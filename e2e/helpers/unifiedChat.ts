/**
 * Shared Playwright helpers for unified Cohi Chat E2E (COHI-397 / Wave 6).
 * @see docs/QA_DEVELOPER_PROCEDURES.md
 */

import { expect, type Page, type Route } from "@playwright/test";

/** Primary Cohi chat textarea placeholder (shell + /data-chat). */
export const UNIFIED_CHAT_INPUT_PLACEHOLDER =
  "What important info do I need to know today?";

export function unifiedChatMessageInput(page: Page) {
  return page.getByPlaceholder(UNIFIED_CHAT_INPUT_PLACEHOLDER);
}

/** Close Radix overlays (tutorials, dialogs) that block chat controls. */
export async function dismissBlockingOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const blockingDialog = page
      .locator("[role='dialog']")
      .filter({ hasText: /quick tour|welcome|what's new|let us give you a quick tour/i })
      .first();
    const overlay = page.locator("div[data-state='open'][aria-hidden='true']").first();

    const dialogVisible = await blockingDialog
      .isVisible({ timeout: 1_500 })
      .catch(() => false);
    const overlayVisible = await overlay.isVisible({ timeout: 1_500 }).catch(() => false);

    if (dialogVisible || overlayVisible) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      continue;
    }
    break;
  }
}

/** Research workspace is not mounted in compact shell band (COHI-404). */
export async function expandChatShellForResearch(page: Page): Promise<void> {
  await dismissBlockingOverlays(page);
  await page.getByRole("button", { name: "Taller" }).click({ force: true });
}

export async function selectUnifiedChatType(
  page: Page,
  label: "Chat" | "Research" | "Insight builder" | "Workbench",
): Promise<void> {
  await dismissBlockingOverlays(page);
  const selector = page.getByRole("combobox", { name: "Chat type" });
  await expect(selector).toBeVisible({ timeout: 15_000 });
  await selector.click({ force: true });
  const option = page.getByRole("option", { name: label, exact: true });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click({ force: true });
}

export const UNIFIED_CHAT_STUB_TEXT =
  "Unified chat stub: blocks envelope is active for this session.";

export const QA_AGENT_RUN_TAG = "wave6-e2e-unified-chat";

export async function forceUnifiedChat(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("cohi_force_unified_chat", "1");
      window.localStorage.setItem(
        "cohi-welcome-tour-last-shown",
        new Date().toISOString(),
      );
    } catch {
      /* ignore */
    }
  });
}

export async function forceLegacyChatOnly(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("cohi_e2e_legacy_chat_only", "1");
    } catch {
      /* ignore */
    }
  });
}

export async function mockUnifiedChatTenantApi(page: Page): Promise<void> {
  await page.route(/\/api\/tenants(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tenants: [{ id: "tenant-unified-e2e", name: "QA Tenant" }],
      }),
    });
  });
}

async function fulfillV1MessagesPost(route: Route, replyText: string): Promise<void> {
  if (route.request().method() !== "POST") {
    await route.continue();
    return;
  }
  const body = route.request().postDataJSON() as { message?: string } | null;
  expect(body?.message ?? "").toBeTruthy();

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      conversationId: "550e8400-e29b-41d4-a716-446655440001",
      turn: {
        id: "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        blocks: [{ type: "text", markdown: replyText }],
      },
      metadata: {
        suggestedQuestions: ["Follow-up one?", "Follow-up two?"],
        route: "global",
        promptHash: "e2e-stub-prompt-hash",
      },
    }),
  });
}

/** COHI-397 AC2 — non-stream POST /api/chat/v1/messages (page + APIRequestContext). */
export async function mockV1Messages(
  page: Page,
  options?: { replyText?: string },
): Promise<void> {
  const replyText = options?.replyText ?? UNIFIED_CHAT_STUB_TEXT;
  const pattern = /\/api\/chat\/v1\/messages(?!:stream)(?:\?.*)?$/;
  const handler = async (route: Route) => fulfillV1MessagesPost(route, replyText);
  await page.route(pattern, handler);
  await page.context().route(pattern, handler);
}

export type StreamMockOptions = {
  replyText?: string;
  researchShellExpand?: boolean;
  /** Binds research workspace to a legacy research session id (COHI-402). */
  researchSessionId?: string;
  chatType?: string;
  actionsBlock?: boolean;
  insightBuilderPreview?: boolean;
  /** Optional chart block (COHI-335 / COHI-78 style mocks). */
  visualization?: Record<string, unknown>;
  streamMetadata?: Record<string, unknown>;
};

/** Open consolidated Research mode on Insights (COHI-404 / COHI-406). */
export async function openConsolidatedResearchChat(page: Page): Promise<void> {
  await page.goto("/insights?mode=research", { waitUntil: "domcontentloaded" });
  await dismissBlockingOverlays(page);
  await expandChatShellForResearch(page);
  await selectUnifiedChatType(page, "Research");
}

type StreamBlock = {
  type: string;
  markdown?: string;
  items?: unknown[];
};

/** Mirror server `emitValidatedStreamWithDeltas` — client reads `block.completed`, not `turn.completed.blocks`. */
function buildV1StreamSseBody(
  conversationId: string,
  turnId: string,
  blocks: StreamBlock[],
  metadata: Record<string, unknown>,
): string {
  const events: Record<string, unknown>[] = [
    { event: "turn.started", conversationId, turnId, metadata },
  ];

  blocks.forEach((block, blockIndex) => {
    const blockType = block.type || "text";
    events.push({
      event: "block.started",
      conversationId,
      turnId,
      blockIndex,
      blockType,
    });
    if (blockType === "text" && typeof block.markdown === "string") {
      events.push({
        event: "block.delta",
        conversationId,
        turnId,
        blockIndex,
        blockType: "text",
        delta: block.markdown,
      });
    }
    events.push({
      event: "block.completed",
      conversationId,
      turnId,
      blockIndex,
      blockType,
      block,
    });
  });

  events.push({
    event: "turn.completed",
    conversationId,
    turnId,
    metadata,
  });

  return events.map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join("");
}

/** COHI-396 AC1 / COHI-402 AC4 — POST /api/chat/v1/messages:stream (SSE) */
export async function mockV1MessageStream(
  page: Page,
  options?: StreamMockOptions,
): Promise<void> {
  const replyText = options?.replyText ?? UNIFIED_CHAT_STUB_TEXT;
  const conversationId = "550e8400-e29b-41d4-a716-446655440001";
  const turnId = "6ba7b810-9dad-11d1-80b4-00c04fd430c9";

  await page.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    const metadata: Record<string, unknown> = {
      promptHash: "e2e-stub-prompt-hash",
      suggestedQuestions: ["Follow-up one?"],
      ...options?.streamMetadata,
    };
    if (options?.researchShellExpand) {
      metadata.researchShellExpand = true;
    }
    const researchSessionId =
      options?.researchSessionId ??
      (options?.researchShellExpand ? "e2e-research-session-1" : undefined);
    if (researchSessionId) {
      metadata.researchSessionId = researchSessionId;
    }

    const blocks: StreamBlock[] = [];
    if (options?.insightBuilderPreview) {
      metadata.insightBuilderPhase = "preview";
      metadata.chatType = "insight_builder";
      blocks.push({
        type: "artifacts",
        items: [
          {
            kind: "file",
            ref: "insight_builder_preview",
            meta: {
              insightBuilderPreview: true,
              insightBuilderPhase: "preview",
              actions: ["approve", "request_changes"],
              draft: {
                title: "QA insight draft",
                prompt_text: "Analyze branch 2001 product mix",
                schedule: "on_demand",
                specifiers: {},
              },
            },
          },
        ],
      });
    } else {
      blocks.push({ type: "text", markdown: replyText });
      if (options?.visualization) {
        blocks.push({
          type: "visualization",
          artifactId: "e2e-viz-artifact-1",
          config: options.visualization,
        });
      }
    }
    if (options?.actionsBlock) {
      blocks.push({
        type: "actions",
        items: [
          {
            type: "add_existing_widget",
            widgetId: "cohi-scorecard-volume",
            label: "Add widget",
          },
        ],
      });
    }

    const body = buildV1StreamSseBody(conversationId, turnId, blocks, metadata);

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache" },
      body,
    });
  });
}

/** Register tenant + both v1 message paths (stream is what production uses on /data-chat). */
export async function mockUnifiedChatApis(
  page: Page,
  options?: StreamMockOptions,
): Promise<void> {
  await mockUnifiedChatTenantApi(page);
  await mockV1Permissions(page);
  await mockV1Messages(page, { replyText: options?.replyText });
  await mockV1MessageStream(page, options);
}

export async function mockV1Permissions(page: Page): Promise<void> {
  await page.route(/\/api\/chat\/v1\/permissions(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cohiChat: true,
        chatTypes: ["chat", "research", "insight_builder", "workbench"],
      }),
    });
  });
}

export async function mockV1ConversationsList(
  page: Page,
  conversations: Array<{
    id: string;
    title: string;
    chat_type: string;
    updated_at?: string;
    folder_id?: string | null;
  }>,
): Promise<void> {
  await page.route(/\/api\/chat\/v1\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        conversations: conversations.map((c) => ({
          folder_id: null,
          updated_at: new Date().toISOString(),
          ...c,
        })),
        total: conversations.length,
      }),
    });
  });
}

export async function mockV1FoldersTree(
  page: Page,
  folders: Array<{
    id: string;
    name: string;
    parent_id: string | null;
    depth?: number;
  }>,
): Promise<void> {
  await page.route(/\/api\/chat\/v1\/folders(?:\?.*)?$/, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ folders }),
      });
      return;
    }
    if (method === "POST") {
      const body = route.request().postDataJSON() as {
        name?: string;
        parent_id?: string | null;
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          folder: {
            id: "e2e-folder-created",
            name: body?.name ?? "QA folder",
            parent_id: body?.parent_id ?? null,
            depth: 1,
          },
        }),
      });
      return;
    }
    await route.continue();
  });
}

export function computeFolderTreeDepth(
  folders: Array<{ id: string; parent_id: string | null }>,
): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const row = byId.get(id);
    if (!row?.parent_id) return 1;
    return 1 + depthOf(row.parent_id, seen);
  };
  return folders.reduce((max, f) => Math.max(max, depthOf(f.id)), 0);
}

export async function expectStreamRequestWithChatType(
  page: Page,
  chatType: string,
  action: () => Promise<void>,
): Promise<void> {
  const seen: { chat_type?: string }[] = [];
  await page.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { chat_type?: string };
      seen.push({ chat_type: body?.chat_type });
    }
    await route.continue();
  });
  await action();
  expect(seen.some((b) => b.chat_type === chatType)).toBeTruthy();
}
