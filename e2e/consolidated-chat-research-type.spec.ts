/**
 * Research mode in consolidated Cohi Chat (COHI-402 / COHI-406 / COHI-404).
 * Replaces legacy `/research/session` page tests — Research Lab UI lives in
 * UnifiedChatResearchWorkspace under Insights with chat type Research.
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import {
  forceUnifiedChat,
  mockUnifiedChatTenantApi,
  mockV1MessageStream,
  mockV1Permissions,
  openConsolidatedResearchChat,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

const COHI_331_SESSION = "cohi-331-session";
const COHI_363_SESSION = "cohi-363-save-session";

const COHI_331_FINDINGS = [
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

function researchStreamSse(findings: typeof COHI_331_FINDINGS): string {
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
  return body;
}

async function mockResearchSessionApi(
  page: Page,
  sessionId: string,
  payload: {
    findings: typeof COHI_331_FINDINGS;
    phase?: string;
    events?: Array<Record<string, unknown>>;
  },
): Promise<void> {
  const phase = payload.phase ?? "complete";
  const sessionBody = {
    id: sessionId,
    phase,
    plan: { questions: [{ id: 1, text: "Q1" }] },
    findings: payload.findings,
    report: null,
    events: payload.events ?? [
      { type: "phase", data: { phase: "complete" }, timestamp: Date.now() },
    ],
    error: null,
    visibility: "private",
    sharedWithUserIds: [],
  };

  await page.route(/\/api\/research\/sessions(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId }),
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
    new RegExp(`/api/research/sessions/${sessionId}(?:\\?.*)?$`),
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(sessionBody),
        });
        return;
      }
      await route.continue();
    },
  );

  await page.route(
    new RegExp(`/api/research/sessions/${sessionId}/stream(?:\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: researchStreamSse(payload.findings),
      });
    },
  );
}

async function bindResearchChatStream(
  page: Page,
  researchSessionId: string,
): Promise<void> {
  await mockV1MessageStream(page, {
    researchSessionId,
    researchShellExpand: true,
    replyText: "Research investigation started in unified chat.",
    streamMetadata: { chatType: "research" },
  });
}

test.describe("@critical Consolidated chat — Research type", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);
  });

  test("@smoke @COHI-386 research mode loads chat input and deep analysis toggle", async ({
    userPage,
  }) => {
    await openConsolidatedResearchChat(userPage);
    await expect(unifiedChatMessageInput(userPage)).toBeVisible({ timeout: 15_000 });
    await expect(
      userPage.getByRole("checkbox", { name: /deep analysis/i }),
    ).toBeVisible();
  });

  test("@smoke @COHI-386 accepts research question in unified chat input", async ({
    userPage,
  }) => {
    await openConsolidatedResearchChat(userPage);
    const input = unifiedChatMessageInput(userPage);
    await input.fill("What are the top 5 conversion bottlenecks this month?");
    await expect(input).toHaveValue(
      "What are the top 5 conversion bottlenecks this month?",
    );
  });

  test("@critical @COHI-386 @COHI-106 research workspace shows timeline after investigation", async ({
    userPage,
  }) => {
    test.setTimeout(90_000);
    await mockResearchSessionApi(userPage, "cohi-106-session", {
      findings: [],
      phase: "investigating",
      events: [
        { type: "plan_created", data: { questionCount: 2 }, timestamp: Date.now() },
      ],
    });
    await bindResearchChatStream(userPage, "cohi-106-session");

    await openConsolidatedResearchChat(userPage);
    const input = unifiedChatMessageInput(userPage);
    await input.fill("What is our pull-through trend by channel this month?");
    await input.press("Enter");

    const workspace = userPage.getByTestId("unified-research-workspace");
    await expect(workspace).toBeVisible({ timeout: 25_000 });
    await expect(workspace.getByRole("tab", { name: "Timeline" })).toBeVisible();

    await mockResearchSessionApi(userPage, "cohi-106-session", {
      findings: COHI_331_FINDINGS.slice(0, 1),
      phase: "complete",
    });
    await userPage.waitForTimeout(2_500);

    await workspace.getByRole("tab", { name: /Findings/i }).click();
    await expect(
      workspace.getByText("Revenue pressure concentrated in mature applications"),
    ).toBeVisible({ timeout: 15_000 });

    await input.fill("Can you break that down by top 3 loan officers?");
    await input.press("Enter");
    await expect(workspace.getByRole("tab", { name: "Timeline" })).toBeVisible();
  });

  test("@critical @COHI-386 @COHI-331 renders finding summaries as readable bullets", async ({
    userPage,
  }) => {
    await mockResearchSessionApi(userPage, COHI_331_SESSION, {
      findings: COHI_331_FINDINGS,
    });
    await bindResearchChatStream(userPage, COHI_331_SESSION);

    await openConsolidatedResearchChat(userPage);
    const input = unifiedChatMessageInput(userPage);
    await input.fill("Summarize mature application revenue risk.");
    await input.press("Enter");

    const workspace = userPage.getByTestId("unified-research-workspace");
    await expect(workspace).toBeVisible({ timeout: 25_000 });
    await workspace.getByRole("tab", { name: /Findings/i }).click();

    await expect(
      workspace.getByText("Revenue pressure concentrated in mature applications"),
    ).toBeVisible({ timeout: 15_000 });

    const bulletItems = workspace.locator("ul li");
    await expect(bulletItems).toHaveCount(3);
    await expect(bulletItems.nth(0)).toContainText("18.4%");
    await expect(bulletItems.nth(0)).toContainText("$425K");
    await expect(bulletItems.nth(1)).toContainText("73 loans");
    await expect(
      workspace.getByText("Single sentence finding summary remains concise."),
    ).toBeVisible();
  });

  test("@critical @COHI-386 @COHI-363 saves research visualization below existing Workbench content (real backend)", async ({
    userPage,
  }) => {
    test.setTimeout(180_000);

    const channelFinding = {
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

    await mockResearchSessionApi(userPage, COHI_363_SESSION, {
      findings: [channelFinding],
    });
    await bindResearchChatStream(userPage, COHI_363_SESSION);

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

    await userPage.goto("/insights?mode=research", { waitUntil: "domcontentloaded" });

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
      await userPage.goto(`/my-dashboard/${createdCanvasId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        userPage.getByText(/Existing Seed Widget|Existing Workbench Widget/i).first(),
      ).toBeVisible({ timeout: 20_000 });

      await openConsolidatedResearchChat(userPage, {
        path: `/my-dashboard/${createdCanvasId}?mode=research`,
      });
      const input = unifiedChatMessageInput(userPage);
      await input.fill("Show conversion by channel.");
      await input.press("Enter");

      const workspace = userPage.getByTestId("unified-research-workspace");
      await expect(workspace).toBeVisible({ timeout: 25_000 });
      await workspace.getByRole("tab", { name: /Findings/i }).click();
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

      await userPage.reload({ waitUntil: "domcontentloaded" });

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

      await expect(
        userPage.getByText(/Existing Seed Widget|Existing Workbench Widget/i).first(),
      ).toBeVisible({ timeout: 20_000 });
      await expect(userPage.getByText(/Saved from Research Lab/)).toBeVisible({
        timeout: 30_000,
      });

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
