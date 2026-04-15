/**
 * Unit tests for scripts/qa/lib/resultParser.ts
 *
 * Uses a temporary fixture file to simulate the Playwright JSON reporter output
 * without needing an actual Playwright run.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Dynamic import so we can point the module at our fixture directory
async function loadParser() {
  const { parseResults } = await import("../../../scripts/qa/lib/resultParser.js");
  return parseResults;
}

function buildFixtureRoot(report: object): string {
  const root = join(tmpdir(), `qa-test-${randomUUID()}`);
  mkdirSync(join(root, "test-results"), { recursive: true });
  writeFileSync(join(root, "test-results", "results.json"), JSON.stringify(report), "utf-8");
  return root;
}

const PASSING_REPORT = {
  stats: {
    expected: 5,
    unexpected: 0,
    skipped: 1,
    duration: 12300,
  },
  suites: [
    {
      title: "Auth",
      file: "e2e/auth.spec.ts",
      suites: [],
      specs: [
        {
          title: "should login",
          tests: [
            {
              results: [
                {
                  status: "passed",
                  attachments: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const FAILING_REPORT = {
  stats: {
    expected: 3,
    unexpected: 2,
    skipped: 0,
    duration: 8500,
  },
  suites: [
    {
      title: "Dashboard",
      file: "e2e/dashboard.spec.ts",
      suites: [],
      specs: [
        {
          title: "renders KPI cards",
          tests: [
            {
              results: [
                {
                  status: "failed",
                  error: {
                    message: "Expected element to be visible but it was hidden",
                    snippet: "  42 | await expect(page.locator('.kpi-card')).toBeVisible();",
                  },
                  attachments: [
                    { name: "screenshot", path: "/tmp/screenshot.png", contentType: "image/png" },
                    { name: "trace", path: "/tmp/trace.zip", contentType: "application/zip" },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: "shows trend chart",
          tests: [
            {
              results: [
                {
                  status: "failed",
                  error: {
                    message: "TimeoutError: waiting for selector .trend-chart",
                  },
                  attachments: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("resultParser.parseResults", () => {
  let roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
    roots = [];
  });

  it("parses a fully-passing report correctly", async () => {
    const parseResults = await loadParser();
    const root = buildFixtureRoot(PASSING_REPORT);
    roots.push(root);

    const summary = parseResults(root);

    expect(summary.total).toBe(6); // expected + skipped
    expect(summary.passed).toBe(5);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.durationMs).toBe(12300);
    expect(summary.failedTests).toHaveLength(0);
  });

  it("parses a failing report and extracts failure details", async () => {
    const parseResults = await loadParser();
    const root = buildFixtureRoot(FAILING_REPORT);
    roots.push(root);

    const summary = parseResults(root);

    expect(summary.total).toBe(5); // expected + unexpected
    expect(summary.passed).toBe(3);
    expect(summary.failed).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.failedTests).toHaveLength(2);

    const [first, second] = summary.failedTests;
    expect(first.title).toBe("renders KPI cards");
    expect(first.file).toBe("e2e/dashboard.spec.ts");
    expect(first.error).toContain("Expected element to be visible");
    expect(first.screenshotPaths).toContain("/tmp/screenshot.png");
    expect(first.tracePaths).toContain("/tmp/trace.zip");

    expect(second.title).toBe("shows trend chart");
    expect(second.error).toContain("TimeoutError");
  });

  it("truncates error messages longer than 500 chars", async () => {
    const parseResults = await loadParser();
    const longError = "x".repeat(600);
    const report = {
      stats: { expected: 0, unexpected: 1, skipped: 0, duration: 1000 },
      suites: [
        {
          title: "Suite",
          file: "e2e/suite.spec.ts",
          suites: [],
          specs: [
            {
              title: "long error test",
              tests: [
                {
                  results: [
                    { status: "failed", error: { message: longError }, attachments: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const root = buildFixtureRoot(report);
    roots.push(root);

    const summary = parseResults(root);
    expect(summary.failedTests[0].error.length).toBeLessThanOrEqual(502); // 500 + ellipsis
  });

  it("throws if results.json does not exist", async () => {
    const parseResults = await loadParser();
    const root = join(tmpdir(), `qa-missing-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    roots.push(root);

    expect(() => parseResults(root)).toThrow(/not found/i);
  });

  it("returns zero counts for empty suites", async () => {
    const parseResults = await loadParser();
    const report = { stats: { expected: 0, unexpected: 0, skipped: 0, duration: 0 }, suites: [] };
    const root = buildFixtureRoot(report);
    roots.push(root);

    const summary = parseResults(root);
    expect(summary.total).toBe(0);
    expect(summary.failedTests).toHaveLength(0);
  });
});
