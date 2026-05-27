/**
 * Shared unified v1 send helpers (COHI-396 / COHI-388) — stream-first for global + workbench.
 */

import {
  createUnifiedChatClient,
  type UnifiedChatClient,
  type UnifiedChatType,
  type UnifiedChatScope,
  type UnifiedChatLocation,
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
import {
  repairWorkbenchBlocks,
  workbenchStreamDisplayText,
} from "@/lib/workbench/parseWorkbenchLlmJson";

export interface InsightBuilderSendDraft {
  title: string;
  prompt_text: string;
  schedule: "batch" | "on_demand";
  prompt_tag?: string;
  specifiers: Record<string, unknown>;
}

export interface SendUnifiedGlobalParams {
  client: UnifiedChatClient;
  message: string;
  chatType?: UnifiedChatType;
  conversationId?: string | null;
  /** When set (e.g. insight-builder approve), duplicate submits reuse server idempotency. */
  clientMessageId?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  deepAnalysis?: boolean;
  uploadIds?: string[];
  datasetUploadIds?: string[];
  context?: Record<string, unknown>;
  location?: UnifiedChatLocation;
  scope?: UnifiedChatScope;
  insightBuilder?: { action?: "approve" | "revise" };
  onStreamText?: (text: string) => void;
  onStreamEvent?: (ev: ChatStreamEvent) => void;
}

export interface SendUnifiedGlobalResult {
  conversationId: string;
  parsed: ParsedGlobalUnifiedFields;
  /** Research Lab: stream ended after handshake; findings load via session polling. */
  researchPollMode?: boolean;
  /** Research Lab session id from stream metadata (poll mode). */
  researchSessionId?: string;
  streamMetadata?: Record<string, unknown>;
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
      clientMessageId: params.clientMessageId ?? crypto.randomUUID(),
      location: params.location ?? { surface: "data_chat_page" },
      scope: params.scope ?? { type: "global_session" },
      history: params.history ?? [],
      context: params.context,
      options: {
        stream: true,
        ...(chatType === "research"
          ? {
              research: {
                deepAnalysis: params.deepAnalysis ?? false,
                ...(params.uploadIds && params.uploadIds.length > 0
                  ? { uploadIds: params.uploadIds }
                  : {}),
              },
            }
          : {}),
        ...(params.datasetUploadIds && params.datasetUploadIds.length > 0
          ? { datasetUploadIds: params.datasetUploadIds }
          : {}),
        ...(chatType === "insight_builder" && params.insightBuilder
          ? { insightBuilder: params.insightBuilder }
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

  const researchPollMode = result.metadata?.researchPollMode === true;
  const researchSessionId =
    typeof result.metadata?.researchSessionId === "string"
      ? result.metadata.researchSessionId
      : undefined;

  return {
    conversationId: result.conversationId,
    parsed,
    researchPollMode,
    researchSessionId,
    streamMetadata: result.metadata,
  };
}

export interface SendUnifiedWorkbenchParams {
  client: UnifiedChatClient;
  message: string;
  conversationId?: string | null;
  scope: { type: "canvas" | "draft"; id?: string };
  context: Record<string, unknown>;
  history?: { role: "user" | "assistant"; content: string }[];
  datasetUploadIds?: string[];
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
      options: {
        stream: true,
        ...(params.datasetUploadIds && params.datasetUploadIds.length > 0
          ? { datasetUploadIds: params.datasetUploadIds }
          : {}),
      },
    },
    (ev: ChatStreamEvent) => {
      if (ev.event === "block.delta" && ev.blockIndex === 0 && ev.delta) {
        streamText += ev.delta;
        params.onStreamText?.(workbenchStreamDisplayText(streamText));
      }
    },
  );

  const rawBlocks: UnifiedChatBlock[] =
    result.blocks.length > 0
      ? result.blocks
      : streamText
        ? [{ type: "text", markdown: streamText }]
        : [];

  const { blocks, suggestedQuestions: repairedSuggestions } =
    repairWorkbenchBlocks(rawBlocks);

  const parsed = parseWorkbenchUnifiedEnvelope(
    blocksToEnvelope(result.conversationId, blocks, {
      ...result.metadata,
      ...(repairedSuggestions?.length
        ? { suggestedQuestions: repairedSuggestions }
        : {}),
    }),
  );

  return {
    conversationId: result.conversationId,
    parsed,
    streamMetadata: result.metadata,
  };
}

export { createUnifiedChatClient };
