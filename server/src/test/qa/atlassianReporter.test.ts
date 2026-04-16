import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { QaRunSummary } from "../../../scripts/qa/lib/resultParser.js";
import type { QaTargetIssue } from "../../../scripts/qa/lib/atlassianReporter.js";

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
  ],
};

const TARGETS: QaTargetIssue[] = [
  {
    issueKey: "COHI-106",
    issueSummary: "AI control plane",
    issueStatus: "In Progress",
    issueUrl: "https://cohi.atlassian.net/browse/COHI-106",
    confluencePageUrl: "https://cohi.atlassian.net/wiki/pages/12345",
  },
  {
    issueKey: "COHI-14",
    issueSummary: "Mobile testing and QA agents",
    issueStatus: "In Review",
    issueUrl: "https://cohi.atlassian.net/browse/COHI-14",
    confluencePageUrl: "https://cohi.atlassian.net/wiki/pages/67890",
  },
];

function setAtlassianEnv() {
  process.env.ATLASSIAN_SITE_URL = "cohi.atlassian.net";
  process.env.ATLASSIAN_EMAIL = "qa-bot@cohi.com";
  process.env.ATLASSIAN_API_TOKEN = "test-token-abc";
  process.env.CONFLUENCE_QA_PARENT_PAGE_ID = "99999";
  process.env.QA_JIRA_PROJECT_KEY = "COHI";
}

function clearAtlassianEnv() {
  delete process.env.ATLASSIAN_SITE_URL;
  delete process.env.ATLASSIAN_EMAIL;
  delete process.env.ATLASSIAN_API_TOKEN;
  delete process.env.CONFLUENCE_QA_PARENT_PAGE_ID;
  delete process.env.QA_JIRA_PROJECT_KEY;
  delete process.env.QA_JIRA_FALLBACK_ISSUE;
  delete process.env.QA_CREATE_BUGS_IN_PROD;
}

function makeFetchMock(responses: Record<string, any> = {}) {
  return vi.fn().mockImplementation(async (url: string, opts: any = {}) => {
    const method = opts.method ?? "GET";
    const key = `${method} ${url}`;
    const match =
      responses[key] ??
      Object.entries(responses).find(([k]) => key.includes(k) || url.includes(k))?.[1] ??
      { ok: true, status: 200, body: {} };

    return {
      ok: match.ok ?? true,
      status: match.status ?? 200,
      headers: { get: () => "application/json" },
      json: async () => match.body ?? {},
      text: async () => JSON.stringify(match.body ?? {}),
    };
  });
}

describe("atlassianReporter.resolveQaTargets", () => {
  beforeEach(() => {
    setAtlassianEnv();
  });

  afterEach(() => {
    clearAtlassianEnv();
    vi.unstubAllGlobals();
  });

  it("loads Jira issue details for discovered issue keys", async () => {
    const fetchMock = makeFetchMock({
      "/issue/COHI-106?fields=summary,status": {
        ok: true,
        body: { fields: { summary: "AI control plane", status: { name: "In Progress" } } },
      },
      "/issue/COHI-14?fields=summary,status": {
        ok: true,
        body: { fields: { summary: "Mobile testing and QA agents", status: { name: "In Review" } } },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { resolveQaTargets } = await import("../../../scripts/qa/lib/atlassianReporter.js");
    const targets = await resolveQaTargets(["COHI-106", "COHI-14"]);

    expect(targets.map((target) => target.issueKey)).toEqual(["COHI-106", "COHI-14"]);
    expect(targets[0].issueSummary).toBe("AI control plane");
  });

  it("normalizes ATLASSIAN_SITE_URL when configured with https scheme", async () => {
    process.env.ATLASSIAN_SITE_URL = "https://cohi.atlassian.net/";
    const fetchMock = makeFetchMock({
      "GET https://cohi.atlassian.net/rest/api/3/issue/COHI-106?fields=summary,status": {
        ok: true,
        body: { fields: { summary: "AI control plane", status: { name: "In Progress" } } },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { resolveQaTargets } = await import("../../../scripts/qa/lib/atlassianReporter.js");
    const targets = await resolveQaTargets(["COHI-106"]);

    expect(targets).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cohi.atlassian.net/rest/api/3/issue/COHI-106?fields=summary,status",
      expect.any(Object)
    );
  });
});

describe("atlassianReporter.updateConfluencePages", () => {
  beforeEach(() => {
    setAtlassianEnv();
  });

  afterEach(() => {
    clearAtlassianEnv();
    vi.unstubAllGlobals();
  });

  it("updates one existing Confluence page per Jira issue", async () => {
    const fetchMock = makeFetchMock({
      "GET https://cohi.atlassian.net/wiki/api/v2/pages/99999": {
        ok: true,
        body: { id: "99999", spaceId: "space-1", version: { number: 2 } },
      },
      "GET https://cohi.atlassian.net/wiki/api/v2/pages?title=QA%20-%20COHI-106&space-id=space-1": {
        ok: true,
        body: { results: [{ id: "12345", title: "QA - COHI-106" }] },
      },
      "GET https://cohi.atlassian.net/wiki/api/v2/pages?title=QA%20-%20COHI-14&space-id=space-1": {
        ok: true,
        body: { results: [{ id: "67890", title: "QA - COHI-14" }] },
      },
      "GET https://cohi.atlassian.net/wiki/api/v2/pages/12345": {
        ok: true,
        body: { version: { number: 5 } },
      },
      "GET https://cohi.atlassian.net/wiki/api/v2/pages/67890": {
        ok: true,
        body: { version: { number: 8 } },
      },
      "PUT https://cohi.atlassian.net/wiki/api/v2/pages/12345": {
        ok: true,
        body: {},
      },
      "PUT https://cohi.atlassian.net/wiki/api/v2/pages/67890": {
        ok: true,
        body: {},
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { updateConfluencePages } = await import("../../../scripts/qa/lib/atlassianReporter.js");
    const enriched = await updateConfluencePages({
      targets: TARGETS.map((target) => ({ ...target, confluencePageId: undefined })),
      summary: PASSING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "42",
      commitHash: "abc1234",
      s3ReportKey: null,
    });

    expect(enriched.map((target) => target.confluencePageId)).toEqual(["12345", "67890"]);
    const putCalls = fetchMock.mock.calls.filter(([, opts]: [string, any]) => opts?.method === "PUT");
    expect(putCalls).toHaveLength(2);
  });
});

describe("atlassianReporter.reportFailuresToJira", () => {
  beforeEach(() => {
    setAtlassianEnv();
  });

  afterEach(() => {
    clearAtlassianEnv();
    vi.unstubAllGlobals();
  });

  it("creates and links a bug for each target issue when no open bug exists", async () => {
    const fetchMock = makeFetchMock({
      "/search": { ok: true, body: { issues: [] } },
      "/issueLinkType": {
        ok: true,
        body: { issueLinkTypes: [{ id: "10001", name: "Relates", inward: "is related to" }] },
      },
      "POST https://cohi.atlassian.net/rest/api/3/issue": {
        ok: true,
        status: 201,
        body: { key: "COHI-999" },
      },
      "POST https://cohi.atlassian.net/rest/api/3/issueLink": {
        ok: true,
        body: {},
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { reportFailuresToJira } = await import("../../../scripts/qa/lib/atlassianReporter.js");
    await reportFailuresToJira({
      targets: [TARGETS[0]],
      summary: FAILING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "42",
      s3ReportKey: null,
    });

    const issueCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, any]) => url.endsWith("/issue") && opts?.method === "POST"
    );
    const linkCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, any]) => url.endsWith("/issueLink") && opts?.method === "POST"
    );
    expect(issueCalls).toHaveLength(1);
    expect(linkCalls).toHaveLength(1);
  });
});

describe("atlassianReporter.reportSuccessToJira", () => {
  beforeEach(() => {
    setAtlassianEnv();
  });

  afterEach(() => {
    clearAtlassianEnv();
    vi.unstubAllGlobals();
  });

  it("posts a success comment to each resolved Jira issue", async () => {
    const fetchMock = makeFetchMock({ "/comment": { ok: true, body: {} } });
    vi.stubGlobal("fetch", fetchMock);

    const { reportSuccessToJira } = await import("../../../scripts/qa/lib/atlassianReporter.js");
    await reportSuccessToJira({
      targets: TARGETS,
      summary: PASSING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "50",
    });

    const commentCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, any]) => url.includes("/comment") && opts?.method === "POST"
    );
    expect(commentCalls).toHaveLength(2);
  });
});
