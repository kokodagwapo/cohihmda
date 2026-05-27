/**
 * Research Lab unified chat stream (COHI-402).
 *
 * `POST /api/chat/v1/messages:stream` with `chat_type=research` starts (or
 * resumes) the legacy Research pipeline, returns a short SSE handshake
 * (`researchSessionId` + starter text), then closes. The client loads findings
 * via `GET /api/research/sessions/:id` polling — not by holding this HTTP
 * connection for the full pipeline (avoids HTTP/2 SSE drops on long streams).
 */

import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import {
  applyChatCarryOver,
  createSession,
  runResearchPipeline,
  runFollowUp,
  getSession,
  loadSession,
  saveSession,
  isSessionRunning,
  type ResearchMode,
  type SSEEvent,
  type ResearchSession,
} from "../research/orchestrator.js";
import type { CarryOverContextPayload } from "./chatConversationFork.js";
import { readModeHandoffContext } from "./modeHandoff.js";
import {
  applyResearchHandoffToSession,
  resolveResearchStructuralHandoff,
} from "./handoffResolver.js";
import type { UnifiedBlock } from "./unifiedChatMappers.js";
import { validateUnifiedStreamEvent } from "./unifiedChatSchemas.js";
import { researchArtifactBlock } from "./unifiedResearchChat.js";
import { assertSqlAllowedByPolicy } from "./sqlAndMetricsRouter.js";
import type { PolicyDecision } from "./unifiedChatPolicy.js";
import { RESEARCH_SHELL_EXPAND_METADATA } from "./researchShellMetadata.js";
import { routePresentationExportIntent } from "./pptIntentRouter.js";
import {
  fallbackResearchTopicFromMessage,
  type PresentationExportMetadata,
} from "./presentationExportIntent.js";

export const RESEARCH_POLL_MODE_METADATA_KEY = "researchPollMode";

export interface UnifiedResearchStreamArgs {
  req: AuthRequest;
  res: Response;
  conversationId: string;
  turnId: string;
  message: string;
  legacyRef?: string | null;
  deepAnalysis?: boolean;
  uploadIds?: string[];
  history?: { role: string; content: string }[];
  policy: PolicyDecision;
  carryOver?: CarryOverContextPayload | null;
  modeHandoff?: ReturnType<typeof readModeHandoffContext>;
  /** @deprecated Poll mode closes immediately; kept for tests. */
  maxWaitMs?: number;
}

export interface UnifiedResearchStreamResult {
  finalBlocks: UnifiedBlock[];
  metadata: Record<string, unknown>;
  legacyRef: string;
}

export async function runUnifiedResearchStream(
  args: UnifiedResearchStreamArgs,
): Promise<UnifiedResearchStreamResult> {
  assertResearchPolicyOrThrow(args.policy);

  const tenantId = args.req.tenantContext?.tenantId || args.req.tenantId;
  const userId = args.req.userId;
  const userEmail = args.req.userEmail || "";
  if (!tenantId || !userId) {
    throw Object.assign(new Error("Tenant and user required"), {
      statusCode: 400,
    });
  }

  const tenantPool = await tenantDbManager.getTenantPool(tenantId);
  const mode: ResearchMode = args.deepAnalysis ? "deep" : "quick";

  let sessionId = args.legacyRef ?? undefined;
  let session: ResearchSession | undefined = sessionId ? getSession(sessionId) : undefined;
  let handoffManifest: Awaited<
    ReturnType<typeof resolveResearchStructuralHandoff>
  >["manifest"] = [];
  if (sessionId && !session) {
    session = await loadSession(sessionId, tenantPool);
  }
  if (!session) {
    const uploadIds =
      Array.isArray(args.uploadIds) && args.uploadIds.length > 0
        ? args.uploadIds.filter((id) => typeof id === "string")
        : [];
    const structural = await resolveResearchStructuralHandoff(
      args.modeHandoff ?? null,
      tenantPool,
    );
    handoffManifest = structural.manifest;
    session = await createSession(
      tenantId,
      userId,
      userEmail,
      tenantPool,
      args.message.trim(),
      undefined,
      mode,
      uploadIds,
      structural.widgetContext,
    );
    if (args.carryOver) {
      applyChatCarryOver(session, args.carryOver);
    }
    applyResearchHandoffToSession(session, structural);
  }
  sessionId = session.id;

  if (session.phase === "error") {
    return emitResearchPollStream(args, session, sessionId, {
      pipelineError: session.error ?? "Research session in error state",
      handoffManifest,
    });
  }

  let presentationExport: PresentationExportMetadata | null = null;
  try {
    presentationExport = await routePresentationExportIntent({
      message: args.message.trim(),
      chatType: "research",
      history: args.history,
      tenantId,
    });
  } catch (err: unknown) {
    console.warn(
      "[unifiedResearchStream] presentation intent failed:",
      err instanceof Error ? err.message : err,
    );
  }

  if (presentationExport?.wantsPresentationExport) {
    const hasExportableReport =
      session.phase === "complete" &&
      (session.findings.length > 0 || !!session.report);
    if (hasExportableReport) {
      return emitResearchPresentationExportStream(
        args,
        session,
        sessionId,
        presentationExport,
        { handoffManifest },
      );
    }

    const researchTopic =
      presentationExport.researchTopic?.trim() ||
      fallbackResearchTopicFromMessage(args.message.trim());
    if (researchTopic.length >= 8) {
      session.topic = researchTopic;
    }
    session.pendingPresentationExport = true;
    if (
      !session.events.some((e) => e.type === "presentation_export_pending")
    ) {
      session.events.push({
        type: "presentation_export_pending",
        data: { requestedAt: Date.now() },
      } as SSEEvent);
    }
    try {
      await saveSession(session, tenantPool);
    } catch (err: unknown) {
      console.warn(
        "[unifiedResearchStream] save pending PPT flag:",
        err instanceof Error ? err.message : err,
      );
    }

    const topicLabel = session.topic || researchTopic;
    const deferredExport: PresentationExportMetadata = {
      ...presentationExport,
      deferred: true,
      researchTopic: session.topic,
    };

    kickResearchPipelineInBackground(args, session, sessionId, tenantPool);

    return emitResearchPollStream(args, session, sessionId, {
      handoffManifest,
      markdownOverride: `Research investigation started for: **${topicLabel}**. When the report is ready, a PowerPoint download will appear below.`,
      presentationExport: deferredExport,
    });
  }

  kickResearchPipelineInBackground(args, session, sessionId, tenantPool);

  return emitResearchPollStream(args, session, sessionId, { handoffManifest });
}

/** Start or resume pipeline work without blocking the unified SSE response. */
export function kickResearchPipelineInBackground(
  args: UnifiedResearchStreamArgs,
  session: ResearchSession,
  sessionId: string,
  tenantPool: Awaited<ReturnType<typeof tenantDbManager.getTenantPool>>,
): void {
  if (
    session.phase !== "complete" &&
    session.phase !== "error" &&
    !isSessionRunning(sessionId)
  ) {
    void runResearchPipeline(sessionId, tenantPool, {
      userRole: args.req.userRole,
      isSuperAdmin: args.req.isSuperAdmin,
    }).catch((err) => {
      console.error("[unifiedResearchStream] pipeline error:", err);
    });
    return;
  }

  if (session.phase === "complete" && !isSessionRunning(sessionId)) {
    void runFollowUp(
      sessionId,
      args.message.trim(),
      tenantPool,
      {
        userRole: args.req.userRole,
        isSuperAdmin: args.req.isSuperAdmin,
      },
      { deepAnalysis: args.deepAnalysis ?? false },
    ).catch((err) => {
      console.error("[unifiedResearchStream] follow-up error:", err);
    });
  }
}

export function buildResearchPollModeMarkdown(
  session: Pick<ResearchSession, "topic" | "phase">,
  message: string,
): string {
  const topic = session.topic || message.trim();
  if (session.phase === "complete") {
    return `Continuing research on: **${topic}**. Open the Research workspace to view timeline, findings, and report as they update.`;
  }
  return `Research investigation started for: **${topic}**. Open the Research workspace to view timeline, findings, and report as they are ready.`;
}

function emitResearchPresentationExportStream(
  args: UnifiedResearchStreamArgs,
  session: ResearchSession,
  sessionId: string,
  presentationExport: PresentationExportMetadata,
  options?: {
    handoffManifest?: { tier: string; included: boolean; truncated: boolean }[];
  },
): UnifiedResearchStreamResult {
  const markdown =
    "Your research report is ready to export as PowerPoint. Use **Download** on the card below when you're ready.";
  return emitResearchPollStream(args, session, sessionId, {
    handoffManifest: options?.handoffManifest,
    markdownOverride: markdown,
    presentationExport,
  });
}

function emitResearchPollStream(
  args: UnifiedResearchStreamArgs,
  session: ResearchSession,
  sessionId: string,
  options?: {
    pipelineError?: string;
    handoffManifest?: { tier: string; included: boolean; truncated: boolean }[];
    markdownOverride?: string;
    presentationExport?: PresentationExportMetadata;
  },
): UnifiedResearchStreamResult {
  setupSseHeaders(args.res);
  const emit = makeEmitter(args.res);

  const markdown =
    options?.markdownOverride ?? buildResearchPollModeMarkdown(session, args.message);
  const finalTextBlock: UnifiedBlock = { type: "text", markdown };
  const artifactBlock = researchArtifactBlock(sessionId, session.phase);
  const pollMetadata = {
    chatType: "research",
    researchSessionId: sessionId,
    phase: session.phase,
    [RESEARCH_POLL_MODE_METADATA_KEY]: true,
    ...RESEARCH_SHELL_EXPAND_METADATA,
    ...(options?.presentationExport
      ? { presentationExport: options.presentationExport }
      : {}),
    contextManifest: [
      { tier: "identity", included: true, truncated: false },
      { tier: "research_pipeline", included: true, truncated: false },
      { tier: "retrieval", included: true, truncated: false },
      ...(options?.handoffManifest ?? []),
    ],
  };

  emit({
    event: "turn.started",
    conversationId: args.conversationId,
    turnId: args.turnId,
    metadata: pollMetadata,
  });
  emit({
    event: "block.started",
    conversationId: args.conversationId,
    turnId: args.turnId,
    blockIndex: 0,
    blockType: "text",
  });
  emitDelta(emit, args, markdown);
  emit({
    event: "block.completed",
    conversationId: args.conversationId,
    turnId: args.turnId,
    blockIndex: 0,
    blockType: "text",
    block: finalTextBlock,
  });
  emit({
    event: "block.started",
    conversationId: args.conversationId,
    turnId: args.turnId,
    blockIndex: 1,
    blockType: "artifacts",
  });
  emit({
    event: "block.completed",
    conversationId: args.conversationId,
    turnId: args.turnId,
    blockIndex: 1,
    blockType: "artifacts",
    block: artifactBlock as Record<string, unknown>,
  });

  if (options?.pipelineError) {
    emit({
      event: "error",
      conversationId: args.conversationId,
      turnId: args.turnId,
      error: {
        code: "research_pipeline_error",
        message: options.pipelineError,
        retryable: false,
      },
    });
  }

  emit({
    event: "turn.completed",
    conversationId: args.conversationId,
    turnId: args.turnId,
    metadata: pollMetadata,
  });

  return {
    finalBlocks: [finalTextBlock, artifactBlock],
    metadata: {
      route: "research",
      researchSessionId: sessionId,
      phase: session.phase,
      [RESEARCH_POLL_MODE_METADATA_KEY]: true,
      ...RESEARCH_SHELL_EXPAND_METADATA,
      ...(options?.presentationExport
        ? { presentationExport: options.presentationExport }
        : {}),
    },
    legacyRef: sessionId,
  };
}

function assertResearchPolicyOrThrow(policy: PolicyDecision): void {
  const gate = assertSqlAllowedByPolicy(policy);
  if (gate.ok === false) {
    const err: any = new Error(gate.clientMessage);
    err.statusCode = 403;
    err.code = gate.code;
    err.metadata = { source: "research_lab" };
    throw err;
  }
}

function setupSseHeaders(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
}

type StreamEmitter = (ev: Record<string, unknown>) => void;

function makeEmitter(res: Response): StreamEmitter {
  return (ev: Record<string, unknown>) => {
    if (!validateUnifiedStreamEvent(ev)) {
      console.warn(
        "[unifiedResearchStream] event failed schema validation:",
        validateUnifiedStreamEvent.errors,
        ev,
      );
      return;
    }
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
}

function emitDelta(
  emit: StreamEmitter,
  args: UnifiedResearchStreamArgs,
  text: string,
): void {
  emit({
    event: "block.delta",
    conversationId: args.conversationId,
    turnId: args.turnId,
    blockIndex: 0,
    blockType: "text",
    delta: text,
  });
}

/**
 * Map a research pipeline SSE event to a single timeline line. Returns null
 * when the event has no user-visible content (e.g. heartbeats).
 */
export function mapEventToLine(event: SSEEvent): string | null {
  switch (event.type) {
    case "phase": {
      const phase = event.data?.phase ?? "phase";
      const message = event.data?.message ?? "";
      return `**${capitalize(String(phase))}** — ${message}`.trim();
    }
    case "plan": {
      const summary = event.data?.summary;
      const count = Array.isArray(event.data?.questions) ? event.data.questions.length : 0;
      return summary
        ? `**Plan:** ${summary} (${count} questions)`
        : `**Plan ready** (${count} questions).`;
    }
    case "user_followup": {
      const q = event.data?.question ?? "";
      return q ? `**Follow-up:** ${q}` : "**Follow-up question**";
    }
    case "agent_start": {
      const topic = event.data?.topic ?? "investigation";
      return `Investigating: ${topic}`;
    }
    case "agent_complete": {
      const title = event.data?.title ?? "finding";
      const confidence = event.data?.confidence ?? "";
      return `Finding ready: ${title}${confidence ? ` (${confidence})` : ""}`;
    }
    case "agent_error": {
      const message = event.data?.error ?? "agent error";
      return `Agent error: ${message}`;
    }
    case "quick_result": {
      const title = event.data?.title ?? "Quick answer";
      return `Quick answer: ${title}`;
    }
    case "synthesis": {
      return `**Synthesis ready.**`;
    }
    case "complete": {
      const findingCount = event.data?.findingCount ?? 0;
      return `Research complete (${findingCount} findings).`;
    }
    case "error": {
      const message = event.data?.message ?? "error";
      return `Error: ${message}`;
    }
    default:
      return null;
  }
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
