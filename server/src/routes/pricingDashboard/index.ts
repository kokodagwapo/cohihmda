/**
 * Pricing Dashboard API Routes
 * GET /api/pricing-dashboard/kpis, /report, /detail, /entity-options, /actor-options
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { attachTenantContext, getTenantContext } from "../../middleware/tenantContext.js";
import { handleDatabaseError } from "../../config/database.js";
import {
  getPricingKPIs,
  getPricingReport,
  getPricingDetail,
  getPricingEntityOptions,
  getPricingActorOptions,
  type PricingDashboardFilters,
  type PricingEntityType,
  type PricingActorType,
  type PricingDateRange,
  type PricingLoanFunding,
  type PricingLoanStatus,
  type PricingLockStatus,
} from "../../services/dashboard/pricingDashboardService.js";
import { buildDimensionFilterWhereClause } from "../../utils/scorecard-utils.js";

const router = Router();

/** Parse channel from query - supports 'channel' or 'channel_group', handles array and trims. */
function parseChannelParam(query: Record<string, unknown>): string | undefined {
  const raw = query.channel ?? query.channel_group;
  if (raw == null) return undefined;
  const value = Array.isArray(raw) ? (raw[0] as string) : (raw as string);
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "" || trimmed === "All") return undefined;
  return trimmed;
}

function parseFilters(query: Record<string, unknown>): PricingDashboardFilters {
  const entityType = (query.entity_type as string) || "branch";
  const actorType = (query.actor_type as string) || "loan_officer";
  const entityFilterType = query.entity_filter_type as string | undefined;
  const actorFilterType = query.actor_filter_type as string | undefined;
  const dimensionFilterClause = buildDimensionFilterWhereClause(
    query as Record<string, any>,
    'l',
    new Set(['channel_group', 'channel', 'tenant_id', 'date_range'])
  );
  return {
    channel: parseChannelParam(query),
    entityType: entityType as PricingEntityType,
    entityFilterType: entityFilterType ? (entityFilterType as PricingEntityType) : undefined,
    entityValue: String(query.entity_value ?? ""),
    actorType: actorType as PricingActorType,
    actorFilterType: actorFilterType ? (actorFilterType as PricingActorType) : undefined,
    actorValue: String(query.actor_value ?? ""),
    dateRange: (query.date_range as PricingDateRange) || "all",
    loanFunding: (query.loan_funding as PricingLoanFunding) || "funded",
    loanStatus: (query.loan_status as PricingLoanStatus) || "active",
    lockStatus: (query.lock_status as PricingLockStatus) || "total",
    dimensionFilterClause,
  };
}

/** Parse metric_columns from query: comma-separated list of column keys. */
function parseMetricColumns(query: Record<string, unknown>): string[] | undefined {
  const raw = query.metric_columns;
  if (raw == null) return undefined;
  const str = Array.isArray(raw) ? (raw[0] as string) : (raw as string);
  if (typeof str !== "string" || str.trim() === "") return undefined;
  return str.split(",").map((s) => s.trim()).filter(Boolean);
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
      const kpis = await getPricingKPIs(ctx.tenantPool, filters);
      return res.json(kpis);
    } catch (error) {
      if (handleDatabaseError(error, res, "Pricing dashboard KPIs")) return;
      return res.status(500).json({ error: "Failed to load pricing KPIs" });
    }
  }
);

router.get(
  "/report",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const filters = parseFilters(req.query as Record<string, unknown>);
      const isEntityDetail = (req.query.report_type as string) === "entity_report";
      const metricColumns = parseMetricColumns(req.query as Record<string, unknown>);
      const result = await getPricingReport(ctx.tenantPool, filters, {
        isEntityDetail,
        metricColumns,
      });
      return res.json(result);
    } catch (error) {
      if (handleDatabaseError(error, res, "Pricing dashboard report")) return;
      return res.status(500).json({ error: "Failed to load pricing report" });
    }
  }
);

router.get(
  "/detail",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const filters = parseFilters(req.query as Record<string, unknown>);
      const isEntityDetail = (req.query.report_type as string) === "entity_detail";
      const metricColumns = parseMetricColumns(req.query as Record<string, unknown>);
      const result = await getPricingDetail(ctx.tenantPool, filters, {
        isEntityDetail,
        metricColumns,
      });
      return res.json(result);
    } catch (error) {
      if (handleDatabaseError(error, res, "Pricing dashboard detail")) return;
      return res.status(500).json({ error: "Failed to load pricing detail" });
    }
  }
);

router.get(
  "/entity-options",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const entityType = (req.query.entity_type as PricingEntityType) || "branch";
      const channel = req.query.channel as string | undefined;
      const options = await getPricingEntityOptions(
        ctx.tenantPool,
        entityType,
        channel
      );
      return res.json({ options });
    } catch (error) {
      if (handleDatabaseError(error, res, "Pricing entity options")) return;
      return res.status(500).json({ error: "Failed to load entity options" });
    }
  }
);

router.get(
  "/actor-options",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      if (!ctx?.tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const actorType = (req.query.actor_type as PricingActorType) || "loan_officer";
      const channel = req.query.channel as string | undefined;
      const options = await getPricingActorOptions(
        ctx.tenantPool,
        actorType,
        channel
      );
      return res.json({ options });
    } catch (error) {
      if (handleDatabaseError(error, res, "Pricing actor options")) return;
      return res.status(500).json({ error: "Failed to load actor options" });
    }
  }
);

export default router;
