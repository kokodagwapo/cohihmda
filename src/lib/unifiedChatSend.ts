/**
 * Shared unified v1 send helpers (COHI-396 / COHI-388) — stream-first for global + workbench.
 */

import {
  createUnifiedChatClient,
  type UnifiedChatClient,
  type UnifiedChatType,
  type ChatStreamEvent,
} from "@/lib/unifiedChatClient";
import {
  parseGlobalUnifiedEnvelope,
  parseWorkbenchUnifiedEnvelope,
  dispatchResearchShellExpandIfNeeded,
  type ParsedGlobalUnifiedFields,
  type UnifiedChatBlock,
  type UnifiedChatV1Response,
} from "@/lib/unifiedChatEnvelope";

export interface SendUnifiedGlobalParams {
  client: UnifiedChatClient;
  message: string;
  chatType?: UnifiedChatType;
  conversationId?: string | null;
  history?: { role: "user" | "assistant"; content: string }[];
  deepAnalysis?: boolean;
  onStreamText?: (text: string) => void;
  onStreamEvent?: (ev: ChatStreamEvent) => void;
}

export interface SendUnifiedGlobalResult {
  conversationId: string;
  parsed: ParsedGlobalUnifiedFields;
}

function blocksToEnvelope(
  conversationId: string,
  blocks: UnifiedChatBlock[],
  metadata?: Record<string, unknown>,
): UnifiedChatV1Response {
  return {
    conversationId,
    turn: { id: "stream", blocks },
    metadata,
  };
}

/**
 * POST /messages:stream for global_session (chat or research).
 */
export async function sendUnifiedGlobalStream(
  params: SendUnifiedGlobalParams,
): Promise<SendUnifiedGlobalResult> {
  const chatType = params.chatType ?? "chat";
  const deltaByBlock = new Map<number, string>();
  let streamText = "";

  const result = await params.client.postMessageStream(
    {
      message: params.message,
      chat_type: chatType,
      conversationId: params.conversationId ?? undefined,
      clientMessageId: crypto.randomUUID(),
      location: { surface: "data_chat_page" },
      scope: { type: "global_session" },
      history: params.history ?? [],
      options: {
        stream: true,
        ...(chatType === "research"
          ? { research: { deepAnalysis: params.deepAnalysis ?? false } }
          : {}),
      },
    },
    (ev: ChatStreamEvent) => {
      params.onStreamEvent?.(ev);
      if (ev.metadata) {
        dispatchResearchShellExpandIfNeeded(ev.metadata);
      }
      if (ev.event === "block.delta" && ev.delta != null) {
        const idx = ev.blockIndex ?? 0;
        if (idx === 0) {
          streamText += ev.delta;
          params.onStreamText?.(streamText);
        } else {
          const prev = deltaByBlock.get(idx) ?? "";
          deltaByBlock.set(idx, prev + ev.delta);
        }
      }
    },
  );

  dispatchResearchShellExpandIfNeeded(result.metadata);

  const blocks: UnifiedChatBlock[] =
    result.blocks.length > 0
      ? result.blocks
      : streamText
        ? [{ type: "text", markdown: streamText }]
        : [{ type: "text", markdown: "(no response)" }];

  const parsed = parseGlobalUnifiedEnvelope(
    blocksToEnvelope(result.conversationId, blocks, result.metadata),
  );
  if (!parsed.message && streamText) {
    parsed.message = streamText;
  }

  return { conversationId: result.conversationId, parsed };
}

export interface SendUnifiedWorkbenchParams {
  client: UnifiedChatClient;
  message: string;
  conversationId?: string | null;
  scope: { type: "canvas" | "draft"; id?: string };
  context: Record<string, unknown>;
  history?: { role: "user" | "assistant"; content: string }[];
  onStreamText?: (text: string) => void;
}

export async function sendUnifiedWorkbenchStream(
  params: SendUnifiedWorkbenchParams,
) {
  let streamText = "";

  const result = await params.client.postMessageStream(
    {
      message: params.message,
      chat_type: "workbench",
      conversationId: params.conversationId ?? undefined,
      clientMessageId: crypto.randomUUID(),
      location: {
        surface: "workbench_canvas",
        route:
          typeof window !== "undefined" ? window.location.pathname : undefined,
      },
      scope: params.scope,
      context: params.context,
      history: params.history ?? [],
      options: { stream: true },
    },
    (ev: ChatStreamEvent) => {
      if (ev.event === "block.delta" && ev.blockIndex === 0 && ev.delta) {
        streamText += ev.delta;
        params.onStreamText?.(streamText);
      }
    },
  );

  const blocks: UnifiedChatBlock[] =
    result.blocks.length > 0
      ? result.blocks
      : streamText
        ? [{ type: "text", markdown: streamText }]
        : [{ type: "text", markdown: "I processed your request." }];

  const parsed = parseWorkbenchUnifiedEnvelope(
    blocksToEnvelope(result.conversationId, blocks, result.metadata),
  );
  if (
    parsed.message === "I processed your request." &&
    streamText.trim()
  ) {
    parsed.message = streamText.trim();
  }

  return { conversationId: result.conversationId, parsed };
}

export { createUnifiedChatClient };
