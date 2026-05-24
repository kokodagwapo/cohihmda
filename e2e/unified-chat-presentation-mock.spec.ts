import { test, expect } from "./fixtures";
import {
  buildV1StreamSseBody,
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  mockUnifiedChatTenantApi,
  mockV1Permissions,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

test.describe("Workbench presentation from chat (mocked)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);

    await userPage.route(/\/api\/workbench\/reports\/generate(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        body: Buffer.from("mock-pptx"),
      });
    });
  });

  test("@critical streams generate_report and does not ask for live values", async ({
    userPage,
  }) => {
    let sawGenerateReport = false;

    await userPage.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const body = buildV1StreamSseBody(
        "550e8400-e29b-41d4-a716-446655440001",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        [
          {
            type: "text",
            markdown: "Built a board-ready deck from your dashboard.",
          },
          {
            type: "actions",
            items: [
              {
                type: "generate_report",
                format: "pptx",
                reportDefinition: {
                  title: "Board Overview",
                  slides: [
                    {
                      id: "s1",
                      layout: "title",
                      title: "Board Overview",
                      elements: [
                        {
                          id: "e1",
                          type: "kpi",
                          position: { x: 1, y: 1, w: 3, h: 1 },
                          config: { type: "kpi", label: "Funded Units", value: 100 },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
        { chatType: "workbench" },
      );
      const text = body;
      if (/generate_report/.test(text)) sawGenerateReport = true;
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: text,
      });
    });

    await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new");
    await selectUnifiedChatType(userPage, "Workbench");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Turn this into a board-ready PowerPoint");
    await input.press("Enter");

    await expect(input).toBeEnabled({ timeout: 30_000 });
    expect(sawGenerateReport).toBe(true);

    const mainText = (await userPage.locator("main").textContent()) ?? "";
    expect(mainText).not.toMatch(/need the live|share live values/i);
    await expect(
      userPage.getByText(/board-ready|presentation|deck/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
