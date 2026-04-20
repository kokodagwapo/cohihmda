import { listActionsByStatus, transitionAction } from "../../src/services/aiAgentOrchestrator.js";

interface AtlassianConfig {
  siteUrl: string;
  email: string;
  apiToken: string;
}

function loadConfig(): AtlassianConfig | null {
  const rawSiteUrl = process.env.ATLASSIAN_SITE_URL;
  const email = process.env.ATLASSIAN_EMAIL;
  const apiToken = process.env.ATLASSIAN_API_TOKEN;
  if (!rawSiteUrl || !email || !apiToken) {
    console.warn("[poll-jira-approvals] Atlassian credentials are not configured; skipping");
    return null;
  }
  return {
    siteUrl: rawSiteUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, ""),
    email,
    apiToken,
  };
}

function authHeader(cfg: AtlassianConfig): string {
  return "Basic " + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
}

async function fetchIssueStatus(cfg: AtlassianConfig, issueKey: string): Promise<string | null> {
  const response = await fetch(
    `https://${cfg.siteUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`,
    {
      headers: {
        Authorization: authHeader(cfg),
        Accept: "application/json",
        "Accept-Language": "en-US",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to fetch ${issueKey}: ${response.status} ${text.slice(0, 300)}`);
  }
  const payload = (await response.json()) as { fields?: { status?: { name?: string } } };
  return payload.fields?.status?.name ?? null;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    return;
  }

  const pending = await listActionsByStatus("pending_evidence_review");
  if (pending.length === 0) {
    console.log("[poll-jira-approvals] No pending evidence-review actions found");
    return;
  }

  for (const row of pending) {
    const issueKey = String(row.metadata?.issueKey ?? "");
    if (!issueKey) {
      continue;
    }

    try {
      const statusName = (await fetchIssueStatus(cfg, issueKey))?.toLowerCase() ?? "";
      if (statusName.includes("approved")) {
        await transitionAction({
          actionId: row.action_id,
          status: "evidence_approved",
          approvalNote: `Jira poll observed approved state for ${issueKey}`,
          metadata: {
            ...(row.metadata ?? {}),
            issueKey,
            jiraPolledStatus: statusName,
          },
        });
        console.log(`[poll-jira-approvals] Marked ${row.action_id} as evidence_approved`);
      } else if (statusName.includes("rejected")) {
        await transitionAction({
          actionId: row.action_id,
          status: "evidence_rejected",
          approvalNote: `Jira poll observed rejected state for ${issueKey}`,
          metadata: {
            ...(row.metadata ?? {}),
            issueKey,
            jiraPolledStatus: statusName,
          },
        });
        console.log(`[poll-jira-approvals] Marked ${row.action_id} as evidence_rejected`);
      }
    } catch (error) {
      console.warn(
        `[poll-jira-approvals] Failed to inspect ${issueKey}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

main().catch((error) => {
  console.error("[poll-jira-approvals] Fatal error:", error);
  process.exitCode = 1;
});
