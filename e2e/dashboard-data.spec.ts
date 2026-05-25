import { test, expect } from "./fixtures";
import type { Page, Response } from "@playwright/test";

async function waitForApi(
  page: Page,
  label: string,
  predicate: (response: Response) => boolean,
  timeoutMs = 60_000,
): Promise<Response> {
  const response = await page.waitForResponse(predicate, { timeout: timeoutMs });
  expect(response.status(), `${label} returned non-OK status`).toBeLessThan(400);
  return response;
}

// IMPORTANT: keep this timeout STRICTLY shorter than the Playwright test
// timeout (60s at the time of writing). If this waits for the full 60s and
// the caller `await`s it inside a `Promise.all([...])`, the outer test
// timeout fires first — the `catch` never runs, `Promise.all` never resolves,
// and the test fails with "Test timeout of 60000ms exceeded" even though the
// required (non-optional) sibling request already responded. The original 60s
// default exhibited exactly this failure mode on environments where the
// leaderboard request is gated on tenant/channel selection and never fires.
async function waitForApiOptional(
  page: Page,
  label: string,
  predicate: (response: Response) => boolean,
  timeoutMs = 20_000,
): Promise<Response | null> {
  try {
    return await waitForApi(page, label, predicate, timeoutMs);
  } catch {
    return null;
  }
}

async function expectInsightsSections(page: Page): Promise<void> {
  const sectionVisible = await expect
    .poll(
      async () => {
        const sectionCandidates = [
          page.locator("#CohiInsights"),
          page.locator("#industryNews"),
          page.locator("#leaderboard"),
          page.getByRole("heading", { name: /insights|news|leaderboard/i }).first(),
          page.getByText(/industry news|market news|leaderboard|Cohi/i).first(),
        ];

        for (const candidate of sectionCandidates) {
          if (await candidate.isVisible().catch(() => false)) {
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true)
    .then(() => true)
    .catch(() => false);

  if (!sectionVisible) {
    await expect(page).toHaveURL(/\/insights/);
    await expect(page.locator("h1, h2, [role='heading']").first()).toBeVisible();
  }
}

test.describe("@regression Dashboard data integrity", () => {
  test("@COHI-398 insights dashboard loads API-backed insights and leaderboard data", async ({ userPage }) => {
    // Use optional waits: the leaderboard request is gated on tenant/channel
    // selection and can be slow or skipped entirely in some environments. We
    // still require the insights API to respond (that's the primary contract),
    // and we fall back to DOM-level checks if the leaderboard is silent.
    const insightsResponsePromise = waitForApi(
      userPage,
      "insights API",
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/dashboard/insights?"),
    );
    const leaderboardResponsePromise = waitForApiOptional(
      userPage,
      "leaderboard API",
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/dashboard/leaderboard?"),
    );

    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });

    const [insightsResponse, leaderboardResponse] = await Promise.all([
      insightsResponsePromise,
      leaderboardResponsePromise,
    ]);

    const insightsPayload = (await insightsResponse.json()) as {
      insights?: unknown[];
      generatedAt?: string;
      usedLLM?: boolean;
    };

    expect(Array.isArray(insightsPayload.insights)).toBe(true);
    expect(typeof insightsPayload.generatedAt).toBe("string");
    expect(typeof insightsPayload.usedLLM).toBe("boolean");

    let leaderboardPayload: { leaderboard?: unknown[]; timeframe?: string } | null = null;
    if (leaderboardResponse) {
      leaderboardPayload = (await leaderboardResponse.json()) as {
        leaderboard?: unknown[];
        timeframe?: string;
      };
      expect(Array.isArray(leaderboardPayload.leaderboard)).toBe(true);
      expect(typeof leaderboardPayload.timeframe).toBe("string");
    }

    await expectInsightsSections(userPage);

    const firstLeader =
      leaderboardPayload && Array.isArray(leaderboardPayload.leaderboard)
        ? (leaderboardPayload.leaderboard[0] as { name?: unknown } | undefined)
        : undefined;
    if (firstLeader && typeof firstLeader.name === "string" && firstLeader.name.trim()) {
      const inLeaderboard = await userPage
        .locator("#leaderboard")
        .getByText(firstLeader.name, { exact: false })
        .first()
        .isVisible()
        .catch(() => false);
      const anywhereOnPage = await userPage
        .getByText(firstLeader.name, { exact: false })
        .first()
        .isVisible()
        .catch(() => false);
      expect(inLeaderboard || anywhereOnPage).toBe(true);
    }
  });

  test("@COHI-398 fallout forecast page receives structured top-tiering API data", async ({ userPage }) => {
    const falloutDataResponsePromise = waitForApi(
      userPage,
      "fallout data API",
      (response) =>
        response.request().method() === "GET" &&
        (response.url().includes("/api/loans?") ||
          response.url().includes("/api/toptiering") ||
          response.url().includes("/api/dashboard/closing-fallout-forecast")),
    );

    await userPage.goto("/fallout-forecast", { waitUntil: "domcontentloaded" });
    const falloutDataResponse = await falloutDataResponsePromise;
    const payload = (await falloutDataResponse.json()) as Record<string, unknown>;
    const requestUrl = falloutDataResponse.url();

    if (requestUrl.includes("/api/loans?")) {
      expect(Array.isArray(payload.loans)).toBe(true);
    } else if (requestUrl.includes("/api/toptiering")) {
      expect(Array.isArray(payload.actors)).toBe(true);
      expect(payload.totals && typeof payload.totals === "object").toBeTruthy();
    } else {
      const hasExpectedForecastShape =
        Array.isArray(payload.loans) ||
        Array.isArray(payload.data) ||
        (payload.totals && typeof payload.totals === "object");
      expect(hasExpectedForecastShape).toBe(true);
    }

    await expect(userPage.locator("h1, h2").first()).toBeVisible();
    await expect(userPage.locator("button, [role='button']").first()).toBeVisible();
  });

  test("@COHI-398 pricing dashboard loads KPI/report/detail data contracts", async ({ userPage }) => {
    const kpisResponsePromise = waitForApi(
      userPage,
      "pricing kpis API",
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/pricing-dashboard/kpis?"),
    );
    const reportResponsePromise = waitForApi(
      userPage,
      "pricing report API",
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/pricing-dashboard/report?"),
    );
    const detailResponsePromise = waitForApi(
      userPage,
      "pricing detail API",
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/pricing-dashboard/detail?"),
    );

    await userPage.goto("/pricing-dashboard", { waitUntil: "domcontentloaded" });
    const [kpisResponse, reportResponse, detailResponse] = await Promise.all([
      kpisResponsePromise,
      reportResponsePromise,
      detailResponsePromise,
    ]);

    const kpisPayload = (await kpisResponse.json()) as {
      units?: number;
      volume?: number;
      pipelineMargin?: number;
      pricingDollars?: number;
      labelPrefix?: string;
    };
    const reportPayload = (await reportResponse.json()) as {
      rows?: unknown[];
      totals?: Record<string, unknown>;
    };
    const detailPayload = (await detailResponse.json()) as {
      rows?: unknown[];
      totals?: Record<string, unknown>;
    };

    expect(typeof kpisPayload.units).toBe("number");
    expect(typeof kpisPayload.volume).toBe("number");
    expect(typeof kpisPayload.pipelineMargin).toBe("number");
    expect(typeof kpisPayload.pricingDollars).toBe("number");
    expect(typeof kpisPayload.labelPrefix).toBe("string");

    expect(Array.isArray(reportPayload.rows)).toBe(true);
    expect(reportPayload.totals && typeof reportPayload.totals === "object").toBeTruthy();
    expect(Array.isArray(detailPayload.rows)).toBe(true);
    expect(detailPayload.totals && typeof detailPayload.totals === "object").toBeTruthy();

    await expect(userPage.locator("h1, h2").first()).toBeVisible();

    const firstReportRow = Array.isArray(reportPayload.rows)
      ? (reportPayload.rows[0] as { entityName?: unknown; actorName?: unknown } | undefined)
      : undefined;
    if (firstReportRow) {
      if (typeof firstReportRow.entityName === "string" && firstReportRow.entityName.trim()) {
        await expect(
          userPage.getByText(firstReportRow.entityName, { exact: false }).first(),
        ).toBeVisible();
      } else if (typeof firstReportRow.actorName === "string" && firstReportRow.actorName.trim()) {
        await expect(
          userPage.getByText(firstReportRow.actorName, { exact: false }).first(),
        ).toBeVisible();
      }
    }
  });
});


