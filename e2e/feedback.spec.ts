import { test, expect } from "./fixtures";

const FEEDBACK_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Y5wAAAABJRU5ErkJggg==";

async function dismissBlockingOverlays(page: import("@playwright/test").Page) {
  // The welcome tour / onboarding dialog can appear on first visit and
  // intercept clicks. Dismiss until no blocking dialog/backdrop remains.
  for (let i = 0; i < 5; i += 1) {
    const blockingDialog = page
      .locator("[role='dialog']")
      .filter({ hasText: /quick tour|welcome|what's new|let us give you a quick tour/i })
      .first();
    const overlay = page.locator("div[data-state='open'][aria-hidden='true']").first();

    const dialogVisible = await blockingDialog.isVisible({ timeout: 1_500 }).catch(() => false);
    const overlayVisible = await overlay.isVisible({ timeout: 1_500 }).catch(() => false);

    if (dialogVisible || overlayVisible) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    } else {
      break;
    }
  }
}

async function suppressWelcomeTour(page: import("@playwright/test").Page) {
  // Pre-seed the same localStorage key used by the welcome tour so CI runs
  // don't render an overlay that intercepts Help-menu pointer actions.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cohi-welcome-tour-last-shown", new Date().toISOString());
    } catch {
      /* storage access denied */
    }
  });
}

async function waitForBackdropToClear(page: import("@playwright/test").Page) {
  // Guard against transient modal backdrops still animating after dismissal.
  const backdrop = page.locator("div[data-state='open'][aria-hidden='true']").first();
  await expect(backdrop).not.toBeVisible({ timeout: 10_000 });
}

async function openHelpMenuAndGoToFeedback(page: import("@playwright/test").Page) {
  const helpOptionsButton = page.getByRole("button", { name: "Help options" });
  const helpMenu = page.getByRole("menu", { name: "Help options" });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await dismissBlockingOverlays(page);
    await waitForBackdropToClear(page);

    await expect(helpOptionsButton).toBeVisible({ timeout: 15_000 });

    const isMenuVisible = await helpMenu.isVisible().catch(() => false);
    if (!isMenuVisible) {
      // Primary path: hover opens the menu on desktop.
      await helpOptionsButton.hover({ timeout: 15_000 });
    }

    const ready = await helpMenu.isVisible({ timeout: 2_500 }).catch(() => false);
    if (ready) {
      await helpMenu.getByRole("menuitem", { name: "Feedback" }).click();
      return;
    }

    // Fallback: click toggle if hover path didn't open in this attempt.
    await helpOptionsButton.click();
    const readyAfterClick = await helpMenu.isVisible({ timeout: 2_500 }).catch(() => false);
    if (readyAfterClick) {
      await helpMenu.getByRole("menuitem", { name: "Feedback" }).click();
      return;
    }
  }

  throw new Error("[E2E] Unable to open Help menu and click Feedback after retries.");
}

function sampleListItem() {
  return {
    id: FEEDBACK_ID,
    area: "insights",
    type: "bug_issue",
    status: "open",
    description: "The insights table lags after filters are changed.",
    submitter_name: "QA User",
    submitter_email: "qa.user@example.com",
    created_at: "2026-04-24T12:00:00.000Z",
    updated_at: "2026-04-24T12:00:00.000Z",
    status_changed_at: "2026-04-24T12:00:00.000Z",
    in_progress_at: null,
    resolved_at: null,
  };
}

async function mockFeedbackApis(
  page: import("@playwright/test").Page,
  options?: { notificationSent?: boolean; forbidDetail?: boolean; includeAttachment?: boolean },
) {
  const notificationSent = options?.notificationSent ?? true;
  const forbidDetail = options?.forbidDetail ?? false;
  const includeAttachment = options?.includeAttachment ?? false;

  await page.route(/\/api\/feedback(\?|$)/, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          feedback: [sampleListItem()],
          page: 1,
          limit: 50,
          total: 1,
        }),
      });
      return;
    }

    if (method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          feedback: sampleListItem(),
          notificationSent,
          notificationFailures: notificationSent ? [] : [{ email: "alerts@example.com", error: "smtp timeout" }],
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.route(/\/api\/feedback\/[^/]+\??[^/]*$/, async (route) => {
    const method = route.request().method();
    if (forbidDetail && method === "GET") {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "Forbidden" }),
      });
      return;
    }

    const detail = {
      ...sampleListItem(),
      status: method === "PATCH" ? "in_progress" : "open",
      admin_notes: method === "PATCH" ? "Reviewed by platform admin." : "",
      in_progress_at: method === "PATCH" ? "2026-04-24T12:10:00.000Z" : null,
      status_changed_at: method === "PATCH" ? "2026-04-24T12:10:00.000Z" : "2026-04-24T12:00:00.000Z",
      attachments: includeAttachment
        ? [
            {
              id: "33333333-3333-4333-8333-333333333333",
              original_file_name: "evidence.png",
              mime_type: "image/png",
              file_size_bytes: 68,
              file_kind: "image",
            },
          ]
        : [],
    };

    if (method === "GET" || method === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ feedback: detail }),
      });
      return;
    }

    await route.continue();
  });

  await page.route(/\/api\/feedback\/[^/]+\/attachments\/[^/]+\/download(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(PNG_1X1_BASE64, "base64"),
    });
  });
}

async function chooseSelectOption(
  page: import("@playwright/test").Page,
  trigger: string,
  optionName: string,
) {
  await page.locator(trigger).click();
  await page.getByRole("option", { name: optionName }).click();
}

test.describe("Feedback flow (COHI-322)", () => {
  test.describe.configure({ mode: "serial" });

  test("@critical @COHI-322 help menu routes to feedback and renders required controls", async ({
    userPage,
  }) => {
    await mockFeedbackApis(userPage);
    await suppressWelcomeTour(userPage);

    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);
    await waitForBackdropToClear(userPage);

    await expect(
      userPage.getByRole("navigation", { name: /main navigation/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(userPage.getByRole("button", { name: "Help options" })).toBeVisible({
      timeout: 30_000,
    });

    // Use stable selectors
    await openHelpMenuAndGoToFeedback(userPage);
    await expect(userPage).toHaveURL(/\/feedback/);
    await expect(userPage.locator("#feedback-area")).toBeVisible();
    await expect(userPage.locator("#feedback-type")).toBeVisible();
    await expect(userPage.locator("#feedback-description")).toBeVisible();
    await expect(userPage.getByRole("button", { name: "Submit Feedback" })).toBeEnabled();
  });

  test("@critical @COHI-322 submit validation and attachment constraints are enforced", async ({
    userPage,
  }) => {
    await mockFeedbackApis(userPage);

    await userPage.goto("/feedback", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // Use stable selectors
    const submitFeedbackCard = userPage
      .locator("div")
      .filter({ has: userPage.getByRole("heading", { name: "Submit Feedback" }) })
      .first();
    await userPage.getByRole("button", { name: "Submit Feedback" }).click();
    await expect(submitFeedbackCard.getByText("Area is required to submit", { exact: true })).toBeVisible();
    await expect(submitFeedbackCard.getByText("Type is required to submit", { exact: true })).toBeVisible();
    await expect(
      submitFeedbackCard.getByText("Description is required to submit", { exact: true }),
    ).toBeVisible();

    await userPage.locator("#feedback-files").setInputFiles([
      { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") },
      { name: "b.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") },
      { name: "c.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") },
      { name: "d.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") },
      { name: "e.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") },
      { name: "f.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") },
    ]);
    await expect(submitFeedbackCard.getByText("Maximum 5 files allowed", { exact: true })).toBeVisible();
    await userPage.getByRole("button", { name: "Clear" }).click();

    await userPage.locator("#feedback-files").setInputFiles([
      { name: "malware.exe", mimeType: "application/octet-stream", buffer: Buffer.from("x") },
    ]);
    await expect(
      submitFeedbackCard.getByText("Unsupported file type: malware.exe", { exact: true }),
    ).toBeVisible();
  });

  test("@critical @COHI-322 successful submit persists and handles notification warning", async ({
    userPage,
  }) => {
    await mockFeedbackApis(userPage, { notificationSent: false });

    await userPage.goto("/feedback", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // Use stable selectors
    await chooseSelectOption(userPage, "#feedback-area", "Insights");
    await chooseSelectOption(userPage, "#feedback-type", "Bug/Issue");
    await userPage.locator("#feedback-description").fill("Latency spikes on the insights grid.");
    await userPage.getByRole("button", { name: "Submit Feedback" }).click();

    const notifications = userPage.getByLabel(/Notifications/i);
    await expect(notifications.getByText("Feedback saved")).toBeVisible();
    await expect(
      notifications.getByText("Feedback submitted successfully. Email Notification Failed. Will try again shortly."),
    ).toBeVisible();
    await expect(userPage.getByRole("heading", { name: "Submitted Feedback" })).toBeVisible();
  });

  test("@critical @COHI-322 feedback detail route shows download link and image preview", async ({
    userPage,
  }) => {
    await mockFeedbackApis(userPage, { includeAttachment: true });

    await userPage.goto("/feedback", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // Use stable selectors
    const submittedFeedbackSection = userPage
      .locator("div")
      .filter({ has: userPage.getByRole("heading", { name: "Submitted Feedback" }) })
      .first();
    await submittedFeedbackSection
      .getByRole("button")
      .filter({ hasText: "The insights table lags after filters are changed." })
      .first()
      .click();
    await expect(userPage).toHaveURL(new RegExp(`/feedback/${FEEDBACK_ID}`));
    await expect(userPage.getByRole("button", { name: "Download" })).toBeVisible();
    await expect(userPage.locator("img[alt='evidence.png']")).toBeVisible();
  });

  test("@critical @COHI-322 non-super access to other feedback detail is blocked", async ({
    userPage,
  }) => {
    await mockFeedbackApis(userPage, { forbidDetail: true });

    await userPage.goto(`/feedback/${FEEDBACK_ID}`, { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // Use stable selectors
    await expect(userPage).toHaveURL(/\/feedback$/);
    const notifications = userPage.getByLabel(/Notifications/i);
    await expect(notifications.getByText("Failed to load feedback", { exact: true })).toBeVisible();
  });

  test("@critical @COHI-322 platform admin can update status and admin notes on detail page", async ({
    adminPage,
  }) => {
    await adminPage.addInitScript((tenantId) => {
      window.localStorage.setItem(
        "cohi-tenant-selection",
        JSON.stringify({ state: { selectedTenantId: tenantId }, version: 0 }),
      );
    }, TENANT_ID);
    await adminPage.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "44444444-4444-4444-8444-444444444444",
            email: "platform.admin@example.com",
            full_name: "Platform Admin",
            role: "super_admin",
            is_super_admin: true,
            tenant_id: null,
          },
        }),
      });
    });
    await mockFeedbackApis(adminPage);

    await adminPage.goto(`/feedback/${FEEDBACK_ID}`, { waitUntil: "domcontentloaded" });
    await adminPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // Use stable selectors
    await chooseSelectOption(
      adminPage,
      "div:has(> label:has-text('Status')) button[role='combobox']",
      "In Progress",
    );
    await adminPage.locator("textarea").fill("Reviewed by platform admin.");
    await adminPage.getByRole("button", { name: "Save Updates" }).click();
    const notifications = adminPage.getByLabel(/Notifications/i);
    await expect(notifications.getByText("Feedback updated", { exact: true })).toBeVisible();
    await expect(
      adminPage.locator("div").filter({ hasText: "In Progress At:" }).first(),
    ).toBeVisible();
  });
});
