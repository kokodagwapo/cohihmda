/**
 * Research Routes
 *
 * API endpoints for the Research Analyst agentic system.
 *
 * GET  /sessions              — List user's sessions
 * POST /sessions              — Create a new research session
 * GET  /sessions/:id          — Get session status/results
 * GET  /sessions/:id/stream   — SSE: run investigation and stream events
 * POST /sessions/:id/steer    — Inject user steering mid-investigation
 * POST /sessions/:id/pause    — Pause the investigation gracefully
 * POST /sessions/:id/resume   — Resume paused investigation
 * POST /sessions/:id/followup — SSE: run follow-up question
 * POST /sessions/:id/feedback — Submit feedback on a step/finding/session
 * DELETE /sessions/:id        — Delete a session
 */

import { Router, type Response } from "express";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import { attachTenantContext, getTenantContext } from "../middleware/tenantContext.js";
import { requirePlatformStaff } from "../middleware/rbac.js";
import { pool as managementPool } from "../config/managementDatabase.js";
import {
  createSession,
  getSession,
  loadSession,
  listSessions,
  deleteSession,
  addSteeringDirective,
  pauseSession,
  resumeSession,
  runResearchPipeline,
  runFollowUp,
  attachSessionEmitter,
  detachSessionEmitter,
  isSessionRunning,
  updateSessionSharing,
  canAccessSession,
  type SSEEvent,
} from "../services/research/orchestrator.js";
import type { ResearchWidgetContext } from "../types/researchWidgetContext.js";
import { startSSEHeartbeat } from "../utils/sseUtils.js";
import uploadRoutes from "./research/uploads.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

const router = Router();

// Mount upload sub-routes at /uploads
router.use("/uploads", uploadRoutes);

// ============================================================================
// Helper: set up SSE response
// ============================================================================

function setupSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function sseEmitter(res: Response) {
  return (event: SSEEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

// ============================================================================
// GET /sessions — List user's sessions
// ============================================================================

router.get(
  "/sessions",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId || "";
      const sessions = await listSessions(tenantPool, userId);
      res.json(sessions);
    } catch (err: any) {
      console.error("[Research] Error listing sessions:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// POST /sessions — Create a new research session
// ============================================================================

router.post(
  "/sessions",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool, tenantId } = getTenantContext(req);
      const { topic, initialContext, mode, uploadIds, widgetCatalog, widgetCatalogMeta } = req.body || {};
      const userId = req.userId || "";
      const userEmail = req.userEmail || "";
      const researchMode = mode === "quick" ? "quick" : "deep";

      let researchWidgetContext: ResearchWidgetContext | undefined;
      if (typeof widgetCatalog === "string" && widgetCatalog.trim().length > 0) {
        researchWidgetContext = {
          catalog: widgetCatalog,
          meta: Array.isArray(widgetCatalogMeta) ? widgetCatalogMeta : [],
        };
      }

      const session = await createSession(
        tenantId,
        userId,
        userEmail,
        tenantPool,
        topic || undefined,
        initialContext || undefined,
        researchMode,
        Array.isArray(uploadIds) ? uploadIds : [],
        researchWidgetContext
      );

      console.log(`[Research] Created session ${session.id} for tenant ${tenantId}${topic ? `, topic: "${topic}"` : ""}${initialContext ? " (from insight)" : ""}${uploadIds?.length ? ` with ${uploadIds.length} uploads` : ""}`);

      res.json({
        sessionId: session.id,
        phase: session.phase,
        topic: session.topic,
        createdAt: session.createdAt,
        uploadIds: session.uploadIds || [],
      });
    } catch (err: any) {
      console.error("[Research] Error creating session:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// GET /sessions/:id/stream — SSE: run the investigation pipeline
// ============================================================================

router.get(
  "/sessions/:id/stream",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { tenantPool } = getTenantContext(req);
    const session = getSession(id) || await loadSession(id, tenantPool);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    setupSSE(res);
    const stopHeartbeat = startSSEHeartbeat(res);

    // Replay existing events on reconnect
    if (session.events.length > 0) {
      for (const event of session.events) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (session.phase === "complete" || session.phase === "error") {
        stopHeartbeat();
        res.end();
        return;
      }
    }

    const baseEmitter = sseEmitter(res);
    let emit: (event: SSEEvent) => void = () => {};
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      detachSessionEmitter(id, emit);
      stopHeartbeat();
      if (!res.writableEnded) {
        res.end();
      }
    };

    emit = (event: SSEEvent) => {
      try {
        baseEmitter(event);
        if (event.type === "complete" || event.type === "error") {
          cleanup();
        }
      } catch {
        cleanup();
      }
    };
    attachSessionEmitter(id, emit);

    req.on("close", () => {
      cleanup();
      console.log(`[Research] Client disconnected from session ${id}`);
    });

    res.write(`data: ${JSON.stringify({ type: "heartbeat", data: { sessionId: id }, timestamp: Date.now() })}\n\n`);

    if (!isSessionRunning(id) && session.phase !== "complete" && session.phase !== "error") {
      runResearchPipeline(id, tenantPool).catch((err: any) => {
        console.error(`[Research] Pipeline failed for session ${id}:`, err);
      });
    }
  }
);

// ============================================================================
// POST /sessions/:id/steer — Inject user direction
// ============================================================================

router.post(
  "/sessions/:id/steer",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { message } = req.body || {};

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const success = addSteeringDirective(id, message);
    if (!success) {
      const session = getSession(id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
      } else {
        res.status(400).json({ error: "Session is no longer running" });
      }
      return;
    }

    console.log(`[Research] Steering directive added to session ${id}: "${message.substring(0, 80)}"`);
    res.json({ acknowledged: true });
  }
);

// ============================================================================
// POST /sessions/:id/pause — Graceful pause
// ============================================================================

router.post(
  "/sessions/:id/pause",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const success = pauseSession(id);
    if (!success) {
      res.status(400).json({ error: "Cannot pause this session" });
      return;
    }
    res.json({ paused: true });
  }
);

// ============================================================================
// POST /sessions/:id/resume — Resume from pause
// ============================================================================

router.post(
  "/sessions/:id/resume",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const success = resumeSession(id);
    if (!success) {
      res.status(400).json({ error: "Cannot resume this session" });
      return;
    }
    res.json({ resumed: true });
  }
);

// ============================================================================
// POST /sessions/:id/followup — SSE: run a follow-up question
// ============================================================================

router.post(
  "/sessions/:id/followup",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { question } = req.body || {};

    if (!question || typeof question !== "string") {
      res.status(400).json({ error: "question is required" });
      return;
    }

    const { tenantPool } = getTenantContext(req);
    const session = getSession(id) || await loadSession(id, tenantPool);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.phase !== "complete") {
      res.status(400).json({ error: "Session must be complete before asking follow-ups" });
      return;
    }

    setupSSE(res);
    const stopHeartbeat = startSSEHeartbeat(res);
    const baseEmitter = sseEmitter(res);
    let emit: (event: SSEEvent) => void = () => {};
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      detachSessionEmitter(id, emit);
      stopHeartbeat();
      if (!res.writableEnded) {
        res.end();
      }
    };
    emit = (event: SSEEvent) => {
      try {
        baseEmitter(event);
        if (event.type === "complete" || event.type === "error") {
          cleanup();
        }
      } catch {
        cleanup();
      }
    };
    attachSessionEmitter(id, emit);

    req.on("close", () => {
      cleanup();
    });

    runFollowUp(id, question, tenantPool).catch((err: any) => {
      console.error(`[Research] Follow-up failed for session ${id}:`, err);
    });
  }
);

// ============================================================================
// POST /sessions/:id/feedback — Submit feedback
// ============================================================================

router.post(
  "/sessions/:id/feedback",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { targetType, targetId, rating, comment, contextSnapshot } = req.body || {};

    if (!targetType || !["step", "finding", "session"].includes(targetType)) {
      res.status(400).json({ error: "targetType must be 'step', 'finding', or 'session'" });
      return;
    }

    const { tenantPool } = getTenantContext(req);
    const userId = req.userId || "";
    const userEmail = req.userEmail || "";

    try {
      const result = await tenantPool.query(
        `INSERT INTO research_feedback (session_id, target_type, target_id, user_id, user_email, rating, comment, context_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [id, targetType, targetId || null, userId, userEmail, rating || null, comment || null, contextSnapshot ? JSON.stringify(contextSnapshot) : null]
      );

      res.json({ feedbackId: result.rows[0].id, success: true });
    } catch (err: any) {
      console.error("[Research] Error saving feedback:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// POST /sessions/:id/feedback/:feedbackId/curate — Promote to training example
// ============================================================================

router.post(
  "/sessions/:id/feedback/:feedbackId/curate",
  authenticateToken,
  requirePlatformStaff(),
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const { feedbackId } = req.params;
    const { promptId, exampleType, headline, understory, adminNote } = req.body || {};
    const userId = req.userId || "";

    if (!promptId || !exampleType || !headline) {
      res.status(400).json({ error: "promptId, exampleType, and headline are required" });
      return;
    }

    try {
      if (!managementPool) {
        res.status(500).json({ error: "Management database not available" });
        return;
      }

      await managementPool.query(
        `INSERT INTO insight_training_examples (prompt_id, example_type, headline, understory, admin_note, curated_by, feedback_rating, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [
          promptId,
          exampleType,
          headline,
          understory || null,
          adminNote || null,
          userId,
          exampleType === "positive" ? 1 : -1,
        ]
      );

      res.json({ success: true });
    } catch (err: any) {
      console.error("[Research] Error curating training example:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// GET /sessions/:id — Get session status (for page reload / reconnect)
// ============================================================================

router.get(
  "/sessions/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const userId = req.userId || "";
    const { tenantPool } = getTenantContext(req);
    const session = getSession(id) || await loadSession(id, tenantPool);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (!canAccessSession(session, userId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json({
      id: session.id,
      tenantId: session.tenantId,
      topic: session.topic,
      phase: session.phase,
      plan: session.plan,
      findings: session.findings,
      report: session.report,
      events: session.events,
      followUpHistory: session.followUpHistory,
      error: session.error,
      createdAt: session.createdAt,
      visibility: session.visibility ?? "private",
      sharedWithUserIds: session.sharedWithUserIds ?? [],
    });
  }
);

// ============================================================================
// PUT /sessions/:id/sharing — Update session visibility and shared users
// ============================================================================

router.put(
  "/sessions/:id/sharing",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const userId = req.userId || "";
    const { visibility, shared_with_user_ids: sharedWithUserIds } = req.body || {};
    const { tenantPool } = getTenantContext(req);

    const GLOBAL_VISIBILITY_ROLES = ['super_admin', 'platform_admin', 'tenant_admin'];
    let validVisibility: string = ["shared", "global"].includes(visibility) ? visibility : "private";

    if (validVisibility === "global" && !GLOBAL_VISIBILITY_ROLES.includes(req.userRole || "")) {
      return res.status(403).json({ error: "Only admins can set global visibility" });
    }

    const ids = Array.isArray(sharedWithUserIds) ? sharedWithUserIds.filter((x: unknown) => typeof x === "string") : [];

    const success = await updateSessionSharing(id, tenantPool, userId, validVisibility, ids);
    if (success) {
      res.json({ success: true, visibility: validVisibility, sharedWithUserIds: ids });
    } else {
      res.status(404).json({ error: "Session not found or you are not the owner" });
    }
  }
);

// ============================================================================
// DELETE /sessions/:id — Delete a session
// ============================================================================

/** Roles that may delete any session regardless of ownership */
const FULL_SESSION_ACCESS_ROLES = ['super_admin', 'platform_admin'];

router.delete(
  "/sessions/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const userId = req.userId || "";
    const { tenantPool } = getTenantContext(req);

    const hasFullAccess = FULL_SESSION_ACCESS_ROLES.includes(req.userRole || "");

    if (!hasFullAccess) {
      const session = getSession(id) || await loadSession(id, tenantPool);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      if (session.userId !== userId) {
        res.status(403).json({ error: "You do not have permission to delete this session" });
        return;
      }
    }

    // Cascade: drop any upload temp tables linked to this session
    try {
      const uploadResult = await tenantPool.query(
        `SELECT id, table_name, storage_strategy FROM research_uploads WHERE session_id = $1`,
        [id]
      );
      const { dropUploadTable: dropTable } = await import("../services/research/uploadProcessor.js");
      for (const row of uploadResult.rows) {
        if (row.storage_strategy === "table" && row.table_name) {
          await dropTable(row.table_name, tenantPool);
        }
      }
      if (uploadResult.rows.length > 0) {
        await tenantPool.query(`DELETE FROM research_uploads WHERE session_id = $1`, [id]);
      }
    } catch (cleanupErr: any) {
      console.warn(`[Research] Upload cleanup error for session ${id}:`, cleanupErr.message);
    }

    const success = await deleteSession(id, tenantPool);
    if (success) {
      res.json({ deleted: true });
    } else {
      res.status(500).json({ error: "Failed to delete session" });
    }
  }
);

// ============================================================================
// POST /artifacts — Persist a Research Lab SQL artifact for tracking / reuse
// ============================================================================
//
// Created when a user bookmarks a research insight whose supporting findings
// have SQL evidence. The artifact captures the SQL + key fields so the
// watchlist evaluator can re-run the metric, and so future Workbench widgets
// can rehydrate the same query. Backed by migration 111
// (`research_artifacts` + `tracked_insights.research_artifact_id`).
//
// The matching frontend call is `api.createResearchArtifact` in `src/lib/api.ts`.
// Schema (COHI-362):
//   { id, user_id, session_id, headline_fingerprint, sql, key_fields,
//     title, viz_config, explanation, created_at, updated_at }

router.post(
  "/artifacts",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId || "";
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const body = (req.body ?? {}) as {
        session_id?: unknown;
        sql?: unknown;
        keyFields?: unknown;
        title?: unknown;
        explanation?: unknown;
        headline_fingerprint?: unknown;
        viz_config?: unknown;
      };

      const sessionId =
        typeof body.session_id === "string" ? body.session_id.trim() : "";
      const sql = typeof body.sql === "string" ? body.sql.trim() : "";
      if (!sessionId) {
        res.status(400).json({ error: "session_id is required" });
        return;
      }
      if (!sql) {
        res.status(400).json({ error: "sql is required" });
        return;
      }

      const keyFields: string[] = Array.isArray(body.keyFields)
        ? body.keyFields
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim())
            .filter((k) => k.length > 0)
        : [];

      // Session-scoped ownership: only the session owner (or platform staff)
      // may attach artifacts to it. Mirrors the DELETE /sessions/:id check.
      const hasFullAccess = FULL_SESSION_ACCESS_ROLES.includes(
        req.userRole || "",
      );
      if (!hasFullAccess) {
        const session =
          getSession(sessionId) || (await loadSession(sessionId, tenantPool));
        if (!session) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        if (session.userId !== userId) {
          res
            .status(403)
            .json({ error: "You do not have permission to add artifacts to this session" });
          return;
        }
      }

      const titleRaw = typeof body.title === "string" ? body.title : null;
      const title = titleRaw ? titleRaw.slice(0, 500) : null;
      const explanationRaw =
        typeof body.explanation === "string" ? body.explanation : null;
      const explanation = explanationRaw ? explanationRaw.slice(0, 8000) : null;
      const headlineFingerprint =
        typeof body.headline_fingerprint === "string"
          ? body.headline_fingerprint.slice(0, 1000)
          : null;
      const vizConfig =
        body.viz_config && typeof body.viz_config === "object" && !Array.isArray(body.viz_config)
          ? (body.viz_config as Record<string, unknown>)
          : null;

      const insertResult = await tenantPool.query(
        `INSERT INTO research_artifacts
           (user_id, session_id, headline_fingerprint, sql, key_fields, title, viz_config, explanation)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
         RETURNING id`,
        [
          userId,
          sessionId,
          headlineFingerprint,
          sql,
          JSON.stringify(keyFields),
          title,
          vizConfig ? JSON.stringify(vizConfig) : null,
          explanation,
        ],
      );

      const id = insertResult.rows[0]?.id as string | undefined;
      if (!id) {
        res.status(500).json({ error: "Failed to create research artifact" });
        return;
      }
      res.json({ id });
    } catch (err: any) {
      console.error("[Research] Error creating artifact:", err);
      res.status(500).json({ error: err?.message || "Failed to create research artifact" });
    }
  },
);

// ============================================================================
// GET /artifacts/:id — Fetch a stored Research Lab SQL artifact
// ============================================================================
//
// Used by Workbench / canvas surfaces that rehydrate a saved research widget
// from the artifact id (e.g. after migrating a tracked insight detail view).

router.get(
  "/artifacts/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId || "";
      const id = req.params.id as string;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        res.status(400).json({ error: "Invalid artifact id" });
        return;
      }

      const hasFullAccess = FULL_SESSION_ACCESS_ROLES.includes(
        req.userRole || "",
      );
      const result = hasFullAccess
        ? await tenantPool.query(
            `SELECT id, user_id, session_id, headline_fingerprint, sql, key_fields,
                    title, viz_config, explanation, created_at, updated_at
             FROM research_artifacts
             WHERE id = $1::uuid`,
            [id],
          )
        : await tenantPool.query(
            `SELECT id, user_id, session_id, headline_fingerprint, sql, key_fields,
                    title, viz_config, explanation, created_at, updated_at
             FROM research_artifacts
             WHERE id = $1::uuid AND user_id = $2`,
            [id, userId],
          );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Research artifact not found" });
        return;
      }
      res.json(result.rows[0]);
    } catch (err: any) {
      console.error("[Research] Error fetching artifact:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch research artifact" });
    }
  },
);

export default router;
