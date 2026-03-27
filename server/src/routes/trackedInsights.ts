/**
 * Tracked Insights Routes
 *
 * CRUD + history endpoints for the insight watchlist.
 * Users can pin insights and track how they evolve over time.
 *
 * POST   /                — Pin an insight to the watchlist
 * GET    /                — List user's tracked insights with latest snapshot
 * GET    /:id/history     — Get time-series snapshots for a tracked insight
 * PUT    /:id             — Update status, alert threshold, tags
 * DELETE /:id             — Untrack / remove
 */

import { Router } from "express";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import { logError } from "../services/logger.js";

const router = Router();

// ============================================================================
// POST / — Pin an insight
// ============================================================================

router.post(
  "/",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const {
        headline,
        understory,
        metric_signature,
        source_insight_id,
        source_type,
        tags,
        display_metadata,
      } = req.body;

      if (!headline || !metric_signature) {
        return res.status(400).json({
          error: "headline and metric_signature are required",
        });
      }

      // Check if display_metadata column exists (migration 093 guard)
      let hasDisplayMetaCol = false;
      try {
        const colCheck = await ctx.tenantPool.query(`
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tracked_insights' AND column_name = 'display_metadata'
        `);
        hasDisplayMetaCol = colCheck.rows.length > 0;
      } catch { /* pre-migration */ }

      const insertCols = hasDisplayMetaCol
        ? `(user_id, user_email, headline, understory, metric_signature, source_insight_id, source_type, tags, display_metadata)`
        : `(user_id, user_email, headline, understory, metric_signature, source_insight_id, source_type, tags)`;
      const insertVals = hasDisplayMetaCol
        ? `($1, $2, $3, $4, $5, $6, $7, $8, $9)`
        : `($1, $2, $3, $4, $5, $6, $7, $8)`;
      const params: any[] = [
        req.userId,
        req.userEmail,
        headline,
        understory || null,
        JSON.stringify(metric_signature),
        source_insight_id || null,
        source_type || "pipeline",
        tags || [],
      ];
      if (hasDisplayMetaCol) {
        params.push(display_metadata ? JSON.stringify(display_metadata) : null);
      }

      const result = await ctx.tenantPool.query(
        `INSERT INTO tracked_insights ${insertCols} VALUES ${insertVals} RETURNING *`,
        params
      );

      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      logError("[TrackedInsights] POST / failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// GET / — List user's tracked insights with latest snapshot
// ============================================================================

router.get(
  "/",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const userId = req.userId;

      // Check if display_metadata column exists (migration 097 guard)
      let hasDisplayMetaCol = false;
      try {
        const colCheck = await ctx.tenantPool.query(`
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tracked_insights' AND column_name = 'display_metadata'
        `);
        hasDisplayMetaCol = colCheck.rows.length > 0;
      } catch { /* pre-migration */ }

      const displayMetaSelect = hasDisplayMetaCol ? "ti.display_metadata," : "NULL AS display_metadata,";

      const result = await ctx.tenantPool.query(
        `SELECT
           ti.id, ti.headline, ti.understory, ti.status, ti.source_type,
           ti.source_insight_id, ti.tags, ti.created_at, ti.updated_at,
           ti.alert_threshold, ti.metric_signature,
           ${displayMetaSelect}
           s.metric_values AS latest_values,
           s.previous_values AS latest_previous,
           s.change_summary AS latest_change,
           s.trend AS latest_trend,
           s.evaluated_at AS last_evaluated
         FROM tracked_insights ti
         LEFT JOIN LATERAL (
           SELECT metric_values, previous_values, change_summary, trend, evaluated_at
           FROM tracked_insight_snapshots
           WHERE tracked_insight_id = ti.id
           ORDER BY evaluated_at DESC
           LIMIT 1
         ) s ON true
         WHERE ti.user_id = $1
         ORDER BY
           CASE ti.status WHEN 'active' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
           ti.created_at DESC`,
        [userId]
      );

      res.json(result.rows);
    } catch (err: any) {
      logError("[TrackedInsights] GET / failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// GET /:id/history — Time-series snapshots
// ============================================================================

router.get(
  "/:id/history",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      // Verify ownership
      const ownerCheck = await ctx.tenantPool.query(
        `SELECT id FROM tracked_insights WHERE id = $1 AND user_id = $2`,
        [id, req.userId]
      );
      if (ownerCheck.rows.length === 0) {
        return res.status(404).json({ error: "Tracked insight not found" });
      }

      const result = await ctx.tenantPool.query(
        `SELECT * FROM tracked_insight_snapshots
         WHERE tracked_insight_id = $1
         ORDER BY evaluated_at DESC
         LIMIT $2`,
        [id, limit]
      );

      res.json(result.rows);
    } catch (err: any) {
      logError("[TrackedInsights] GET /:id/history failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// PUT /:id — Update tracked insight
// ============================================================================

router.put(
  "/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const { id } = req.params;
      const { status, alert_threshold, tags } = req.body;

      const sets: string[] = ["updated_at = NOW()"];
      const vals: any[] = [];
      let pi = 1;

      if (status !== undefined) {
        sets.push(`status = $${pi++}`);
        vals.push(status);
      }
      if (alert_threshold !== undefined) {
        sets.push(`alert_threshold = $${pi++}`);
        vals.push(JSON.stringify(alert_threshold));
      }
      if (tags !== undefined) {
        sets.push(`tags = $${pi++}`);
        vals.push(tags);
      }

      vals.push(id, req.userId);

      const result = await ctx.tenantPool.query(
        `UPDATE tracked_insights SET ${sets.join(", ")}
         WHERE id = $${pi++} AND user_id = $${pi++}
         RETURNING *`,
        vals
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Tracked insight not found" });
      }

      res.json(result.rows[0]);
    } catch (err: any) {
      logError("[TrackedInsights] PUT /:id failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// DELETE /:id — Untrack
// ============================================================================

router.delete(
  "/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const { id } = req.params;

      const result = await ctx.tenantPool.query(
        `DELETE FROM tracked_insights WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, req.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Tracked insight not found" });
      }

      res.json({ deleted: true });
    } catch (err: any) {
      logError("[TrackedInsights] DELETE /:id failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
