/**
 * Unified chat orchestrator — delegates to legacy pipelines and maps to block envelope (COHI-388).
 */

import { randomUUID } from "crypto";
import type { AuthRequest } from "../../middleware/auth.js";
import {
  processCohiQuestion,
  type ChatContext,
  type CohiChatMessage,
} from "../ai/cohiChatService.js";
import { runWorkbenchChatTurn } from "../../routes/cohiWorkbench.js";
import {
  mapCohiChatResponseToBlocks,
  mapWorkbenchResponseToBlocks,
} from "./unifiedChatMappers.js";
import {
  assertUnifiedChatAllowed,
  type UnifiedChatPolicyInput,
} from "./policyEngine.js";
import { hashPromptModules } from "./promptComposer.js";
import { filterKnownWidgetActions } from "./widgetActionGate.js";
import type { UnifiedConversationChatType } from "./unifiedConversationService.js";

export type UnifiedChatType = UnifiedConversationChatType;

export interface UnifiedChatRequestBody {
  message: string;
  chat_type?: UnifiedChatType;
  conversationId?: string;
  clientMessageId?: string;
  scope?: {
    type:
      | "global_session"
      | "canvas"
      | "draft"
      | "insight"
      | "widget_edit"
      | "workbench_hub";
    id?: string;
  };
  location?: {
    surface:
      | "site"
      | "workbench_canvas"
      | "workbench_hub"
      | "insight_modal"
      | "data_chat_page";
    route?: string;
    locale?: string;
  };
  context?: {
    canvasState?: Record<string, unknown>;
    widgetCatalog?: string;
    widgetEdit?: Record<string, unknown>;
    insightContext?: Record<string, unknown>;
    sourceInsight?: Record<string, unknown>;
  };
  history?: { role: "user" | "assistant"; content: string }[];
  options?: {
    stream?: boolean;
    includeRag?: boolean;
    includeLiveCanvasData?: boolean;
    maxHistoryTurns?: number;
    personaHints?: string[];
    qaAgentRunTag?: string;
    planningMode?: "auto" | "always" | "never";
    research?: { deepAnalysis?: boolean };
  };
}

function buildChatContext(req: AuthRequest): ChatContext {
  const tenantId = req.tenantContext?.tenantId || req.tenantId;
  if (!tenantId) {
    throw new Error("No tenant context available");
  }
  return {
    userId: req.userId!,
    tenantId,
    userRole: req.userRole || "user",
    userEmail: req.userEmail,
  };
}

function mapHistoryToCohiMessages(
  history: UnifiedChatRequestBody["history"],
  maxTurns?: number,
): CohiChatMessage[] {
  const slice = history ?? [];
  const lim =
    maxTurns !== undefined ? slice.slice(-maxTurns * 2) : slice.slice(-20);
  return lim.map((m, i) => ({
    id: `hist-${i}`,
    role: m.role,
    content: m.content,
    timestamp: new Date(),
  }));
}

function normalizeChatType(body: UnifiedChatRequestBody): UnifiedChatType {
  const t = body.chat_type;
  if (t === "research" || t === "insight_builder" || t === "workbench" || t === "chat") {
    return t;
  }
  return "chat";
}

function shouldUseWorkbench(body: UnifiedChatRequestBody): boolean {
  const st = body.scope?.type;
  const surf = body.location?.surface;
  if (surf === "workbench_canvas" || surf === "workbench_hub") return true;
  if (
    st === "canvas" ||
    st === "draft" ||
    st === "widget_edit" ||
    st === "workbench_hub"
  ) {
    return true;
  }
  return false;
}

function summarizePromptModules(
  mode: "workbench" | "global",
  body: UnifiedChatRequestBody,
): string {
  const mods = [
    mode,
    body.location?.surface ?? "unknown_surface",
    body.scope?.type ?? "unknown_scope",
    body.options?.planningMode ? `plan:${body.options.planningMode}` : "",
  ].filter(Boolean);
  return hashPromptModules(mods);
}

function sanitizeActionBlocks<T extends { type: string; items?: unknown[] }>(
  blocks: T[],
): T[] {
  return blocks.map((b) => {
    if (b.type === "actions" && Array.isArray(b.items)) {
      return {
        ...b,
        items: filterKnownWidgetActions(b.items),
      };
    }
    return b;
  }) as T[];
}

export async function processUnifiedChatMessage(
  req: AuthRequest,
  body: UnifiedChatRequestBody,
): Promise<{
  conversationId: string;
  turn: { id: string; blocks: ReturnType<typeof mapCohiChatResponseToBlocks> };
  metadata: Record<string, unknown>;
}> {
  const policyInput: UnifiedChatPolicyInput = {
    surface: body.location?.surface,
    scopeType: body.scope?.type,
  };
  const gate = await assertUnifiedChatAllowed(req, policyInput);
  if (gate.ok === false) {
    const err: any = new Error(gate.message);
    err.statusCode = 403;
    err.code = gate.code;
    throw err;
  }

  const chatType = normalizeChatType(body);
  const conversationId = body.conversationId ?? randomUUID();
  const turnId = randomUUID();

  if (shouldUseWorkbench(body)) {
    const wbBody = {
      question: body.message,
      canvasState: body.context?.canvasState,
      widgetCatalog: body.context?.widgetCatalog,
      conversationHistory: (body.history ?? []).map((h) => ({
        role: h.role,
        content: h.content,
      })),
    };
    const raw = await runWorkbenchChatTurn(req, wbBody);
    const blocks = sanitizeActionBlocks(mapWorkbenchResponseToBlocks(raw));
    return {
      conversationId,
      turn: { id: turnId, blocks },
      metadata: {
        promptHash: summarizePromptModules("workbench", body),
        chatType,
        contextManifest: [
          { tier: "identity", included: true, truncated: false },
          {
            tier: "workbench_snapshot",
            included: !!body.context?.canvasState,
            truncated: false,
          },
        ],
        suggestedQuestions: raw.suggestedQuestions ?? [],
        route: "workbench",
      },
    };
  }

  const chatContext = buildChatContext(req);
  const maxH = body.options?.maxHistoryTurns ?? 12;
  const convHistory = mapHistoryToCohiMessages(body.history, maxH);

  const resp = await processCohiQuestion(
    body.message.trim(),
    chatContext,
    convHistory,
  );

  const vizArtifactId = resp.visualization ? randomUUID() : undefined;
  const blocks = mapCohiChatResponseToBlocks(resp, {
    visualizationArtifactId: vizArtifactId,
  });

  return {
    conversationId,
    turn: { id: turnId, blocks },
    metadata: {
      promptHash: summarizePromptModules("global", body),
      chatType,
      contextManifest: [
        { tier: "identity", included: true, truncated: false },
        {
          tier: "retrieval",
          included: body.options?.includeRag !== false,
          truncated: false,
        },
      ],
      suggestedQuestions: resp.suggestedQuestions ?? [],
      sqlQuery: resp.sqlQuery,
      sources: resp.sources,
      route: "global",
    },
  };
}
