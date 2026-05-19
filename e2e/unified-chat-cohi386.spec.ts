import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function mockUnifiedChatApis(page: Page) {
  await page.route(/\/api\/tenants(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tenants: [{ id: "tenant-unified-e2e", name: "QA Tenant" }],
      }),
    });
  });

  await page.route(/\/api\/chat\/v1\/messages(?:\?.*)?$/, async (route) => {
    const body = route.request().postDataJSON() as { message?: string } | null;
    expect(body?.message ?? "").toBeTruthy();

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        conversationId: "550e8400-e29b-41d4-a716-446655440001",
        turn: {
          id: "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
          blocks: [
            {
              type: "text",
              markdown:
                "Unified chat stub: blocks envelope is active for this session.",
            },
          ],
        },
        metadata: {
          suggestedQuestions: ["Follow-up one?", "Follow-up two?"],
          route: "global",
        },
      }),
    });
  });
}

test.describe("Unified Cohi Chat (v1 API)", () => {
  test("@critical @COHI-386 global data-chat uses unified v1 when forced", async ({
    userPage,
  }) => {
    await userPage.addInitScript(() => {
      try {
        sessionStorage.setItem("cohi_force_unified_chat", "1");
      } catch {
        /* ignore */
      }
    });

    await mockUnifiedChatApis(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });

    await expect(
      userPage.getByPlaceholder("What important info do I need to know today?"),
    ).toBeVisible({ timeout: 15_000 });

    const input = userPage.getByPlaceholder(
      "What important info do I need to know today?",
    );
    await input.fill("Smoke test unified chat path");
    await input.press("Enter");

    await expect(
      userPage.getByText(/Unified chat stub: blocks envelope is active/i),
    ).toBeVisible({
      timeout: 15_000,
    });
  });

  test("@COHI-404 unified shell on /insights without floating dock chip", async ({
    userPage,
  }) => {
    await userPage.addInitScript(() => {
      try {
        sessionStorage.setItem("cohi_force_unified_chat", "1");
      } catch {
        /* ignore */
      }
    });

    await mockUnifiedChatApis(userPage);
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });

    await expect(userPage.getByTestId("unified-chat-shell")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      userPage.getByRole("button", { name: /Open Cohi Insights/i }),
    ).toHaveCount(0);
  });
});
