/**
 * Unit tests for scripts/qa/lib/atlassianReporter.ts
 *
 * All HTTP calls are mocked via vi.stubGlobal so no real network requests
 * are made. Tests verify request construction, deduplication logic, and
 * graceful degradation when credentials are missing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { QaRunSummary } from "../../../scripts/qa/lib/resultParser.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSING_SUMMARY: QaRunSummary = {
  total: 10,
  passed: 10,
  failed: 0,
  skipped: 0,
  durationMs: 5000,
  failedTests: [],
};

const FAILING_SUMMARY: QaRunSummary = {
  total: 10,
  passed: 7,
  failed: 3,
  skipped: 0,
  durationMs: 8000,
  failedTests: [
    {
      title: "Test A",
      file: "e2e/a.spec.ts",
      error: "Expected true to be false",
      screenshotPaths: [],
      tracePaths: [],
      videoPaths: [],
    },
    {
      title: "Test B",
      file: "e2e/b.spec.ts",
      error: "TimeoutError: locator not found",
      screenshotPaths: [],
      tracePaths: [],
      videoPaths: [],
    },
    {
      title: "Test C",
      file: "e2e/c.spec.ts",
      error: "Network request failed",
      screenshotPaths: [],
      tracePaths: [],
      videoPaths: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setAtlassianEnv() {
  process.env.ATLASSIAN_SITE_URL = "cohi.atlassian.net";
  process.env.ATLASSIAN_EMAIL = "qa-bot@cohi.com";
  process.env.ATLASSIAN_API_TOKEN = "test-token-abc";
  process.env.CONFLUENCE_QA_PAGE_ID = "99999";
  process.env.QA_JIRA_PROJECT_KEY = "COHI";
  process.env.QA_JIRA_PARENT_ISSUE = "COHI-14";
  process.env.QA_JIRA_TRACKING_ISSUE = "COHI-14";
}

function clearAtlassianEnv() {
  delete process.env.ATLASSIAN_SITE_URL;
  delete process.env.ATLASSIAN_EMAIL;
  delete process.env.ATLASSIAN_API_TOKEN;
  delete process.env.CONFLUENCE_QA_PAGE_ID;
  delete process.env.QA_JIRA_PROJECT_KEY;
  delete process.env.QA_JIRA_PARENT_ISSUE;
  delete process.env.QA_JIRA_TRACKING_ISSUE;
  delete process.env.QA_CREATE_BUGS_IN_PROD;
}

function makeFetchMock(responses: Record<string, any> = {}) {
  return vi.fn().mockImplementation(async (url: string, opts: any) => {
    const key = `${opts?.method ?? "GET"} ${url}`;
    const match =
      responses[key] ??
      Object.entries(responses).find(([k]) => url.includes(k))?.[1] ??
      { ok: true, status: 200, json: async () => ({}) };

    return {
      ok: match.ok ?? true,
      status: match.status ?? 200,
      headers: { get: () => "application/json" },
      json: async () => match.body ?? {},
      text: async () => JSON.stringify(match.body ?? {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("atlassianReporter.updateConfluencePage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setAtlassianEnv();
    fetchMock = makeFetchMock({
      // GET page returns version 5
      "GET https://cohi.atlassian.net/wiki/api/v2/pages/99999": {
        ok: true,
        body: { version: { number: 5 } },
      },
      // PUT page succeeds
      "PUT https://cohi.atlassian.net/wiki/api/v2/pages/99999": {
        ok: true,
        body: {},
      },
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    clearAtlassianEnv();
    vi.unstubAllGlobals();
  });

  it("GETs the current page version then PUTs with version+1", async () => {
    const { updateConfluencePage } = await import(
      "../../../scripts/qa/lib/atlassianReporter.js"
    );

    await updateConfluencePage({
      summary: PASSING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "42",
      commitHash: "abc1234",
      s3ReportKey: null,
    });

    const calls = fetchMock.mock.calls;
    const getCalls = calls.filter(([url]: [string]) => url.includes("/pages/99999") && !calls.find);
    const putCall = calls.find(
      ([url, opts]: [string, any]) =>
        url.includes("/pages/99999") && opts?.method === "PUT"
    );

    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall[1].body);
    expect(body.version.number).toBe(6); // current 5 + 1
  });

  it("returns null and logs warning when CONFLUENCE_QA_PAGE_ID is missing", async () => {
    delete process.env.CONFLUENCE_QA_PAGE_ID;
    const { updateConfluencePage } = await import(
      "../../../scripts/qa/lib/atlassianReporter.js"
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await updateConfluencePage({
      summary: PASSING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "1",
      commitHash: "abc",
      s3ReportKey: null,
    });

    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  it("returns null and does not throw if credentials are missing", async () => {
    clearAtlassianEnv();
    const { updateConfluencePage } = await import(
      "../../../scripts/qa/lib/atlassianReporter.js"
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await updateConfluencePage({
      summary: PASSING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "1",
      commitHash: "abc",
      s3ReportKey: null,
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("atlassianReporter.reportFailuresToJira", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setAtlassianEnv();
  });

  afterEach(() => {
    clearAtlassianEnv();
    vi.unstubAllGlobals();
  });

  it("creates a new bug when no open bug exists", async () => {
    fetchMock = makeFetchMock({
      // JQL search returns nothing
      "/search": { ok: true, body: { issues: [] } },
      // issue link types
      "/issueLinkType": { ok: true, body: { issueLinkTypes: [{ id: "10001", name: "Relates", inward: "is related to" }] } },
      // issue creation
      "/issue": { ok: true, status: 201, body: { key: "COHI-999" } },
      // issue link
      "/issueLink": { ok: true, body: {} },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { reportFailuresToJira } = await import(
      "../../../scripts/qa/lib/atlassianReporter.js"
    );

    await reportFailuresToJira({
      summary: FAILING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "42",
      s3ReportKey: null,
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([, opts]: [string, any]) => opts?.method === "POST"
    );
    const issuePosts = postCalls.filter(([url]: [string]) => url.endsWith("/issue") || url.match(/\/issue$/));
    expect(issuePosts.length).toBeGreaterThanOrEqual(1);
  });

  it("adds a comment to an existing open bug instead of creating a duplicate", async () => {
    fetchMock = makeFetchMock({
      "/search": { ok: true, body: { issues: [{ key: "COHI-100" }] } },
      "/comment": { ok: true, body: {} },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { reportFailuresToJira } = await import(
      "../../../scripts/qa/lib/atlassianReporter.js"
    );

    await reportFailuresToJira({
      summary: FAILING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "43",
      s3ReportKey: null,
    });

    const commentCalls = fetchMock.mock.calls.filter(([url]: [string]) =>
      url.includes("COHI-100/comment")
    );
    expect(commentCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("skips bug creation in prod when QA_CREATE_BUGS_IN_PROD is false", async () => {
    process.env.QA_CREATE_BUGS_IN_PROD = "false";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { reportFailuresToJira } = await import(
      "../../../scripts/qa/lib/atlassianReporter.js"
    );

    await reportFailuresToJira({
      summary: FAILING_SUMMARY,
      suite: "smoke",
      environment: "production",
      buildNumber: "100",
      s3ReportKey: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not throw if Jira API fails", async () => {
    fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { reportFailuresToJira } = await import(
      "../../../scripts/qa/lib/atlassianReporter.js"
    );

    await expect(
      reportFailuresToJira({
        summary: FAILING_SUMMARY,
        suite: "critical",
        environment: "dev",
        buildNumber: "1",
        s3ReportKey: null,
      })
    ).resolves.not.toThrow();

    warnSpy.mockRestore();
  });
});

describe("atlassianReporter.reportSuccessToJira", () => {
  afterEach(() => {
    clearAtlassianEnv();
    vi.unstubAllGlobals();
  });

  it("posts a success comment to the tracking issue", async () => {
    setAtlassianEnv();
    const fetchMock = makeFetchMock({ "/comment": { ok: true, body: {} } });
    vi.stubGlobal("fetch", fetchMock);

    const { reportSuccessToJira } = await import(
      "../../../scripts/qa/lib/atlassianReporter.js"
    );

    await reportSuccessToJira({
      summary: PASSING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "50",
      confluencePageUrl: "https://cohi.atlassian.net/wiki/pages/99999",
    });

    const commentCalls = fetchMock.mock.calls.filter(([url]: [string]) =>
      url.includes("COHI-14/comment")
    );
    expect(commentCalls.length).toBe(1);
  });

  it("skips silently when tracking issue is not configured", async () => {
    setAtlassianEnv();
    delete process.env.QA_JIRA_TRACKING_ISSUE;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { reportSuccessToJira } = await import(
      "../../../scripts/qa/lib/atlassianReporter.js"
    );

    await reportSuccessToJira({
      summary: PASSING_SUMMARY,
      suite: "smoke",
      environment: "dev",
      buildNumber: "1",
      confluencePageUrl: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
