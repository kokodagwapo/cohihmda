/**
 * Pipeline Analysis API Routes
 * GET /api/pipeline-analysis/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD
 * GET /api/pipeline-analysis/config - current snapshot day (1=Mon .. 5=Fri)
 * POST /api/pipeline-analysis/backfill - optional body { day_of_week: 1-5 } to set day, wipe, and recalc
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { attachTenantContext, getTenantContext } from "../../middleware/tenantContext.js";
import { handleDatabaseError } from "../../config/database.js";
import {
  getPipelineSnapshots,
  recalculatePipelineSnapshots,
  getPipelineYearRange,
  getPipelineSnapshotDay,
  type SnapshotDayOfWeek,
} from "../../services/dashboard/pipelineAnalysisService.js";

const router = Router();

/**
 * GET /api/pipeline-analysis/config
 * Returns { snapshot_day_of_week: number } (1=Mon .. 5=Fri).
 */
router.get(
  "/config",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const day = await getPipelineSnapshotDay(ctx.tenantPool);
      return res.json({ snapshot_day_of_week: day });
    } catch (error) {
      if (handleDatabaseError(error, res, "Pipeline analysis config")) return;
      return res.status(500).json({ error: "Failed to get pipeline config" });
    }
  }
);

/**
 * GET /api/pipeline-analysis/range
 * Returns { minYear, maxYear } from pipeline_analysis_snapshots for building year-range dropdown.
 */
router.get(
  "/range",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const range = await getPipelineYearRange(ctx.tenantPool);
      return res.json(range ?? { minYear: null, maxYear: null });
    } catch (error) {
      if (handleDatabaseError(error, res, "Pipeline analysis range")) return;
      return res.status(500).json({ error: "Failed to get pipeline year range" });
    }
  }
);

router.get(
  "/snapshots",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    console.log("[Pipeline Analysis] GET /snapshots", { from, to });
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const rows = await getPipelineSnapshots(ctx.tenantPool, from, to);
      const snapshots = rows.map((r) => ({
        date: typeof r.date === "string" ? r.date : r.date?.toISOString?.()?.slice(0, 10) ?? String(r.date),
        index: Number(r.index),
        snapshot_weekday: String(r.snapshot_weekday ?? "Monday"),
        year: Number(r.year),
        week_value: Number(r.week_value),
        active_units: Number(r.active_units),
        active_volume: Number(r.active_volume),
        active_lo_count: Number(r.active_lo_count),
        weekly_pct_change_volume: r.weekly_pct_change_volume != null ? Number(r.weekly_pct_change_volume) : null,
        monthly_pct_change_volume: r.monthly_pct_change_volume != null ? Number(r.monthly_pct_change_volume) : null,
        annual_pct_change_volume: r.annual_pct_change_volume != null ? Number(r.annual_pct_change_volume) : null,
        weekly_pct_change_units: r.weekly_pct_change_units != null ? Number(r.weekly_pct_change_units) : null,
        monthly_pct_change_units: r.monthly_pct_change_units != null ? Number(r.monthly_pct_change_units) : null,
        annual_pct_change_units: r.annual_pct_change_units != null ? Number(r.annual_pct_change_units) : null,
        calculated_at: r.calculated_at != null ? (typeof r.calculated_at === "string" ? r.calculated_at : new Date(r.calculated_at).toISOString()) : null,
      }));
      return res.json({ snapshots });
    } catch (error) {
      console.error("[Pipeline Analysis] GET /snapshots error:", error);
      if (handleDatabaseError(error, res, "Pipeline analysis snapshots")) return;
      return res.status(500).json({ error: "Failed to load pipeline analysis snapshots" });
    }
  }
);

/**
 * POST /api/pipeline-analysis/backfill
 * Populate pipeline_analysis_snapshots. If body.day_of_week (1-5) is provided, set config to that day,
 * truncate the snapshot table, and recalculate all snapshots for that weekday. Otherwise recalc using current config.
 * Requires tenant context.
 */
router.post(
  "/backfill",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required. Select a tenant and try again." });
      }
      const dayOfWeek = req.body?.day_of_week as number | undefined;
      if (dayOfWeek != null) {
        const d = Number(dayOfWeek);
        if (!Number.isInteger(d) || d < 1 || d > 5) {
          return res.status(400).json({ error: "day_of_week must be 1 (Monday) through 5 (Friday)." });
        }
        await recalculatePipelineSnapshots(ctx.tenantPool, d as SnapshotDayOfWeek);
      } else {
        await recalculatePipelineSnapshots(ctx.tenantPool);
      }
      return res.json({ success: true, message: "Pipeline analysis backfill completed." });
    } catch (error) {
      if (handleDatabaseError(error, res, "Pipeline analysis backfill")) return;
      return res.status(500).json({ error: "Pipeline analysis backfill failed" });
    }
  }
);

export default router;
