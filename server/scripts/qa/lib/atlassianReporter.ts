/**
 * Atlassian Reporter for QA Runner
 *
 * Handles three integrations:
 *   1. Jira target resolution from discovered issue keys.
 *   2. Confluence QA pages, one child page per Jira issue.
 *   3. Jira bug/comment reporting against those resolved issues.
 *
 * All operations are best-effort: failures are logged as warnings and do
 * NOT cause the runner to exit with a non-zero code.
 *
 * Auth: Basic auth (email:apiToken) against ATLASSIAN_SITE_URL.
 */

import { QaRunSummary } from "./resultParser.js";

interface AtlassianConfig {
  siteUrl: string;
  email: string;
  apiToken: string;
  confluenceParentPageId: string;
  jiraProjectKey: string;
  jiraFallbackIssue: string;
  createBugsInProd: boolean;
}

export interface QaTargetIssue {
  issueKey: string;
  issueSummary: string;
  issueStatus: string;
  issueUrl: string;
  confluencePageId?: string | null;
  confluencePageUrl?: string | null;
}

export interface QaArtifactLink {
  label: string;
  s3Key: string;
  consoleUrl: string;
  directUrl: string;
  contentType?: string;
}

function loadConfig(): AtlassianConfig | null {
  const rawSiteUrl = process.env.ATLASSIAN_SITE_URL;
  const email = process.env.ATLASSIAN_EMAIL;
  const apiToken = process.env.ATLASSIAN_API_TOKEN;

  if (!rawSiteUrl || !email || !apiToken) {
    console.warn(
      "[AtlassianReporter] ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL, or ATLASSIAN_API_TOKEN not set — skipping Atlassian reporting"
    );
    return null;
  }

  const siteUrl = rawSiteUrl
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  return {
    siteUrl,
    email,
    apiToken,
    confluenceParentPageId: process.env.CONFLUENCE_QA_PARENT_PAGE_ID ?? "",
    jiraProjectKey: process.env.QA_JIRA_PROJECT_KEY ?? "COHI",
    jiraFallbackIssue: process.env.QA_JIRA_FALLBACK_ISSUE ?? "",
    createBugsInProd: process.env.QA_CREATE_BUGS_IN_PROD === "true",
  };
}

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

  return parseJsonResponse(resp);
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

  return parseJsonResponse(resp);
}

async function parseJsonResponse(resp: Response): Promise<any> {
  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;

  const rawText = await resp.text().catch(() => "");
  const text = typeof rawText === "string" ? rawText : "";
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildConfluencePageTitle(target: QaTargetIssue): string {
  return `QA - ${target.issueKey}`;
}

function adfText(text: string, href?: string) {
  return href
    ? {
        type: "text",
        text,
        marks: [{ type: "link", attrs: { href } }],
      }
    : { type: "text", text };
}

function adfParagraph(content: Array<Record<string, unknown>> | string) {
  return {
    type: "paragraph",
    content: typeof content === "string" ? [adfText(content)] : content,
  };
}

function adfHeading(level: number, text: string) {
  return {
    type: "heading",
    attrs: { level },
    content: [adfText(text)],
  };
}

function adfTableCell(text: string, isHeader = false) {
  return {
    type: isHeader ? "tableHeader" : "tableCell",
    attrs: { colspan: 1, rowspan: 1 },
    content: [adfParagraph(text)],
  };
}

function adfBulletList(items: Array<Array<Record<string, unknown>> | string>) {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [adfParagraph(item)],
    })),
  };
}

function buildConfluenceAdf(opts: {
  target: QaTargetIssue;
  summary: QaRunSummary;
  suite: string;
  environment: string;
  buildNumber: string;
  commitHash: string;
  s3ReportKey: string | null;
  bucket: string | null;
  reportConsoleUrl: string | null;
  artifacts: QaArtifactLink[];
}): string {
  const {
    target,
    summary,
    suite,
    environment,
    buildNumber,
    commitHash,
    s3ReportKey,
    bucket,
    reportConsoleUrl,
    artifacts,
  } = opts;
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
  const ts = new Date().toISOString();
  const reportTarget = reportConsoleUrl ?? (
    s3ReportKey && bucket ? `https://${bucket}.s3.amazonaws.com/${s3ReportKey}` : undefined
  );

  return {
    type: "doc",
    version: 1,
    content: [
      adfHeading(1, buildConfluencePageTitle(target)),
      adfParagraph([adfText("Jira issue: "), adfText(target.issueKey, target.issueUrl)]),
      adfParagraph(`Issue summary: ${target.issueSummary}`),
      adfParagraph(`Issue status: ${target.issueStatus}`),
      adfParagraph(`Last updated: ${ts}`),
      adfHeading(2, "Summary"),
      {
        type: "table",
        attrs: { layout: "default" },
        content: [
          {
            type: "tableRow",
            content: [adfTableCell("Property", true), adfTableCell("Value", true)],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Environment"), adfTableCell(environment)],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Suite"), adfTableCell(suite)],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Build"), adfTableCell(`#${buildNumber}`)],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Commit"), adfTableCell(commitHash.slice(0, 8))],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Total Tests"), adfTableCell(String(summary.total))],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Passed"), adfTableCell(String(summary.passed))],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Failed"), adfTableCell(String(summary.failed))],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Skipped"), adfTableCell(String(summary.skipped))],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Pass Rate"), adfTableCell(`${passRate}%`)],
          },
          {
            type: "tableRow",
            content: [adfTableCell("Duration"), adfTableCell(`${(summary.durationMs / 1000).toFixed(1)}s`)],
          },
          {
            type: "tableRow",
            content: [
              adfTableCell("Report"),
              {
                type: "tableCell",
                attrs: { colspan: 1, rowspan: 1 },
                content: [adfParagraph(reportTarget ? [adfText("Open report in AWS Console", reportTarget)] : "Report not uploaded")],
              },
            ],
          },
        ],
      },
      adfHeading(2, "Failed Tests"),
      adfBulletList(
        summary.failedTests.length > 0
          ? summary.failedTests.map((t) => `${t.title} (${t.file}) - ${t.error}`)
          : ["No failing tests in this run."]
      ),
      adfHeading(2, "Artifacts"),
      adfBulletList(
        artifacts.length > 0
          ? artifacts.map((a) => [
              adfText(`${a.label}: `),
              adfText("AWS Console", a.consoleUrl),
              adfText(" | "),
              adfText("Direct link", a.directUrl),
            ])
          : ["No failure artifacts were uploaded for this run."]
      ),
    ],
  };
}

function toAdfParagraph(text: string) {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

async function getConfluenceParent(cfg: AtlassianConfig): Promise<{ id: string; spaceId: string }> {
  const parent = await confluenceRequest(cfg, "GET", `/api/v2/pages/${cfg.confluenceParentPageId}`);
  return {
    id: String(parent?.id ?? cfg.confluenceParentPageId),
    spaceId: String(parent?.spaceId ?? ""),
  };
}

async function findConfluencePageByTitle(
  cfg: AtlassianConfig,
  title: string,
  spaceId: string
): Promise<string | null> {
  const result = await confluenceRequest(
    cfg,
    "GET",
    `/api/v2/pages?title=${encodeURIComponent(title)}&space-id=${encodeURIComponent(spaceId)}`
  );
  const pages = result?.results ?? [];
  const page = pages.find((entry: any) => entry?.title === title);
  return page?.id ? String(page.id) : null;
}

async function upsertConfluencePageForTarget(
  cfg: AtlassianConfig,
  target: QaTargetIssue,
  opts: {
    summary: QaRunSummary;
    suite: string;
    environment: string;
    buildNumber: string;
    commitHash: string;
    s3ReportKey: string | null;
    reportConsoleUrl: string | null;
    artifacts: QaArtifactLink[];
    parent: { id: string; spaceId: string };
  }
): Promise<QaTargetIssue> {
  const title = buildConfluencePageTitle(target);
  const adfBody = buildConfluenceAdf({
    target,
    summary: opts.summary,
    suite: opts.suite,
    environment: opts.environment,
    buildNumber: opts.buildNumber,
    commitHash: opts.commitHash,
    s3ReportKey: opts.s3ReportKey,
    bucket: process.env.AI_ARTIFACTS_BUCKET ?? null,
    reportConsoleUrl: opts.reportConsoleUrl,
    artifacts: opts.artifacts,
  });

  const existingPageId = await findConfluencePageByTitle(cfg, title, opts.parent.spaceId);

  if (existingPageId) {
    const current = await confluenceRequest(cfg, "GET", `/api/v2/pages/${existingPageId}`);
    const currentVersion: number = current?.version?.number ?? 0;

    await confluenceRequest(cfg, "PUT", `/api/v2/pages/${existingPageId}`, {
      id: existingPageId,
      status: "current",
      title,
      body: {
        representation: "atlas_doc_format",
        value: JSON.stringify(adfBody),
      },
      version: { number: currentVersion + 1, message: `Build #${opts.buildNumber}` },
    });

    return {
      ...target,
      confluencePageId: existingPageId,
      confluencePageUrl: `https://${cfg.siteUrl}/wiki/pages/${existingPageId}`,
    };
  }

  const created = await confluenceRequest(cfg, "POST", "/api/v2/pages", {
    spaceId: opts.parent.spaceId,
    status: "current",
    title,
    parentId: opts.parent.id,
    body: {
      representation: "atlas_doc_format",
      value: JSON.stringify(adfBody),
    },
  });

  const createdPageId = String(created?.id ?? "");
  return {
    ...target,
    confluencePageId: createdPageId,
    confluencePageUrl: createdPageId
      ? `https://${cfg.siteUrl}/wiki/pages/${createdPageId}`
      : null,
  };
}

function findFallbackIssueKeys(cfg: AtlassianConfig, issueKeys: string[]): string[] {
  if (issueKeys.length > 0) return issueKeys;
  return cfg.jiraFallbackIssue ? [cfg.jiraFallbackIssue] : [];
}

export async function resolveQaTargets(issueKeys: string[]): Promise<QaTargetIssue[]> {
  const cfg = loadConfig();
  if (!cfg) return [];

  const keys = unique(findFallbackIssueKeys(cfg, issueKeys));
  if (keys.length === 0) {
    console.warn("[AtlassianReporter] No Jira issue keys discovered and no fallback issue configured");
    return [];
  }

  const targets: QaTargetIssue[] = [];

  for (const issueKey of keys) {
    try {
      const issue = await jiraRequest(
        cfg,
        "GET",
        `/issue/${encodeURIComponent(issueKey)}?fields=summary,status`
      );
      targets.push({
        issueKey,
        issueSummary: String(issue?.fields?.summary ?? "Unknown issue"),
        issueStatus: String(issue?.fields?.status?.name ?? "Unknown"),
        issueUrl: `https://${cfg.siteUrl}/browse/${issueKey}`,
      });
    } catch (err) {
      console.warn(`[AtlassianReporter] Failed to resolve Jira issue ${issueKey}:`, err);
    }
  }

  return targets;
}

export async function updateConfluencePages(opts: {
  targets: QaTargetIssue[];
  summary: QaRunSummary;
  suite: string;
  environment: string;
  buildNumber: string;
  commitHash: string;
  s3ReportKey: string | null;
  reportConsoleUrl: string | null;
  artifacts: QaArtifactLink[];
}): Promise<QaTargetIssue[]> {
  const cfg = loadConfig();
  if (!cfg) return opts.targets;

  if (!cfg.confluenceParentPageId) {
    console.warn(
      "[AtlassianReporter] CONFLUENCE_QA_PARENT_PAGE_ID not set, skipping Confluence updates"
    );
    return opts.targets;
  }

  if (opts.targets.length === 0) {
    console.warn("[AtlassianReporter] No resolved Jira targets, skipping Confluence page creation");
    return opts.targets;
  }

  try {
    const parent = await getConfluenceParent(cfg);
    const enrichedTargets: QaTargetIssue[] = [];

    for (const target of opts.targets) {
      try {
        const enriched = await upsertConfluencePageForTarget(cfg, target, {
          summary: opts.summary,
          suite: opts.suite,
          environment: opts.environment,
          buildNumber: opts.buildNumber,
          commitHash: opts.commitHash,
          s3ReportKey: opts.s3ReportKey,
          reportConsoleUrl: opts.reportConsoleUrl,
          artifacts: opts.artifacts,
          parent,
        });
        console.log(`[AtlassianReporter] Confluence page synced for ${target.issueKey}: ${enriched.confluencePageUrl}`);
        enrichedTargets.push(enriched);
      } catch (err) {
        console.warn(`[AtlassianReporter] Confluence sync failed for ${target.issueKey}:`, err);
        enrichedTargets.push(target);
      }
    }

    return enrichedTargets;
  } catch (err) {
    console.warn("[AtlassianReporter] Confluence update failed:", err);
    return opts.targets;
  }
}

async function findOpenFailureBug(
  cfg: AtlassianConfig,
  suite: string,
  environment: string,
  target: QaTargetIssue
): Promise<string | null> {
  const runLabel = `qa-automated-${environment}-${suite}`;
  const targetLabel = `qa-target-${target.issueKey.toLowerCase()}`;
  const jql = `project = ${cfg.jiraProjectKey} AND issuetype = Bug AND labels = "${runLabel}" AND labels = "${targetLabel}" AND statusCategory != Done ORDER BY created DESC`;

  try {
    const result = await jiraRequest(cfg, "GET", `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=1`);
    const issues = result?.issues ?? [];
    return issues[0]?.key ?? null;
  } catch (err) {
    console.warn("[AtlassianReporter] JQL search failed:", err);
    return null;
  }
}

function buildJiraBugDescription(opts: {
  summary: QaRunSummary;
  suite: string;
  buildNumber: string;
  s3ReportKey: string | null;
  target: QaTargetIssue;
  reportConsoleUrl: string | null;
  artifacts: QaArtifactLink[];
}): string {
  const failureLines = opts.summary.failedTests
    .slice(0, 20)
    .map((t) => `- ${t.title} (${t.file})\n${t.error}`)
    .join("\n");

  const reportNote = opts.s3ReportKey
    ? `\nReport (AWS Console): ${opts.reportConsoleUrl ?? "not available"}\nReport (S3 URI): s3://${process.env.AI_ARTIFACTS_BUCKET ?? ""}/${opts.s3ReportKey}`
    : "";

  const confluenceNote = opts.target.confluencePageUrl
    ? `\nConfluence QA page: ${opts.target.confluencePageUrl}`
    : "";

  const artifactNote = opts.artifacts.length > 0
    ? `\nArtifacts:\n${opts.artifacts
        .map((artifact) => `- ${artifact.label}: ${artifact.consoleUrl}`)
        .join("\n")}`
    : "";

  return [
    `Automated QA detected *${opts.summary.failed}* failing test(s) in suite *${opts.suite}* (Build #${opts.buildNumber}).`,
    `Related Jira item: ${opts.target.issueKey} - ${opts.target.issueSummary}`,
    "",
    "h3. Failed Tests",
    failureLines || "_No failure details available_",
    reportNote,
    confluenceNote,
    artifactNote,
  ].join("\n");
}

export async function reportFailuresToJira(opts: {
  targets: QaTargetIssue[];
  summary: QaRunSummary;
  suite: string;
  environment: string;
  buildNumber: string;
  s3ReportKey: string | null;
  reportConsoleUrl: string | null;
  artifacts: QaArtifactLink[];
}): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return;

  if (opts.environment === "production" && !cfg.createBugsInProd) {
    console.log("[AtlassianReporter] QA_CREATE_BUGS_IN_PROD=false — skipping bug creation in prod");
    return;
  }

  if (opts.summary.failed === 0) {
    console.log("[AtlassianReporter] No failures, skipping Jira bug creation");
    return;
  }

  if (opts.targets.length === 0) {
    console.warn("[AtlassianReporter] No resolved Jira targets, skipping Jira failure reporting");
    return;
  }

  for (const target of opts.targets) {
    const runLabel = `qa-automated-${opts.environment}-${opts.suite}`;
    const targetLabel = `qa-target-${target.issueKey.toLowerCase()}`;

    try {
      const existingKey = await findOpenFailureBug(cfg, opts.suite, opts.environment, target);

      if (existingKey) {
        const commentText =
          `Build #${opts.buildNumber}: *${opts.summary.failed}* test(s) still failing ` +
          `for ${target.issueKey} (${opts.summary.passed}/${opts.summary.total} passed).`;
        await jiraRequest(cfg, "POST", `/issue/${existingKey}/comment`, {
          body: {
            type: "doc",
            version: 1,
            content: [toAdfParagraph(commentText)],
          },
        });
        console.log(`[AtlassianReporter] Failure comment added to existing bug ${existingKey}`);
        continue;
      }

      const created = await jiraRequest(cfg, "POST", "/issue", {
        fields: {
          project: { key: cfg.jiraProjectKey },
          issuetype: { name: "Bug" },
          summary: `[QA][${target.issueKey}] ${opts.summary.failed} test(s) failed — ${opts.suite} / Build #${opts.buildNumber}`,
          description: {
            type: "doc",
            version: 1,
            content: [
              toAdfParagraph(
                buildJiraBugDescription({
                  summary: opts.summary,
                  suite: opts.suite,
                  buildNumber: opts.buildNumber,
                  s3ReportKey: opts.s3ReportKey,
                  target,
                  reportConsoleUrl: opts.reportConsoleUrl,
                  artifacts: opts.artifacts,
                })
              ),
            ],
          },
          labels: [runLabel, targetLabel, "qa-automated", `environment:${opts.environment}`],
        },
      });

      const issueKey = created?.key;
      console.log(`[AtlassianReporter] Jira bug created for ${target.issueKey}: ${issueKey}`);

      if (issueKey) {
        try {
          const linkTypes = await jiraRequest(cfg, "GET", "/issueLinkType");
          const relatesType = (linkTypes?.issueLinkTypes ?? []).find(
            (lt: any) => lt.name === "Relates" || lt.inward === "is related to"
          );

          if (relatesType) {
            await jiraRequest(cfg, "POST", "/issueLink", {
              type: { id: relatesType.id },
              inwardIssue: { key: issueKey },
              outwardIssue: { key: target.issueKey },
            });
            console.log(`[AtlassianReporter] Linked ${issueKey} → ${target.issueKey}`);
          }
        } catch (linkErr) {
          console.warn("[AtlassianReporter] Failed to create issue link:", linkErr);
        }
      }
    } catch (err) {
      console.warn(`[AtlassianReporter] Jira bug creation/comment failed for ${target.issueKey}:`, err);
    }
  }
}

export async function reportSuccessToJira(opts: {
  targets: QaTargetIssue[];
  summary: QaRunSummary;
  suite: string;
  environment: string;
  buildNumber: string;
}): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return;

  if (opts.targets.length === 0) {
    console.warn("[AtlassianReporter] No resolved Jira targets, skipping Jira success comments");
    return;
  }

  const passRate = opts.summary.total > 0
    ? Math.round((opts.summary.passed / opts.summary.total) * 100)
    : 0;
  const duration = (opts.summary.durationMs / 1000).toFixed(1);

  for (const target of opts.targets) {
    const text =
      `Build #${opts.buildNumber} passed ${opts.summary.passed}/${opts.summary.total} tests ` +
      `(${passRate}%) in suite *${opts.suite}* (${opts.environment}, ${duration}s).` +
      (target.confluencePageUrl ? ` QA page: ${target.confluencePageUrl}` : "");

    try {
      await jiraRequest(cfg, "POST", `/issue/${target.issueKey}/comment`, {
        body: {
          type: "doc",
          version: 1,
          content: [toAdfParagraph(text)],
        },
      });
      console.log(`[AtlassianReporter] Success comment posted on ${target.issueKey}`);
    } catch (err) {
      console.warn(`[AtlassianReporter] Failed to post success comment on ${target.issueKey}:`, err);
    }
  }
}
