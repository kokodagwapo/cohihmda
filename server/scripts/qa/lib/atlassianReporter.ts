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

import { QaRunSummary, type TestResult } from "./resultParser.js";
import type { IssueAcValidationResult } from "../ai/types.js";

interface AtlassianConfig {
  siteUrl: string;
  email: string;
  apiToken: string;
  confluenceParentPageId: string;
  jiraProjectKey: string;
  createBugsInProd: boolean;
}

export interface QaTargetIssue {
  issueKey: string;
  issueSummary: string;
  issueStatus: string;
  issueUrl: string;
  confluencePageId?: string | null;
  confluencePageUrl?: string | null;
  hasEvidenceGap?: boolean;
  acValidation?: IssueAcValidationResult;
}

export interface QaArtifactLink {
  label: string;
  s3Key: string;
  consoleUrl: string;
  directUrl: string;
  contentType?: string;
  localPath?: string;
}

export interface QaRelatedCommit {
  hash: string;
  shortHash: string;
  subject: string;
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

interface ConfluenceAttachmentMeta {
  fileId: string;
  mediaType: string;
  attachmentId: string;
  title: string;
}

/**
 * Upload a single file as a Confluence page attachment and return the media
 * metadata needed to embed it inline via ADF.
 *
 * Uses the v1 `child/attachment` endpoint because the v1 response reliably
 * surfaces `extensions.fileId` (the Atlassian media UUID), which is what
 * `mediaSingle`/`media` ADF nodes reference. The v2 attachments API stores
 * the same metadata but at time of writing returns a different response
 * shape that doesn't expose the media UUID as cleanly.
 *
 * Notes:
 *   - `X-Atlassian-Token: no-check` is required by Confluence for any
 *     attachment upload — it disables the XSRF token check that browsers
 *     would normally satisfy via cookie. Without it you get `403: XSRF
 *     check failed`.
 *   - We always set `minorEdit=true` so each screenshot upload does not
 *     bump the page's "latest edit" in the human-facing Confluence
 *     activity feed. Reviewers scanning "recent changes" should see
 *     pipeline-triggered page version bumps, not 10 individual
 *     attachment-added events.
 *   - If a file with the same `title` already exists on the page,
 *     Confluence returns 400. We side-step this by making the title
 *     unique per build (caller prefixes with `b{buildNumber}-`), which
 *     also gives reviewers "which run did this come from?" context
 *     without having to open the file.
 */
async function uploadConfluenceAttachment(
  cfg: AtlassianConfig,
  pageId: string,
  fileBytes: Buffer,
  filename: string,
  contentType: string,
): Promise<ConfluenceAttachmentMeta | null> {
  const url = `https://${cfg.siteUrl}/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment?minorEdit=true`;

  const form = new FormData();
  // Convert the Buffer to a Blob so undici's FormData accepts it; node's
  // built-in FormData requires a Blob-compatible value.
  const blob = new Blob([new Uint8Array(fileBytes)], { type: contentType });
  form.append("file", blob, filename);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(cfg.email, cfg.apiToken),
      Accept: "application/json",
      "X-Atlassian-Token": "no-check",
    },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Confluence attachment upload for "${filename}" failed ${resp.status}: ${text.slice(0, 300)}`,
    );
  }

  const json = await parseJsonResponse(resp);
  const first = Array.isArray(json?.results) ? json.results[0] : null;
  const fileId: unknown = first?.extensions?.fileId;
  const mediaType: unknown = first?.extensions?.mediaType;
  const attachmentId: unknown = first?.id;
  const title: unknown = first?.title;
  if (
    typeof fileId !== "string" ||
    typeof mediaType !== "string" ||
    typeof attachmentId !== "string"
  ) {
    return null;
  }
  return {
    fileId,
    mediaType,
    attachmentId,
    title: typeof title === "string" ? title : filename,
  };
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

function adfPanel(
  panelType: "info" | "note" | "warning" | "success" | "error",
  content: Array<Record<string, unknown>>,
) {
  return {
    type: "panel",
    attrs: { panelType },
    content,
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

function adfTable(rows: Array<Array<ReturnType<typeof adfTableCell>>>) {
  return {
    type: "table",
    attrs: { layout: "default" },
    content: rows.map((cells) => ({
      type: "tableRow",
      content: cells,
    })),
  };
}

/**
 * Build a block-level `mediaSingle` ADF node that renders a previously
 * uploaded Confluence attachment inline. Used inside the Tests/Evidence
 * table so reviewers see a thumbnail per screenshot instead of a
 * "click-to-open-in-AWS-console" link.
 *
 * `collection` must be `contentId-<pageId>` — that's how Confluence's
 * media service scopes attachments to their owning page. Omitting it or
 * using a bare `media` node without `mediaSingle` results in the image
 * silently not rendering.
 */
function adfAttachmentImage(
  mediaFileId: string,
  pageId: string,
  altText: string,
): Record<string, unknown> {
  return {
    type: "mediaSingle",
    attrs: { layout: "center" },
    content: [
      {
        type: "media",
        attrs: {
          type: "file",
          id: mediaFileId,
          collection: `contentId-${pageId}`,
          alt: altText,
        },
      },
    ],
  };
}

function getTestsForIssue(summary: QaRunSummary, issueKey: string): TestResult[] {
  return summary.tests.filter((test) => test.jiraKeys.includes(issueKey));
}

function getFailedTestsForIssue(summary: QaRunSummary, issueKey: string): TestResult[] {
  return summary.failedTests.filter((test) => test.jiraKeys.includes(issueKey));
}

function getArtifactsForIssue(tests: TestResult[], artifacts: QaArtifactLink[]): QaArtifactLink[] {
  const relevantPaths = new Set(
    tests.flatMap((test) => [...test.screenshotPaths, ...test.tracePaths, ...test.videoPaths]),
  );
  return artifacts.filter((artifact) => artifact.localPath && relevantPaths.has(artifact.localPath));
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
  relatedCommits: QaRelatedCommit[];
  // Caller supplies `pageId` + `mediaByLocalPath` after uploading
  // screenshot attachments. For screenshots with a matching entry we
  // emit an inline `mediaSingle` ADF node; for screenshots without one
  // (upload failure, first-pass build of the page when no id exists yet,
  // or non-image artifacts like traces) we fall back to the old
  // "Open in AWS Console" link, so the evidence row is never empty.
  pageId?: string | null;
  mediaByLocalPath?: Map<string, ConfluenceAttachmentMeta>;
}): Record<string, unknown> {
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
    relatedCommits,
    pageId,
    mediaByLocalPath,
  } = opts;
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
  const ts = new Date().toISOString();
  const testsForIssue = getTestsForIssue(summary, target.issueKey);
  const failedTestsForIssue = getFailedTestsForIssue(summary, target.issueKey);
  const artifactsForIssue = getArtifactsForIssue(testsForIssue, artifacts);
  const hasEvidenceGap = testsForIssue.length === 0;
  const requiresEvidenceApproval =
    target.acValidation?.approvalStatus === "pending_evidence_review" ||
    Boolean(target.acValidation?.evidencePackage);
  // Build the per-row evidence cell. A single test can have screenshots,
  // videos, and traces; we render inline thumbnails for uploaded
  // screenshots (pleasant for reviewers — no AWS roundtrip) and keep
  // videos/traces/DOMs as console links (too large to inline, rarely
  // needed in the common review pass).
  //
  // Returning an array of block-level nodes rather than a single
  // paragraph because `mediaSingle` is a block node — wrapping it inside
  // a paragraph would make Confluence reject the doc.
  const evidenceForTest = (test: TestResult): Array<Record<string, unknown>> => {
    const screenshotPaths = new Set(test.screenshotPaths);
    const linkPaths = new Set([...test.tracePaths, ...test.videoPaths]);
    const matchingArtifacts = artifactsForIssue.filter(
      (artifact) => artifact.localPath && (screenshotPaths.has(artifact.localPath) || linkPaths.has(artifact.localPath)),
    );
    if (matchingArtifacts.length === 0) {
      return [adfParagraph("n/a")];
    }

    const blocks: Array<Record<string, unknown>> = [];
    const screenshotArtifacts = matchingArtifacts.filter(
      (a) => a.localPath && screenshotPaths.has(a.localPath),
    );
    const nonScreenshotArtifacts = matchingArtifacts.filter(
      (a) => a.localPath && !screenshotPaths.has(a.localPath),
    );

    for (const artifact of screenshotArtifacts) {
      const media = artifact.localPath && mediaByLocalPath?.get(artifact.localPath);
      if (media && pageId) {
        blocks.push(adfAttachmentImage(media.fileId, pageId, artifact.label));
        // Caption paragraph below the image identifies which step/test it
        // belongs to; reviewers scrolling the page can tell which
        // assertion produced which screenshot without hovering for alt
        // text.
        blocks.push(adfParagraph([adfText(artifact.label, artifact.consoleUrl)]));
      } else {
        // Upload failed or hasn't happened yet (first-pass body); fall
        // back to the link so the row is never empty.
        blocks.push(adfParagraph([adfText(artifact.label, artifact.consoleUrl)]));
      }
    }

    if (nonScreenshotArtifacts.length > 0) {
      const linkContent: Array<Record<string, unknown>> = [];
      nonScreenshotArtifacts.forEach((artifact, index) => {
        if (index > 0) linkContent.push(adfText(" | "));
        linkContent.push(adfText(artifact.label, artifact.consoleUrl));
      });
      blocks.push(adfParagraph(linkContent));
    }

    return blocks;
  };
  const reportTarget = reportConsoleUrl ?? (
    s3ReportKey && bucket ? `https://${bucket}.s3.amazonaws.com/${s3ReportKey}` : undefined
  );

  return {
    type: "doc",
    version: 1,
    content: [
      adfHeading(1, buildConfluencePageTitle(target)),
      ...(requiresEvidenceApproval
        ? [
            adfPanel("warning", [
              adfParagraph("Approval Required: autonomous QA evidence has been generated and is awaiting human review."),
              ...(target.acValidation?.evidencePackage?.manifestS3Url
                ? [
                    adfParagraph([
                      adfText("Evidence manifest: "),
                      adfText("Open manifest", target.acValidation.evidencePackage.manifestS3Url),
                    ]),
                  ]
                : []),
            ]),
          ]
        : []),
      adfParagraph([adfText("Jira issue: "), adfText(target.issueKey, target.issueUrl)]),
      adfParagraph(`Issue summary: ${target.issueSummary}`),
      adfParagraph(`Issue status: ${target.issueStatus}`),
      adfParagraph(`Last updated: ${ts}`),
      ...(hasEvidenceGap
        ? [
            adfPanel("warning", [
              adfParagraph(
                "Evidence gap: no tests currently verify this issue. Run-level results and related commits are still recorded below."
              ),
            ]),
          ]
        : []),
      adfHeading(2, "Summary"),
      adfTable([
        [adfTableCell("Property", true), adfTableCell("Value", true)],
        [adfTableCell("Environment"), adfTableCell(environment)],
        [adfTableCell("Suite"), adfTableCell(suite)],
        [adfTableCell("Build"), adfTableCell(`#${buildNumber}`)],
        [adfTableCell("Commit"), adfTableCell(commitHash.slice(0, 8))],
        [adfTableCell("Total Tests"), adfTableCell(String(summary.total))],
        [adfTableCell("Passed"), adfTableCell(String(summary.passed))],
        [adfTableCell("Failed"), adfTableCell(String(summary.failed))],
        [adfTableCell("Skipped"), adfTableCell(String(summary.skipped))],
        [adfTableCell("Pass Rate"), adfTableCell(`${passRate}%`)],
        [adfTableCell("Duration"), adfTableCell(`${(summary.durationMs / 1000).toFixed(1)}s`)],
        [
          adfTableCell("Report"),
          {
            type: "tableCell",
            attrs: { colspan: 1, rowspan: 1 },
            content: [adfParagraph(reportTarget ? [adfText("Open report in AWS Console", reportTarget)] : "Report not uploaded")],
          },
        ],
      ]),
      adfHeading(2, "Tests Verifying This Issue"),
      ...(testsForIssue.length > 0
        ? [
            adfTable([
              [
                adfTableCell("Test", true),
                adfTableCell("File", true),
                adfTableCell("Status", true),
                adfTableCell("Duration", true),
                adfTableCell("Evidence", true),
              ],
              ...testsForIssue.map((test) => {
                const evidenceBlocks = evidenceForTest(test);
                return [
                  adfTableCell(test.title),
                  adfTableCell(test.file),
                  adfTableCell(test.status),
                  adfTableCell(`${(test.durationMs / 1000).toFixed(1)}s`),
                  {
                    type: "tableCell",
                    attrs: { colspan: 1, rowspan: 1 },
                    // `evidenceForTest` already returns block-level nodes
                    // (paragraphs and/or `mediaSingle`s); pass them
                    // straight through rather than wrapping in another
                    // paragraph, which would nest blocks inside an inline
                    // container and fail ADF validation.
                    content: evidenceBlocks,
                  },
                ];
              }),
            ]),
          ]
        : [adfParagraph("No tagged tests verified this issue in this run.")]),
      adfHeading(2, "Related Commits"),
      ...(relatedCommits.length > 0
        ? [
            adfBulletList(
              relatedCommits.map((commit) => [
                adfText(`${commit.shortHash}: ${commit.subject}`),
              ]),
            ),
          ]
        : [adfParagraph("No commits mentioning this issue key were found in the scanned range.")]),
      ...(target.acValidation
        ? [
            adfHeading(2, "Acceptance Criteria Validation"),
            adfParagraph(target.acValidation.confluenceSummary ?? "AC validation completed."),
            adfTable([
              [
                adfTableCell("AC", true),
                adfTableCell("Category", true),
                adfTableCell("Status", true),
                adfTableCell("Statement", true),
              ],
              ...target.acValidation.statements.map((statement) => [
                adfTableCell(String(statement.index)),
                adfTableCell(statement.category),
                adfTableCell(statement.status),
                adfTableCell(statement.statement),
              ]),
            ]),
          ]
        : []),
      adfHeading(2, "Failed Tests"),
      adfBulletList(
        failedTestsForIssue.length > 0
          ? failedTestsForIssue.map((t) => `${t.title} (${t.file}) - ${t.error}`)
          : ["No failing tests in this run."]
      ),
      adfHeading(2, "Artifacts"),
      adfBulletList(
        artifactsForIssue.length > 0
          ? artifactsForIssue.map((a) => [
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

/**
 * Build a browser-friendly Confluence page URL from a v2 page response.
 *
 * Confluence v2 page responses include `_links.webui` which is a space-aware
 * relative path such as `/spaces/SRS/pages/1351024641/QA+-+COHI-77`. The bare
 * `/wiki/pages/{id}` form Confluence redirects to works for logged-in users
 * with space access, but it is fragile and shows up as a broken link for
 * users landing without a session. Always prefer the webui path.
 */
function buildConfluencePageUrl(
  cfg: AtlassianConfig,
  page: any,
  fallbackPageId?: string | null,
): string | null {
  const webui: unknown = page?._links?.webui;
  const base: unknown = page?._links?.base;
  if (typeof webui === "string" && webui.length > 0) {
    const normalizedWebui = webui.startsWith("/") ? webui : `/${webui}`;
    const baseUrl =
      typeof base === "string" && base.length > 0
        ? base.replace(/\/$/, "")
        : `https://${cfg.siteUrl}/wiki`;
    return `${baseUrl}${normalizedWebui}`;
  }
  const pageId = String(page?.id ?? fallbackPageId ?? "");
  if (!pageId) return null;
  return `https://${cfg.siteUrl}/wiki/pages/${pageId}`;
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

// Upload every screenshot-class artifact belonging to this issue's tests
// as a Confluence page attachment, and return a map from local file path
// back to Confluence's media metadata. The map is threaded into
// `buildConfluenceAdf` so each test's Evidence cell can render the
// screenshot inline instead of as a "click to open in AWS Console" link.
//
// Behavior / failure modes:
//   - Only image/* MIME types are uploaded inline. Videos and Playwright
//     traces stay as S3 console links — they are too large to inline
//     usefully and reviewers rarely need them in the first pass.
//   - Per-file errors are isolated: one broken screenshot cannot tank
//     the whole page render. We log and skip, and the downstream ADF
//     falls back to a text link for that row.
//   - Filenames are prefixed with `b{buildNumber}-` so re-runs don't
//     collide with Confluence's "attachment with this name already
//     exists" 400, and reviewers get provenance ("which build did this
//     come from?") without opening the file.
async function uploadScreenshotAttachmentsForIssue(
  cfg: AtlassianConfig,
  pageId: string,
  buildNumber: string,
  artifacts: QaArtifactLink[],
  testsForIssue: TestResult[],
): Promise<Map<string, ConfluenceAttachmentMeta>> {
  const result = new Map<string, ConfluenceAttachmentMeta>();

  const screenshotPaths = new Set<string>();
  for (const test of testsForIssue) {
    for (const path of test.screenshotPaths) screenshotPaths.add(path);
  }

  const screenshotArtifacts = artifacts.filter(
    (a) =>
      a.localPath &&
      screenshotPaths.has(a.localPath) &&
      (a.contentType?.startsWith("image/") ?? /\.(png|jpe?g|gif|webp)$/i.test(a.localPath)),
  );

  if (screenshotArtifacts.length === 0) return result;

  const { readFile } = await import("node:fs/promises");
  const { basename } = await import("node:path");

  for (const artifact of screenshotArtifacts) {
    if (!artifact.localPath) continue;
    try {
      const bytes = await readFile(artifact.localPath);
      const baseName = basename(artifact.localPath);
      // Prefix with build number so repeated runs don't hit Confluence's
      // "attachment with that title already exists" 400.
      const title = `b${buildNumber}-${baseName}`;
      const contentType =
        artifact.contentType && artifact.contentType.startsWith("image/")
          ? artifact.contentType
          : baseName.toLowerCase().endsWith(".jpg") || baseName.toLowerCase().endsWith(".jpeg")
            ? "image/jpeg"
            : baseName.toLowerCase().endsWith(".gif")
              ? "image/gif"
              : baseName.toLowerCase().endsWith(".webp")
                ? "image/webp"
                : "image/png";

      const media = await uploadConfluenceAttachment(cfg, pageId, bytes, title, contentType);
      if (media) {
        result.set(artifact.localPath, media);
      }
    } catch (err) {
      console.warn(
        `[AtlassianReporter] Failed to upload screenshot "${artifact.localPath}" to Confluence page ${pageId}: ${(err as Error).message}`,
      );
    }
  }

  return result;
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
    relatedCommitsByIssueKey: Record<string, QaRelatedCommit[]>;
    parent: { id: string; spaceId: string };
  }
): Promise<QaTargetIssue> {
  const title = buildConfluencePageTitle(target);
  const testsForIssue = getTestsForIssue(opts.summary, target.issueKey);
  const hasEvidenceGap = testsForIssue.length === 0;

  // Helper: render the ADF body for a given page. Called twice — once
  // without a media map (for the initial POST that creates the page +
  // gives us a pageId), and again with the media map once attachments
  // have been uploaded. Keeping it inline as a closure avoids threading
  // the full option set through another function signature.
  const renderAdf = (
    pageId: string | null,
    mediaByLocalPath: Map<string, ConfluenceAttachmentMeta> | undefined,
  ) =>
    buildConfluenceAdf({
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
      relatedCommits: opts.relatedCommitsByIssueKey[target.issueKey] ?? [],
      pageId,
      mediaByLocalPath,
    });

  const existingPageId = await findConfluencePageByTitle(cfg, title, opts.parent.spaceId);

  // Pass 1: ensure a Confluence page exists for this issue so we have a
  // pageId to upload attachments against. For existing pages we skip the
  // no-op PUT — the version bump happens in Pass 2.
  let pageId: string;
  // Confluence v2 page responses are loosely typed (`_links`, `version`,
  // etc. are all optional and nested). Rather than thread a zod schema
  // through just to satisfy one place, keep it as an opaque bag and
  // consume via optional chaining at read sites.
  let pageBeforeFinalPut: Record<string, unknown> | null = null;
  if (existingPageId) {
    pageId = existingPageId;
    pageBeforeFinalPut = await confluenceRequest(cfg, "GET", `/api/v2/pages/${pageId}`);
  } else {
    // POST with a minimal-but-valid ADF body so the page exists; Pass 2
    // will replace it with the full report.
    const created = await confluenceRequest(cfg, "POST", "/api/v2/pages", {
      spaceId: opts.parent.spaceId,
      status: "current",
      title,
      parentId: opts.parent.id,
      body: {
        representation: "atlas_doc_format",
        value: JSON.stringify({
          type: "doc",
          version: 1,
          content: [toAdfParagraph(`QA page created for build #${opts.buildNumber}; evidence upload in progress…`)],
        }),
      },
    });
    pageId = String(created?.id ?? "");
    pageBeforeFinalPut = created;
    if (!pageId) {
      throw new Error(
        `[AtlassianReporter] Confluence page create for ${target.issueKey} returned no id`,
      );
    }
  }

  // Pass 2: upload screenshots as attachments so inline `mediaSingle`
  // ADF nodes can reference them. Best-effort — failures degrade to
  // text links without blocking the rest of the report.
  const mediaByLocalPath = await uploadScreenshotAttachmentsForIssue(
    cfg,
    pageId,
    opts.buildNumber,
    opts.artifacts,
    testsForIssue,
  );

  const adfBody = renderAdf(pageId, mediaByLocalPath);

  // Pass 3: PUT the full body with inline thumbnails. We re-fetch the
  // current version here rather than reuse pageBeforeFinalPut.version
  // because the attachment uploads themselves bump the page's internal
  // version counter on some Confluence tenants; using the stale number
  // would hit `409: version conflict`.
  const beforePut = await confluenceRequest(cfg, "GET", `/api/v2/pages/${pageId}`);
  const currentVersion: number = beforePut?.version?.number ?? pageBeforeFinalPut?.version?.number ?? 0;

  const updated = await confluenceRequest(cfg, "PUT", `/api/v2/pages/${pageId}`, {
    id: pageId,
    status: "current",
    title,
    body: {
      representation: "atlas_doc_format",
      value: JSON.stringify(adfBody),
    },
    version: {
      number: currentVersion + 1,
      message: `Build #${opts.buildNumber}${mediaByLocalPath.size > 0 ? ` (+${mediaByLocalPath.size} inline screenshot${mediaByLocalPath.size === 1 ? "" : "s"})` : ""}`,
    },
  });

  const enrichedTarget: QaTargetIssue = {
    ...target,
    confluencePageId: pageId,
    confluencePageUrl:
      buildConfluencePageUrl(cfg, updated, pageId) ??
      buildConfluencePageUrl(cfg, beforePut, pageId) ??
      buildConfluencePageUrl(cfg, pageBeforeFinalPut, pageId),
    hasEvidenceGap,
  };

  if (hasEvidenceGap) {
    try {
      await jiraRequest(cfg, "POST", `/issue/${target.issueKey}/comment`, {
        body: {
          type: "doc",
          version: 1,
          content: [
            toAdfParagraph(
              `Evidence gap for build #${opts.buildNumber}: no tests tagged ${target.issueKey} verified this issue in suite ${opts.suite}.` +
              (enrichedTarget.confluencePageUrl ? ` QA page: ${enrichedTarget.confluencePageUrl}` : "")
            ),
          ],
        },
      });
    } catch (err) {
      console.warn(`[AtlassianReporter] Failed to post evidence-gap comment on ${target.issueKey}:`, err);
    }
  }

  return enrichedTarget;
}

export async function resolveQaTargets(issueKeys: string[]): Promise<QaTargetIssue[]> {
  const cfg = loadConfig();
  if (!cfg) return [];

  const keys = unique(issueKeys);
  if (keys.length === 0) {
    console.warn("[AtlassianReporter] No Jira issue keys discovered");
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
  relatedCommitsByIssueKey: Record<string, QaRelatedCommit[]>;
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
          relatedCommitsByIssueKey: opts.relatedCommitsByIssueKey,
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
  failedTests: TestResult[];
  suite: string;
  buildNumber: string;
  s3ReportKey: string | null;
  target: QaTargetIssue;
  reportConsoleUrl: string | null;
  artifacts: QaArtifactLink[];
}): string {
  const failureLines = opts.failedTests
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
    `Automated QA detected *${opts.failedTests.length}* failing test(s) for *${opts.target.issueKey}* in suite *${opts.suite}* (Build #${opts.buildNumber}).`,
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
    const failedTestsForIssue = getFailedTestsForIssue(opts.summary, target.issueKey);
    const artifactsForIssue = getArtifactsForIssue(failedTestsForIssue, opts.artifacts);
    if (failedTestsForIssue.length === 0) {
      continue;
    }

    const runLabel = `qa-automated-${opts.environment}-${opts.suite}`;
    const targetLabel = `qa-target-${target.issueKey.toLowerCase()}`;

    try {
      const existingKey = await findOpenFailureBug(cfg, opts.suite, opts.environment, target);

      if (existingKey) {
        const commentText =
          `Build #${opts.buildNumber}: *${failedTestsForIssue.length}* tagged test(s) still failing ` +
          `for ${target.issueKey}.`;
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
          summary: `[QA][${target.issueKey}] ${failedTestsForIssue.length} tagged test(s) failed — ${opts.suite} / Build #${opts.buildNumber}`,
          description: {
            type: "doc",
            version: 1,
            content: [
              toAdfParagraph(
                buildJiraBugDescription({
                  failedTests: failedTestsForIssue,
                  suite: opts.suite,
                  buildNumber: opts.buildNumber,
                  s3ReportKey: opts.s3ReportKey,
                  target,
                  reportConsoleUrl: opts.reportConsoleUrl,
                  artifacts: artifactsForIssue,
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

// Anchor string identifying the single self-updating QA Agent status comment
// on a Jira issue. The AC validator/QA runner maintains exactly one comment
// per issue with this marker: on each run, we PUT to update it rather than
// POST a new comment, so Jira issues don't grow an unbounded tail of
// "Build #N recorded…" breadcrumbs. Renaming this string is a breaking change
// — cleanup tooling (`cleanupStalePipelineEvidence.ts`) also keys off it.
export const QA_AGENT_STATUS_MARKER = "[QA Agent] Latest Status";

// Legacy regex used to identify pre-anchor success comments that the cleanup
// script should remove. Both the marker-prefixed body and the old bare
// "Build #N recorded …" bodies are recognized for backfill purposes.
export const QA_AGENT_LEGACY_COMMENT_PATTERN =
  /^Build #\d+ recorded \d+ tagged test\(s\) for /;

interface JiraCommentSummary {
  id: string;
  firstLineText: string;
  fullText: string;
}

/**
 * Fetch all QA-Agent-authored comments on a Jira issue, classified by whether
 * they use the anchor marker or match the legacy "Build #N recorded…" shape.
 *
 * We paginate explicitly (maxResults=100) because Jira issues with long
 * histories can exceed the default page size; failing to paginate would leave
 * old legacy comments behind on heavily-commented tickets.
 */
export async function listQaAgentComments(
  cfgOrUndefined: AtlassianConfig | null,
  issueKey: string,
): Promise<{ anchor: JiraCommentSummary | null; legacy: JiraCommentSummary[] }> {
  const cfg = cfgOrUndefined ?? loadConfig();
  if (!cfg) return { anchor: null, legacy: [] };

  const collected: JiraCommentSummary[] = [];
  let startAt = 0;
  const pageSize = 100;
  for (;;) {
    const page = await jiraRequest(
      cfg,
      "GET",
      `/issue/${encodeURIComponent(issueKey)}/comment?maxResults=${pageSize}&startAt=${startAt}`,
    );
    const comments = Array.isArray(page?.comments) ? page.comments : [];
    for (const comment of comments) {
      const id = String(comment?.id ?? "").trim();
      if (!id) continue;
      const fullText = extractAdfPlainText(comment?.body);
      const firstLineText = fullText.split(/\r?\n/, 1)[0]?.trim() ?? "";
      collected.push({ id, firstLineText, fullText });
    }
    const total = typeof page?.total === "number" ? page.total : collected.length;
    startAt += comments.length;
    if (comments.length === 0 || startAt >= total) break;
  }

  let anchor: JiraCommentSummary | null = null;
  const legacy: JiraCommentSummary[] = [];
  for (const comment of collected) {
    if (comment.firstLineText.startsWith(QA_AGENT_STATUS_MARKER)) {
      // Keep only the newest anchor; treat any earlier duplicates as legacy so
      // cleanup converges on exactly one self-updating comment per issue.
      if (anchor) {
        legacy.push(anchor);
      }
      anchor = comment;
      continue;
    }
    if (QA_AGENT_LEGACY_COMMENT_PATTERN.test(comment.firstLineText)) {
      legacy.push(comment);
    }
  }
  return { anchor, legacy };
}

export async function deleteJiraComment(
  cfgOrUndefined: AtlassianConfig | null,
  issueKey: string,
  commentId: string,
): Promise<void> {
  const cfg = cfgOrUndefined ?? loadConfig();
  if (!cfg) return;
  await jiraRequest(
    cfg,
    "DELETE",
    `/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`,
  );
}

/**
 * Expose loadConfig so cleanup tooling can reuse the same env plumbing
 * instead of duplicating config parsing in a second place.
 */
export function getAtlassianConfig(): AtlassianConfig | null {
  return loadConfig();
}

/**
 * Recursively stringify an ADF document, extracting only text content so we
 * can do substring/regex matching against comment bodies without re-parsing
 * the structured JSON each time.
 */
function extractAdfPlainText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const lines: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { text?: unknown; type?: unknown; content?: unknown };
    if (typeof n.text === "string") {
      lines.push(n.text);
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
      if (n.type === "paragraph" || n.type === "heading") {
        lines.push("\n");
      }
    }
  };
  walk(adf);
  return lines.join("").replace(/\n+$/g, "");
}

function buildAnchorCommentBody(opts: {
  target: QaTargetIssue;
  summary: QaRunSummary;
  suite: string;
  environment: string;
  buildNumber: string;
}): Record<string, unknown> {
  const passRate = opts.summary.total > 0
    ? Math.round((opts.summary.passed / opts.summary.total) * 100)
    : 0;
  const duration = (opts.summary.durationMs / 1000).toFixed(1);
  const testsForIssue = getTestsForIssue(opts.summary, opts.target.issueKey);
  const failedTestsForIssue = getFailedTestsForIssue(opts.summary, opts.target.issueKey);
  const isPass = failedTestsForIssue.length === 0;
  const ts = new Date().toISOString();

  // Line 1 is the anchor marker so the list-comments lookup in
  // `listQaAgentComments` can identify this comment in O(1) per entry.
  const headerLine = `${QA_AGENT_STATUS_MARKER} — Build #${opts.buildNumber} ${isPass ? "PASSED" : "FAILED"}`;
  const statsLine =
    `Suite: ${opts.suite} | Env: ${opts.environment} | Duration: ${duration}s | Pass rate: ${passRate}% ` +
    `(${opts.summary.passed}/${opts.summary.total} passed, ${opts.summary.failed} failed, ${opts.summary.skipped} skipped)`;
  const tagLine = testsForIssue.length === 0
    ? `Tagged tests: 0 verified this build (no @${opts.target.issueKey} tests ran).`
    : `Tagged tests: ${testsForIssue.length} verified${
        failedTestsForIssue.length > 0
          ? ` (${failedTestsForIssue.length} failed)`
          : " (all passed)"
      }.`;
  const acLine = opts.target.acValidation
    ? `AC validator: ${opts.target.acValidation.status}` +
      (opts.target.acValidation.approvalStatus
        ? ` (approval=${opts.target.acValidation.approvalStatus})`
        : "")
    : null;
  const linkLine = opts.target.confluencePageUrl
    ? `QA evidence: ${opts.target.confluencePageUrl}`
    : null;
  const footerLine = `Last updated: ${ts}. This comment is edited in-place by the QA Agent on each run; see Jira comment edit history for prior runs.`;

  const paragraphs = [headerLine, statsLine, tagLine, acLine, linkLine, footerLine]
    .filter((line): line is string => Boolean(line))
    .map((line) => toAdfParagraph(line));

  return {
    type: "doc",
    version: 1,
    content: paragraphs,
  };
}

/**
 * Update the single "[QA Agent] Latest Status" anchor comment on each target
 * Jira issue, creating it on the first run.
 *
 * Why edit-in-place instead of posting a new comment per run:
 *   - Every build previously appended a "Build #N recorded…" breadcrumb,
 *     which grows without bound (20+ entries on a well-exercised ticket) and
 *     drowns out human conversation.
 *   - The signal ("did QA pass on this build?") is preserved via Jira's
 *     built-in comment edit history — every old version remains retrievable.
 *   - Exactly one comment per issue per agent keeps the ticket readable.
 *
 * The legacy POST-per-run behavior is intentionally removed; the one-shot
 * backfill script (`cleanupStalePipelineEvidence.ts`) converts the historical
 * breadcrumb tail into a single anchor comment.
 */
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
    console.warn("[AtlassianReporter] No resolved Jira targets, skipping Jira status comment update");
    return;
  }

  for (const target of opts.targets) {
    const body = buildAnchorCommentBody({
      target,
      summary: opts.summary,
      suite: opts.suite,
      environment: opts.environment,
      buildNumber: opts.buildNumber,
    });

    try {
      const { anchor } = await listQaAgentComments(cfg, target.issueKey);

      if (anchor) {
        // Edit-in-place: Jira returns 200 + updated comment body.
        await jiraRequest(
          cfg,
          "PUT",
          `/issue/${encodeURIComponent(target.issueKey)}/comment/${encodeURIComponent(anchor.id)}`,
          { body },
        );
        console.log(
          `[AtlassianReporter] Status anchor comment updated on ${target.issueKey} (commentId=${anchor.id})`,
        );
      } else {
        await jiraRequest(cfg, "POST", `/issue/${encodeURIComponent(target.issueKey)}/comment`, { body });
        console.log(`[AtlassianReporter] Status anchor comment created on ${target.issueKey}`);
      }
    } catch (err) {
      console.warn(
        `[AtlassianReporter] Failed to update status anchor comment on ${target.issueKey}:`,
        err,
      );
    }
  }
}

export async function transitionJiraIssueToEvidenceReview(
  issueKey: string,
  transitionNames = ["Evidence Review", "In Review"],
): Promise<boolean> {
  const cfg = loadConfig();
  if (!cfg) {
    return false;
  }

  try {
    const transitions = await jiraRequest(
      cfg,
      "GET",
      `/issue/${encodeURIComponent(issueKey)}/transitions`,
    );
    const transition = (transitions?.transitions ?? []).find((candidate: any) =>
      transitionNames.some(
        (name) => String(candidate?.name ?? "").trim().toLowerCase() === name.toLowerCase(),
      ),
    );

    if (!transition?.id) {
      console.warn(
        `[AtlassianReporter] No evidence-review transition found for ${issueKey}; looked for ${transitionNames.join(", ")}`,
      );
      return false;
    }

    await jiraRequest(cfg, "POST", `/issue/${encodeURIComponent(issueKey)}/transitions`, {
      transition: { id: transition.id },
    });
    return true;
  } catch (error) {
    console.warn(`[AtlassianReporter] Failed to transition ${issueKey} to evidence review:`, error);
    return false;
  }
}
