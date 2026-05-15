/**
 * Research Lab live stream proxy (COHI-402, Wave 3 locked decision #1).
 *
 * Wraps the legacy Research SSE pipeline so a client of
 * `POST /api/chat/v1/messages:stream` with `chat_type=research` gets a single
 * SSE connection emitting schema-valid `ChatStreamEvent`s — no second
 * `GET /api/research/sessions/:id/stream` is required.
 *
 * Mapping rules (intentionally narrow — we only emit shapes that already
 * validate against `chat-event-stream.schema.json`):
 *   - `phase` / `agent_*` / `plan` / `quick_result` → `block.delta` on the
 *     timeline text block (index 0).
 *   - `synthesis` → finalize text block; emit a closing artifacts block (index 1).
 *   - `complete` → flush remaining deltas, emit `turn.completed`.
 *   - `error` → emit a stream `error` event.
 */

import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import {
  createSession,
  runResearchPipeline,
  getSession,
  loadSession,
  attachSessionEmitter,
  detachSessionEmitter,
  isSessionRunning,
  type ResearchMode,
  type SSEEvent,
  type SSEEmitter,
  type ResearchSession,
} from "../research/orchestrator.js";
import type { UnifiedBlock } from "./unifiedChatMappers.js";
import { validateUnifiedStreamEvent } from "./unifiedChatSchemas.js";
import { researchArtifactBlock } from "./unifiedResearchChat.js";
import { assertSqlAllowedByPolicy } from "./sqlAndMetricsRouter.js";
import type { PolicyDecision } from "./unifiedChatPolicy.js";

export interface UnifiedResearchStreamArgs {
  req: AuthRequest;
  res: Response;
  conversationId: string;
  turnId: string;
  message: string;
  legacyRef?: string | null;
  deepAnalysis?: boolean;
  policy: PolicyDecision;
  /** Hard cap so we never hold a request forever (ms). */
  maxWaitMs?: number;
}

export interface UnifiedResearchStreamResult {
  finalBlocks: UnifiedBlock[];
  metadata: Record<string, unknown>;
  legacyRef: string;
}

const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000;

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
  if (sessionId && !session) {
    session = await loadSession(sessionId, tenantPool);
  }
  if (!session) {
    session = await createSession(
      tenantId,
      userId,
      userEmail,
      tenantPool,
      args.message.trim(),
      undefined,
      mode,
    );
  }
  sessionId = session.id;

  setupSseHeaders(args.res);
  const emit = makeEmitter(args.res);

  emit({
    event: "turn.started",
    conversationId: args.conversationId,
    turnId: args.turnId,
  });
  emit({
    event: "block.started",
    conversationId: args.conversationId,
    turnId: args.turnId,
    blockIndex: 0,
    blockType: "text",
  });

  // Replay any prior events so reconnects see history (parity with legacy SSE).
  const timelineLines: string[] = [
    `Research investigation started for: **${session.topic || args.message.trim()}**.`,
  ];
  emitDelta(emit, args, timelineLines[0]);

  for (const ev of session.events) {
    const line = mapEventToLine(ev);
    if (line) {
      timelineLines.push(line);
      emitDelta(emit, args, line);
    }
  }

  const completionPromise = new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const onEvent: SSEEmitter = (ev: SSEEvent) => {
      const line = mapEventToLine(ev);
      if (line) {
        timelineLines.push(line);
        emitDelta(emit, args, line);
      }
      if (ev.type === "complete") {
        resolve({ ok: true });
      } else if (ev.type === "error") {
        resolve({ ok: false, error: ev.data?.message ?? "Research pipeline error" });
      }
    };
    attachSessionEmitter(sessionId!, onEvent);

    // Kick the pipeline if not already running and not done.
    if (
      session!.phase !== "complete" &&
      session!.phase !== "error" &&
      !isSessionRunning(sessionId!)
    ) {
      void runResearchPipeline(sessionId!, tenantPool, {
        userRole: args.req.userRole,
        isSuperAdmin: args.req.isSuperAdmin,
      }).catch((err) => {
        console.error("[unifiedResearchStream] pipeline error:", err);
      });
    }

    // If already complete on entry, resolve immediately.
    if (session!.phase === "complete") {
      resolve({ ok: true });
    } else if (session!.phase === "error") {
      resolve({
        ok: false,
        error: session!.error ?? "Research session in error state",
      });
    }

    const maxWaitMs = args.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: "research_stream_timeout" });
    }, maxWaitMs);

    args.req.on("close", () => {
      clearTimeout(timeout);
      detachSessionEmitter(sessionId!, onEvent);
    });
  });

  const result = await completionPromise;

  // Finalize blocks.
  const summaryMarkdown = timelineLines.join("\n\n");
  const finalTextBlock: UnifiedBlock = {
    type: "text",
    markdown: summaryMarkdown,
  };
  emit({
    event: "block.completed",
    conversationId: args.conversationId,
    turnId: args.turnId,
    blockIndex: 0,
    blockType: "text",
    block: finalTextBlock,
  });

  const finalSession = getSession(sessionId!) ?? session!;
  const artifactBlock = researchArtifactBlock(sessionId!, finalSession.phase);
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

  if (!result.ok) {
    emit({
      event: "error",
      conversationId: args.conversationId,
      turnId: args.turnId,
      error: {
        code: "research_pipeline_error",
        message: result.error ?? "Research pipeline failed",
        retryable: false,
      },
    });
  }

  emit({
    event: "turn.completed",
    conversationId: args.conversationId,
    turnId: args.turnId,
    metadata: {
      chatType: "research",
      researchSessionId: sessionId,
      phase: finalSession.phase,
    },
  });

  return {
    finalBlocks: [finalTextBlock, artifactBlock],
    metadata: {
      route: "research",
      researchSessionId: sessionId,
      phase: finalSession.phase,
      mode,
      policyDecisionId: args.policy.decisionId,
    },
    legacyRef: sessionId!,
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
    delta: `${text}\n\n`,
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
