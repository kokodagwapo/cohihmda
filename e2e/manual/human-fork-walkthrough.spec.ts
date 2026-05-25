/**
 * Human-style walkthrough: real login state, real LLM, real UI clicks.
 * Run: npx playwright test e2e/manual/human-fork-walkthrough.spec.ts --config=playwright.manual-live.config.ts
 */
import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import {
  dismissBlockingOverlays,
  forceUnifiedChat,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import {
  openFreshWorkbenchChat,
  waitForChatInputReady,
} from "../helpers/workbenchLive";

const OUT = path.join("test-results", "human-walkthrough");

test.describe("Human fork walkthrough @manual-live", () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await forceUnifiedChat(page);
  });

  test("tenant admin can switch Workbench → Chat and fork UX", async ({ page }) => {
    const log: string[] = [];
    const note = (s: string) => {
      log.push(s);
      console.log(`[human] ${s}`);
    };

    await openFreshWorkbenchChat(page);
    await page.screenshot({ path: path.join(OUT, "01-workbench-open.png"), fullPage: true });

    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const permRes = await page.request.get("/api/chat/v1/permissions", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const permBody = permRes.ok() ? await permRes.json() : { error: permRes.status() };
    note(`permissions: ${JSON.stringify(permBody)}`);
    fs.writeFileSync(path.join(OUT, "permissions.json"), JSON.stringify(permBody, null, 2));

    const input = unifiedChatMessageInput(page);
    await input.fill("Build a quick MTD KPI summary — funded units only.");
    await input.press("Enter");
    note("sent workbench prompt");
    await waitForChatInputReady(page);
    await dismissBlockingOverlays(page);
    await page.screenshot({ path: path.join(OUT, "02-after-first-turn.png"), fullPage: true });

    const combobox = page.getByRole("combobox", { name: "Chat type" });
    await expect(combobox).toBeVisible({ timeout: 15_000 });
    const currentType = (await combobox.textContent())?.trim() ?? "";
    note(`chat type before switch: "${currentType}"`);

    await combobox.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    const optionTexts = await listbox.getByRole("option").allTextContents();
    note(`dropdown options: ${JSON.stringify(optionTexts)}`);
    await page.screenshot({ path: path.join(OUT, "03-dropdown-open.png"), fullPage: true });

    expect(optionTexts.length, "dropdown must list chat types for tenant admin").toBeGreaterThan(1);
    expect(
      optionTexts.some((t) => /^(Chat|Research)$/i.test(t.trim())),
      `expected Chat or Research in ${JSON.stringify(optionTexts)}`,
    ).toBe(true);

    const pick = optionTexts.some((t) => t.trim() === "Chat") ? "Chat" : "Research";
    await listbox.getByRole("option", { name: pick, exact: true }).click();
    note(`selected ${pick} from open listbox`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, "04-after-type-switch.png"), fullPage: true });

    const forkChip = await page.getByTestId("conversation-fork-chips").isVisible().catch(() => false);
    const toastVisible = await page
      .getByText(/Started a new.*chat|carried over|continued from/i)
      .first()
      .isVisible()
      .catch(() => false);
    const composerEmpty = (await input.inputValue()) === "";
    const typeTrigger = page.getByRole("combobox", { name: "Chat type" });
    const afterType = (await typeTrigger.textContent().catch(() => pick))?.trim() ?? pick;

    note(`after switch type="${afterType}" forkChip=${forkChip} toast=${toastVisible} composerEmpty=${composerEmpty}`);

    fs.writeFileSync(path.join(OUT, "RESULT.txt"), log.join("\n"));

    expect(afterType).toMatch(/Chat|Research/i);
    expect(forkChip || toastVisible, "fork chip or toast should appear after mid-thread type switch").toBe(
      true,
    );
  });
});
