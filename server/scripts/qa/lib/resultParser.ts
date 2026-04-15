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

export interface FailedTest {
  title: string;
  file: string;
  error: string;
  screenshotPaths: string[];
  tracePaths: string[];
  videoPaths: string[];
}

export interface QaRunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failedTests: FailedTest[];
}

const MAX_ERROR_LENGTH = 500;

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

function collectAttachments(
  result: any,
  type: "screenshot" | "trace" | "video"
): string[] {
  if (!Array.isArray(result.attachments)) return [];
  return result.attachments
    .filter((a: any) => {
      if (type === "screenshot") return a.name === "screenshot" || a.contentType?.startsWith("image/");
      if (type === "trace") return a.name === "trace" || a.path?.endsWith(".zip");
      if (type === "video") return a.name === "video" || a.contentType?.startsWith("video/");
      return false;
    })
    .map((a: any) => a.path ?? a.body ?? "")
    .filter(Boolean);
}

function walkSuites(suites: any[]): FailedTest[] {
  const failures: FailedTest[] = [];

  function walk(suite: any, fileHint: string): void {
    const file = suite.file ?? suite.title ?? fileHint;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        const title = spec.title ?? "";
        if (!Array.isArray(spec.tests)) continue;

        for (const test of spec.tests) {
          if (!Array.isArray(test.results)) continue;

          for (const result of test.results) {
            if (result.status !== "failed" && result.status !== "timedOut") continue;

            const rawError =
              result.error?.message ??
              result.error?.value ??
              result.error?.snippet ??
              "Unknown error";

            failures.push({
              title,
              file,
              error: truncate(String(rawError), MAX_ERROR_LENGTH),
              screenshotPaths: collectAttachments(result, "screenshot"),
              tracePaths: collectAttachments(result, "trace"),
              videoPaths: collectAttachments(result, "video"),
            });
          }
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

  return failures;
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

  const failedTests = walkSuites(Array.isArray(raw.suites) ? raw.suites : []);

  return { total, passed, failed, skipped, durationMs, failedTests };
}
