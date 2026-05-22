/**
 * Unified chat orchestrator pipeline (COHI-388).
 * context → policy → compose → execute branch → blocks
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
  type UnifiedBlock,
} from "./unifiedChatMappers.js";
import {
  assertUnifiedChatAllowed,
  type UnifiedChatPolicyInput,
  type PolicyDecision,
} from "./policyEngine.js";
import { composePromptBundle } from "./promptComposer.js";
import { filterKnownWidgetActions } from "./widgetActionGate.js";
import type { UnifiedConversationChatType } from "./unifiedConversationService.js";
import { runSqlThroughRouter } from "./sqlAndMetricsRouter.js";
import { createVisualizationArtifactId } from "./artifactService.js";
import { runInsightBuilderTurn, type InsightBuilderDraft } from "./insightBuilderTurn.js";
import { runUnifiedResearchTurn } from "./unifiedResearchChat.js";
import { findUnifiedConversationByLegacyRef } from "./unifiedConversationService.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import {
  resolveDatasetUploadIdsForRequest,
  resolveUploadSchemaContext,
} from "../research/uploadConversationService.js";

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
    /** Server-side insight builder draft state (optional). */
    insightBuilderDraft?: InsightBuilderDraft;
    legacyResearchSessionId?: string;
  };
  history?: { role: "user" | "assistant"; content: string }[];
  options?: {
    stream?: boolean;
    includeRag?: boolean;
    includeLiveCanvasData?: boolean;
    maxHistoryTurns?: number;
    personaHints?: string[];
    qaAgentRunTag?: string;
    // Deferred until unified chat merge is complete — restore with promptComposer + OpenAPI + schemas.
    // planningMode?: "auto" | "always" | "never";
    datasetUploadIds?: string[];
    research?: { deepAnalysis?: boolean; uploadIds?: string[] };
    insightBuilder?: { action?: "approve" | "revise" };
  };
}

export interface UnifiedChatTurnResult {
  conversationId: string;
  turn: { id: string; blocks: UnifiedBlock[] };
  metadata: Record<string, unknown>;
  legacyRef?: string | null;
  legacySource?: string | null;
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

async function buildChatContextWithUploads(
  req: AuthRequest,
  body: UnifiedChatRequestBody,
): Promise<ChatContext> {
  const base = buildChatContext(req);
  const tenantPool = await tenantDbManager.getTenantPool(base.tenantId);
  const uploadIds = await resolveDatasetUploadIdsForRequest(body, tenantPool);
  if (uploadIds.length === 0) return base;
  const resolved = await resolveUploadSchemaContext(uploadIds, tenantPool);
  if (!resolved.instructionBlock) return base;
  return {
    ...base,
    uploadOnlyMode: true,
    uploadSchemaContext: resolved.instructionBlock,
    datasetUploadIds: uploadIds,
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

export function normalizeChatType(body: UnifiedChatRequestBody): UnifiedChatType {
  const t = body.chat_type;
  if (t === "research" || t === "insight_builder" || t === "workbench" || t === "chat") {
    return t;
  }
  return "chat";
}

export function shouldUseWorkbench(body: UnifiedChatRequestBody): boolean {
  if (normalizeChatType(body) === "workbench") return true;
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

// function resolvePlanningMode(
//   body: UnifiedChatRequestBody,
// ): "auto" | "always" | "never" {
//   return body.options?.planningMode ?? "auto";
// }

function sanitizeActionBlocks(blocks: UnifiedBlock[]): UnifiedBlock[] {
  return blocks.map((b) => {
    if (b.type === "actions" && Array.isArray(b.items)) {
      return {
        ...b,
        items: filterKnownWidgetActions(b.items),
      };
    }
    return b;
  }) as UnifiedBlock[];
}

function baseContextManifest(
  body: UnifiedChatRequestBody,
  tiers: { tier: string; included: boolean; truncated: boolean }[],
) {
  return [
    { tier: "identity", included: true, truncated: false },
    ...tiers,
    // {
    //   tier: "planning",
    //   included: resolvePlanningMode(body) !== "never",
    //   truncated: false,
    // },
    { tier: "planning", included: false, truncated: false },
  ];
}

async function executeWorkbenchBranch(
  req: AuthRequest,
  body: UnifiedChatRequestBody,
  policy: PolicyDecision,
  bundle: ReturnType<typeof composePromptBundle>,
): Promise<{ blocks: UnifiedBlock[]; metadata: Record<string, unknown> }> {
  const tenantId = req.tenantContext?.tenantId || req.tenantId;
  const tenantPool = tenantId
    ? await tenantDbManager.getTenantPool(tenantId)
    : null;
  const uploadIds = tenantPool
    ? await resolveDatasetUploadIdsForRequest(body, tenantPool)
    : [];
  let uploadSchemaContext: string | undefined;
  if (uploadIds.length > 0 && tenantPool) {
    if (tenantId) {
      const resolved = await resolveUploadSchemaContext(uploadIds, tenantPool);
      uploadSchemaContext = resolved.instructionBlock || undefined;
    }
  }
  const wbBody = {
    question: body.message,
    canvasState: body.context?.canvasState,
    widgetCatalog: body.context?.widgetCatalog,
    conversationHistory: (body.history ?? []).map((h) => ({
      role: h.role,
      content: h.content,
    })),
    datasetUploadIds: uploadIds.length > 0 ? uploadIds : undefined,
    uploadSchemaContext,
  };
  const chatContext = buildChatContext(req);
  const raw = await runSqlThroughRouter(
    {
      source: "workbench",
      chatType: policy.chatType,
      tenantId: chatContext.tenantId,
      userId: chatContext.userId,
    },
    policy,
    () => runWorkbenchChatTurn(req, wbBody),
  );
  const blocks = sanitizeActionBlocks(mapWorkbenchResponseToBlocks(raw));
  return {
    blocks,
    metadata: {
      promptHash: bundle.bundleHash,
      suggestedQuestions: raw.suggestedQuestions ?? [],
      route: "workbench",
      contextManifest: baseContextManifest(body, [
        {
          tier: "workbench_snapshot",
          included: !!body.context?.canvasState,
          truncated: false,
        },
      ]),
    },
  };
}

async function executeGlobalChatBranch(
  req: AuthRequest,
  body: UnifiedChatRequestBody,
  policy: PolicyDecision,
  bundle: ReturnType<typeof composePromptBundle>,
): Promise<{ blocks: UnifiedBlock[]; metadata: Record<string, unknown> }> {
  const chatContext = await buildChatContextWithUploads(req, body);
  const maxH = body.options?.maxHistoryTurns ?? 12;
  const convHistory = mapHistoryToCohiMessages(body.history, maxH);

  const resp = await runSqlThroughRouter(
    {
      source: "unified_chat",
      chatType: policy.chatType,
      tenantId: chatContext.tenantId,
      userId: chatContext.userId,
    },
    policy,
    () =>
      processCohiQuestion(body.message.trim(), chatContext, convHistory, {
        includeRag:
          policy.retrieval !== "deny" && body.options?.includeRag !== false,
      }),
  );

  const vizArtifactId = resp.visualization
    ? createVisualizationArtifactId()
    : undefined;
  const blocks = mapCohiChatResponseToBlocks(resp, {
    visualizationArtifactId: vizArtifactId,
  });

  return {
    blocks,
    metadata: {
      promptHash: bundle.bundleHash,
      suggestedQuestions: resp.suggestedQuestions ?? [],
      sqlQuery: resp.sqlQuery,
      sources: resp.sources,
      route: "global",
      contextManifest: baseContextManifest(body, [
        {
          tier: "retrieval",
          included:
            policy.retrieval !== "deny" && body.options?.includeRag !== false,
          truncated: false,
        },
      ]),
    },
  };
}

export async function processUnifiedChatMessage(
  req: AuthRequest,
  body: UnifiedChatRequestBody,
): Promise<UnifiedChatTurnResult> {
  const chatType = normalizeChatType(body);
  const policyInput: UnifiedChatPolicyInput = {
    surface: body.location?.surface,
    scopeType: body.scope?.type,
    chatType,
    deepAnalysis: body.options?.research?.deepAnalysis,
  };
  const gate = await assertUnifiedChatAllowed(req, policyInput);
  if (gate.ok === false) {
    const err: any = new Error(gate.message);
    err.statusCode = 403;
    err.code = gate.code;
    throw err;
  }
  const policy = gate.decision;

  const bundle = composePromptBundle({
    chatType,
    surface: body.location?.surface,
    scopeType: body.scope?.type,
    // planningMode: resolvePlanningMode(body),
    deepAnalysis: body.options?.research?.deepAnalysis,
  });

  let conversationId = body.conversationId;
  let legacyRef: string | null = body.context?.legacyResearchSessionId ?? null;
  // Research resume: when the client passes a legacy session id but no
  // conversationId, reuse the existing unified row so the thread stays stable.
  if (!conversationId && chatType === "research" && legacyRef) {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const userId = req.userId;
      if (tenantId && userId) {
        const existing = await findUnifiedConversationByLegacyRef({
          tenantId,
          userId,
          legacyRef,
        });
        if (existing) conversationId = existing.id;
      }
    } catch (err: any) {
      console.warn(
        "[unifiedChatOrchestrator] legacy_ref lookup failed:",
        err?.message ?? err,
      );
    }
  }
  if (!conversationId) conversationId = randomUUID();
  const turnId = randomUUID();

  let blocks: UnifiedBlock[];
  let metadata: Record<string, unknown>;
  let legacySource: string | null = null;

  if (chatType === "research") {
    const research = await runUnifiedResearchTurn({
      req,
      message: body.message,
      conversationId,
      legacyRef,
      deepAnalysis: body.options?.research?.deepAnalysis,
      uploadIds: mergeDatasetUploadIds(body),
      policy,
    });
    blocks = research.blocks;
      metadata = {
      ...research.metadata,
      promptHash: bundle.bundleHash,
      chatType,
      policyDecisionId: policy.decisionId,
      contextManifest: baseContextManifest(body, [
        { tier: "research_pipeline", included: true, truncated: false },
      ]),
    };
    legacyRef = research.legacyRef;
    legacySource = "research_lab";
  } else if (chatType === "insight_builder") {
    const chatCtx = buildChatContext(req);
    const ib = await runInsightBuilderTurn({
      tenantId: chatCtx.tenantId,
      userId: chatCtx.userId,
      message: body.message,
      history: body.history ?? [],
      bundle,
      pendingDraft: body.context?.insightBuilderDraft ?? null,
      options: body.options?.insightBuilder,
    });
    blocks = ib.blocks;
    metadata = {
      ...ib.metadata,
      promptHash: bundle.bundleHash,
      chatType,
      policyDecisionId: policy.decisionId,
      route: "insight_builder",
      contextManifest: baseContextManifest(body, [
        { tier: "insight_builder", included: true, truncated: false },
      ]),
    };
  } else if (shouldUseWorkbench(body)) {
    const wb = await executeWorkbenchBranch(req, body, policy, bundle);
    blocks = wb.blocks;
    metadata = { ...wb.metadata, chatType, policyDecisionId: policy.decisionId };
    if (chatType === "workbench") legacySource = "cohi_chat";
  } else {
    const global = await executeGlobalChatBranch(req, body, policy, bundle);
    blocks = global.blocks;
    metadata = { ...global.metadata, chatType, policyDecisionId: policy.decisionId };
    legacySource = "cohi_chat";
  }

  return {
    conversationId,
    turn: { id: turnId, blocks },
    metadata,
    legacyRef,
    legacySource,
  };
}
