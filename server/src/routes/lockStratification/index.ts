/**
 * Lock Stratification Dashboard API Routes
 * GET /api/lock-stratification/kpis, /interest-rates, /milestone-chart,
 *     /milestone-pivot, /days-to-expiration, /pull-through
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { attachTenantContext, getTenantContext } from "../../middleware/tenantContext.js";
import { handleDatabaseError } from "../../config/database.js";
import {
  getLockStratKPIs,
  getInterestRateDistribution,
  getMilestoneChart,
  getMilestonePivot,
  getDaysToExpiration,
  getPullThrough,
  type LockStratFilters,
  type LockedFilter,
  type MeasureFilter,
  type MilestoneGroupBy,
  type PullThroughPeriod,
  type InterestRateDrillOptions,
} from "../../services/dashboard/lockStratificationService.js";

const router = Router();

function parseChannelParam(query: Record<string, unknown>): string | undefined {
  const raw = query.channel ?? query.channel_group;
  if (raw == null) return undefined;
  const value = Array.isArray(raw) ? (raw[0] as string) : (raw as string);
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "" || trimmed === "All") return undefined;
  return trimmed;
}

function parseFilters(query: Record<string, unknown>): LockStratFilters {
  const rateMin = query.rate_min != null ? Number(query.rate_min) : undefined;
  const rateMax = query.rate_max != null ? Number(query.rate_max) : undefined;
  return {
    channel: parseChannelParam(query),
    locked: ((query.locked as string) || "all_active") as LockedFilter,
    measure: ((query.measure as string) || "volume") as MeasureFilter,
    rateMin: Number.isFinite(rateMin) ? rateMin : undefined,
    rateMax: Number.isFinite(rateMax) ? rateMax : undefined,
  };
}

function parseInterestRateDrill(query: Record<string, unknown>): InterestRateDrillOptions | null {
  const rawMin = query.drill_min;
  const rawMax = query.drill_max;
  const rawInc = query.increment;
  const min = rawMin != null ? Number(rawMin) : NaN;
  const max = rawMax != null ? Number(rawMax) : NaN;
  const inc = rawInc === "0.125" ? 0.125 : rawInc === "rate" ? "rate" : null;
  if (Number.isFinite(min) && Number.isFinite(max) && min < max && inc != null) {
    return { drillMin: min, drillMax: max, increment: inc };
  }
  return null;
}

router.get(
  "/kpis",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const filters = parseFilters(req.query as Record<string, unknown>);
      const kpis = await getLockStratKPIs(ctx.tenantPool, filters);
      return res.json(kpis);
    } catch (error) {
      if (handleDatabaseError(error, res, "Lock stratification KPIs")) return;
      return res.status(500).json({ error: "Failed to load lock stratification KPIs" });
    }
  }
);

router.get(
  "/interest-rates",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const filters = parseFilters(req.query as Record<string, unknown>);
      const drill = parseInterestRateDrill(req.query as Record<string, unknown>);
      const data = await getInterestRateDistribution(ctx.tenantPool, filters, drill);
      return res.json({ buckets: data });
    } catch (error) {
      if (handleDatabaseError(error, res, "Lock stratification interest rates")) return;
      return res.status(500).json({ error: "Failed to load interest rate distribution" });
    }
  }
);

router.get(
  "/milestone-chart",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const filters = parseFilters(req.query as Record<string, unknown>);
      const groupBy = ((req.query.group_by as string) || "current_milestone") as MilestoneGroupBy;
      const data = await getMilestoneChart(ctx.tenantPool, filters, groupBy);
      return res.json({ rows: data });
    } catch (error) {
      console.error("[LockStrat] milestone-chart error:", error);
      if (handleDatabaseError(error, res, "Lock stratification milestone chart")) return;
      return res.status(500).json({ error: "Failed to load milestone chart" });
    }
  }
);

router.get(
  "/milestone-pivot",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const filters = parseFilters(req.query as Record<string, unknown>);
      const groupBy = ((req.query.group_by as string) || "current_milestone") as MilestoneGroupBy;
      const data = await getMilestonePivot(ctx.tenantPool, filters, groupBy);
      return res.json(data);
    } catch (error) {
      console.error("[LockStrat] milestone-pivot error:", error);
      if (handleDatabaseError(error, res, "Lock stratification milestone pivot")) return;
      return res.status(500).json({ error: "Failed to load milestone pivot" });
    }
  }
);

router.get(
  "/days-to-expiration",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const filters = parseFilters(req.query as Record<string, unknown>);
      const data = await getDaysToExpiration(ctx.tenantPool, filters);
      return res.json({ rows: data });
    } catch (error) {
      if (handleDatabaseError(error, res, "Lock stratification days to expiration")) return;
      return res.status(500).json({ error: "Failed to load days to expiration" });
    }
  }
);

router.get(
  "/pull-through",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const filters = parseFilters(req.query as Record<string, unknown>);
      const period = ((req.query.period as string) || "60") as PullThroughPeriod;
      const data = await getPullThrough(ctx.tenantPool, filters, period);
      return res.json(data);
    } catch (error) {
      if (handleDatabaseError(error, res, "Lock stratification pull-through")) return;
      return res.status(500).json({ error: "Failed to load pull-through data" });
    }
  }
);

export default router;
