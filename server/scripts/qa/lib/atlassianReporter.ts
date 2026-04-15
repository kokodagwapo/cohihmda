/**
 * Atlassian Reporter for QA Runner
 *
 * Handles two integrations:
 *   1. Confluence — updates a living "QA Results" page per environment.
 *      Uses GET-then-PUT with version+1 to avoid conflict errors.
 *   2. Jira — creates a Bug issue on failure (deduplicated via JQL) or
 *      posts a success comment on the tracking ticket.
 *
 * All operations are best-effort: failures are logged as warnings and do
 * NOT cause the runner to exit with a non-zero code.
 *
 * Auth: Basic auth (email:apiToken) against ATLASSIAN_SITE_URL.
 */

import { QaRunSummary, FailedTest } from "./resultParser.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface AtlassianConfig {
  siteUrl: string;   // e.g. "cohi.atlassian.net"
  email: string;
  apiToken: string;
  confluencePageId: string;
  jiraProjectKey: string;
  jiraParentIssue: string;
  jiraTrackingIssue: string;
  createBugsInProd: boolean;
}

function loadConfig(): AtlassianConfig | null {
  const siteUrl = process.env.ATLASSIAN_SITE_URL;
  const email = process.env.ATLASSIAN_EMAIL;
  const apiToken = process.env.ATLASSIAN_API_TOKEN;

  if (!siteUrl || !email || !apiToken) {
    console.warn(
      "[AtlassianReporter] ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL, or ATLASSIAN_API_TOKEN not set — skipping Atlassian reporting"
    );
    return null;
  }

  return {
    siteUrl,
    email,
    apiToken,
    confluencePageId: process.env.CONFLUENCE_QA_PAGE_ID ?? "",
    jiraProjectKey: process.env.QA_JIRA_PROJECT_KEY ?? "COHI",
    jiraParentIssue: process.env.QA_JIRA_PARENT_ISSUE ?? "",
    jiraTrackingIssue: process.env.QA_JIRA_TRACKING_ISSUE ?? "",
    // Default to false in prod to prevent alert noise
    createBugsInProd: process.env.QA_CREATE_BUGS_IN_PROD === "true",
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function authHeader(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function confluenceRequest(
  cfg: AtlassianConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<any> {
  const url = `https://${cfg.siteUrl}/wiki${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(cfg.email, cfg.apiToken),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Confluence ${method} ${path} failed ${resp.status}: ${text.slice(0, 300)}`);
  }

  const ct = resp.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return resp.json();
  return null;
}

async function jiraRequest(
  cfg: AtlassianConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<any> {
  const url = `https://${cfg.siteUrl}/rest/api/3${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(cfg.email, cfg.apiToken),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Jira ${method} ${path} failed ${resp.status}: ${text.slice(0, 300)}`);
  }

  const ct = resp.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return resp.json();
  return null;
}

// ---------------------------------------------------------------------------
// Confluence
// ---------------------------------------------------------------------------

function buildConfluenceMarkdown(opts: {
  summary: QaRunSummary;
  suite: string;
  environment: string;
  buildNumber: string;
  commitHash: string;
  s3ReportKey: string | null;
  bucket: string | null;
}): string {
  const { summary, suite, environment, buildNumber, commitHash, s3ReportKey, bucket } = opts;
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
  const status = summary.failed > 0 ? "FAILED" : "PASSED";
  const ts = new Date().toISOString();

  const reportLink =
    s3ReportKey && bucket
      ? `[Download Report](https://${bucket}.s3.amazonaws.com/${s3ReportKey})`
      : "_Report not uploaded_";

  const failureSection =
    summary.failedTests.length > 0
      ? [
          "## Failed Tests",
          "",
          ...summary.failedTests.map(
            (t) =>
              `- **${t.title}** (\`${t.file}\`)\n  \`\`\`\n  ${t.error}\n  \`\`\``
          ),
        ].join("\n")
      : "";

  return [
    `# QA Results — ${environment.toUpperCase()} | ${status}`,
    "",
    `> Last updated: ${ts}`,
    "",
    "## Summary",
    "",
    `| | |`,
    `|---|---|`,
    `| Suite | ${suite} |`,
    `| Build | #${buildNumber} |`,
    `| Commit | \`${commitHash.slice(0, 8)}\` |`,
    `| Total Tests | ${summary.total} |`,
    `| Passed | ${summary.passed} |`,
    `| Failed | ${summary.failed} |`,
    `| Skipped | ${summary.skipped} |`,
    `| Pass Rate | ${passRate}% |`,
    `| Duration | ${(summary.durationMs / 1000).toFixed(1)}s |`,
    `| Report | ${reportLink} |`,
    "",
    failureSection,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

export async function updateConfluencePage(opts: {
  summary: QaRunSummary;
  suite: string;
  environment: string;
  buildNumber: string;
  commitHash: string;
  s3ReportKey: string | null;
}): Promise<string | null> {
  const cfg = loadConfig();
  if (!cfg || !cfg.confluencePageId) {
    console.warn("[AtlassianReporter] CONFLUENCE_QA_PAGE_ID not set, skipping Confluence update");
    return null;
  }

  try {
    // Step 1: GET current page to read version number (required for updates)
    const current = await confluenceRequest(cfg, "GET", `/api/v2/pages/${cfg.confluencePageId}`);
    const currentVersion: number = current?.version?.number ?? 0;

    const markdown = buildConfluenceMarkdown({
      ...opts,
      bucket: process.env.AI_ARTIFACTS_BUCKET ?? null,
    });

    // Step 2: PUT with version+1
    await confluenceRequest(cfg, "PUT", `/api/v2/pages/${cfg.confluencePageId}`, {
      id: cfg.confluencePageId,
      status: "current",
      title: `QA Results — ${opts.environment.toUpperCase()}`,
      body: {
        representation: "wiki",
        value: markdown,
      },
      version: { number: currentVersion + 1, message: `Build #${opts.buildNumber}` },
    });

    const pageUrl = `https://${cfg.siteUrl}/wiki/pages/${cfg.confluencePageId}`;
    console.log(`[AtlassianReporter] Confluence page updated: ${pageUrl}`);
    return pageUrl;
  } catch (err) {
    console.warn("[AtlassianReporter] Confluence update failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

async function findOpenFailureBug(
  cfg: AtlassianConfig,
  suite: string,
  environment: string
): Promise<string | null> {
  const label = `qa-automated-${environment}-${suite}`;
  const jql = `project = ${cfg.jiraProjectKey} AND issuetype = Bug AND labels = "${label}" AND statusCategory != Done ORDER BY created DESC`;

  try {
    const result = await jiraRequest(cfg, "GET", `/search?jql=${encodeURIComponent(jql)}&maxResults=1`);
    const issues = result?.issues ?? [];
    return issues[0]?.key ?? null;
  } catch (err) {
    console.warn("[AtlassianReporter] JQL search failed:", err);
    return null;
  }
}

function buildJiraBugDescription(summary: QaRunSummary, suite: string, buildNumber: string, s3ReportKey: string | null): string {
  const failureLines = summary.failedTests
    .slice(0, 20)
    .map((t) => `* *${t.title}* (${t.file})\n{noformat}${t.error}{noformat}`)
    .join("\n");

  const reportNote = s3ReportKey
    ? `\nReport: s3://${process.env.AI_ARTIFACTS_BUCKET ?? ""}/${s3ReportKey}`
    : "";

  return [
    `Automated QA detected *${summary.failed}* failing test(s) in suite *${suite}* (Build #${buildNumber}).`,
    "",
    "h3. Failed Tests",
    failureLines || "_No failure details available_",
    reportNote,
  ].join("\n");
}

export async function reportFailuresToJira(opts: {
  summary: QaRunSummary;
  suite: string;
  environment: string;
  buildNumber: string;
  s3ReportKey: string | null;
}): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return;

  // Safety switch: in prod, only create bugs if explicitly enabled
  if (opts.environment === "production" && !cfg.createBugsInProd) {
    console.log("[AtlassianReporter] QA_CREATE_BUGS_IN_PROD=false — skipping bug creation in prod");
    return;
  }

  const { summary } = opts;

  if (summary.failed === 0) {
    console.log("[AtlassianReporter] No failures, skipping Jira bug creation");
    return;
  }
  const label = `qa-automated-${opts.environment}-${opts.suite}`;

  try {
    const existingKey = await findOpenFailureBug(cfg, opts.suite, opts.environment);

    if (existingKey) {
      // Deduplication: add comment to existing bug
      const commentText = `Build #${opts.buildNumber}: *${summary.failed}* test(s) still failing (${summary.passed}/${summary.total} passed).`;
      await jiraRequest(cfg, "POST", `/issue/${existingKey}/comment`, {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: commentText }],
            },
          ],
        },
      });
      console.log(`[AtlassianReporter] Failure comment added to existing bug ${existingKey}`);
    } else {
      // Create new bug
      const issueBody: Record<string, unknown> = {
        fields: {
          project: { key: cfg.jiraProjectKey },
          issuetype: { name: "Bug" },
          summary: `[QA] ${summary.failed} test(s) failed — ${opts.suite} / Build #${opts.buildNumber}`,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: buildJiraBugDescription(summary, opts.suite, opts.buildNumber, opts.s3ReportKey),
                  },
                ],
              },
            ],
          },
          labels: [label, "qa-automated", `environment:${opts.environment}`],
        },
      };

      const created = await jiraRequest(cfg, "POST", "/issue", issueBody);
      const issueKey = created?.key;
      console.log(`[AtlassianReporter] Jira bug created: ${issueKey}`);

      // Link to tracking issue if configured (best-effort, don't break on failure)
      if (issueKey && cfg.jiraTrackingIssue) {
        try {
          // Get available link types
          const linkTypes = await jiraRequest(cfg, "GET", "/issueLinkType");
          const relatesType = (linkTypes?.issueLinkTypes ?? []).find(
            (lt: any) => lt.name === "Relates" || lt.inward === "is related to"
          );

          if (relatesType) {
            await jiraRequest(cfg, "POST", "/issueLink", {
              type: { id: relatesType.id },
              inwardIssue: { key: issueKey },
              outwardIssue: { key: cfg.jiraTrackingIssue },
            });
            console.log(`[AtlassianReporter] Linked ${issueKey} → ${cfg.jiraTrackingIssue}`);
          }
        } catch (linkErr) {
          console.warn("[AtlassianReporter] Failed to create issue link:", linkErr);
        }
      }
    }
  } catch (err) {
    console.warn("[AtlassianReporter] Jira bug creation/comment failed:", err);
  }
}

export async function reportSuccessToJira(opts: {
  summary: QaRunSummary;
  suite: string;
  environment: string;
  buildNumber: string;
  confluencePageUrl: string | null;
}): Promise<void> {
  const cfg = loadConfig();
  if (!cfg || !cfg.jiraTrackingIssue) return;

  const passRate = opts.summary.total > 0
    ? Math.round((opts.summary.passed / opts.summary.total) * 100)
    : 0;
  const duration = (opts.summary.durationMs / 1000).toFixed(1);

  const text =
    `Build #${opts.buildNumber} ✅ ${opts.summary.passed}/${opts.summary.total} tests passed ` +
    `(${passRate}%) in suite *${opts.suite}* (${opts.environment}, ${duration}s).` +
    (opts.confluencePageUrl ? ` [View Report](${opts.confluencePageUrl})` : "");

  try {
    await jiraRequest(cfg, "POST", `/issue/${cfg.jiraTrackingIssue}/comment`, {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text }],
          },
        ],
      },
    });
    console.log(`[AtlassianReporter] Success comment posted on ${cfg.jiraTrackingIssue}`);
  } catch (err) {
    console.warn("[AtlassianReporter] Failed to post success comment:", err);
  }
}
