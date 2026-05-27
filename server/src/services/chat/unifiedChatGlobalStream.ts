/**
 * Global chat streaming (COHI-388 Option C) — true LLM token deltas on the wire.
 */

import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import {
  processCohiQuestionStreaming,
  type CohiChatMessage,
  type ChatContext,
} from "../ai/cohiChatService.js";
import {
  mapCohiChatResponseToBlocks,
  type UnifiedBlock,
} from "./unifiedChatMappers.js";
import { createVisualizationArtifactId } from "./artifactService.js";
import type { PolicyDecision } from "./unifiedChatPolicy.js";
import {
  createStreamEmitter,
  emitValidatedStreamWithDeltas,
} from "./unifiedChatStream.js";
import { runSqlThroughRouter } from "./sqlAndMetricsRouter.js";
import type { UnifiedChatRequestBody } from "./unifiedChatOrchestrator.js";
import { routePresentationExportIntent } from "./pptIntentRouter.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import {
  resolveDatasetUploadIdsForRequest,
  resolveUploadSchemaContext,
} from "../research/uploadConversationService.js";

export interface GlobalStreamArgs {
  req: AuthRequest;
  res: Response;
  conversationId: string;
  turnId: string;
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  policy: PolicyDecision;
  includeRag?: boolean;
  streamMetadata?: Record<string, unknown>;
  requestBody?: UnifiedChatRequestBody;
}

export interface GlobalStreamResult {
  blocks: UnifiedBlock[];
  metadata: Record<string, unknown>;
}

async function buildChatContextForStream(
  req: AuthRequest,
  requestBody?: UnifiedChatRequestBody,
): Promise<ChatContext> {
  const tenantId = req.tenantContext?.tenantId || req.tenantId;
  if (!tenantId) throw new Error("No tenant context available");
  const base: ChatContext = {
    userId: req.userId!,
    tenantId,
    userRole: req.userRole || "user",
    userEmail: req.userEmail,
  };
  if (!requestBody) return base;
  const tenantPool = await tenantDbManager.getTenantPool(tenantId);
  const uploadIds = await resolveDatasetUploadIdsForRequest(
    requestBody,
    tenantPool,
  );
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

function mapHistory(
  history: GlobalStreamArgs["history"],
): CohiChatMessage[] {
  return (history ?? []).map((m, i) => ({
    id: `hist-${i}`,
    role: m.role,
    content: m.content,
    timestamp: new Date(),
  }));
}

export function setupGlobalStreamHeaders(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
}

export async function runUnifiedGlobalStream(
  args: GlobalStreamArgs,
): Promise<GlobalStreamResult> {
  const tenantId = args.req.tenantContext?.tenantId || args.req.tenantId;
  let presentationExport = null as Awaited<
    ReturnType<typeof routePresentationExportIntent>
  >;
  try {
    presentationExport = await routePresentationExportIntent({
      message: args.message.trim(),
      chatType: "chat",
      history: args.history,
      tenantId: tenantId ?? undefined,
    });
  } catch (err: unknown) {
    console.warn(
      "[unifiedChatGlobalStream] presentation intent failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const convertOnlyVizExport =
    presentationExport?.wantsPresentationExport &&
    presentationExport.action === "export_viz" &&
    presentationExport.mode === "convert";

  const chatContext = await buildChatContextForStream(args.req, args.requestBody);
  const convHistory = mapHistory(args.history);
  const retrievalAllowed =
    args.policy.retrieval !== "deny" && !chatContext.uploadOnlyMode;
  const includeRag = args.includeRag !== false && retrievalAllowed;

  setupGlobalStreamHeaders(args.res);
  const emit = createStreamEmitter(args.res);
  emit({ event: "turn.started", conversationId: args.conversationId, turnId: args.turnId });

  if (convertOnlyVizExport) {
    const blocks: UnifiedBlock[] = [
      {
        type: "text",
        markdown:
          "I'll prepare a PowerPoint from your last chart. Use **Download** on the card below.",
      },
    ];
    emitValidatedStreamWithDeltas(
      args.res,
      args.conversationId,
      args.turnId,
      blocks as Array<Record<string, unknown>>,
      {
        chatType: args.policy.chatType,
        presentationExport,
        ...args.streamMetadata,
      },
      { emit, skipTurnStarted: true },
    );
    return {
      blocks,
      metadata: {
        route: "global",
        presentationExport,
        contextManifest: [],
      },
    };
  }
  emit({
    event: "block.started",
    conversationId: args.conversationId,
    turnId: args.turnId,
    blockIndex: 0,
    blockType: "text",
  });

  const response = await runSqlThroughRouter(
    {
      source: "unified_chat",
      chatType: args.policy.chatType,
      tenantId: chatContext.tenantId,
      userId: chatContext.userId,
    },
    args.policy,
    () =>
      processCohiQuestionStreaming(
        args.message.trim(),
        chatContext,
        convHistory,
        {
          includeRag,
          onTextDelta: (delta) => {
            if (!delta) return;
            emit({
              event: "block.delta",
              conversationId: args.conversationId,
              turnId: args.turnId,
              blockIndex: 0,
              blockType: "text",
              delta,
            });
          },
        },
      ),
  );

  const vizArtifactId = response.visualization
    ? createVisualizationArtifactId()
    : undefined;
  const blocks = mapCohiChatResponseToBlocks(response, {
    visualizationArtifactId: vizArtifactId,
  });

  emitValidatedStreamWithDeltas(
    args.res,
    args.conversationId,
    args.turnId,
    blocks as Array<Record<string, unknown>>,
    {
      suggestedQuestions: response.suggestedQuestions ?? [],
      chatType: args.policy.chatType,
      presentationExport,
      ...args.streamMetadata,
    },
    {
      emit,
      skipTurnStarted: true,
      skipTextDeltas: true,
      primedTextBlockIndex: 0,
    },
  );

  return {
    blocks,
    metadata: {
      route: "global",
      sqlQuery: response.sqlQuery,
      sources: response.sources,
      suggestedQuestions: response.suggestedQuestions,
      retrievalIncluded: includeRag,
      presentationExport,
      contextManifest: [
        { tier: "identity", included: true, truncated: false },
        {
          tier: "retrieval",
          included: includeRag,
          truncated: false,
        },
      ],
    },
  };
}
