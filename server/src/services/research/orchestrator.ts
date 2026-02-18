/**
 * Research Orchestrator
 *
 * Manages research sessions and coordinates the 3-phase agentic pipeline:
 *   Phase 1: Planner — creates an investigation plan
 *   Phase 2: Data Analysts — investigate each question in parallel
 *   Phase 3: Synthesis — compiles findings into a report
 *
 * Features:
 *   - Graceful pause/resume (agents finish current step before pausing)
 *   - DB persistence (sessions saved to research_sessions table)
 *   - In-memory cache for active sessions
 *   - Follow-up questions after completion
 *   - Steering directives mid-run
 */

import pg from "pg";
import crypto from "crypto";
import { getOpenAIKey, getSchemaContext, getMetricDefinitions, getKnowledgeContext } from "./tools.js";
import { runPlannerAgent, type ResearchPlan } from "./agents/plannerAgent.js";
import {
  runDataAnalystAgent,
  type Finding,
  type AgentStep,
} from "./agents/dataAnalystAgent.js";
import {
  runSynthesisAgent,
  type ResearchReport,
} from "./agents/synthesisAgent.js";

// ============================================================================
// Types
// ============================================================================

export type SessionPhase =
  | "created"
  | "planning"
  | "investigating"
  | "synthesizing"
  | "complete"
  | "followup"
  | "error";

export interface SSEEvent {
  type: string;
  data: any;
  timestamp: number;
}

export type SSEEmitter = (event: SSEEvent) => void;

export interface FollowUpEntry {
  question: string;
  finding: Finding;
  timestamp: number;
}

export interface InsightContext {
  insightId?: number;
  headline: string;
  understory: string;
  keyMetrics?: Record<string, any>;
  evidenceSummary?: string;
  chatHistory?: Array<{ role: string; content: string }>;
}

export interface ResearchSession {
  id: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  topic?: string;
  phase: SessionPhase;
  plan?: ResearchPlan;
  findings: Finding[];
  report?: ResearchReport;
  events: SSEEvent[];
  followUpHistory: FollowUpEntry[];
  steeringDirectives: string[];
  createdAt: number;
  error?: string;
  initialContext?: InsightContext;
  // Pause mechanism
  pauseRequested: boolean;
  paused: boolean;
  _pauseResolver?: () => void;
  // Active SSE emitter (set when streaming)
  _activeEmitter?: SSEEmitter;
}

// ============================================================================
// In-memory session cache (hot cache, DB is source of truth)
// ============================================================================

const sessions = new Map<string, ResearchSession>();
const SESSION_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

function pruneExpiredSessions() {
  const cutoff = Date.now() - SESSION_CACHE_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff && session.phase !== "investigating" && session.phase !== "planning") {
      sessions.delete(id);
    }
  }
}

// ============================================================================
// Pause / Resume
// ============================================================================

export function pauseSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.phase === "complete" || session.phase === "error") return false;
  session.pauseRequested = true;
  return true;
}

export function resumeSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.pauseRequested = false;
  session.paused = false;
  if (session._pauseResolver) {
    session._pauseResolver();
    session._pauseResolver = undefined;
  }
  return true;
}

/**
 * Called by agents between iterations. Returns immediately if not paused.
 * If pauseRequested, emits a "paused" event and blocks until resumed.
 */
async function waitIfPaused(session: ResearchSession, emit: SSEEmitter): Promise<void> {
  if (!session.pauseRequested) return;
  session.paused = true;
  emit({ type: "paused", data: { message: "Investigation paused" }, timestamp: Date.now() });
  console.log(`[Research] Session ${session.id} paused`);
  await new Promise<void>((resolve) => {
    session._pauseResolver = resolve;
  });
  emit({ type: "resumed", data: { message: "Investigation resumed" }, timestamp: Date.now() });
  console.log(`[Research] Session ${session.id} resumed`);
}

// ============================================================================
// DB Persistence
// ============================================================================

export async function saveSession(session: ResearchSession, tenantPool: pg.Pool): Promise<void> {
  try {
    await tenantPool.query(`
      INSERT INTO research_sessions (id, tenant_id, user_id, user_email, topic, phase, plan, findings, report, events, follow_up_history, error, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, to_timestamp($13::double precision / 1000), NOW())
      ON CONFLICT (id) DO UPDATE SET
        phase = EXCLUDED.phase,
        plan = EXCLUDED.plan,
        findings = EXCLUDED.findings,
        report = EXCLUDED.report,
        events = EXCLUDED.events,
        follow_up_history = EXCLUDED.follow_up_history,
        error = EXCLUDED.error,
        updated_at = NOW()
    `, [
      session.id,
      session.tenantId,
      session.userId,
      session.userEmail,
      session.topic || null,
      session.phase,
      session.plan ? JSON.stringify(session.plan) : null,
      JSON.stringify(session.findings),
      session.report ? JSON.stringify(session.report) : null,
      JSON.stringify(session.events),
      JSON.stringify(session.followUpHistory),
      session.error || null,
      session.createdAt,
    ]);
  } catch (err: any) {
    console.error(`[Research] Failed to save session ${session.id}:`, err.message);
  }
}

export async function loadSession(sessionId: string, tenantPool: pg.Pool): Promise<ResearchSession | undefined> {
  // Check memory cache first
  const cached = sessions.get(sessionId);
  if (cached) return cached;

  try {
    const result = await tenantPool.query(
      `SELECT * FROM research_sessions WHERE id = $1`,
      [sessionId]
    );
    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    const session: ResearchSession = {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      userEmail: row.user_email || "",
      topic: row.topic,
      phase: row.phase as SessionPhase,
      plan: row.plan,
      findings: row.findings || [],
      report: row.report,
      events: row.events || [],
      followUpHistory: row.follow_up_history || [],
      steeringDirectives: [],
      createdAt: new Date(row.created_at).getTime(),
      error: row.error,
      pauseRequested: false,
      paused: false,
    };

    sessions.set(session.id, session);
    return session;
  } catch (err: any) {
    console.error(`[Research] Failed to load session ${sessionId}:`, err.message);
    return undefined;
  }
}

export async function listSessions(
  tenantPool: pg.Pool,
  userId: string
): Promise<Array<{ id: string; topic: string | null; phase: string; createdAt: string; updatedAt: string }>> {
  try {
    const result = await tenantPool.query(
      `SELECT id, topic, phase, created_at, updated_at
       FROM research_sessions
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 50`,
      [userId]
    );
    return result.rows.map((r: any) => ({
      id: r.id,
      topic: r.topic,
      phase: r.phase,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch (err: any) {
    console.error("[Research] Failed to list sessions:", err.message);
    return [];
  }
}

export async function deleteSession(sessionId: string, tenantPool: pg.Pool): Promise<boolean> {
  sessions.delete(sessionId);
  try {
    await tenantPool.query(`DELETE FROM research_sessions WHERE id = $1`, [sessionId]);
    return true;
  } catch (err: any) {
    console.error(`[Research] Failed to delete session ${sessionId}:`, err.message);
    return false;
  }
}

// ============================================================================
// Session Management
// ============================================================================

export async function createSession(
  tenantId: string,
  userId: string,
  userEmail: string,
  tenantPool: pg.Pool,
  topic?: string,
  initialContext?: InsightContext
): Promise<ResearchSession> {
  pruneExpiredSessions();

  // If no topic provided but we have initial context, derive a topic
  const derivedTopic = topic || (initialContext
    ? `Deep dive: ${initialContext.headline}`
    : undefined);

  // Pre-populate steering directive from insight context so the planner has prior knowledge
  const steeringDirectives: string[] = [];
  if (initialContext) {
    let directive = `PRIOR INVESTIGATION CONTEXT — The user is escalating from a dashboard insight:\n`;
    directive += `Headline: ${initialContext.headline}\n`;
    directive += `Summary: ${initialContext.understory}\n`;
    if (initialContext.keyMetrics && Object.keys(initialContext.keyMetrics).length > 0) {
      directive += `Key Metrics: ${Object.entries(initialContext.keyMetrics).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
    }
    if (initialContext.evidenceSummary) {
      directive += `Evidence: ${initialContext.evidenceSummary}\n`;
    }
    if (initialContext.chatHistory?.length) {
      directive += `\nPrior chat Q&A:\n`;
      for (const msg of initialContext.chatHistory.slice(-6)) {
        directive += `${msg.role === 'user' ? 'User' : 'Cohi'}: ${msg.content.substring(0, 300)}\n`;
      }
    }
    directive += `\nBuild on these findings. Go deeper, explore related angles, and find new patterns the dashboard insight didn't cover.`;
    steeringDirectives.push(directive);
  }

  const session: ResearchSession = {
    id: crypto.randomUUID(),
    tenantId,
    userId,
    userEmail,
    topic: derivedTopic,
    phase: "created",
    findings: [],
    events: [],
    followUpHistory: [],
    steeringDirectives,
    createdAt: Date.now(),
    initialContext,
    pauseRequested: false,
    paused: false,
  };

  sessions.set(session.id, session);
  await saveSession(session, tenantPool);
  return session;
}

export function getSession(sessionId: string): ResearchSession | undefined {
  return sessions.get(sessionId);
}

export function addSteeringDirective(sessionId: string, message: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.phase === "complete" || session.phase === "error") return false;
  session.steeringDirectives.push(message);
  return true;
}

// ============================================================================
// Main Orchestration Pipeline
// ============================================================================

export async function runResearchPipeline(
  sessionId: string,
  tenantPool: pg.Pool,
  emit: SSEEmitter
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    emit({ type: "error", data: { message: "Session not found" }, timestamp: Date.now() });
    return;
  }

  session._activeEmitter = emit;

  try {
    const apiKey = await getOpenAIKey(session.tenantId);
    const [schemaContext, metricDefs, knowledgeContext] = await Promise.all([
      getSchemaContext(session.tenantId),
      Promise.resolve(getMetricDefinitions()),
      getKnowledgeContext(tenantPool, session.tenantId, session.topic),
    ]);

    if (knowledgeContext) {
      console.log(`[Research] Session ${sessionId}: Knowledge base context loaded (${knowledgeContext.length} chars)`);
    }

    // ── Phase 1: Planning ──
    session.phase = "planning";
    emit({
      type: "phase",
      data: { phase: "planning", message: "Research planner is creating an investigation plan..." },
      timestamp: Date.now(),
    });

    // Build prior context string for sessions created from insights
    let priorInvestigationContext: string | undefined;
    if (session.initialContext) {
      const ic = session.initialContext;
      let ctx = `Headline: ${ic.headline}\nSummary: ${ic.understory}\n`;
      if (ic.keyMetrics && Object.keys(ic.keyMetrics).length > 0) {
        ctx += `Key Metrics: ${Object.entries(ic.keyMetrics).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
      }
      if (ic.evidenceSummary) ctx += `Evidence: ${ic.evidenceSummary}\n`;
      if (ic.chatHistory?.length) {
        ctx += `\nPrior Q&A:\n`;
        for (const msg of ic.chatHistory.slice(-6)) {
          ctx += `${msg.role === 'user' ? 'User' : 'Cohi'}: ${msg.content.substring(0, 300)}\n`;
        }
      }
      priorInvestigationContext = ctx;
    }

    const plan = await runPlannerAgent(schemaContext, metricDefs, apiKey, {
      topic: session.topic,
      knowledgeContext,
      priorInvestigationContext,
    });

    session.plan = plan;
    emit({ type: "plan", data: plan, timestamp: Date.now() });
    await saveSession(session, tenantPool);

    console.log(`[Research] Session ${sessionId}: Plan created with ${plan.questions.length} questions`);

    // ── Phase 2: Investigation ──
    session.phase = "investigating";
    emit({
      type: "phase",
      data: { phase: "investigating", message: `Launching ${plan.questions.length} data analyst agents...` },
      timestamp: Date.now(),
    });

    const MAX_CONCURRENT = 3;
    const questions = plan.questions;
    const allFindings: Finding[] = [];

    for (let i = 0; i < questions.length; i += MAX_CONCURRENT) {
      const batch = questions.slice(i, i + MAX_CONCURRENT);

      const batchResults = await Promise.allSettled(
        batch.map((question) => {
          emit({
            type: "agent_start",
            data: { questionId: question.id, topic: question.topic, category: question.category },
            timestamp: Date.now(),
          });

          const onStep = (step: AgentStep) => {
            emit({
              type: `agent_${step.type}`,
              data: { questionId: question.id, ...step },
              timestamp: step.timestamp,
            });
          };

          const getSteeringDirective = (): string | null => {
            if (session.steeringDirectives.length > 0) return session.steeringDirectives.shift()!;
            return null;
          };

          const checkPause = () => waitIfPaused(session, emit);

          return runDataAnalystAgent(
            question, schemaContext, metricDefs, tenantPool, apiKey,
            onStep, getSteeringDirective, checkPause, knowledgeContext
          );
        })
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          allFindings.push(result.value);
          emit({
            type: "agent_complete",
            data: { questionId: result.value.questionId, title: result.value.title, confidence: result.value.confidence },
            timestamp: Date.now(),
          });
        } else {
          console.error(`[Research] Agent failed:`, result.reason);
          emit({ type: "agent_error", data: { error: result.reason?.message || "Agent failed" }, timestamp: Date.now() });
        }
      }
    }

    session.findings = allFindings;
    await saveSession(session, tenantPool);

    console.log(`[Research] Session ${sessionId}: ${allFindings.length} findings collected`);

    // ── Phase 3: Synthesis ──
    session.phase = "synthesizing";
    emit({
      type: "phase",
      data: { phase: "synthesizing", message: "Synthesis agent is compiling the research report..." },
      timestamp: Date.now(),
    });

    const report = await runSynthesisAgent(plan, allFindings, apiKey);
    session.report = report;
    emit({ type: "synthesis", data: report, timestamp: Date.now() });

    // ── Complete ──
    session.phase = "complete";
    emit({
      type: "complete",
      data: { message: "Research investigation complete.", findingCount: allFindings.length, insightCount: report.rankedInsights?.length || 0 },
      timestamp: Date.now(),
    });

    await saveSession(session, tenantPool);
    console.log(`[Research] Session ${sessionId}: Pipeline complete`);
  } catch (err: any) {
    session.phase = "error";
    session.error = err.message;
    console.error(`[Research] Session ${sessionId} error:`, err);
    emit({ type: "error", data: { message: err.message }, timestamp: Date.now() });
    await saveSession(session, tenantPool);
  } finally {
    session._activeEmitter = undefined;
  }
}

// ============================================================================
// Follow-up Investigation
// ============================================================================

export async function runFollowUp(
  sessionId: string,
  question: string,
  tenantPool: pg.Pool,
  emit: SSEEmitter
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    emit({ type: "error", data: { message: "Session not found" }, timestamp: Date.now() });
    return;
  }

  if (session.phase !== "complete") {
    emit({ type: "error", data: { message: "Session must be complete before asking follow-ups" }, timestamp: Date.now() });
    return;
  }

  session.phase = "followup" as SessionPhase;
  session._activeEmitter = emit;

  emit({
    type: "phase",
    data: { phase: "followup", message: `Investigating follow-up: "${question.substring(0, 80)}"...` },
    timestamp: Date.now(),
  });

  try {
    const apiKey = await getOpenAIKey(session.tenantId);
    const [schemaContext, metricDefs, knowledgeContext] = await Promise.all([
      getSchemaContext(session.tenantId),
      Promise.resolve(getMetricDefinitions()),
      getKnowledgeContext(tenantPool, session.tenantId, question),
    ]);

    // Build context from existing findings
    const existingContext = session.findings
      .map((f) => `- ${f.title}: ${f.summary}`)
      .join("\n");

    const followUpQuestion = {
      id: 900 + session.followUpHistory.length,
      topic: question,
      hypothesis: `Follow-up investigation based on user question: "${question}"`,
      approach: `Use the existing findings as context:\n${existingContext}\n\nInvestigate the user's specific question with targeted SQL queries.`,
      priority: "high" as const,
      category: "followup",
    };

    emit({
      type: "agent_start",
      data: { questionId: followUpQuestion.id, topic: followUpQuestion.topic, category: "followup" },
      timestamp: Date.now(),
    });

    const onStep = (step: AgentStep) => {
      emit({
        type: `agent_${step.type}`,
        data: { questionId: followUpQuestion.id, ...step },
        timestamp: step.timestamp,
      });
    };

    const getSteeringDirective = (): string | null => {
      if (session.steeringDirectives.length > 0) return session.steeringDirectives.shift()!;
      return null;
    };

    const checkPause = () => waitIfPaused(session, emit);

    const finding = await runDataAnalystAgent(
      followUpQuestion, schemaContext, metricDefs, tenantPool, apiKey,
      onStep, getSteeringDirective, checkPause, knowledgeContext
    );

    session.findings.push(finding);
    session.followUpHistory.push({ question, finding, timestamp: Date.now() });

    emit({
      type: "agent_complete",
      data: { questionId: finding.questionId, title: finding.title, confidence: finding.confidence },
      timestamp: Date.now(),
    });

    session.phase = "complete";
    emit({
      type: "complete",
      data: { message: "Follow-up investigation complete.", findingCount: 1 },
      timestamp: Date.now(),
    });

    await saveSession(session, tenantPool);
  } catch (err: any) {
    session.phase = "complete"; // Revert to complete on followup error
    console.error(`[Research] Follow-up error for session ${sessionId}:`, err);
    emit({ type: "error", data: { message: err.message }, timestamp: Date.now() });
  } finally {
    session._activeEmitter = undefined;
  }
}
