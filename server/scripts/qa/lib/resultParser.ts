/**
 * Playwright JSON Report Parser
 *
 * Reads test-results/results.json produced by the Playwright JSON reporter
 * and returns a structured QaRunSummary for the runner lifecycle.
 *
 * The JSON format is Playwright's built-in reporter schema:
 *   { suites: Suite[], stats: { ... } }
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

export type TestStatus = "passed" | "failed" | "timedOut" | "skipped";

export interface TestResult {
  title: string;
  file: string;
  status: TestStatus;
  durationMs: number;
  jiraKeys: string[];
  error?: string;
  screenshotPaths: string[];
  tracePaths: string[];
  videoPaths: string[];
}

export interface FailedTest extends TestResult {
  status: "failed" | "timedOut";
  error: string;
}

export interface QaRunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  tests: TestResult[];
  failedTests: FailedTest[];
}

const MAX_ERROR_LENGTH = 500;
const JIRA_KEY_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g;

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

function collectAttachments(
  results: any[],
  type: "screenshot" | "trace" | "video"
): string[] {
  const attachments: string[] = [];
  for (const result of results) {
    if (!Array.isArray(result.attachments)) continue;
    for (const attachment of result.attachments) {
      const matchesType =
        type === "screenshot"
          ? attachment.name === "screenshot" || attachment.contentType?.startsWith("image/")
          : type === "trace"
            ? attachment.name === "trace" || attachment.path?.endsWith(".zip")
            : attachment.name === "video" || attachment.contentType?.startsWith("video/");
      if (matchesType) {
        const path = attachment.path ?? attachment.body ?? "";
        if (path) attachments.push(path);
      }
    }
  }
  return attachments;
}

function extractJiraKeys(title: string): string[] {
  return [...new Set(title.match(JIRA_KEY_REGEX) ?? [])].sort();
}

function normalizeStatus(status: string): TestStatus | null {
  if (status === "passed" || status === "failed" || status === "timedOut" || status === "skipped") {
    return status;
  }
  if (status === "interrupted") {
    return "skipped";
  }
  return null;
}

function walkSuites(suites: any[]): TestResult[] {
  const tests: TestResult[] = [];

  function walk(suite: any, fileHint: string): void {
    const file = suite.file ?? suite.title ?? fileHint;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        const title = spec.title ?? "";
        if (!Array.isArray(spec.tests)) continue;

        for (const test of spec.tests) {
          if (!Array.isArray(test.results)) continue;
          const finalResult = [...test.results].reverse().find((result) => normalizeStatus(result?.status));
          const status = normalizeStatus(finalResult?.status);
          if (!finalResult || !status) continue;

          const rawError =
            finalResult.error?.message ??
            finalResult.error?.value ??
            finalResult.error?.snippet ??
            (status === "failed" || status === "timedOut" ? "Unknown error" : undefined);

          tests.push({
            title,
            file,
            status,
            durationMs: test.results.reduce(
              (sum: number, result: any) => sum + (typeof result?.duration === "number" ? result.duration : 0),
              0,
            ),
            jiraKeys: extractJiraKeys(title),
            ...(rawError && { error: truncate(String(rawError), MAX_ERROR_LENGTH) }),
            screenshotPaths: collectAttachments(test.results, "screenshot"),
            tracePaths: collectAttachments(test.results, "trace"),
            videoPaths: collectAttachments(test.results, "video"),
          });
        }
      }
    }

    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) {
        walk(child, file);
      }
    }
  }

  for (const suite of suites) {
    walk(suite, suite.file ?? suite.title ?? "");
  }

  return tests;
}

export function parseResults(repoRoot: string): QaRunSummary {
  const resultsPath = join(repoRoot, "test-results", "results.json");

  if (!existsSync(resultsPath)) {
    throw new Error(
      `Playwright JSON results not found at ${resultsPath}. ` +
      "Ensure the JSON reporter is enabled in playwright.config.ts and tests have run."
    );
  }

  const raw = JSON.parse(readFileSync(resultsPath, "utf-8"));

  const stats = raw.stats ?? {};
  const total = (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.skipped ?? 0);
  const passed = stats.expected ?? 0;
  const failed = stats.unexpected ?? 0;
  const skipped = stats.skipped ?? 0;
  const durationMs = Math.round((stats.duration ?? 0));

  const tests = walkSuites(Array.isArray(raw.suites) ? raw.suites : []);
  const failedTests = tests.filter(
    (test): test is FailedTest => test.status === "failed" || test.status === "timedOut",
  );

  return { total, passed, failed, skipped, durationMs, tests, failedTests };
}
