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
import { getOpenAIKey, getSchemaContext, getMetricDefinitions, getKnowledgeContext, getDerivedMetricContext, getTrackedInsightContext } from "./tools.js";
import { runPlannerAgent, type ResearchPlan, type InvestigationQuestion } from "./agents/plannerAgent.js";
import {
  runDataAnalystAgent,
  type Finding,
  type AgentStep,
} from "./agents/dataAnalystAgent.js";
import {
  runSynthesisAgent,
  type ResearchReport,
} from "./agents/synthesisAgent.js";
import {
  loadUploadRecord,
  buildUploadTableSchemaContext,
  migrateContextUploadToTable,
} from "./uploadProcessor.js";
import type { ResearchWidgetContext } from "../../types/researchWidgetContext.js";
import { getLoanAccessContext } from "../userLoanAccessService.js";

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

export type ResearchMode = "quick" | "deep";

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
  /** "quick" = single agent, no plan/synthesis; "deep" = full pipeline. Default "deep". */
  mode?: ResearchMode;
  // Pause mechanism
  pauseRequested: boolean;
  paused: boolean;
  _pauseResolver?: () => void;
  // Active SSE emitters (multiple clients can subscribe to the same session stream)
  _emitters: SSEEmitter[];
  _isRunning: boolean;
  // Sharing (in-app user picker)
  visibility?: string;
  sharedWithUserIds?: string[];
  // Upload attachments
  uploadIds?: string[];
  /** Client-snapshotted widget catalog for the analyst (COHI-366). */
  widgetContext?: ResearchWidgetContext;
}

export interface ResearchAccessPrincipal {
  userRole?: string;
  isSuperAdmin?: boolean;
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

function getPrimaryCategory(plan: ResearchPlan | undefined): string | null {
  const first = plan?.questions?.[0];
  return (first?.category as string) || null;
}

const SAVE_SESSION_WITH_CATEGORY_AND_WIDGET = `
  INSERT INTO research_sessions (id, tenant_id, user_id, user_email, topic, phase, plan, findings, report, events, follow_up_history, error, primary_category, upload_ids, widget_context, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, to_timestamp($16::double precision / 1000), NOW())
  ON CONFLICT (id) DO UPDATE SET
    phase = EXCLUDED.phase,
    plan = EXCLUDED.plan,
    findings = EXCLUDED.findings,
    report = EXCLUDED.report,
    events = EXCLUDED.events,
    follow_up_history = EXCLUDED.follow_up_history,
    error = EXCLUDED.error,
    primary_category = EXCLUDED.primary_category,
    upload_ids = EXCLUDED.upload_ids,
    widget_context = EXCLUDED.widget_context,
    updated_at = NOW()`;

const SAVE_SESSION_WITHOUT_CATEGORY_AND_WIDGET = `
  INSERT INTO research_sessions (id, tenant_id, user_id, user_email, topic, phase, plan, findings, report, events, follow_up_history, error, upload_ids, widget_context, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, to_timestamp($15::double precision / 1000), NOW())
  ON CONFLICT (id) DO UPDATE SET
    phase = EXCLUDED.phase,
    plan = EXCLUDED.plan,
    findings = EXCLUDED.findings,
    report = EXCLUDED.report,
    events = EXCLUDED.events,
    follow_up_history = EXCLUDED.follow_up_history,
    error = EXCLUDED.error,
    upload_ids = EXCLUDED.upload_ids,
    widget_context = EXCLUDED.widget_context,
    updated_at = NOW()`;

const SAVE_SESSION_WITH_CATEGORY = `
  INSERT INTO research_sessions (id, tenant_id, user_id, user_email, topic, phase, plan, findings, report, events, follow_up_history, error, primary_category, upload_ids, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, to_timestamp($15::double precision / 1000), NOW())
  ON CONFLICT (id) DO UPDATE SET
    phase = EXCLUDED.phase,
    plan = EXCLUDED.plan,
    findings = EXCLUDED.findings,
    report = EXCLUDED.report,
    events = EXCLUDED.events,
    follow_up_history = EXCLUDED.follow_up_history,
    error = EXCLUDED.error,
    primary_category = EXCLUDED.primary_category,
    upload_ids = EXCLUDED.upload_ids,
    updated_at = NOW()`;

const SAVE_SESSION_WITHOUT_CATEGORY = `
  INSERT INTO research_sessions (id, tenant_id, user_id, user_email, topic, phase, plan, findings, report, events, follow_up_history, error, upload_ids, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, to_timestamp($14::double precision / 1000), NOW())
  ON CONFLICT (id) DO UPDATE SET
    phase = EXCLUDED.phase,
    plan = EXCLUDED.plan,
    findings = EXCLUDED.findings,
    report = EXCLUDED.report,
    events = EXCLUDED.events,
    follow_up_history = EXCLUDED.follow_up_history,
    error = EXCLUDED.error,
    upload_ids = EXCLUDED.upload_ids,
    updated_at = NOW()`;

export async function saveSession(session: ResearchSession, tenantPool: pg.Pool): Promise<void> {
  const primaryCategory = getPrimaryCategory(session.plan);
  const uploadIdsJson = JSON.stringify(session.uploadIds || []);
  const widgetCtxJson = session.widgetContext ? JSON.stringify(session.widgetContext) : null;
  const paramsWithCategoryAndWidget = [
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
    primaryCategory,
    uploadIdsJson,
    widgetCtxJson,
    session.createdAt,
  ];
  const paramsWithoutCategoryAndWidget = [
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
    uploadIdsJson,
    widgetCtxJson,
    session.createdAt,
  ];
  const paramsWithCategory = [
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
    primaryCategory,
    uploadIdsJson,
    session.createdAt,
  ];
  const paramsWithoutCategory = [
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
    uploadIdsJson,
    session.createdAt,
  ];
  try {
    await tenantPool.query(SAVE_SESSION_WITH_CATEGORY_AND_WIDGET, paramsWithCategoryAndWidget);
  } catch (err: any) {
    const msg = err.message || "";
    if (msg.includes("widget_context") && msg.includes("does not exist")) {
      try {
        await tenantPool.query(SAVE_SESSION_WITH_CATEGORY, paramsWithCategory);
      } catch (err2: any) {
        if (err2.message?.includes("primary_category") && err2.message?.includes("does not exist")) {
          try {
            await tenantPool.query(SAVE_SESSION_WITHOUT_CATEGORY, paramsWithoutCategory);
          } catch (fallbackErr: any) {
            console.error(`[Research] Failed to save session ${session.id}:`, fallbackErr.message);
          }
        } else {
          console.error(`[Research] Failed to save session ${session.id}:`, err2.message);
        }
      }
    } else if (msg.includes("primary_category") && msg.includes("does not exist")) {
      try {
        await tenantPool.query(SAVE_SESSION_WITHOUT_CATEGORY_AND_WIDGET, paramsWithoutCategoryAndWidget);
      } catch (err3: any) {
        if (err3.message?.includes("widget_context") && err3.message?.includes("does not exist")) {
          try {
            await tenantPool.query(SAVE_SESSION_WITHOUT_CATEGORY, paramsWithoutCategory);
          } catch (fallbackErr: any) {
            console.error(`[Research] Failed to save session ${session.id}:`, fallbackErr.message);
          }
        } else {
          console.error(`[Research] Failed to save session ${session.id}:`, err3.message);
        }
      }
    } else {
      console.error(`[Research] Failed to save session ${session.id}:`, msg);
    }
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
    let widgetContext: ResearchWidgetContext | undefined;
    const rawWc = row.widget_context;
    if (rawWc != null) {
      if (typeof rawWc === "object" && rawWc !== null && "catalog" in rawWc) {
        widgetContext = rawWc as ResearchWidgetContext;
      } else if (typeof rawWc === "string") {
        try {
          widgetContext = JSON.parse(rawWc) as ResearchWidgetContext;
        } catch {
          widgetContext = undefined;
        }
      }
    }
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
      _emitters: [],
      _isRunning: false,
      visibility: row.visibility ?? "private",
      sharedWithUserIds: Array.isArray(row.shared_with_user_ids) ? row.shared_with_user_ids : [],
      uploadIds: Array.isArray(row.upload_ids) ? row.upload_ids : [],
      widgetContext,
    };

    sessions.set(session.id, session);
    return session;
  } catch (err: any) {
    console.error(`[Research] Failed to load session ${sessionId}:`, err.message);
    return undefined;
  }
}

const LIST_SESSIONS_WITH_CATEGORY = `
  SELECT id, topic, phase, primary_category, created_at, updated_at, (user_id = $1) AS is_owner
  FROM research_sessions
  WHERE user_id = $1
     OR visibility = 'global'
     OR (visibility = 'shared' AND $1 = ANY(shared_with_user_ids))
  ORDER BY updated_at DESC
  LIMIT 50`;

const LIST_SESSIONS_WITHOUT_CATEGORY = `
  SELECT id, topic, phase, created_at, updated_at, (user_id = $1) AS is_owner
  FROM research_sessions
  WHERE user_id = $1
     OR visibility = 'global'
     OR (visibility = 'shared' AND $1 = ANY(shared_with_user_ids))
  ORDER BY updated_at DESC
  LIMIT 50`;

export async function listSessions(
  tenantPool: pg.Pool,
  userId: string
): Promise<Array<{ id: string; topic: string | null; phase: string; primaryCategory: string | null; createdAt: string; updatedAt: string; isOwner: boolean }>> {
  try {
    let result: pg.QueryResult;
    try {
      result = await tenantPool.query(LIST_SESSIONS_WITH_CATEGORY, [userId]);
    } catch (colErr: any) {
      if (colErr.message?.includes("primary_category") && colErr.message?.includes("does not exist")) {
        result = await tenantPool.query(LIST_SESSIONS_WITHOUT_CATEGORY, [userId]);
      } else {
        throw colErr;
      }
    }
    return result.rows.map((r: any) => ({
      id: r.id,
      topic: r.topic,
      phase: r.phase,
      primaryCategory: r.primary_category ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      isOwner: r.is_owner ?? true,
    }));
  } catch (err: any) {
    console.error("[Research] Failed to list sessions:", err.message);
    return [];
  }
}

export async function updateSessionSharing(
  sessionId: string,
  tenantPool: pg.Pool,
  userId: string,
  visibility: string,
  sharedWithUserIds: string[]
): Promise<boolean> {
  try {
    const result = await tenantPool.query(
      `UPDATE research_sessions
       SET visibility = $1, shared_with_user_ids = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING id`,
      [["shared", "global"].includes(visibility) ? visibility : "private", sharedWithUserIds, sessionId, userId]
    );
    if (result.rows.length > 0) {
      const session = sessions.get(sessionId);
      if (session) {
        session.visibility = ["shared", "global"].includes(visibility) ? visibility as "shared" | "global" : "private";
        session.sharedWithUserIds = sharedWithUserIds;
      }
      return true;
    }
    return false;
  } catch (err: any) {
    console.error(`[Research] Failed to update sharing for session ${sessionId}:`, err.message);
    return false;
  }
}

export function canAccessSession(session: ResearchSession, userId: string): boolean {
  if (session.userId === userId) return true;
  if (session.visibility === "global") return true;
  if (session.visibility === "shared" && session.sharedWithUserIds?.includes(userId)) return true;
  return false;
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
// Cross-Session Context
// ============================================================================

const PRIOR_SESSION_SUMMARY_MAX_CHARS = 2000;

export async function getPriorSessionSummaries(
  tenantPool: pg.Pool,
  tenantId: string,
  excludeSessionId?: string
): Promise<string | undefined> {
  try {
    const result = await tenantPool.query(
      `SELECT id, topic, findings, created_at
       FROM research_sessions
       WHERE tenant_id = $1
         AND phase = 'complete'
         ${excludeSessionId ? "AND id != $2" : ""}
       ORDER BY updated_at DESC
       LIMIT 5`,
      excludeSessionId ? [tenantId, excludeSessionId] : [tenantId]
    );

    if (result.rows.length === 0) return undefined;

    let summary = "## Prior Research Sessions (for context — avoid re-investigating the same questions)\n";
    let totalChars = summary.length;

    for (const row of result.rows) {
      const dateStr = new Date(row.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const topicLabel = row.topic || "General analysis";
      const findings: Finding[] = row.findings || [];

      let entry = `\nSession (${dateStr}): "${topicLabel}"\n`;

      if (findings.length > 0) {
        entry += "  Findings:\n";
        for (const f of findings.slice(0, 4)) {
          entry += `  - ${f.title} [${f.confidence}]\n`;
          const topMetrics = Object.entries(f.keyMetrics || {}).slice(0, 3);
          if (topMetrics.length > 0) {
            entry += `    Metrics: ${topMetrics.map(([k, v]) => `${k}=${v}`).join(", ")}\n`;
          }
        }
        if (findings.length > 4) {
          entry += `  ... and ${findings.length - 4} more findings\n`;
        }
      }

      if (totalChars + entry.length > PRIOR_SESSION_SUMMARY_MAX_CHARS) break;
      summary += entry;
      totalChars += entry.length;
    }

    return summary;
  } catch (err: any) {
    console.error("[Research] Failed to fetch prior session summaries:", err.message);
    return undefined;
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
  initialContext?: InsightContext,
  mode: ResearchMode = "deep",
  uploadIds: string[] = [],
  widgetContext?: ResearchWidgetContext
): Promise<ResearchSession> {
  pruneExpiredSessions();

  // If no topic provided but we have initial context, derive a topic
  const derivedTopic = topic || (initialContext
    ? `Deep dive: ${initialContext.headline}`
    : undefined);

  // Pre-populate steering directive from insight context so the planner has prior knowledge (deep mode only)
  const steeringDirectives: string[] = [];
  if (mode === "deep" && initialContext) {
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
    mode,
    pauseRequested: false,
    paused: false,
    _emitters: [],
    _isRunning: false,
    uploadIds: uploadIds.length > 0 ? uploadIds : undefined,
    widgetContext:
      widgetContext &&
      (String(widgetContext.catalog || "").trim().length > 0 || (widgetContext.meta?.length ?? 0) > 0)
        ? widgetContext
        : undefined,
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

export function attachSessionEmitter(sessionId: string, emitter: SSEEmitter): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session._emitters.push(emitter);
  return true;
}

export function detachSessionEmitter(sessionId: string, emitter: SSEEmitter): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session._emitters = session._emitters.filter((candidate) => candidate !== emitter);
}

export function isSessionRunning(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  return !!session?._isRunning;
}

function emitSessionEvent(session: ResearchSession, event: SSEEvent): void {
  session.events.push(event);
  if (session._emitters.length === 0) return;

  const nextEmitters: SSEEmitter[] = [];
  for (const emitter of session._emitters) {
    try {
      emitter(event);
      nextEmitters.push(emitter);
    } catch {
      // Drop emitters that throw (usually disconnected clients).
    }
  }
  session._emitters = nextEmitters;
}

// ============================================================================
// Main Orchestration Pipeline
// ============================================================================

export async function runResearchPipeline(
  sessionId: string,
  tenantPool: pg.Pool,
  principal?: ResearchAccessPrincipal
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }
  if (session._isRunning) {
    console.log(`[Research] Session ${sessionId}: pipeline already running; skipping duplicate start`);
    return;
  }
  session._isRunning = true;
  const emit: SSEEmitter = (event) => emitSessionEvent(session, event);

  const isQuickMode = session.mode === "quick";

  try {
    const loanAccessCtx = await getLoanAccessContext(
      {
        userId: session.userId,
        userRole: principal?.userRole,
        isSuperAdmin: principal?.isSuperAdmin,
      },
      tenantPool
    );
    const loanAccessFilter = loanAccessCtx.getFilter();
    const apiKey = await getOpenAIKey(session.tenantId);
    const [schemaContext, metricDefs, knowledgeContext, priorSessionSummaries, businessKnowledge, trackedInsightContext] = await Promise.all([
      getSchemaContext(session.tenantId),
      Promise.resolve(getMetricDefinitions()),
      getKnowledgeContext(tenantPool, session.tenantId, session.topic),
      isQuickMode ? Promise.resolve("") : getPriorSessionSummaries(tenantPool, session.tenantId, session.id),
      Promise.resolve(getDerivedMetricContext()),
      getTrackedInsightContext(tenantPool),
    ]);

    // ── Load upload context (all uploads are table-backed → schema addendum only) ──
    let uploadSchemaAddendum = "";
    if (session.uploadIds && session.uploadIds.length > 0) {
      for (const uploadId of session.uploadIds) {
        try {
          const uploadRecord = await loadUploadRecord(uploadId, tenantPool);
          if (!uploadRecord) {
            console.warn(`[Research] Upload record ${uploadId} not found`);
            continue;
          }
          const rec = uploadRecord as typeof uploadRecord & { id: string; originalFileName: string };
          rec.id = uploadRecord.id;

          // Auto-migrate legacy context-strategy uploads to table
          if (!rec.tableName && rec.dataJson && rec.dataJson.length > 0) {
            console.log(`[Research] Migrating context-strategy upload ${uploadId} to table...`);
            const newTableName = await migrateContextUploadToTable(rec, tenantPool);
            if (newTableName) {
              rec.tableName = newTableName;
              rec.storageStrategy = "table";
              console.log(`[Research] Migrated upload ${uploadId} → table "${newTableName}"`);
            }
          }

          console.log(`[Research] Upload ${uploadId}: strategy=${rec.storageStrategy}, tableName=${rec.tableName}, file=${rec.originalFileName}`);
          uploadSchemaAddendum += buildUploadTableSchemaContext(rec);
        } catch (uploadErr: any) {
          console.warn(`[Research] Failed to load upload ${uploadId}:`, uploadErr.message);
        }
      }
      if (uploadSchemaAddendum) {
        console.log(`[Research] Upload schema addendum: ${uploadSchemaAddendum.length} chars`);
      } else {
        console.warn(`[Research] WARNING: ${session.uploadIds.length} upload(s) attached but schema addendum is empty`);
      }
    }

    const combinedSchemaContext = uploadSchemaAddendum
      ? `${schemaContext}\n\n${uploadSchemaAddendum}`
      : schemaContext;

    const enrichedKnowledgeContext = [knowledgeContext, priorSessionSummaries, trackedInsightContext]
      .filter(Boolean)
      .join("\n\n") || undefined;

    if (isQuickMode) {
      // ── Quick Answer: single data analyst, no plan, no synthesis ──
      let quickApproach = "Answer the user's question directly with one or more SQL queries. Produce a single finding with a clear title, summary, key metrics, and evidence tables. Be concise.";
      if (uploadSchemaAddendum) {
        quickApproach =
          "Answer the user's question directly. " +
          "One or more user-uploaded datasets are queryable as SQL tables (listed in the schema context as upload_... tables). " +
          "Use SQL to query them — they contain the full uploaded data. " +
          "Produce a finding with a clear title, summary, key metrics, and at least two evidence tables: " +
          "(1) a summary table with computed aggregates, and (2) a detail table with the most relevant individual rows. " +
          "Be concise.";
      }

      const quickQuestion: InvestigationQuestion = {
        id: 1,
        topic: session.topic || "Quick analysis",
        hypothesis: session.topic || "Answer the user's question directly.",
        approach: quickApproach,
        priority: "high",
        category: "performance",
      };

      session.phase = "investigating";
      emit({
        type: "phase",
        data: { phase: "investigating", message: "Getting your answer..." },
        timestamp: Date.now(),
      });

      emit({
        type: "agent_start",
        data: { questionId: 1, topic: quickQuestion.topic, category: quickQuestion.category },
        timestamp: Date.now(),
      });

      const onStep = (step: AgentStep) => {
        emit({
          type: `agent_${step.type}`,
          data: { questionId: 1, ...step },
          timestamp: step.timestamp,
        });
      };

      const getSteeringDirective = (): string | null => {
        if (session.steeringDirectives.length > 0) return session.steeringDirectives.shift()!;
        return null;
      };

      const checkPause = () => waitIfPaused(session, emit);

      const finding = await runDataAnalystAgent(
        quickQuestion,
        combinedSchemaContext,
        metricDefs,
        tenantPool,
        apiKey,
        onStep,
        getSteeringDirective,
        checkPause,
        enrichedKnowledgeContext,
        businessKnowledge,
        session.widgetContext ?? null,
        {
          tenantId: session.tenantId,
          loanAccessFilter,
        }
      );

      session.plan = { summary: "Quick answer", questions: [quickQuestion] };
      session.findings = [finding];
      emit({ type: "quick_result", data: finding, timestamp: Date.now() });
      emit({
        type: "agent_complete",
        data: { questionId: finding.questionId, title: finding.title, confidence: finding.confidence },
        timestamp: Date.now(),
      });

      session.phase = "complete";
      emit({
        type: "complete",
        data: { message: "Quick answer ready.", findingCount: 1, quickMode: true },
        timestamp: Date.now(),
      });

      await saveSession(session, tenantPool);
      console.log(`[Research] Session ${sessionId}: Quick answer complete`);
      return;
    }

    // ── Deep mode: full pipeline ──
    if (knowledgeContext) {
      console.log(`[Research] Session ${sessionId}: Knowledge base context loaded (${knowledgeContext.length} chars)`);
    }
    if (priorSessionSummaries) {
      console.log(`[Research] Session ${sessionId}: Prior session context loaded (${priorSessionSummaries.length} chars)`);
    }
    if (trackedInsightContext) {
      console.log(`[Research] Session ${sessionId}: Tracked insight context loaded (${trackedInsightContext.length} chars)`);
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

    const plan = await runPlannerAgent(combinedSchemaContext, metricDefs, apiKey, {
      topic: session.topic,
      knowledgeContext,
      priorInvestigationContext,
      priorSessionSummaries: priorSessionSummaries || undefined,
      businessKnowledge,
      uploadContext: uploadSchemaAddendum || undefined,
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
            question, combinedSchemaContext, metricDefs, tenantPool, apiKey,
            onStep, getSteeringDirective, checkPause, enrichedKnowledgeContext, businessKnowledge,
            session.widgetContext ?? null,
            {
              tenantId: session.tenantId,
              loanAccessFilter,
            }
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

    const report = await runSynthesisAgent(plan, allFindings, apiKey, session.topic, businessKnowledge);
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
    session._isRunning = false;
  }
}

// ============================================================================
// Follow-up Investigation
// ============================================================================

export async function runFollowUp(
  sessionId: string,
  question: string,
  tenantPool: pg.Pool,
  principal?: ResearchAccessPrincipal
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }
  if (session._isRunning) {
    emitSessionEvent(session, { type: "error", data: { message: "Session is currently running another investigation" }, timestamp: Date.now() });
    return;
  }

  if (session.phase !== "complete") {
    emitSessionEvent(session, { type: "error", data: { message: "Session must be complete before asking follow-ups" }, timestamp: Date.now() });
    return;
  }
  session._isRunning = true;
  const emit: SSEEmitter = (event) => emitSessionEvent(session, event);

  session.phase = "followup" as SessionPhase;

  emit({
    type: "phase",
    data: { phase: "followup", message: `Investigating follow-up: "${question.substring(0, 80)}"...` },
    timestamp: Date.now(),
  });

  try {
    const loanAccessCtx = await getLoanAccessContext(
      {
        userId: session.userId,
        userRole: principal?.userRole,
        isSuperAdmin: principal?.isSuperAdmin,
      },
      tenantPool
    );
    const loanAccessFilter = loanAccessCtx.getFilter();
    const apiKey = await getOpenAIKey(session.tenantId);
    const [schemaContext, metricDefs, knowledgeContext, trackedInsightCtx] = await Promise.all([
      getSchemaContext(session.tenantId),
      Promise.resolve(getMetricDefinitions()),
      getKnowledgeContext(tenantPool, session.tenantId, question),
      getTrackedInsightContext(tenantPool),
    ]);

    const businessKnowledge = getDerivedMetricContext();

    // Re-load upload context for this session so follow-ups can still reference uploaded data
    let followUpUploadSchemaAddendum = "";
    if (session.uploadIds && session.uploadIds.length > 0) {
      for (const uploadId of session.uploadIds) {
        try {
          const uploadRecord = await loadUploadRecord(uploadId, tenantPool);
          if (!uploadRecord) continue;
          const rec = uploadRecord as typeof uploadRecord & { id: string; originalFileName: string };
          rec.id = uploadRecord.id;
          if (!rec.tableName && rec.dataJson && rec.dataJson.length > 0) {
            const newTableName = await migrateContextUploadToTable(rec, tenantPool);
            if (newTableName) {
              rec.tableName = newTableName;
              rec.storageStrategy = "table";
            }
          }
          followUpUploadSchemaAddendum += buildUploadTableSchemaContext(rec);
        } catch {
          // Skip failed uploads
        }
      }
    }

    const followUpSchemaContext = followUpUploadSchemaAddendum
      ? `${schemaContext}\n\n${followUpUploadSchemaAddendum}`
      : schemaContext;

    const enrichedFollowUpContext = [knowledgeContext, trackedInsightCtx]
      .filter(Boolean)
      .join("\n\n") || undefined;

    // Build context from existing findings
    const existingContext = session.findings
      .map((f) => `- ${f.title}: ${f.summary}`)
      .join("\n");

    let followUpApproach = `Use the existing findings as context:\n${existingContext}\n\nInvestigate the user's specific question with targeted SQL queries.`;
    if (followUpUploadSchemaAddendum) {
      followUpApproach =
        `Use the existing findings as context:\n${existingContext}\n\n` +
        `Investigate the user's specific question. ` +
        `One or more user-uploaded datasets are queryable as SQL tables (listed in the schema context as upload_... tables). ` +
        `Use SQL to query them for precise results. ` +
        `Produce at least two evidence tables: (1) a summary with aggregates, and (2) detail rows.`;
    }

    const followUpQuestion = {
      id: 900 + session.followUpHistory.length,
      topic: question,
      hypothesis: `Follow-up investigation based on user question: "${question}"`,
      approach: followUpApproach,
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
      followUpQuestion, followUpSchemaContext, metricDefs, tenantPool, apiKey,
      onStep, getSteeringDirective, checkPause, enrichedFollowUpContext, businessKnowledge,
      session.widgetContext ?? null,
      {
        tenantId: session.tenantId,
        loanAccessFilter,
      }
    );

    session.findings.push(finding);
    session.followUpHistory.push({ question, finding, timestamp: Date.now() });

    emit({
      type: "agent_complete",
      data: { questionId: finding.questionId, title: finding.title, confidence: finding.confidence },
      timestamp: Date.now(),
    });

    // Re-synthesize the report with all findings (original + follow-ups)
    if (session.plan && session.findings.length > 0) {
      session.phase = "synthesizing" as SessionPhase;
      emit({
        type: "phase",
        data: { phase: "synthesizing", message: "Updating report with new findings..." },
        timestamp: Date.now(),
      });

      try {
        const updatedReport = await runSynthesisAgent(
          session.plan, session.findings, apiKey, session.topic, businessKnowledge
        );
        session.report = updatedReport;
        emit({ type: "synthesis", data: updatedReport, timestamp: Date.now() });
      } catch (synthErr: any) {
        console.warn(`[Research] Follow-up re-synthesis failed (non-fatal): ${synthErr.message}`);
      }
    }

    session.phase = "complete";
    emit({
      type: "complete",
      data: { message: "Follow-up investigation complete.", findingCount: session.findings.length },
      timestamp: Date.now(),
    });

    await saveSession(session, tenantPool);
  } catch (err: any) {
    session.phase = "complete"; // Revert to complete on followup error
    console.error(`[Research] Follow-up error for session ${sessionId}:`, err);
    emit({ type: "error", data: { message: err.message }, timestamp: Date.now() });
  } finally {
    session._isRunning = false;
  }
}
