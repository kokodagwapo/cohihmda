/**
 * Analytics API: event ingestion (POST) and reporting (GET, admin-only).
 */

import { Router } from "express";
import { z } from "zod";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { pool as managementPool } from "../config/managementDatabase.js";
import {
  ingestEvents,
  upsertSession,
  storeReplayChunk,
  type AnalyticsSessionPayload,
  type AnalyticsEventPayload,
} from "../services/analyticsService.js";
import {
  getPageViews,
  getTopPages,
  getUserJourney,
  getFunnelAnalysis,
  getClickHeatmapData,
  getSessionList,
  getSessionDetail,
  getReplayChunk,
  getActiveUsers,
  getFeatureUsage,
} from "../services/analyticsQueryService.js";

const router = Router();

const requireAnalyticsAdmin = requireRole("super_admin", "platform_admin", "tenant_admin", "admin");

/** Resolve tenant ID for analytics: JWT tenant for tenant users, or query param for platform admins. */
async function resolveAnalyticsTenantId(req: AuthRequest): Promise<string | null> {
  const isPlatform = req.userRole === "super_admin" || req.userRole === "platform_admin";
  const queryTenantId = typeof req.query.tenantId === "string" ? req.query.tenantId.trim() : null;
  if (isPlatform && queryTenantId) {
    const r = await managementPool.query("SELECT id FROM coheus_tenants WHERE id = $1 OR slug = $1", [
      queryTenantId,
    ]);
    if (r.rows.length > 0) return String(r.rows[0].id);
  }
  return req.tenantId ?? null;
}

const eventPayloadSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  tenantId: z.string(),
  eventType: z.string(),
  eventName: z.string().nullable().optional(),
  pageUrl: z.string().nullable().optional(),
  pagePath: z.string().nullable().optional(),
  referrerPath: z.string().nullable().optional(),
  elementTag: z.string().nullable().optional(),
  elementId: z.string().nullable().optional(),
  elementText: z.string().nullable().optional(),
  elementSelector: z.string().nullable().optional(),
  clickX: z.number().nullable().optional(),
  clickY: z.number().nullable().optional(),
  viewportWidth: z.number().nullable().optional(),
  viewportHeight: z.number().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  durationMs: z.number().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

const batchEventsSchema = z.object({ events: z.array(eventPayloadSchema) });

/**
 * POST /api/analytics/events
 * Ingest a batch of analytics events. Auth required; events must match current user/tenant.
 */
router.post("/events", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const parse = batchEventsSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid payload", details: parse.error.flatten() });
    }
    const { events } = parse.data;
    const userId = req.userId;
    const tenantId = req.tenantId;
    if (!userId || !tenantId) return res.status(401).json({ error: "Unauthorized" });
    for (const e of events) {
      if (e.userId !== userId || e.tenantId !== tenantId) {
        return res.status(403).json({ error: "Event user/tenant must match authenticated user" });
      }
    }
    await ingestEvents(events as AnalyticsEventPayload[]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to ingest events" });
  }
});

/**
 * POST /api/analytics/session
 * Upsert session (start or update with end/duration). Auth required.
 */
router.post("/session", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      id: z.string(),
      startedAt: z.string(),
      endedAt: z.string().nullable().optional(),
      pageCount: z.number().optional(),
      eventCount: z.number().optional(),
      deviceType: z.string().nullable().optional(),
      browser: z.string().nullable().optional(),
      os: z.string().nullable().optional(),
      screenWidth: z.number().nullable().optional(),
      screenHeight: z.number().nullable().optional(),
      entryPage: z.string().nullable().optional(),
      exitPage: z.string().nullable().optional(),
      durationMs: z.number().nullable().optional(),
    });
    const parse = schema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid payload", details: parse.error.flatten() });
    }
    const userId = req.userId;
    const tenantId = req.tenantId;
    if (!userId || !tenantId) return res.status(401).json({ error: "Unauthorized" });
    const session: AnalyticsSessionPayload = {
      ...parse.data,
      userId,
      tenantId,
    } as AnalyticsSessionPayload;
    await upsertSession(session);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to upsert session" });
  }
});

/**
 * POST /api/analytics/replay
 * Store one rrweb replay chunk. Auth required.
 */
router.post("/replay", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      sessionId: z.string(),
      chunkIndex: z.number(),
      eventsData: z.array(z.unknown()),
    });
    const parse = schema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid payload", details: parse.error.flatten() });
    }
    const userId = req.userId;
    const tenantId = req.tenantId;
    if (!userId || !tenantId) return res.status(401).json({ error: "Unauthorized" });
    await storeReplayChunk(
      parse.data.sessionId,
      userId,
      tenantId,
      parse.data.chunkIndex,
      parse.data.eventsData
    );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to store replay chunk" });
  }
});

// ----- Read endpoints (admin-only) -----

router.get("/page-views", authenticateToken, requireAnalyticsAdmin, async (req: AuthRequest, res) => {
  try {
    const tenantId = await resolveAnalyticsTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
    const start = typeof req.query.start === "string" ? req.query.start : undefined;
    const end = typeof req.query.end === "string" ? req.query.end : undefined;
    const groupByPath = req.query.groupByPath === "true";
    if (!start || !end) {
      return res.status(400).json({ error: "Query params start and end (ISO date) required" });
    }
    const data = await getPageViews(tenantId, { start, end }, groupByPath);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to get page views" });
  }
});

router.get("/top-pages", authenticateToken, requireAnalyticsAdmin, async (req: AuthRequest, res) => {
  try {
    const tenantId = await resolveAnalyticsTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
    const start = typeof req.query.start === "string" ? req.query.start : undefined;
    const end = typeof req.query.end === "string" ? req.query.end : undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    if (!start || !end) {
      return res.status(400).json({ error: "Query params start and end (ISO date) required" });
    }
    const data = await getTopPages(tenantId, { start, end }, limit);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to get top pages" });
  }
});

router.get("/sessions", authenticateToken, requireAnalyticsAdmin, async (req: AuthRequest, res) => {
  try {
    const tenantId = await resolveAnalyticsTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    const start = typeof req.query.start === "string" ? req.query.start : undefined;
    const end = typeof req.query.end === "string" ? req.query.end : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const data = await getSessionList(tenantId, { userId, start, end, limit });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to get sessions" });
  }
});

router.get("/sessions/:id", authenticateToken, requireAnalyticsAdmin, async (req: AuthRequest, res) => {
  try {
    const tenantId = await resolveAnalyticsTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!sessionId) return res.status(400).json({ error: "Session ID required" });
    const { session, replayChunkIndices } = await getSessionDetail(tenantId, sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ session, replayChunkIndices });
  } catch (err) {
    res.status(500).json({ error: "Failed to get session" });
  }
});

router.get(
  "/sessions/:id/replay/:chunkIndex",
  authenticateToken,
  requireAnalyticsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = await resolveAnalyticsTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
      const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!sessionId) return res.status(400).json({ error: "Session ID required" });
      const chunkIndex = parseInt(Array.isArray(req.params.chunkIndex) ? req.params.chunkIndex[0] : req.params.chunkIndex, 10);
      if (Number.isNaN(chunkIndex)) return res.status(400).json({ error: "Invalid chunk index" });
      const events = await getReplayChunk(tenantId, sessionId, chunkIndex);
      if (events === null) return res.status(404).json({ error: "Chunk not found" });
      res.json({ events });
    } catch (err) {
      res.status(500).json({ error: "Failed to get replay chunk" });
    }
  }
);

router.get(
  "/user/:userId/journey",
  authenticateToken,
  requireAnalyticsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = await resolveAnalyticsTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
      const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
      if (!userId) return res.status(400).json({ error: "User ID required" });
      const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : null;
      const data = await getUserJourney(tenantId, userId, sessionId);
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: "Failed to get user journey" });
    }
  }
);

router.get("/funnels", authenticateToken, requireAnalyticsAdmin, async (req: AuthRequest, res) => {
  try {
    const tenantId = await resolveAnalyticsTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
    const start = typeof req.query.start === "string" ? req.query.start : undefined;
    const end = typeof req.query.end === "string" ? req.query.end : undefined;
    let steps: string[] = [];
    if (typeof req.query.steps === "string") {
      try {
        steps = JSON.parse(req.query.steps) as string[];
      } catch {
        steps = req.query.steps.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } else if (Array.isArray(req.query.steps)) {
      steps = (req.query.steps as string[]).filter(Boolean);
    }
    if (!start || !end) {
      return res.status(400).json({ error: "Query params start and end (ISO date) required" });
    }
    const data = await getFunnelAnalysis(tenantId, steps, { start, end });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to get funnel analysis" });
  }
});

router.get("/heatmap", authenticateToken, requireAnalyticsAdmin, async (req: AuthRequest, res) => {
  try {
    const tenantId = await resolveAnalyticsTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
    const pagePath = typeof req.query.pagePath === "string" ? req.query.pagePath : "";
    const start = typeof req.query.start === "string" ? req.query.start : undefined;
    const end = typeof req.query.end === "string" ? req.query.end : undefined;
    if (!pagePath || !start || !end) {
      return res.status(400).json({ error: "Query params pagePath, start and end required" });
    }
    const data = await getClickHeatmapData(tenantId, pagePath, { start, end });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to get heatmap data" });
  }
});

router.get("/active-users", authenticateToken, requireAnalyticsAdmin, async (req: AuthRequest, res) => {
  try {
    const tenantId = await resolveAnalyticsTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
    const period = (req.query.period as "day" | "week" | "month") || "day";
    if (!["day", "week", "month"].includes(period)) {
      return res.status(400).json({ error: "period must be day, week, or month" });
    }
    const data = await getActiveUsers(tenantId, period);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to get active users" });
  }
});

router.get("/feature-usage", authenticateToken, requireAnalyticsAdmin, async (req: AuthRequest, res) => {
  try {
    const tenantId = await resolveAnalyticsTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "Tenant context required" });
    const start = typeof req.query.start === "string" ? req.query.start : undefined;
    const end = typeof req.query.end === "string" ? req.query.end : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    if (!start || !end) {
      return res.status(400).json({ error: "Query params start and end (ISO date) required" });
    }
    const data = await getFeatureUsage(tenantId, { start, end }, limit);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to get feature usage" });
  }
});

export default router;
