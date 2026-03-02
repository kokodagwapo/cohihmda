/**
 * Pipeline Analysis API Routes
 * GET /api/pipeline-analysis/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD
 * GET /api/pipeline-analysis/config - current snapshot day (1=Mon .. 5=Fri)
 * POST /api/pipeline-analysis/backfill - optional body { day_of_week: 1-5 } to set snapshot day only (no table)
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { attachTenantContext, getTenantContext } from "../../middleware/tenantContext.js";
import { handleDatabaseError } from "../../config/database.js";
import { buildDimensionFilterWhereClause } from "../../utils/scorecard-utils.js";
import {
  getPipelineSnapshots,
  recalculatePipelineSnapshots,
  getPipelineYearRange,
  getPipelineSnapshotDay,
  getPipelineFilterOptions,
  getPipelineLoansInRange,
  getPipelineLoansActiveInRange,
  type SnapshotDayOfWeek,
  type StartDateField,
  type PipelineSnapshotFilters,
} from "../../services/dashboard/pipelineAnalysisService.js";

function parseStringArray(q: unknown): string[] | undefined {
  if (q == null) return undefined;
  if (Array.isArray(q)) return q.filter((x) => typeof x === "string" && x.trim() !== "").map((x) => String(x).trim());
  if (typeof q === "string" && q.trim() !== "") return [q.trim()];
  return undefined;
}

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
 * Returns { minYear, maxYear } from loans (application_date) for building year-range dropdown.
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

/**
 * GET /api/pipeline-analysis/filter-options
 * Returns { loanTypes, loanPurposes, branches } for multi-select filter dropdowns.
 */
router.get(
  "/filter-options",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const options = await getPipelineFilterOptions(ctx.tenantPool);
      return res.json(options);
    } catch (error) {
      if (handleDatabaseError(error, res, "Pipeline analysis filter options")) return;
      return res.status(500).json({ error: "Failed to get filter options" });
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
    const startDateFieldRaw = req.query.start_date_field as string | undefined;
    const startDateField: StartDateField =
      startDateFieldRaw === "lock_date" ? "lock_date"
      : startDateFieldRaw === "processing_date" ? "processing_date"
      : startDateFieldRaw === "credit_pull_date" ? "credit_pull_date"
      : startDateFieldRaw === "submitted_to_underwriting_date" ? "submitted_to_underwriting_date"
      : "application_date";
    const loanTypes = parseStringArray(req.query.loan_type);
    const loanPurposes = parseStringArray(req.query.loan_purpose);
    const branches = parseStringArray(req.query.branch);
    const filters: PipelineSnapshotFilters | undefined =
      (loanTypes?.length ?? 0) > 0 || (loanPurposes?.length ?? 0) > 0 || (branches?.length ?? 0) > 0
        ? { loanTypes, loanPurposes, branches }
        : undefined;
    const dimensionFilterClause = buildDimensionFilterWhereClause(
      req.query as Record<string, any>,
      "l",
      new Set(["tenant_id", "from", "to", "start_date_field", "loan_type", "loan_purpose", "branch"]),
    );
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const rows = await getPipelineSnapshots(ctx.tenantPool, from, to, startDateField, filters, dimensionFilterClause);
      const snapshots = rows.map((r) => ({
        date: typeof r.date === "string" ? r.date : (r.date as Date | undefined)?.toISOString?.()?.slice(0, 10) ?? String(r.date),
        index: Number(r.index),
        snapshot_weekday: String(r.snapshot_weekday ?? "Monday"),
        year: Number(r.year),
        week_value: Number(r.week_value),
        active_units: Number(r.active_units),
        active_volume: Number(r.active_volume),
        active_lo_count: Number(r.active_lo_count),
        active_ops_count: Number(r.active_ops_count ?? 0),
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
 * If body.day_of_week (1-5) is provided, set config to that day only.
 * Snapshots are always computed live from loans; no table is written.
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

/**
 * GET /api/pipeline-analysis/loans
 * Returns loan detail rows for all loans that are active on at least one snapshot date in the range.
 * Same "active on snapshot date" logic as pipeline snapshots, so the list matches the loans counted in units/volume.
 * Query: from, to, start_date_field, loan_type[], loan_purpose[], branch[], tenant_id.
 */
router.get(
  "/loans",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    if (!from || !to) {
      return res.status(400).json({ error: "from and to date parameters are required (YYYY-MM-DD)." });
    }
    const startDateFieldRaw = req.query.start_date_field as string | undefined;
    const startDateField: StartDateField =
      startDateFieldRaw === "lock_date" ? "lock_date"
      : startDateFieldRaw === "processing_date" ? "processing_date"
      : startDateFieldRaw === "credit_pull_date" ? "credit_pull_date"
      : startDateFieldRaw === "submitted_to_underwriting_date" ? "submitted_to_underwriting_date"
      : "application_date";
    const loanTypes = parseStringArray(req.query.loan_type);
    const loanPurposes = parseStringArray(req.query.loan_purpose);
    const branches = parseStringArray(req.query.branch);
    const filters: PipelineSnapshotFilters | undefined =
      (loanTypes?.length ?? 0) > 0 || (loanPurposes?.length ?? 0) > 0 || (branches?.length ?? 0) > 0
        ? { loanTypes, loanPurposes, branches }
        : undefined;
    const dimensionFilterClause = buildDimensionFilterWhereClause(
      req.query as Record<string, unknown>,
      "l",
      new Set(["tenant_id", "from", "to", "start_date_field", "loan_type", "loan_purpose", "branch", "snapshot_dates"]),
    );
    const snapshotDates = parseStringArray(req.query.snapshot_dates);
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const loans = await getPipelineLoansActiveInRange(
        ctx.tenantPool,
        from,
        to,
        startDateField,
        filters,
        dimensionFilterClause,
        snapshotDates && snapshotDates.length > 0 ? snapshotDates : undefined
      );
      return res.json({ loans });
    } catch (error) {
      console.error("[Pipeline Analysis] GET /loans error:", error);
      if (handleDatabaseError(error, res, "Pipeline analysis loans")) return;
      return res.status(500).json({ error: "Failed to load pipeline loans" });
    }
  }
);

export default router;
