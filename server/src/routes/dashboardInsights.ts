/**
 * Dashboard Insights API
 *
 * GET  /api/dashboard-insights     — load stored insights for a page + filter subset
 * POST /api/dashboard-insights/generate — run on-demand generation for a page + filters
 *
 * Phase 1–2: no post-sync hook; generation is on-demand only.
 */

import { Router } from "express";
import { z } from "zod";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { attachTenantContext, getTenantContext } from "../middleware/tenantContext.js";
import {
  loadDashboardInsights,
  runDashboardInsightsForPage,
} from "../services/dashboardInsights/index.js";

const router = Router();

const getQuerySchema = z.object({
  pageId: z.string().min(1),
  datePeriod: z.string().optional(),
  channelGroup: z.string().optional(),
});

const generateBodySchema = z.object({
  pageId: z.string().min(1),
  filters: z.record(z.unknown()).optional(),
});

const feedbackBodySchema = z.object({
  insightId: z.number().int().positive(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  tags: z.array(z.string()).optional(),
  comment: z.string().optional(),
});

/**
 * GET /api/dashboard-insights
 * Query: pageId, datePeriod?, channelGroup?, ...
 * Returns stored insights + generatedAt for the page and filter subset.
 */
router.get(
  "/",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const parsed = getQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parsed.error.flatten(),
        });
      }
      const { pageId, datePeriod, channelGroup } = parsed.data;
      const tenantContext = getTenantContext(req);
      const filterContext: Record<string, unknown> = {};
      if (datePeriod) filterContext.datePeriod = datePeriod;
      if (channelGroup) filterContext.channelGroup = channelGroup;
      // When no filters are sent, load page-level insights (latest for page, independent of time period).

      const result = await loadDashboardInsights(
        tenantContext.tenantPool,
        pageId,
        filterContext
      );
      return res.json({
        insights: result.insights,
        generatedAt: result.generatedAt,
      });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "42P01") {
        return res.status(503).json({
          error:
            "Dashboard insights are not set up for this tenant. An administrator needs to run the database migration. From the server directory run: npm run migrate:tenant <tenant-slug> (or migrate:tenant --all for all tenants).",
        });
      }
      console.error("[DashboardInsights] GET error:", err);
      return res.status(500).json({
        error: "Failed to load dashboard insights",
      });
    }
  }
);

/**
 * POST /api/dashboard-insights/generate
 * Body: { pageId, filters? }
 * Runs the 4-pass pipeline for the given page and filters; returns newly generated insights.
 */
router.post(
  "/generate",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const parsed = generateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parsed.error.flatten(),
        });
      }
      const { pageId, filters = {} } = parsed.data;
      const tenantContext = getTenantContext(req);

      const result = await runDashboardInsightsForPage(
        tenantContext.tenantId,
        tenantContext.tenantPool,
        pageId,
        filters
      );
      return res.json({
        insights: result.insights,
        count: result.count,
        pageId: result.pageId,
        pageName: result.pageName,
        generationBatch: result.generationBatch,
      });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "42P01") {
        return res.status(503).json({
          error:
            "Dashboard insights are not set up for this tenant. An administrator needs to run the database migration. From the server directory run: npm run migrate:tenant <tenant-slug> (or migrate:tenant --all for all tenants).",
        });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[DashboardInsights] POST /generate error:", err);
      if (message.includes("Unknown dashboard page")) {
        return res.status(400).json({ error: message });
      }
      return res.status(500).json({
        error: "Failed to generate dashboard insights",
      });
    }
  }
);

/**
 * POST /api/dashboard-insights/feedback
 * Body: { insightId, rating (1 | -1), tags?, comment? }
 * Records feedback for a dashboard insight (Phase 2). Persistence can be extended later.
 */
router.post(
  "/feedback",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const parsed = feedbackBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parsed.error.flatten(),
        });
      }
      const { insightId, rating } = parsed.data;
      const tenantContext = getTenantContext(req);
      const check = await tenantContext.tenantPool.query(
        "SELECT id FROM dashboard_generated_insights WHERE id = $1",
        [insightId]
      );
      if (check.rows.length === 0) {
        return res.status(404).json({ error: "Insight not found" });
      }
      // Stub: acknowledge feedback (persist to a feedback table in a later iteration if needed)
      return res.status(200).json({ ok: true, insightId, rating });
    } catch (err: unknown) {
      console.error("[DashboardInsights] POST /feedback error:", err);
      return res.status(500).json({ error: "Failed to submit feedback" });
    }
  }
);

export default router;
