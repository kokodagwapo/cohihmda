import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function mockDataQualityApis(page: Page) {
  await page.route(/\/api\/data-quality\/metrics(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        metrics: {
          total_loans: 1200,
          loans_with_issues: 88,
          total_issues: 112,
          quality_score: 91,
          critical_issues: 7,
          warning_issues: 42,
          info_issues: 63,
          status_inconsistencies: 7,
          date_sequence_issues: 3,
          issues_by_group: {
            "Status Tests": 7,
            "Application Tests": 42,
            "Credit Tests": 63,
          },
        },
      }),
    });
  });

  await page.route(/\/api\/data-quality\/warnings-grouped(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        warnings: [
          {
            id: "active-funded",
            name: "Active loan has funding date",
            type: "status_inconsistency",
            group: "Status Tests",
            severity: "critical",
            field: "funding_date",
            description: "Active loans with funding dates should be reviewed.",
            count: 7,
            sample_loans: [{ loan_id: "loan-1", loan_number: "1001" }],
          },
          {
            id: "missing-application",
            name: "Missing application date",
            type: "missing_required",
            group: "Application Tests",
            severity: "warning",
            field: "application_date",
            description: "Application date is required for compliance checks.",
            count: 42,
            sample_loans: [{ loan_id: "loan-2", loan_number: "1002" }],
          },
        ],
        groupedSummary: {
          "Status Tests": { count: 7, criticalCount: 7, warningCount: 0, infoCount: 0 },
          "Application Tests": {
            count: 42,
            criticalCount: 0,
            warningCount: 42,
            infoCount: 0,
          },
        },
      }),
    });
  });

  await page.route(/\/api\/data-quality\/status-inconsistencies(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        inconsistencies: [
          {
            id: "active-funded",
            name: "Active loan has funding date",
            description: "Active loans with funding dates should be reviewed.",
            severity: "critical",
            count: 7,
            sample_loans: [{ loan_id: "loan-1", loan_number: "1001" }],
          },
        ],
        statusDistribution: [],
        statusGroupTotals: {},
      }),
    });
  });

  await page.route(/\/api\/data-quality\/crucial-fields-status(?:\?.*)?$/, async (route) => {
    const field = (
      name: string,
      column: string,
      populatedCount: number,
      missingCount: number,
    ) => ({
      name,
      column,
      priority: 1,
      applicableLoanCount: populatedCount + missingCount,
      populatedCount,
      missingCount,
      populationRate: Math.round((populatedCount / (populatedCount + missingCount)) * 100),
      status: missingCount === 0 ? "good" : "warning",
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        totalLoans: 1200,
        stageGroups: {
          universal: {
            label: "All Loans",
            description: "Fields expected on all reportable loans.",
            applicableLoanCount: 1200,
            fields: [
              field("Loan Number", "loan_number", 1200, 0),
              field("Loan Amount", "loan_amount", 1190, 10),
              field("Loan Source", "loan_source", 1180, 20),
              field("Application Date", "application_date", 1150, 50),
            ],
          },
          originated: {
            label: "Originated Loans",
            description: "Fields expected on originated loans.",
            applicableLoanCount: 700,
            fields: [field("Closing Date", "closing_date", 690, 10)],
          },
          processing: {
            label: "Processing Loans",
            description: "Fields expected after application.",
            applicableLoanCount: 900,
            fields: [field("Processor", "processor", 860, 40)],
          },
        },
      }),
    });
  });

  await page.route(/\/api\/data-quality\/range-analysis(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        rangeAnalysis: {
          fico: {
            inRange: 1100,
            outOfRange: 12,
            distribution: [
              { range: "620-679", count: 300 },
              { range: "680-739", count: 500 },
              { range: "Out of Range", count: 12 },
            ],
          },
          ltv: {
            inRange: 1088,
            outOfRange: 24,
            distribution: [
              { range: "0-80%", count: 800 },
              { range: "Over 100%", count: 24 },
            ],
          },
        },
      }),
    });
  });

  await page.route(/\/api\/data-quality\/warning-loans\/active-funded(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        totalCount: 1,
        filteredCount: 1,
        fields: ["loan_number", "funding_date", "loan_officer", "branch"],
        loans: [
          {
            loan_number: "1001",
            funding_date: "2026-04-01",
            loan_officer: "Avery Adams",
            branch: "Main",
          },
        ],
      }),
    });
  });
}

test.describe("Data Quality dashboard", () => {
  test("@critical @COHI-13 renders standalone /data-quality dashboard with summary tabs", async ({
    userPage,
  }) => {
    await mockDataQualityApis(userPage);
    await userPage.goto("/data-quality", { waitUntil: "domcontentloaded" });

    await expect(userPage).toHaveURL(/\/data-quality/);
    await expect(
      userPage.getByRole("heading", { name: /^Data Quality$/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(userPage.getByText("Quality Score")).toBeVisible();
    await expect(userPage.getByText("91%")).toBeVisible();
    await expect(userPage.getByRole("tab", { name: /Warnings/i })).toBeVisible();
    await expect(userPage.getByRole("tab", { name: /Field Health/i })).toBeVisible();
    await expect(userPage.getByRole("tab", { name: /Ranges/i })).toBeVisible();
  });

  test("@critical @COHI-13 supports warning drill-down and data-quality analysis tabs", async ({
    userPage,
  }) => {
    await mockDataQualityApis(userPage);
    await userPage.goto("/data-quality", { waitUntil: "domcontentloaded" });

    await expect(
      userPage.getByRole("button", { name: /Loan Lifecycle/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(userPage.getByText("Active loan has funding date")).toBeVisible();
    await userPage.getByRole("button", { name: "View" }).first().click();
    const dialog = userPage.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText("1001")).toBeVisible();
    await expect(dialog.getByText("Avery Adams")).toBeVisible();
    await userPage.keyboard.press("Escape");

    await userPage.getByRole("tab", { name: /Field Health/i }).click();
    await expect(userPage.getByText("Loan Identification")).toBeVisible();
    await expect(userPage.getByText("Personnel & Assignments")).toBeVisible();

    await userPage.getByRole("tab", { name: /Ranges/i }).click();
    await expect(userPage.getByText("Range Analysis")).toBeVisible();
    await expect(userPage.getByText("FICO Score")).toBeVisible();
    await expect(userPage.getByText("Out of Range").first()).toBeVisible();
  });

  test("@critical @COHI-13 admin Data Quality entry points to the standalone dashboard", async ({
    adminPage,
  }) => {
    await adminPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: "Data Quality" }).click();

    await expect(
      adminPage.getByText("Data Quality has moved to its own dashboard."),
    ).toBeVisible({ timeout: 10_000 });
    await adminPage.getByRole("link", { name: "Open Data Quality Dashboard" }).click();
    await expect(adminPage).toHaveURL(/\/data-quality/);
  });
});
