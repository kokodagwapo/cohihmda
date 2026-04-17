import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
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

const TAGGED_REPORT_FIXTURE = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/test/qa/fixtures/results-tagged.json"),
    "utf8",
  ),
);

describe("resultParser.parseResults", () => {
  let roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
    roots = [];
  });

  it("parses tagged tests across passed, failed, and skipped states", async () => {
    const parseResults = await loadParser();
    const root = buildFixtureRoot(TAGGED_REPORT_FIXTURE);
    roots.push(root);

    const summary = parseResults(root);

    expect(summary.total).toBe(4);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.durationMs).toBe(9100);
    expect(summary.tests).toHaveLength(4);
    expect(summary.failedTests).toHaveLength(1);

    const workbench = summary.tests.find((test) => test.title.includes("opens save dialog"));
    expect(workbench?.jiraKeys).toEqual(["COHI-77"]);
    expect(workbench?.status).toBe("passed");

    const shared = summary.tests.find((test) => test.title.includes("shared workbench signal"));
    expect(shared?.jiraKeys).toEqual(["COHI-77", "COHI-96"]);

    const failure = summary.failedTests[0];
    expect(failure.title).toContain("@COHI-96");
    expect(failure.file).toBe("e2e/toptiering.spec.ts");
    expect(failure.error).toContain("Portfolio Analysis");
    expect(failure.screenshotPaths).toContain("/tmp/toptiering-failure.png");
    expect(failure.tracePaths).toContain("/tmp/toptiering-trace.zip");

    const skipped = summary.tests.find((test) => test.status === "skipped");
    expect(skipped?.jiraKeys).toEqual([]);
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
    expect(summary.tests).toHaveLength(0);
    expect(summary.failedTests).toHaveLength(0);
  });
});
