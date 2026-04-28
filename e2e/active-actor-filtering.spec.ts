import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function mockLeaderboardActorApis(page: Page) {
  await page.route("**/api/dashboard/leaderboard?**", async (route) => {
    const url = route.request().url();
    const base = {
      timeframe: "lq",
      actorStatusSummary: {
        totalActors: 4,
        matchedActors: 2,
        unmatchedActors: 2,
        activeActors: 1,
        inactiveActors: 1,
        removedActors: 1,
        unknownActors: 1,
      },
    };
    const fullLeaderboard = [
      {
        employeeId: "id-active",
        name: "Active LO",
        role: "Loan Officer",
        branch: "Main",
        rank: 1,
        actorStatus: "Active",
        lastLogin: "2026-01-15T12:00:00.000Z",
        loansClosed: 20,
        loansStarted: 22,
        totalVolume: 8_000_000,
        totalRevenue: 200_000,
        pullThroughRate: 80,
        avgCycleTime: 28,
        delta: 5,
      },
      {
        employeeId: "id-inactive",
        name: "Inactive LO",
        role: "Loan Officer",
        branch: "Main",
        rank: 2,
        actorStatus: "Inactive",
        lastLogin: null,
        loansClosed: 12,
        loansStarted: 14,
        totalVolume: 4_000_000,
        totalRevenue: 100_000,
        pullThroughRate: 70,
        avgCycleTime: 35,
        delta: 0,
      },
      {
        employeeId: "id-removed",
        name: "Removed LO",
        role: "Loan Officer",
        branch: "West",
        rank: 3,
        actorStatus: "Removed",
        lastLogin: null,
        loansClosed: 8,
        loansStarted: 9,
        totalVolume: 2_000_000,
        totalRevenue: 50_000,
        pullThroughRate: 65,
        avgCycleTime: 38,
        delta: -1,
      },
      {
        employeeId: "id-unknown",
        name: "Unknown LO",
        role: "Loan Officer",
        branch: "East",
        rank: 4,
        actorStatus: "Unknown",
        lastLogin: null,
        loansClosed: 5,
        loansStarted: 6,
        totalVolume: 1_000_000,
        totalRevenue: 25_000,
        pullThroughRate: 60,
        avgCycleTime: 40,
        delta: -2,
      },
    ];
    if (url.includes("actor_status=active")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...base,
          leaderboard: fullLeaderboard.filter((r) => r.actorStatus === "Active"),
        }),
      });
      return;
    }
    if (url.includes("actor_status=inactive")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...base,
          leaderboard: fullLeaderboard.filter((r) => r.actorStatus === "Inactive" || r.actorStatus === "Removed"),
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        leaderboard: fullLeaderboard,
      }),
    });
  });
}

const tierSummaryBlock = {
  top: {
    count: 1,
    revenue: 100_000,
    revenuePercent: 50,
    units: 10,
    unitsPercent: 50,
    avgRevenue: 100_000,
    avgUnits: 10,
  },
  second: {
    count: 1,
    revenue: 50_000,
    revenuePercent: 30,
    units: 5,
    unitsPercent: 30,
    avgRevenue: 50_000,
    avgUnits: 5,
  },
  bottom: {
    count: 0,
    revenue: 0,
    revenuePercent: 20,
    units: 0,
    unitsPercent: 20,
    avgRevenue: 0,
    avgUnits: 0,
  },
};

async function mockTopTieringComparison(page: Page) {
  await page.route("**/api/toptiering/comparison**", async (route) => {
    const url = route.request().url();
    const allActors = [
      {
        id: "a1",
        name: "Active Actor",
        tier: "top" as const,
        revenue: 100_000,
        units: 10,
        volume: 2_000_000,
        revenueBPS: 50,
        revenuePerLoan: 10_000,
        actorStatus: "Active",
        lastLogin: null,
      },
      {
        id: "a2",
        name: "Inactive Actor",
        tier: "second" as const,
        revenue: 50_000,
        units: 5,
        volume: 1_000_000,
        revenueBPS: 50,
        revenuePerLoan: 10_000,
        actorStatus: "Inactive",
        lastLogin: null,
      },
    ];
    const actors = url.includes("actor_status=active")
      ? allActors.filter((a) => a.actorStatus === "Active")
      : url.includes("actor_status=inactive")
        ? allActors.filter((a) => a.actorStatus === "Inactive")
        : allActors;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        actors,
        totals: {
          revenue: 150_000,
          units: 15,
          volume: 3_000_000,
          avgRevenueBPS: 50,
          actorCount: 2,
          avgRevenuePerActor: 75_000,
          avgUnitsPerActor: 7.5,
        },
        tierSummary: tierSummaryBlock,
        actorStatusFilter: url.includes("actor_status=")
          ? url.includes("actor_status=active")
            ? "active"
            : "inactive"
          : "all",
        actorStatusSummary: {
          totalActors: 2,
          matchedActors: 2,
          unmatchedActors: 0,
          activeActors: 1,
          inactiveActors: 1,
        removedActors: 0,
          unknownActors: 0,
        },
        dateRange: {
          start: "2025-01-01",
          end: "2025-12-31",
          label: "2025",
          periodType: "last-year",
        },
      }),
    });
  });
}

test.describe("Active actor filtering (COHI-350)", () => {
  test.describe.configure({ mode: "serial" });

  test("@critical @COHI-350 leaderboard shows actor status filter, summary, and active-only narrows rows", async ({
    userPage,
  }) => {
    await mockLeaderboardActorApis(userPage);
    await userPage.goto("/leaderboard", { waitUntil: "domcontentloaded" });

    await expect(userPage.getByTestId("actor-status-filter")).toBeVisible();
    await expect(userPage.getByText(/1 active · 1 inactive · 1 removed · 1 unknown/)).toBeVisible();

    const lbTable = userPage.locator("#leaderboard-main-table");
    await expect(lbTable.getByText("Active LO", { exact: true })).toBeVisible();
    await expect(lbTable.getByText("Inactive LO", { exact: true })).toBeVisible();
    await expect(lbTable.getByText("Removed LO", { exact: true })).toBeVisible();

    await userPage.getByTestId("actor-status-filter-active").click();
    await expect(lbTable.getByText("Active LO", { exact: true })).toBeVisible();
    await expect(lbTable.getByText("Inactive LO", { exact: true })).toHaveCount(0);
    await expect(lbTable.getByText("Removed LO", { exact: true })).toHaveCount(0);
  });

  test("@critical @COHI-350 TopTiering comparison keeps tier totals while filtering visible actors", async ({
    userPage,
  }) => {
    await mockTopTieringComparison(userPage);
    await userPage.goto("/performance/toptiering-comparison", {
      waitUntil: "domcontentloaded",
    });

    await expect(userPage.getByTestId("actor-status-filter")).toBeVisible();
    await expect(
      userPage.locator("#ttc-kpi-actor-count div.min-w-0.flex-1 > p").nth(1),
    ).toHaveText("2");
    await userPage.getByRole("tab", { name: "Detail" }).first().click();
    const detailTable = userPage.locator("#ttc-detail-table");
    await expect(detailTable.getByText("Active Actor", { exact: true })).toBeVisible();
    await expect(detailTable.getByText("Inactive Actor", { exact: true })).toBeVisible();

    await userPage.getByTestId("actor-status-filter-active").click();
    // KPI headline count is filtered actor rows; tier subline reflects tierSummary from the API.
    await expect(
      userPage.locator("#ttc-kpi-actor-count div.min-w-0.flex-1 > p").nth(1),
    ).toHaveText("1");
    await expect(userPage.locator("#ttc-kpi-actor-count")).toContainText("1 Top | 1 Second | 0 Bottom");
    await expect(detailTable.getByText("Active Actor", { exact: true })).toBeVisible();
    await expect(detailTable.getByText("Inactive Actor", { exact: true })).not.toBeVisible();
  });

  test("@critical @COHI-350 admin Encompass directory shows loan actor reconciliation summary", async ({
    adminPage,
  }) => {
    const tenantId = "e2e-admin-tenant";
    await adminPage.addInitScript((selectedTenantId) => {
      localStorage.setItem(
        "cohi-tenant-selection",
        JSON.stringify({ state: { selectedTenantId }, version: 0 }),
      );
    }, tenantId);
    await adminPage.route("**/api/tenants**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tenants: [{ id: tenantId, name: "E2E Admin Tenant", status: "active" }],
        }),
      });
    });
    await adminPage.route("**/api/los/connections**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connections: [
            {
              id: "los-conn-1",
              name: "Test Encompass",
              los_type: "encompass",
              is_active: true,
            },
          ],
        }),
      });
    });
    await adminPage.route("**/api/admin/encompass-users?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ users: [], total: 0 }),
      });
    });
    await adminPage.route("**/api/admin/encompass-users/sync-history?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });
    await adminPage.route("**/api/admin/encompass-users/actor-reconciliation-summary**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          actorColumn: "loan_officer",
          distinctLoanActors: 10,
          totalActors: 10,
          matchedActors: 7,
          unmatchedActors: 3,
          activeActors: 6,
          inactiveActors: 1,
          removedActors: 2,
          unknownActors: 3,
        }),
      });
    });

    await adminPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await adminPage.getByTestId("admin-users").click();
    await adminPage.getByRole("tab", { name: /Encompass Directory/i }).click();

    await expect(adminPage.getByTestId("actor-reconciliation-summary")).toBeVisible();
    await expect(adminPage.getByTestId("actor-reconciliation-summary")).toContainText(
      "7 of 10 distinct loan officers",
    );
  });
});
