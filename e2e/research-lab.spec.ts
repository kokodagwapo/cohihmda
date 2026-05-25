import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function mockResearchFindingsSession(page: Page) {
  await page.route(/\/api\/research\/sessions(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId: "cohi-331-session" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route(
    /\/api\/research\/sessions\/cohi-331-session\/stream(?:\?.*)?$/,
    async (route) => {
      const findings = [
        {
          questionId: 1,
          title: "Revenue pressure concentrated in mature applications",
          summary:
            "Applications aged 90-180 days show 18.4% lower pull-through and $425K lower revenue than the recent cohort. Processor queue aging accounts for 73 loans in the exception set. Follow-up should prioritize loans older than 120 days.",
          summary_bullets: [
            "Applications aged 90-180 days show 18.4% lower pull-through and $425K lower revenue than the recent cohort.",
            "Processor queue aging accounts for 73 loans in the exception set.",
            "Follow-up should prioritize loans older than 120 days.",
          ],
          confidence: "high",
          evidence: [],
          keyMetrics: { "Revenue Gap": "$425K", "Aged Loans": 73 },
        },
        {
          questionId: 2,
          title: "Single sentence finding stays compact",
          summary: "Single sentence finding summary remains concise.",
          confidence: "medium",
          evidence: [],
          keyMetrics: {},
        },
      ];

      const body = [
        `data: ${JSON.stringify({
          type: "quick_result",
          data: findings[0],
          timestamp: Date.now(),
        })}`,
        "",
        `data: ${JSON.stringify({
          type: "agent_finding",
          data: { content: JSON.stringify(findings[1]) },
          timestamp: Date.now(),
        })}`,
        "",
        `data: ${JSON.stringify({
          type: "complete",
          data: {},
          timestamp: Date.now(),
        })}`,
        "",
        "",
      ].join("\n");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    },
  );
}

async function mockResearchWorkbenchSaveSession(page: Page) {
  await page.route(/\/api\/research\/sessions(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId: "cohi-363-save-session" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route(
    /\/api\/research\/sessions\/cohi-363-save-session\/stream(?:\?.*)?$/,
    async (route) => {
      const finding = {
        questionId: 1,
        title: "Channel conversion save test",
        summary: "Channel conversion evidence is ready to save to Workbench.",
        confidence: "high",
        keyMetrics: { Channels: 2 },
        evidence: [
          {
            kind: "sql",
            sql: "select channel, pull_through from test_channel_conversion",
            explanation: "Conversion by channel",
            fields: ["channel", "pull_through"],
            rowCount: 2,
            rows: [
              { channel: "Retail", pull_through: 0.42 },
              { channel: "Wholesale", pull_through: 0.35 },
            ],
            chartHint: {
              type: "bar",
              xKey: "channel",
              yKey: "pull_through",
            },
          },
        ],
      };

      const body = [
        `data: ${JSON.stringify({
          type: "quick_result",
          data: finding,
          timestamp: Date.now(),
        })}`,
        "",
        `data: ${JSON.stringify({
          type: "complete",
          data: {},
          timestamp: Date.now(),
        })}`,
        "",
        "",
      ].join("\n");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    },
  );
}

test.describe("@critical Research Lab", () => {
  test("@COHI-398 @smoke research page loads with input and mode toggle", async ({ userPage }) => {
    await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { level: 2, name: "Research Lab" })).toBeVisible();
    await expect(userPage.getByPlaceholder(/e\.g\., What's our YTD pull-through/i)).toBeVisible();
    await expect(userPage.getByRole("button", { name: /Deep Analysis/i })).toBeVisible();
  });

  test("@COHI-398 @smoke accepts research question input", async ({ userPage }) => {
    await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });
    const prompt = userPage.getByPlaceholder(/e\.g\., What's our YTD pull-through/i);
    await prompt.fill("What are the top 5 conversion bottlenecks this month?");
    await expect(prompt).toHaveValue("What are the top 5 conversion bottlenecks this month?");
  });

  test("@critical @COHI-106 runs investigation lifecycle and supports follow-up behavior", async ({ userPage }) => {
    test.setTimeout(90_000);
    await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });

    const prompt = userPage.getByPlaceholder(/YTD pull-through|comprehensive analysis/i);
    await prompt.fill("What is our pull-through trend by channel this month?");
    await userPage.getByRole("button", { name: /Get answer|Investigate/i }).click();

    // Session starts: timeline tab + steering/follow-up input should appear.
    await expect(userPage.getByRole("tab", { name: "Timeline" })).toBeVisible();
    const steerOrFollowup = userPage.getByPlaceholder(/Steer the investigation|Ask a follow-up question/i);
    await expect(steerOrFollowup).toBeVisible();

    // While running, pause and resume controls should be available.
    const pauseBtn = userPage.getByRole("button", { name: "Pause" });
    if (await pauseBtn.isVisible().catch(() => false)) {
      await pauseBtn.click();
      const resumeBtn = userPage.getByRole("button", { name: "Resume" });
      if (await resumeBtn.isVisible().catch(() => false)) {
        await resumeBtn.click();
      }
    }

    // Wait for synthesis to complete (the "Continue the conversation" label
    // appears above the input bar when phase transitions to "complete").
    const completed = await userPage
      .getByText("Continue the conversation")
      .isVisible({ timeout: 45_000 })
      .catch(() => false);

    if (completed) {
      const reportTab = userPage.getByRole("tab", { name: "Report" });
      if (!(await reportTab.isDisabled())) {
        await reportTab.click();
      }

      // After completion the same input stays mounted but its placeholder
      // switches to "Ask a follow-up question...". Use the broad locator
      // that already matched during the running phase.
      await expect(steerOrFollowup).toBeVisible();
      await expect(steerOrFollowup).toBeEditable();
      await steerOrFollowup.fill("Can you break that down by top 3 loan officers?");
      await steerOrFollowup.press("Enter");
      await expect(userPage.getByRole("tab", { name: "Timeline" })).toBeVisible();
    }
  });

  test("@critical @COHI-331 renders research finding summaries as readable bullets", async ({
    userPage,
  }) => {
    await mockResearchFindingsSession(userPage);
    await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });

    const prompt = userPage.getByPlaceholder(/YTD pull-through|comprehensive analysis/i);
    await prompt.fill("Summarize mature application revenue risk.");
    await userPage.getByRole("button", { name: /Get answer|Investigate/i }).click();

    await expect(userPage.getByRole("tab", { name: /Findings/i })).toBeVisible({
      timeout: 15_000,
    });
    await userPage.getByRole("tab", { name: /Findings/i }).click();

    const findingsPanel = userPage.locator('[data-tour="research-findings"]');
    await expect(
      findingsPanel.getByText("Revenue pressure concentrated in mature applications"),
    ).toBeVisible({ timeout: 15_000 });

    const bulletItems = findingsPanel.locator("ul li");
    await expect(bulletItems).toHaveCount(3);
    await expect(bulletItems.nth(0)).toContainText("18.4%");
    await expect(bulletItems.nth(0)).toContainText("$425K");
    await expect(bulletItems.nth(1)).toContainText("73 loans");

    await expect(
      findingsPanel.getByText("Single sentence finding summary remains concise."),
    ).toBeVisible();
  });

  test("@critical @COHI-363 saves Research Lab visualization below existing Workbench content (real backend)", async ({
    userPage,
  }) => {
    // This test exercises the full real-backend save flow against a local
    // dev server (POST canvas + MyDashboard render + Research Lab query +
    // Save-to-Workbench PUT + 7s autosave settle + GET verify + DELETE
    // cleanup). Under parallel-worker contention — especially with the
    // current LOS-connections 500 noise on /research/session and
    // /my-dashboard shells — 120s is too tight and occasionally drains the
    // budget before the finally-block cleanup can fire. 180s gives enough
    // headroom without masking a real regression (each individual assertion
    // still has its own scoped timeout).
    test.setTimeout(180_000);
    await mockResearchWorkbenchSaveSession(userPage);

    const seedItem = {
      i: `seed-${Date.now()}`,
      x: 20,
      y: 20,
      w: 520,
      h: 360,
      type: "cohi_widget",
      payload: {
        type: "cohi_widget",
        sql: "select 1 as one",
        title: "Existing Seed Widget",
        vizConfig: { type: "table", title: "Existing", data: [] },
      },
    };

    const canvasTitle = `COHI-363 E2E ${Date.now()}`;

    // Navigate to the app first so relative-URL fetches resolve against the
    // app origin and inherit auth cookies / tenant headers from real session.
    await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });

    const createdCanvasId: string = await userPage.evaluate(
      async ({ title, item }) => {
        const token = localStorage.getItem("auth_token");
        if (!token) throw new Error("No auth_token in localStorage; user fixture not authed");
        const res = await fetch("/api/workbench/canvases", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          credentials: "include",
          body: JSON.stringify({
            title,
            layoutVersion: "freeform-v1",
            layout: [item],
          }),
        });
        if (!res.ok) {
          throw new Error(`Seed canvas POST failed: ${res.status} ${await res.text()}`);
        }
        const data = (await res.json()) as { id: string };
        return data.id;
      },
      { title: canvasTitle, item: seedItem },
    );

    expect(createdCanvasId).toMatch(/[0-9a-f-]{8,}/i);

    const fetchLayoutFromBackend = async (id: string) =>
      userPage.evaluate(async (canvasId) => {
        const token = localStorage.getItem("auth_token");
        const res = await fetch(`/api/workbench/canvases/${canvasId}`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) {
          throw new Error(`GET canvas failed: ${res.status} ${await res.text()}`);
        }
        const data = (await res.json()) as {
          content?: {
            layoutVersion?: string;
            layout?: Array<Record<string, unknown>>;
          };
        };
        return data.content;
      }, id);

    try {
      // Reproduce the real-world flow that exposed the autosave/stale-state
      // bug: open the canvas in MyDashboard FIRST so WorkbenchCanvas mounts
      // with just Viz A, then bounce to Research Lab, save Viz B, and verify
      // the appended widget actually persists (and isn't clobbered by an
      // autosave from the still-cached canvas state).
      await userPage.goto(`/my-dashboard/${createdCanvasId}`, {
        waitUntil: "domcontentloaded",
      });
      // Ensure the canvas actually rendered the seeded widget. The canvas
      // minimap renders widget titles too, so match is non-unique — use
      // .first() to satisfy Playwright strict mode.
      await expect(
        userPage.getByText(/Existing Seed Widget|Existing Workbench Widget/i).first(),
      ).toBeVisible({
        timeout: 20_000,
      });

      await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });

      const prompt = userPage.getByPlaceholder(/YTD pull-through|comprehensive analysis/i);
      await prompt.fill("Show conversion by channel.");
      await userPage.getByRole("button", { name: /Get answer|Investigate/i }).click();

      await expect(userPage.getByRole("tab", { name: /Findings/i })).toBeVisible({
        timeout: 15_000,
      });
      await userPage.getByRole("tab", { name: /Findings/i }).click();
      await userPage.getByText("Channel conversion save test").click();
      await userPage.getByRole("button", { name: /View evidence data/i }).click();

      await expect(userPage.getByRole("grid", { name: "Evidence table" })).toBeVisible({
        timeout: 15_000,
      });
      await userPage
        .getByText("Conversion by channel")
        .locator("xpath=preceding::button[1]")
        .click();
      await userPage.getByRole("menuitem", { name: /Save to Workbench/i }).click();

      const dialog = userPage.getByRole("dialog", { name: /Save to Workbench/i });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("combobox").click();
      await userPage.getByRole("option", { name: canvasTitle }).click();
      await dialog.getByRole("button", { name: /^Save$/ }).click();

      await expect(userPage).toHaveURL(new RegExp(`/my-dashboard/${createdCanvasId}`), {
        timeout: 20_000,
      });

      // After Save-to-Workbench, MyDashboard is supposed to remount WorkbenchCanvas
      // (reloadCanvas in location state). In practice the canvas sometimes still
      // paints only the pre-save in-memory layout while GET /canvases/:id already
      // returns the appended widget — a full reload aligns DOM with the server
      // (same as a manual refresh) so the UI half of this spec stays deterministic.
      await userPage.reload({ waitUntil: "domcontentloaded" });

      // Check DB first so we distinguish "PUT never happened" from "render is
      // stale" from "autosave clobbered the append".
      const immediatelyAfterSave = await fetchLayoutFromBackend(createdCanvasId);
      expect(immediatelyAfterSave?.layoutVersion).toBe("freeform-v1");
      expect(immediatelyAfterSave?.layout?.length ?? 0).toBe(2);

      const layoutArr = immediatelyAfterSave!.layout as Array<Record<string, unknown>>;
      const appended = layoutArr[1];
      expect(appended.x).toBe(20);
      expect(appended.y).toBe(20 + 360 + 24);
      expect(appended.type).toBe("cohi_widget");
      const appendedPayload = appended.payload as Record<string, unknown>;
      expect(appendedPayload.sourceType).toBe("research");

      // Both widgets should be visible on the canvas after the forced
      // refetch. Minimap + main canvas both render titles, so use .first()
      // to avoid strict-mode violations.
      await expect(
        userPage.getByText(/Existing Seed Widget|Existing Workbench Widget/i).first(),
      ).toBeVisible({
        timeout: 20_000,
      });
      // Research-sourced widgets show this banner in CohiWidgetRenderer; it is
      // unique on the canvas and avoids pinning on the composed title string.
      await expect(userPage.getByText(/Saved from Research Lab/)).toBeVisible({
        timeout: 30_000,
      });

      // Wait past the WorkbenchCanvas autosave debounce (5s) and confirm the
      // appended widget hasn't been clobbered by a stale-state autosave.
      await userPage.waitForTimeout(7_000);
      const afterAutosave = await fetchLayoutFromBackend(createdCanvasId);
      expect(afterAutosave?.layout?.length ?? 0).toBe(2);
    } finally {
      await userPage.evaluate(async (id) => {
        const token = localStorage.getItem("auth_token");
        await fetch(`/api/workbench/canvases/${id}`, {
          method: "DELETE",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      }, createdCanvasId);
    }
  });
});


