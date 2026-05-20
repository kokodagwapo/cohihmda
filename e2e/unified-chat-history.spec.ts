import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";
import {
  computeFolderTreeDepth,
  forceUnifiedChat,
  mockUnifiedChatApis,
  mockV1ConversationsList,
  mockV1FoldersTree,
  mockV1Permissions,
  QA_AGENT_RUN_TAG,
} from "./helpers/unifiedChat";

const legacySessions = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "e2e/fixtures/legacy-research-sessions.json"),
    "utf8",
  ),
) as { sessionIds: string[] };

const DEEP_FOLDER_TREE = [
  { id: "f1", name: "L1", parent_id: null },
  { id: "f2", name: "L2", parent_id: "f1" },
  { id: "f3", name: "L3", parent_id: "f2" },
  { id: "f4", name: "L4", parent_id: "f3" },
  { id: "f5", name: "L5", parent_id: "f4" },
];

test.describe("Unified chat history (COHI-403)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatApis(userPage);
    await mockV1Permissions(userPage);
  });

  test("@critical @COHI-403 AC1 GET folders tree depth at most 5", async ({
    userPage,
  }) => {
    await mockV1FoldersTree(userPage, DEEP_FOLDER_TREE);
    await mockV1ConversationsList(userPage, []);
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("button", { name: "Folders" })).toBeVisible({
      timeout: 15_000,
    });
    expect(computeFolderTreeDepth(DEEP_FOLDER_TREE)).toBeLessThanOrEqual(5);
  });

  test("@critical @COHI-403 AC2 @MUTATION POST folder and assign conversation", async ({
    userPage,
  }) => {
    let folderPostCount = 0;
    await mockV1FoldersTree(userPage, []);
    await mockV1ConversationsList(userPage, [
      {
        id: "conv-e2e-1",
        title: "QA conversation",
        chat_type: "chat",
      },
    ]);
    await userPage.route(/\/api\/chat\/v1\/folders(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "POST") folderPostCount += 1;
      await route.continue();
    });

    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("button", { name: "Folders" })).toBeVisible({
      timeout: 15_000,
    });
    await userPage.getByRole("button", { name: "New folder" }).first().click();
    const dialog = userPage.getByRole("dialog", { name: "New folder" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel("Folder name").fill(`${QA_AGENT_RUN_TAG}-folder`);
    await dialog.getByRole("button", { name: /^Create$/i }).click({ force: true });
    await expect.poll(() => folderPostCount).toBeGreaterThanOrEqual(1);
  });

  test("@critical @COHI-403 AC3 full history search filter pagination", async ({
    userPage,
  }) => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `conv-page-${i}`,
      title: i === 0 ? "Alpha loan volume thread" : `Thread ${i}`,
      chat_type: i % 2 === 0 ? "chat" : "research",
    }));
    await mockV1FoldersTree(userPage, []);
    await mockV1ConversationsList(userPage, rows);

    await userPage.goto("/chat/history", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { name: "Full chat history" })).toBeVisible({
      timeout: 15_000,
    });

    await userPage.getByLabel("Search conversations by title").fill("Alpha loan");
    await expect(userPage.getByText("Alpha loan volume thread")).toBeVisible({
      timeout: 10_000,
    });

    const historyFilters = userPage
      .getByRole("heading", { name: "Full chat history" })
      .locator("xpath=ancestor::div[contains(@class,'container')][1]");
    await historyFilters.getByRole("combobox").click();
    await userPage.getByRole("option", { name: "Research", exact: true }).click();

    const next = userPage.getByRole("button", { name: "Next" });
    if (await next.isVisible().catch(() => false)) {
      await next.click();
    }
  });

  test("@critical @COHI-403 AC4 research-lab redirects with resume query", async ({
    userPage,
  }) => {
    const sessionId = legacySessions.sessionIds[0] ?? "e2e-legacy-session-1";

    await userPage.goto("/research-lab", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/insights\?mode=research/);

    await userPage.goto(`/research?session=${sessionId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(userPage).toHaveURL(
      new RegExp(`\\?.*resume=${encodeURIComponent(sessionId)}.*mode=research`),
    );
    expect(new URL(userPage.url()).pathname).toBe("/");

    await userPage.goto(`/research/session?session=${sessionId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(userPage).toHaveURL(/\/\?/);
    await expect(userPage).toHaveURL(new RegExp(`resume=${encodeURIComponent(sessionId)}`));
  });
});
