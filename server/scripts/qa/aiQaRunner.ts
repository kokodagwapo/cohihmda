#!/usr/bin/env tsx
/**
 * AI QA Runner — Main Entry Point
 *
 * Orchestrates the full QA lifecycle:
 *   1. Parse CLI args
 *   2. Run Playwright tests
 *   3. Parse JSON results
 *   4. Discover Jira targets from commit messages
 *   5. Upload artifacts to S3
 *   6. Create/update one Confluence QA page per resolved Jira issue
 *   7. Create comments or linked bugs on those Jira issues
 *   8. POST result to backend audit ledger
 *   9. Print summary and exit with Playwright's exit code
 *
 * Execute from the repo root or server/ directory:
 *   cd server && npx tsx scripts/qa/aiQaRunner.ts --suite=critical --base-url=https://...
 *
 * Every integration step (Jira discovery, S3, Confluence, Jira, ledger) is best-effort.
 * A reporting failure NEVER causes a non-zero exit — only Playwright failures do.
 */

import { spawnSync } from "child_process";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHmac } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { parseResults } from "./lib/resultParser.js";
import {
  uploadHtmlReport,
  uploadFailureArtifacts,
} from "./lib/s3Upload.js";
import {
  resolveQaTargets,
  updateConfluencePages,
  reportFailuresToJira,
  reportSuccessToJira,
} from "./lib/atlassianReporter.js";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  suite: string;
  baseUrl: string;
  buildNumber: string;
  commitHash: string;
  commitRange: string;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const match = args.find((a) => a.startsWith(`--${flag}=`));
    return match ? match.split("=").slice(1).join("=") : fallback;
  };

  return {
    suite: get("suite", "critical"),
    baseUrl: get("base-url", process.env.E2E_BASE_URL ?? ""),
    buildNumber: get("build-number", process.env.BITBUCKET_BUILD_NUMBER ?? "local"),
    commitHash: get("commit-hash", process.env.BITBUCKET_COMMIT ?? "unknown"),
    commitRange: get(
      "commit-range",
      process.env.QA_COMMIT_RANGE ?? process.env.BITBUCKET_COMMIT_RANGE ?? ""
    ),
  };
}

const JIRA_KEY_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g;

function readGitStdout(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8",
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }

  return result.stdout ?? "";
}

function discoverJiraIssueKeys(repoRoot: string, commitRange: string): string[] {
  try {
    const commitMessages = commitRange
      ? readGitStdout(repoRoot, ["log", "--format=%B", commitRange])
      : readGitStdout(repoRoot, [
          "log",
          "--format=%B",
          `-n${process.env.QA_COMMIT_LOOKBACK ?? "20"}`,
          "HEAD",
        ]);

    const issueKeys = [...new Set((commitMessages.match(JIRA_KEY_REGEX) ?? []).sort())];
    if (issueKeys.length > 0) {
      console.log(`[QaRunner] Discovered Jira issues from commit history: ${issueKeys.join(", ")}`);
    } else {
      console.warn("[QaRunner] No Jira issues discovered from commit messages");
    }
    return issueKeys;
  } catch (err) {
    console.warn("[QaRunner] Failed to inspect git commit messages for Jira keys:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ledger recording
// ---------------------------------------------------------------------------

async function recordToLedger(opts: {
  baseUrl: string;
  suite: string;
  environment: string;
  buildNumber: string;
  commitHash: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  confluencePageUrl: string | null;
  confluencePageUrls: string[];
  jiraIssueKeys: string[];
  s3ReportKey: string | null;
  failedTests: Array<{ title: string; file: string; error?: string }>;
}): Promise<void> {
  const apiKey = process.env.QA_RUNNER_API_KEY;
  const hmacSecret = process.env.QA_RUNNER_HMAC_SECRET;
  if (!apiKey || !hmacSecret || !opts.baseUrl) {
    console.warn("[QaRunner] Ledger recording skipped — QA_RUNNER_API_KEY, QA_RUNNER_HMAC_SECRET, or base URL not set");
    return;
  }

  const endpoint = `${opts.baseUrl.replace(/\/$/, "")}/api/internal/qa-run`;
  const body = JSON.stringify({
    suite: opts.suite,
    browser: "chromium",
    environment: opts.environment,
    total: opts.total,
    passed: opts.passed,
    failed: opts.failed,
    skipped: opts.skipped,
    durationMs: opts.durationMs,
    pipelineBuild: opts.buildNumber,
    commitHash: opts.commitHash,
    triggeredBy: `pipeline:bitbucket/${opts.buildNumber}`,
    ...(opts.confluencePageUrl && { confluencePageUrl: opts.confluencePageUrl }),
    ...(opts.confluencePageUrls.length > 0 && { confluencePageUrls: opts.confluencePageUrls }),
    ...(opts.jiraIssueKeys.length > 0 && { jiraIssueKeys: opts.jiraIssueKeys }),
    ...(opts.s3ReportKey && { s3ReportKey: opts.s3ReportKey }),
    failedTests: opts.failedTests.map((t) => ({
      title: t.title,
      file: t.file,
      ...(t.error && { error: t.error }),
    })),
  });

  const timestamp = String(Date.now());
  const signature = createHmac("sha256", hmacSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QA-Runner-Key": apiKey,
        "X-QA-Timestamp": timestamp,
        "X-QA-Signature": signature,
      },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(`[QaRunner] Ledger POST returned ${resp.status}: ${text.slice(0, 200)}`);
    } else {
      const json = await resp.json().catch(() => ({}));
      console.log(`[QaRunner] Ledger recorded — actionId: ${(json as any).actionId ?? "?"}`);
    }
  } catch (err) {
    console.warn("[QaRunner] Ledger recording failed (network/timeout):", err);
  }
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

function printSummary(opts: {
  suite: string;
  environment: string;
  buildNumber: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  s3ReportKey: string | null;
  confluencePageUrls: string[];
  jiraIssueKeys: string[];
}): void {
  const passRate = opts.total > 0 ? Math.round((opts.passed / opts.total) * 100) : 0;
  const status = opts.failed > 0 ? "FAILED" : "PASSED";
  const duration = (opts.durationMs / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log(`  QA Run Summary — ${status}`);
  console.log("=".repeat(60));
  console.log(`  Suite:        ${opts.suite}`);
  console.log(`  Environment:  ${opts.environment}`);
  console.log(`  Build:        #${opts.buildNumber}`);
  console.log(`  Total:        ${opts.total}`);
  console.log(`  Passed:       ${opts.passed}`);
  console.log(`  Failed:       ${opts.failed}`);
  console.log(`  Skipped:      ${opts.skipped}`);
  console.log(`  Pass rate:    ${passRate}%`);
  console.log(`  Duration:     ${duration}s`);
  if (opts.s3ReportKey) console.log(`  S3 report:    ${opts.s3ReportKey}`);
  if (opts.jiraIssueKeys.length > 0) console.log(`  Jira issues:  ${opts.jiraIssueKeys.join(", ")}`);
  if (opts.confluencePageUrls.length > 0) console.log(`  Confluence:   ${opts.confluencePageUrls.length} page(s) updated`);
  console.log("=".repeat(60) + "\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { suite, baseUrl, buildNumber, commitHash, commitRange } = parseArgs();
  const environment = process.env.NODE_ENV === "production" ? "production" : "dev";

  // Playwright runs from repo root (two levels above server/scripts/qa/)
  const repoRoot = resolve(__dirname, "../../../");

  console.log(`[QaRunner] Starting QA run — suite=${suite} env=${environment} build=#${buildNumber}`);

  // ---------------------------------------------------------------------------
  // Step 1: Run Playwright
  // ---------------------------------------------------------------------------
  const pwArgs = [
    "playwright",
    "test",
    "--reporter=json,html",
    `--grep=@${suite}`,
    "--project=chromium",
  ];

  if (baseUrl) process.env.E2E_BASE_URL = baseUrl;

  const pwResult = spawnSync("npx", pwArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });

  const playwrightExitCode = pwResult.status ?? 1;
  console.log(`[QaRunner] Playwright exited with code ${playwrightExitCode}`);

  // ---------------------------------------------------------------------------
  // Step 2: Parse results
  // ---------------------------------------------------------------------------
  let summary;
  try {
    summary = parseResults(repoRoot);
  } catch (err) {
    console.error("[QaRunner] Failed to parse Playwright results:", err);
    process.exit(playwrightExitCode || 1);
  }

  const bucket = process.env.AI_ARTIFACTS_BUCKET ?? "";
  const discoveredIssueKeys = discoverJiraIssueKeys(repoRoot, commitRange);
  let qaTargets = await resolveQaTargets(discoveredIssueKeys);

  // ---------------------------------------------------------------------------
  // Step 3: Upload S3 artifacts (best-effort)
  // ---------------------------------------------------------------------------
  let s3ReportKey: string | null = null;
  if (bucket) {
    try {
      s3ReportKey = await uploadHtmlReport({ repoRoot, environment, buildNumber, bucket });

      const failurePaths = summary.failedTests.flatMap((t) => [
        ...t.screenshotPaths,
        ...t.tracePaths,
        ...t.videoPaths,
      ]);

      if (failurePaths.length > 0) {
        await uploadFailureArtifacts({ repoRoot, environment, buildNumber, bucket, failurePaths });
      }
    } catch (err) {
      console.warn("[QaRunner] S3 upload step failed:", err);
    }
  } else {
    console.warn("[QaRunner] AI_ARTIFACTS_BUCKET not set — skipping S3 uploads");
  }

  // ---------------------------------------------------------------------------
  // Step 4: Confluence per-issue page updates (best-effort)
  // ---------------------------------------------------------------------------
  let confluencePageUrls: string[] = [];
  try {
    qaTargets = await updateConfluencePages({
      targets: qaTargets,
      summary,
      suite,
      environment,
      buildNumber,
      commitHash,
      s3ReportKey,
    });
    confluencePageUrls = qaTargets
      .map((target) => target.confluencePageUrl)
      .filter((value): value is string => Boolean(value));
  } catch (err) {
    console.warn("[QaRunner] Confluence update failed:", err);
  }

  // ---------------------------------------------------------------------------
  // Step 5: Jira reporting (best-effort)
  // ---------------------------------------------------------------------------
  try {
    if (summary.failed > 0) {
      await reportFailuresToJira({
        targets: qaTargets,
        summary,
        suite,
        environment,
        buildNumber,
        s3ReportKey,
      });
    } else {
      await reportSuccessToJira({
        targets: qaTargets,
        summary,
        suite,
        environment,
        buildNumber,
      });
    }
  } catch (err) {
    console.warn("[QaRunner] Jira reporting failed:", err);
  }

  // ---------------------------------------------------------------------------
  // Step 6: Record in audit ledger (best-effort)
  // ---------------------------------------------------------------------------
  try {
    await recordToLedger({
      baseUrl,
      suite,
      environment,
      buildNumber,
      commitHash,
      ...summary,
      confluencePageUrl: confluencePageUrls[0] ?? null,
      confluencePageUrls,
      jiraIssueKeys: qaTargets.map((target) => target.issueKey),
      s3ReportKey,
      failedTests: summary.failedTests.map((t) => ({
        title: t.title,
        file: t.file,
        error: t.error,
      })),
    });
  } catch (err) {
    console.warn("[QaRunner] Ledger recording failed:", err);
  }

  // ---------------------------------------------------------------------------
  // Step 7: Print summary and exit
  // ---------------------------------------------------------------------------
  printSummary({
    suite,
    environment,
    buildNumber,
    ...summary,
    s3ReportKey,
    confluencePageUrls,
    jiraIssueKeys: qaTargets.map((target) => target.issueKey),
  });

  // Exit with Playwright's exit code so the pipeline step fails on test failures
  process.exit(playwrightExitCode);
}

main().catch((err) => {
  console.error("[QaRunner] Unhandled error:", err);
  process.exit(1);
});
