import { test, expect } from "./fixtures";

test.describe("@critical Critical missing routes", () => {
  test("reset-password route handles invalid link state", async ({ page }) => {
    await page.goto("/reset-password", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  });

  test("reset-password route supports cognito code flow inputs", async ({ page }) => {
    await page.goto("/reset-password?email=qa-user@example.com", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Verification Code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset Password" })).toBeVisible();
  });

  test("sso callback shows an error path safely", async ({ page }) => {
    await page.goto(
      "/auth/sso/callback?error=access_denied&error_description=User%20denied%20request",
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { name: /Sign in failed/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Return to login/i })).toBeVisible();
  });

  test("unsubscribe token route resolves to success or error state", async ({ page }) => {
    await page.goto("/unsubscribe/fake-token-for-e2e", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .getByRole("heading")
        .filter({ hasText: /You’re unsubscribed|Invalid link|Something went wrong/i })
        .first(),
    ).toBeVisible();
  });

  test("subscription cancel route is reachable", async ({ userPage }) => {
    await userPage.goto("/subscription/cancel", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { name: /Checkout Cancelled/i })).toBeVisible();
  });

  test("subscription success route loads fallback status UI", async ({ userPage }) => {
    await userPage.goto("/subscription/success?session_id=fake_session_for_e2e", {
      waitUntil: "domcontentloaded",
    });
    await expect(userPage.getByRole("heading", { name: /Payment Successful/i })).toBeVisible();
  });

  test("data-chat route loads chat shell", async ({ userPage }) => {
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { name: "Data Chat" })).toBeVisible();
  });

  test("loans route loads loans table shell", async ({ userPage }) => {
    await userPage.goto("/loans", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { name: "Loan Details" })).toBeVisible();
  });

  test("workbench redirect sends users to my-dashboard", async ({ userPage }) => {
    await userPage.goto("/workbench", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/my-dashboard/);
  });

  test("loan-funnel legacy route redirects to insights", async ({ userPage }) => {
    await userPage.goto("/loan-funnel", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/insights/);
  });

  test("fallout loan detail deep-link route renders detail shell", async ({ userPage }) => {
    await userPage.goto("/fallout-forecast/loan/fake-loan-id-e2e", {
      waitUntil: "domcontentloaded",
    });
    await expect(userPage.getByRole("button", { name: /Back to Coheus Fallout Report/i })).toBeVisible();
  });
});
