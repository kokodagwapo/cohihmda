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

function isPlatformStaffRole(role: unknown): boolean {
  return role === "super_admin" || role === "platform_admin" || role === "support";
}

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

const feedbackParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
});

const feedbackUpsertSchema = z.object({
  rating: z.union([z.literal(1), z.literal(-1)]),
  tags: z.array(z.string()).optional().default([]),
  comment: z.string().optional().default(""),
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
 * POST /api/dashboard-insights/:id/feedback
 * Body: { rating (1 | -1), tags?, comment? }
 * Stores user feedback for a dashboard insight (separate table from generated_insights feedback).
 */
router.post(
  "/:id/feedback",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const params = feedbackParamsSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ error: "Invalid request", details: params.error.flatten() });
      }
      const insightId = Number(params.data.id);
      const parsed = feedbackUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }
      const { rating, tags, comment } = parsed.data;
      const tenantContext = getTenantContext(req);

      const insightRow = await tenantContext.tenantPool.query(
        `SELECT id, page_id, page_name, headline
         FROM dashboard_generated_insights
         WHERE id = $1`,
        [insightId]
      );
      if (insightRow.rows.length === 0) {
        return res.status(404).json({ error: "Insight not found" });
      }
      const { page_id, page_name, headline } = insightRow.rows[0];

      await tenantContext.tenantPool.query(
        `INSERT INTO dashboard_insight_feedback
           (dashboard_insight_id, user_id, user_email, user_name, rating, tags, comment, insight_headline, insight_page_id, insight_page_name)
         VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (dashboard_insight_id, user_id)
         DO UPDATE SET
           rating = EXCLUDED.rating,
           tags = EXCLUDED.tags,
           comment = EXCLUDED.comment,
           insight_headline = EXCLUDED.insight_headline,
           insight_page_id = EXCLUDED.insight_page_id,
           insight_page_name = EXCLUDED.insight_page_name,
           created_at = NOW()`,
        [
          insightId,
          req.userId,
          req.userEmail || "",
          req.userEmail || null,
          rating,
          tags,
          comment,
          headline || null,
          page_id || null,
          page_name || null,
        ]
      );

      return res.status(200).json({ success: true, insightId, rating });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "42P01") {
        return res.status(503).json({
          error:
            "Dashboard insight feedback is not set up for this tenant. An administrator needs to run the database migration. From the server directory run: npm run migrate:tenant <tenant-slug> (or migrate:tenant --all for all tenants).",
        });
      }
      console.error("[DashboardInsights] POST /:id/feedback error:", err);
      return res.status(500).json({ error: "Failed to submit feedback" });
    }
  }
);

/**
 * GET /api/dashboard-insights/:id/feedback
 * Returns all feedback entries plus `myFeedback` for current user.
 */
router.get(
  "/:id/feedback",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const params = feedbackParamsSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ error: "Invalid request", details: params.error.flatten() });
      }
      const insightId = Number(params.data.id);
      const tenantContext = getTenantContext(req);

      const result = await tenantContext.tenantPool.query(
        `SELECT id, dashboard_insight_id, user_id, user_email, user_name, rating, tags, comment, created_at
         FROM dashboard_insight_feedback
         WHERE dashboard_insight_id = $1
         ORDER BY created_at DESC`,
        [insightId]
      );
      const myFeedback = result.rows.find((r: any) => r.user_id === req.userId) || null;
      return res.json({
        feedback: result.rows,
        myFeedback,
        total: result.rows.length,
      });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "42P01") {
        return res.status(503).json({
          error:
            "Dashboard insight feedback is not set up for this tenant. An administrator needs to run the database migration. From the server directory run: npm run migrate:tenant <tenant-slug> (or migrate:tenant --all for all tenants).",
        });
      }
      console.error("[DashboardInsights] GET /:id/feedback error:", err);
      return res.status(500).json({ error: "Failed to fetch feedback" });
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
 * DELETE /api/dashboard-insights/:id
 * Admin-only: removes a single dashboard insight row.
 */
router.delete(
  "/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const role = (req as any).userRole || (req as any).role;
      const isPlatformStaff = typeof (req as any).isPlatformStaff === "function" ? (req as any).isPlatformStaff() : false;
      if (!isPlatformStaff && !isPlatformStaffRole(role)) {
        return res.status(403).json({ error: "Platform staff access required" });
      }

      const params = feedbackParamsSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ error: "Invalid request", details: params.error.flatten() });
      }
      const insightId = Number(params.data.id);
      const tenantContext = getTenantContext(req);

      const result = await tenantContext.tenantPool.query(
        `DELETE FROM dashboard_generated_insights
         WHERE id = $1
         RETURNING id`,
        [insightId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Insight not found" });
      }
      return res.json({ success: true, deletedId: insightId });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "42P01") {
        return res.status(503).json({
          error:
            "Dashboard insights are not set up for this tenant. An administrator needs to run the database migration. From the server directory run: npm run migrate:tenant <tenant-slug> (or migrate:tenant --all for all tenants).",
        });
      }
      console.error("[DashboardInsights] DELETE /:id error:", err);
      return res.status(500).json({ error: "Failed to delete dashboard insight" });
    }
  }
);

/**
 * POST /api/dashboard-insights/feedback
 * Body: { insightId, rating (1 | -1), tags?, comment? }
 * Compatibility wrapper for older callers.
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
      const { insightId, rating, tags, comment } = parsed.data;
      const tenantContext = getTenantContext(req);

      const insightRow = await tenantContext.tenantPool.query(
        `SELECT id, page_id, page_name, headline
         FROM dashboard_generated_insights
         WHERE id = $1`,
        [insightId]
      );
      if (insightRow.rows.length === 0) {
        return res.status(404).json({ error: "Insight not found" });
      }
      const { page_id, page_name, headline } = insightRow.rows[0];

      await tenantContext.tenantPool.query(
        `INSERT INTO dashboard_insight_feedback
           (dashboard_insight_id, user_id, user_email, user_name, rating, tags, comment, insight_headline, insight_page_id, insight_page_name)
         VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (dashboard_insight_id, user_id)
         DO UPDATE SET
           rating = EXCLUDED.rating,
           tags = EXCLUDED.tags,
           comment = EXCLUDED.comment,
           insight_headline = EXCLUDED.insight_headline,
           insight_page_id = EXCLUDED.insight_page_id,
           insight_page_name = EXCLUDED.insight_page_name,
           created_at = NOW()`,
        [
          insightId,
          req.userId,
          req.userEmail || "",
          req.userEmail || null,
          rating,
          tags || [],
          comment || "",
          headline || null,
          page_id || null,
          page_name || null,
        ]
      );

      return res.status(200).json({ success: true, insightId, rating });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "42P01") {
        return res.status(503).json({
          error:
            "Dashboard insight feedback is not set up for this tenant. An administrator needs to run the database migration. From the server directory run: npm run migrate:tenant <tenant-slug> (or migrate:tenant --all for all tenants).",
        });
      }
      console.error("[DashboardInsights] POST /feedback error:", err);
      return res.status(500).json({ error: "Failed to submit feedback" });
    }
  }
);

export default router;
