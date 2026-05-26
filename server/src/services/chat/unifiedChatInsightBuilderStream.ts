/**
 * Insight builder streaming path (COHI-388) — no SQL/RAG; LLM draft + preview artifact.
 */

import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import type { ChatContext } from "../ai/cohiChatService.js";
import { composePromptBundle } from "./promptComposer.js";
import {
  runInsightBuilderTurn,
  type InsightBuilderDraft,
  type InsightBuilderTurnOptions,
} from "./insightBuilderTurn.js";
import type { PolicyDecision } from "./unifiedChatPolicy.js";
import type { HandoffManifestEntry } from "./handoffResolver.js";
import type { UnifiedBlock } from "./unifiedChatMappers.js";
import {
  createStreamEmitter,
  emitValidatedStreamWithDeltas,
} from "./unifiedChatStream.js";
import { setupGlobalStreamHeaders } from "./unifiedChatGlobalStream.js";

export interface InsightBuilderStreamArgs {
  req: AuthRequest;
  res: Response;
  conversationId: string;
  turnId: string;
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  policy: PolicyDecision;
  pendingDraft?: InsightBuilderDraft | null;
  insightBuilderOptions?: InsightBuilderTurnOptions;
  surface?: string;
  scopeType?: string;
  handoffManifest?: HandoffManifestEntry[];
}

export interface InsightBuilderStreamResult {
  blocks: UnifiedBlock[];
  metadata: Record<string, unknown>;
}

function buildChatContext(req: AuthRequest): ChatContext {
  const tenantId = req.tenantContext?.tenantId || req.tenantId;
  if (!tenantId) throw new Error("No tenant context available");
  return {
    userId: req.userId!,
    tenantId,
    userRole: req.userRole || "user",
    userEmail: req.userEmail,
  };
}

export async function runUnifiedInsightBuilderStream(
  args: InsightBuilderStreamArgs,
): Promise<InsightBuilderStreamResult> {
  const chatCtx = buildChatContext(args.req);
  const bundle = composePromptBundle({
    chatType: "insight_builder",
    surface: args.surface as Parameters<typeof composePromptBundle>[0]["surface"],
    scopeType: args.scopeType as Parameters<typeof composePromptBundle>[0]["scopeType"],
  });

  setupGlobalStreamHeaders(args.res);
  const emit = createStreamEmitter(args.res);
  emit({ event: "turn.started", conversationId: args.conversationId, turnId: args.turnId });

  const ib = await runInsightBuilderTurn({
    tenantId: chatCtx.tenantId,
    userId: chatCtx.userId,
    message: args.message,
    history: args.history ?? [],
    bundle,
    pendingDraft: args.pendingDraft ?? null,
    options: args.insightBuilderOptions,
  });

  const metadata: Record<string, unknown> = {
    ...ib.metadata,
    promptHash: bundle.bundleHash,
    chatType: "insight_builder",
    policyDecisionId: args.policy.decisionId,
    route: "insight_builder",
    contextManifest: [
      { tier: "insight_builder", included: true, truncated: false },
      ...(args.handoffManifest ?? []),
    ],
    persistedPromptId: ib.persistedPromptId ?? null,
  };

  emitValidatedStreamWithDeltas(
    args.res,
    args.conversationId,
    args.turnId,
    ib.blocks as Array<Record<string, unknown>>,
    metadata,
    { emit, skipTurnStarted: true },
  );

  return { blocks: ib.blocks, metadata };
}
