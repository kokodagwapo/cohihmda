import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { QaRunSummary } from "../../../scripts/qa/lib/resultParser.js";
import type { QaTargetIssue } from "../../../scripts/qa/lib/atlassianReporter.js";

const PASSING_SUMMARY: QaRunSummary = {
  total: 3,
  passed: 3,
  failed: 0,
  skipped: 0,
  durationMs: 5000,
  tests: [
    {
      title: "@critical @COHI-77 workbench save flow",
      file: "e2e/workbench.spec.ts",
      status: "passed",
      durationMs: 1200,
      jiraKeys: ["COHI-77"],
      screenshotPaths: [],
      tracePaths: [],
      videoPaths: [],
    },
    {
      title: "@critical @COHI-77 @COHI-96 shared signal",
      file: "e2e/workbench.spec.ts",
      status: "passed",
      durationMs: 900,
      jiraKeys: ["COHI-77", "COHI-96"],
      screenshotPaths: [],
      tracePaths: [],
      videoPaths: [],
    },
    {
      title: "@critical @COHI-14 research evidence gap seed",
      file: "e2e/research-lab.spec.ts",
      status: "passed",
      durationMs: 1000,
      jiraKeys: ["COHI-14"],
      screenshotPaths: [],
      tracePaths: [],
      videoPaths: [],
    },
  ],
  failedTests: [],
};

const FAILING_SUMMARY: QaRunSummary = {
  total: 3,
  passed: 2,
  failed: 1,
  skipped: 0,
  durationMs: 8000,
  tests: [
    {
      title: "@critical @COHI-96 supports drill-down",
      file: "e2e/toptiering.spec.ts",
      status: "failed",
      durationMs: 2200,
      jiraKeys: ["COHI-96"],
      error: "Expected Portfolio Analysis drawer",
      screenshotPaths: ["/tmp/toptiering.png"],
      tracePaths: ["/tmp/toptiering.zip"],
      videoPaths: [],
    },
    {
      title: "@critical @COHI-77 workbench save flow",
      file: "e2e/workbench.spec.ts",
      status: "passed",
      durationMs: 1800,
      jiraKeys: ["COHI-77"],
      screenshotPaths: [],
      tracePaths: [],
      videoPaths: [],
    },
    {
      title: "@critical @COHI-14 research page shell",
      file: "e2e/research-lab.spec.ts",
      status: "passed",
      durationMs: 1400,
      jiraKeys: ["COHI-14"],
      screenshotPaths: [],
      tracePaths: [],
      videoPaths: [],
    },
  ],
  failedTests: [
    {
      title: "@critical @COHI-96 supports drill-down",
      file: "e2e/toptiering.spec.ts",
      status: "failed",
      durationMs: 2200,
      jiraKeys: ["COHI-96"],
      error: "Expected Portfolio Analysis drawer",
      screenshotPaths: ["/tmp/toptiering.png"],
      tracePaths: ["/tmp/toptiering.zip"],
      videoPaths: [],
    },
  ],
};

const TARGETS: QaTargetIssue[] = [
  {
    issueKey: "COHI-77",
    issueSummary: "Workbench agents panel",
    issueStatus: "In Progress",
    issueUrl: "https://cohi.atlassian.net/browse/COHI-77",
    confluencePageUrl: "https://cohi.atlassian.net/wiki/pages/12345",
  },
  {
    issueKey: "COHI-96",
    issueSummary: "TopTiering drill-down",
    issueStatus: "In Review",
    issueUrl: "https://cohi.atlassian.net/browse/COHI-96",
    confluencePageUrl: "https://cohi.atlassian.net/wiki/pages/67890",
  },
  {
    issueKey: "COHI-14",
    issueSummary: "Mobile testing and QA agents",
    issueStatus: "Approved",
    issueUrl: "https://cohi.atlassian.net/browse/COHI-14",
    confluencePageUrl: "https://cohi.atlassian.net/wiki/pages/24680",
  },
];

function setAtlassianEnv() {
  process.env.ATLASSIAN_SITE_URL = "cohi.atlassian.net";
  process.env.ATLASSIAN_EMAIL = "qa-bot@cohi.com";
  process.env.ATLASSIAN_API_TOKEN = "test-token-abc";
  process.env.CONFLUENCE_QA_PARENT_PAGE_ID = "99999";
  process.env.QA_JIRA_PROJECT_KEY = "COHI";
  process.env.AI_ARTIFACTS_BUCKET = "cohi-qa-artifacts";
  process.env.AWS_REGION = "us-east-2";
}

function clearAtlassianEnv() {
  delete process.env.ATLASSIAN_SITE_URL;
  delete process.env.ATLASSIAN_EMAIL;
  delete process.env.ATLASSIAN_API_TOKEN;
  delete process.env.CONFLUENCE_QA_PARENT_PAGE_ID;
  delete process.env.QA_JIRA_PROJECT_KEY;
  delete process.env.QA_CREATE_BUGS_IN_PROD;
  delete process.env.AI_ARTIFACTS_BUCKET;
  delete process.env.AWS_REGION;
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

function extractAdfBodyFromPutCall(call: [string, any]) {
  const payload = JSON.parse(call[1].body);
  // v1 Confluence REST wraps the ADF payload under
  // `body.atlas_doc_format.value`; the representation is declared inline
  // as a sibling of the value.
  return JSON.parse(payload.body.atlas_doc_format.value);
}

function collectAdfText(node: any): string {
  if (!node) return "";
  if (Array.isArray(node)) {
    return node.map((entry) => collectAdfText(entry)).join(" ");
  }
  const ownText = typeof node.text === "string" ? node.text : "";
  const childText = node.content ? collectAdfText(node.content) : "";
  return [ownText, childText].filter(Boolean).join(" ").trim();
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

  it("renders only issue-scoped tests and related commits on each page", async () => {
    const fetchMock = makeFetchMock({
      // v1 REST API surface. `getConfluenceParent` expands `space` so the
      // reporter can read `space.key` for the subsequent `spaceKey=` lookup.
      "GET https://cohi.atlassian.net/wiki/rest/api/content/99999?expand=space": {
        ok: true,
        body: { id: "99999", space: { key: "space-1" } },
      },
      "GET https://cohi.atlassian.net/wiki/rest/api/content?title=QA%20-%20COHI-77&spaceKey=space-1&type=page&limit=25": {
        ok: true,
        body: { results: [{ id: "12345", title: "QA - COHI-77" }] },
      },
      "GET https://cohi.atlassian.net/wiki/rest/api/content?title=QA%20-%20COHI-96&spaceKey=space-1&type=page&limit=25": {
        ok: true,
        body: { results: [{ id: "67890", title: "QA - COHI-96" }] },
      },
      "GET https://cohi.atlassian.net/wiki/rest/api/content/12345?expand=version": {
        ok: true,
        body: { version: { number: 5 } },
      },
      "GET https://cohi.atlassian.net/wiki/rest/api/content/67890?expand=version": {
        ok: true,
        body: { version: { number: 8 } },
      },
      "PUT https://cohi.atlassian.net/wiki/rest/api/content/12345": {
        ok: true,
        body: {},
      },
      "PUT https://cohi.atlassian.net/wiki/rest/api/content/67890": {
        ok: true,
        body: {},
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { updateConfluencePages } = await import("../../../scripts/qa/lib/atlassianReporter.js");
    const enriched = await updateConfluencePages({
      targets: TARGETS.map((target, index) => ({
        ...target,
        confluencePageId: undefined,
        ...(index === 0 && {
          acValidation: {
            issueKey: target.issueKey,
            issueSummary: target.issueSummary,
            status: "passed",
            statements: [
              {
                index: 1,
                category: "ROUTE",
                statement: "Navigating to /workbench/agents renders Agents",
                status: "passed",
                stepIds: ["ac1-goto-agents"],
                evidenceLinks: [],
              },
            ],
            approvalStatus: "auto_read_only",
            confluenceSummary: "1 AC statement validated successfully.",
            screenshotPaths: [],
          },
        }),
      })).slice(0, 2),
      summary: PASSING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "42",
      commitHash: "abc1234",
      s3ReportKey: null,
      reportConsoleUrl: null,
      artifacts: [],
      relatedCommitsByIssueKey: {
        "COHI-77": [{ hash: "abc1234", shortHash: "abc1234", subject: "COHI-77 initial work" }],
        "COHI-96": [{ hash: "def5678", shortHash: "def5678", subject: "COHI-96 follow-up" }],
      },
    });

    expect(enriched.map((target) => target.confluencePageId)).toEqual(["12345", "67890"]);
    const putCalls = fetchMock.mock.calls.filter(([, opts]: [string, any]) => opts?.method === "PUT");
    expect(putCalls).toHaveLength(2);
    // v1 declares representation inside the body.atlas_doc_format envelope.
    expect(JSON.parse(putCalls[0][1].body).body.atlas_doc_format.representation).toBe(
      "atlas_doc_format",
    );

    const firstPageText = collectAdfText(extractAdfBodyFromPutCall(putCalls[0]));
    const secondPageText = collectAdfText(extractAdfBodyFromPutCall(putCalls[1]));

    expect(firstPageText).toContain("@COHI-77 workbench save flow");
    expect(firstPageText).not.toContain("@COHI-14 research evidence gap seed");
    expect(firstPageText).toContain("COHI-77 initial work");
    expect(firstPageText).toContain("Acceptance Criteria Validation");
    expect(firstPageText).toContain("1 AC statement validated successfully.");
    expect(secondPageText).toContain("@COHI-96");
    expect(secondPageText).not.toContain("@COHI-14 research evidence gap seed");
    expect(secondPageText).toContain("COHI-96 follow-up");
  });

  it("emits an evidence-gap page and Jira comment when a target has no tagged tests", async () => {
    const fetchMock = makeFetchMock({
      "GET https://cohi.atlassian.net/wiki/rest/api/content/99999?expand=space": {
        ok: true,
        body: { id: "99999", space: { key: "space-1" } },
      },
      "GET https://cohi.atlassian.net/wiki/rest/api/content?title=QA%20-%20COHI-14&spaceKey=space-1&type=page&limit=25": {
        ok: true,
        body: { results: [{ id: "67890", title: "QA - COHI-14" }] },
      },
      "GET https://cohi.atlassian.net/wiki/rest/api/content/67890?expand=version": {
        ok: true,
        body: { version: { number: 8 } },
      },
      "PUT https://cohi.atlassian.net/wiki/rest/api/content/67890": {
        ok: true,
        body: {},
      },
      "POST https://cohi.atlassian.net/rest/api/3/issue/COHI-14/comment": {
        ok: true,
        body: {},
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { updateConfluencePages } = await import("../../../scripts/qa/lib/atlassianReporter.js");
    await updateConfluencePages({
      targets: [TARGETS[2]],
      summary: {
        ...PASSING_SUMMARY,
        tests: PASSING_SUMMARY.tests.filter((test) => !test.jiraKeys.includes("COHI-14")),
      },
      suite: "critical",
      environment: "dev",
      buildNumber: "42",
      commitHash: "abc1234",
      s3ReportKey: null,
      reportConsoleUrl: null,
      artifacts: [],
      relatedCommitsByIssueKey: {
        "COHI-14": [{ hash: "def5678", shortHash: "def5678", subject: "COHI-14 follow-up" }],
      },
    });

    const putCalls = fetchMock.mock.calls.filter(([, opts]: [string, any]) => opts?.method === "PUT");
    const pageText = collectAdfText(extractAdfBodyFromPutCall(putCalls[0]));
    expect(pageText).toContain("Evidence gap");

    const commentCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, any]) => url.endsWith("/issue/COHI-14/comment") && opts?.method === "POST",
    );
    expect(commentCalls).toHaveLength(1);
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

  it("creates and links a bug only for the issue with tagged failures", async () => {
    const fetchMock = makeFetchMock({
      "/search/jql": { ok: true, body: { issues: [] } },
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
        body: undefined,
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { reportFailuresToJira } = await import("../../../scripts/qa/lib/atlassianReporter.js");
    await reportFailuresToJira({
      targets: TARGETS,
      summary: FAILING_SUMMARY,
      suite: "critical",
      environment: "dev",
      buildNumber: "42",
      s3ReportKey: null,
      reportConsoleUrl: null,
      artifacts: [],
    });

    const issueCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, any]) => url.endsWith("/issue") && opts?.method === "POST"
    );
    const linkCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, any]) => url.endsWith("/issueLink") && opts?.method === "POST"
    );
    expect(issueCalls).toHaveLength(1);
    expect(linkCalls).toHaveLength(1);
    expect(JSON.parse(issueCalls[0][1].body).fields.summary).toContain("COHI-96");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/rest/api/3/search/jql?jql="),
      expect.any(Object)
    );
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
    expect(commentCalls).toHaveLength(3);
  });
});
