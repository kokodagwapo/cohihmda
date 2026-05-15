/**
 * Research mode behind unified chat (COHI-402).
 *
 * The non-stream POST (`runUnifiedResearchTurn`) kicks off the Research Lab
 * pipeline and returns a "started" turn (text + artifact ref). The stream POST
 * proxy lives in {@link ./unifiedResearchStream.ts} and emits ChatStreamEvents
 * as the pipeline runs (Wave 3 locked decision #1, Option B).
 */

import type { AuthRequest } from "../../middleware/auth.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import {
  createSession,
  runResearchPipeline,
  getSession,
  loadSession,
  type ResearchMode,
} from "../research/orchestrator.js";
import type { UnifiedBlock } from "./unifiedChatMappers.js";
import { assertSqlAllowedByPolicy } from "./sqlAndMetricsRouter.js";
import type { PolicyDecision } from "./unifiedChatPolicy.js";

/**
 * Explicit policy gate before kicking off (or resuming) the Research Lab
 * pipeline. The pipeline executes tenant SQL via legacy agent code — Wave 3
 * locked decision #4: match existing research coverage for now and gate at the
 * pipeline boundary so denied users never hit agent SQL.
 */
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

export async function runUnifiedResearchTurn(args: {
  req: AuthRequest;
  message: string;
  conversationId: string;
  legacyRef?: string | null;
  deepAnalysis?: boolean;
  policy: PolicyDecision;
}): Promise<{
  blocks: UnifiedBlock[];
  metadata: Record<string, unknown>;
  legacyRef: string;
}> {
  assertResearchPolicyOrThrow(args.policy);

  const tenantId = args.req.tenantContext?.tenantId || args.req.tenantId;
  const userId = args.req.userId;
  const userEmail = args.req.userEmail || "";
  if (!tenantId || !userId) {
    throw Object.assign(new Error("Tenant and user required"), { statusCode: 400 });
  }

  const tenantPool = await tenantDbManager.getTenantPool(tenantId);
  const mode: ResearchMode = args.deepAnalysis ? "deep" : "quick";

  let sessionId = args.legacyRef ?? undefined;
  let session = sessionId ? getSession(sessionId) : undefined;
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
    sessionId = session.id;
    void runResearchPipeline(session.id, tenantPool, {
      userRole: args.req.userRole,
      isSuperAdmin: args.req.isSuperAdmin,
    }).catch((err) => {
      console.error("[unifiedResearchChat] pipeline error:", err);
    });
  } else if (session.phase === "complete") {
    return {
      legacyRef: session.id,
      blocks: [
        {
          type: "text",
          markdown:
            "This research session is complete. Ask a follow-up in the Research UI or start a new Research thread.",
        },
        researchArtifactBlock(session.id, session.phase),
      ],
      metadata: {
        route: "research",
        researchSessionId: session.id,
        phase: session.phase,
        policyDecisionId: args.policy.decisionId,
      },
    };
  }

  const phase = session.phase;
  const blocks: UnifiedBlock[] = [
    {
      type: "text",
      markdown: `Research investigation started for: **${session.topic || args.message.trim()}**. Open the Research workspace to view timeline, findings, and report as they stream.`,
    },
    researchArtifactBlock(session.id, phase),
  ];

  return {
    legacyRef: session.id,
    blocks,
    metadata: {
      route: "research",
      researchSessionId: session.id,
      phase,
      mode,
      policyDecisionId: args.policy.decisionId,
    },
  };
}

export function researchArtifactBlock(sessionId: string, phase: string): UnifiedBlock {
  return {
    type: "artifacts",
    items: [
      {
        kind: "chart_ref",
        ref: sessionId,
        meta: {
          researchSessionId: sessionId,
          phase,
          // Kept for backward compatibility; primary streaming contract is
          // POST /api/chat/v1/messages:stream (Option B).
          streamPath: `/api/research/sessions/${sessionId}/stream`,
        },
      },
    ],
  };
}
