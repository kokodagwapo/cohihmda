/**
 * Metrics API Routes
 * RESTful endpoints for querying metrics from the metrics catalog
 * Supports date ranges, filtering, and RAG agent access
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import {
  queryMetric,
  queryMetrics,
  queryMetricsByCategory,
  queryMetricsGroupedBy,
  getMetricsCatalog,
  DateRange,
  queryFicoDistribution,
  queryLtvDistribution,
  queryDtiDistribution,
  queryLoanSizeDistribution,
  queryLockExpirationDistribution,
  queryLoanMix,
  queryCreditRiskStory,
  queryCreditRiskDrilldownLoans,
  DistributionBucket,
  ExtendedDistributionBucket,
  LoanMixRow,
  CreditRiskStoryData,
} from "../services/metrics/metricsService.js";
import {
  explainMetric,
  explainMetricResult,
  chatAboutMetrics,
  getStaticMetricDescriptions,
  MetricChatMessage,
} from "../services/metrics/metricsAiService.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { pool } from "../config/database.js";
import { getLoanAccessContext } from "../services/userLoanAccessService.js";

/**
 * Helper to get tenant_id - from query param or user's profile
 */
async function resolveTenantId(req: AuthRequest): Promise<string | undefined> {
  // First check query param
  if (req.query.tenant_id) {
    console.log(
      `[Metrics] Using tenant_id from query param: ${req.query.tenant_id}`
    );
    return req.query.tenant_id as string;
  }

  // Fall back to user's own tenant from profiles table
  try {
    const result = await pool.query(
      "SELECT tenant_id FROM public.profiles WHERE user_id = $1",
      [req.userId]
    );
    const tenantId = result.rows[0]?.tenant_id;
    if (tenantId) {
      console.log(`[Metrics] Using tenant_id from user profile: ${tenantId}`);
      return tenantId;
    }
    console.log(
      `[Metrics] No tenant_id found in profiles for user ${req.userId}`
    );
    return undefined;
  } catch (error) {
    console.log("[Metrics] Error getting tenant from profile:", error);
    return undefined;
  }
}

const router = Router();

/**
 * GET /api/metrics/catalog
 * Get list of all available metrics
 */
router.get(
  "/catalog",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const catalog = getMetricsCatalog().map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        category: m.category,
        formula: m.formula,
        sqlQuery: m.sqlQuery,
        defaultDateField: m.defaultDateField,
      }));

      res.json({ metrics: catalog });
    } catch (error: any) {
      console.error("[Metrics] Error fetching catalog:", error);
      res.status(500).json({ error: "Failed to fetch metrics catalog" });
    }
  }
);

/**
 * GET /api/metrics/:metricId
 * Query a single metric
 * Query params: startDate, endDate (ISO strings), dateField (optional)
 * Respects user-level loan access filtering
 */
router.get(
  "/:metricId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const metricId = req.params.metricId as string;
      const tenantPool = getTenantContext(req).tenantPool;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(req, tenantPool);

      // If user has no access, return zero metric
      if (accessCtx.hasNoAccess) {
        return res.json({
          metricId,
          value: 0,
          metadata: { accessFiltered: true, noAccess: true },
        });
      }

      // Parse date range from query params - keep as strings to avoid timezone issues
      const dateRange: DateRange | undefined =
        req.query.startDate || req.query.endDate
          ? {
              start: (req.query.startDate as string) || null,
              end: (req.query.endDate as string) || null,
            }
          : undefined;

      const dateField = req.query.dateField as string | undefined;

      // Parse additional filters from query params
      const additionalFilters: Record<string, any> = {};
      if (req.query.loan_type)
        additionalFilters.loan_type = req.query.loan_type;
      if (req.query.branch) additionalFilters.branch = req.query.branch;
      if (req.query.loan_officer_id)
        additionalFilters.loan_officer_id = req.query.loan_officer_id;
      if (req.query.status) additionalFilters.status = req.query.status;
      // Channel filter - supports consolidated channel groups (Retail, TPO) or specific channels
      if (req.query.consolidated_channel)
        additionalFilters.consolidated_channel = req.query.consolidated_channel;

      const result = await queryMetric(tenantPool, metricId, {
        dateRange,
        dateField,
        additionalFilters:
          Object.keys(additionalFilters).length > 0
            ? additionalFilters
            : undefined,
        userAccessFilter: accessCtx.getFilter("l"),
      });
      res.json(result);
    } catch (error: any) {
      console.error(
        `[Metrics] Error querying metric ${req.params.metricId}:`,
        error
      );
      res
        .status(500)
        .json({ error: error.message || "Failed to query metric" });
    }
  }
);

/**
 * POST /api/metrics/query
 * Query multiple metrics in a single call
 * Body: { metricIds: string[], dateRange?: { start?: string, end?: string }, dateField?: string, groupBy?: string, additionalFilters?: object }
 * Respects user-level loan access filtering
 */
router.post(
  "/query",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { metricIds, dateRange, dateField, groupBy, additionalFilters } =
        req.body;
      const tenantPool = getTenantContext(req).tenantPool;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(req, tenantPool);

      // If user has no access, return empty/zero metrics
      if (accessCtx.hasNoAccess) {
        const emptyResults: Record<string, any> = {};
        for (const id of metricIds || []) {
          emptyResults[id] = {
            metricId: id,
            value: 0,
            metadata: { accessFiltered: true, noAccess: true },
          };
        }
        return res.json({ metrics: emptyResults, accessFiltered: true });
      }

      if (!Array.isArray(metricIds) || metricIds.length === 0) {
        return res
          .status(400)
          .json({ error: "metricIds must be a non-empty array" });
      }

      // Pass date range as strings (YYYY-MM-DD format) - don't convert to Date objects
      // to avoid timezone issues when PostgreSQL compares timestamps
      const parsedDateRange: DateRange | undefined = dateRange
        ? {
            start: dateRange.start || null,
            end: dateRange.end || null,
          }
        : undefined;

      // Debug logging to trace date range issues
      console.log("[Metrics POST /query] Request:", {
        metricIds:
          metricIds.slice(0, 3).join(", ") +
          (metricIds.length > 3 ? "..." : ""),
        dateRange: dateRange,
        parsedDateRange: parsedDateRange,
        groupBy,
        additionalFilters,
        hasAccessFilter: accessCtx.requiresFiltering,
      });

      const options = {
        dateRange: parsedDateRange,
        dateField,
        additionalFilters,
        userAccessFilter: accessCtx.getFilter("l"),
      };

      // If groupBy is specified, return grouped results
      if (groupBy) {
        const allowedGroupBy = [
          "branch",
          "loan_officer",
          "channel",
          "loan_type",
          "loan_purpose",
          "occupancy_type",
          "processor",
          "underwriter",
          "investor",
        ];
        if (!allowedGroupBy.includes(groupBy)) {
          return res.status(400).json({
            error: `Invalid groupBy. Allowed: ${allowedGroupBy.join(", ")}`,
          });
        }

        const groupedResults = await queryMetricsGroupedBy(
          tenantPool,
          metricIds,
          groupBy as any,
          options
        );
        return res.json({ metrics: groupedResults, groupedBy: groupBy });
      }

      // Non-grouped query (existing behavior)
      const results = await queryMetrics(tenantPool, metricIds, options);
      res.json({ metrics: results });
    } catch (error: any) {
      console.error("[Metrics] Error querying metrics:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to query metrics" });
    }
  }
);

/**
 * GET /api/metrics/category/:category
 * Query all metrics in a category
 * Query params: startDate, endDate (ISO strings), dateField (optional)
 * Respects user-level loan access filtering
 */
router.get(
  "/category/:category",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const category = req.params.category as string;
      const tenantPool = getTenantContext(req).tenantPool;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(req, tenantPool);

      // If user has no access, return empty metrics
      if (accessCtx.hasNoAccess) {
        return res.json({ metrics: {}, accessFiltered: true, noAccess: true });
      }

      // Parse date range from query params - keep as strings to avoid timezone issues
      const dateRange: DateRange | undefined =
        req.query.startDate || req.query.endDate
          ? {
              start: (req.query.startDate as string) || null,
              end: (req.query.endDate as string) || null,
            }
          : undefined;

      const dateField = req.query.dateField as string | undefined;

      // Parse additional filters from query params
      const additionalFilters: Record<string, any> = {};
      if (req.query.loan_type)
        additionalFilters.loan_type = req.query.loan_type;
      if (req.query.branch) additionalFilters.branch = req.query.branch;
      if (req.query.loan_officer_id)
        additionalFilters.loan_officer_id = req.query.loan_officer_id;
      if (req.query.status) additionalFilters.status = req.query.status;

      const results = await queryMetricsByCategory(tenantPool, category, {
        dateRange,
        userAccessFilter: accessCtx.getFilter("l"),
        dateField,
        additionalFilters:
          Object.keys(additionalFilters).length > 0
            ? additionalFilters
            : undefined,
      });
      res.json({ metrics: results });
    } catch (error: any) {
      console.error(
        `[Metrics] Error querying category ${req.params.category}:`,
        error
      );
      res
        .status(500)
        .json({ error: error.message || "Failed to query category metrics" });
    }
  }
);

// ============== Credit Risk Distribution Endpoints ==============

/**
 * POST /api/metrics/distributions
 * Query all three distributions (FICO, LTV, DTI) in a single call
 * Body: { dateRange?: { start?: string, end?: string }, dateField?: string, additionalFilters?: object }
 */
router.post(
  "/distributions",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { dateRange, dateField, additionalFilters } = req.body;
      const tenantPool = getTenantContext(req).tenantPool;

      const parsedDateRange = dateRange
        ? { start: dateRange.start || null, end: dateRange.end || null }
        : undefined;

      const options = {
        dateRange: parsedDateRange,
        dateField,
        additionalFilters,
      };

      // Query all three distributions in parallel
      const [ficoDistribution, ltvDistribution, dtiDistribution] =
        await Promise.all([
          queryFicoDistribution(tenantPool, options),
          queryLtvDistribution(tenantPool, options),
          queryDtiDistribution(tenantPool, options),
        ]);

      res.json({
        ficoDistribution,
        ltvDistribution,
        dtiDistribution,
      });
    } catch (error: any) {
      console.error("[Metrics] Error querying distributions:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to query distributions" });
    }
  }
);

/**
 * POST /api/metrics/loan-mix
 * Query Loan Mix data grouped by dimension
 * Body: { groupBy: 'loan_type' | 'loan_purpose' | 'occupancy_type' | 'current_milestone', dateRange?: { start?: string, end?: string }, dateField?: string, additionalFilters?: object }
 */
router.post(
  "/loan-mix",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { groupBy, dateRange, dateField, additionalFilters } = req.body;
      const tenantPool = getTenantContext(req).tenantPool;

      const allowedGroupBy = [
        "loan_type",
        "loan_purpose",
        "occupancy_type",
        "current_milestone",
      ];
      if (!groupBy || !allowedGroupBy.includes(groupBy)) {
        return res.status(400).json({
          error: `groupBy is required. Allowed: ${allowedGroupBy.join(", ")}`,
        });
      }

      const parsedDateRange = dateRange
        ? { start: dateRange.start || null, end: dateRange.end || null }
        : undefined;

      const options = {
        dateRange: parsedDateRange,
        dateField,
        additionalFilters,
      };

      const loanMix = await queryLoanMix(tenantPool, groupBy as any, options);

      res.json({ loanMix, groupedBy: groupBy });
    } catch (error: any) {
      console.error("[Metrics] Error querying loan mix:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to query loan mix" });
    }
  }
);

/**
 * POST /api/metrics/loan-size-distribution
 * Query Loan Size Distribution
 * Body: { dateRange?: { start?: string, end?: string }, dateField?: string, additionalFilters?: object }
 */
router.post(
  "/loan-size-distribution",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { dateRange, dateField, additionalFilters } = req.body;
      const tenantPool = getTenantContext(req).tenantPool;

      const parsedDateRange = dateRange
        ? { start: dateRange.start || null, end: dateRange.end || null }
        : undefined;

      const options = {
        dateRange: parsedDateRange,
        dateField,
        additionalFilters,
      };

      const distribution = await queryLoanSizeDistribution(tenantPool, options);

      res.json({ distribution });
    } catch (error: any) {
      console.error("[Metrics] Error querying loan size distribution:", error);
      res.status(500).json({
        error: error.message || "Failed to query loan size distribution",
      });
    }
  }
);

/**
 * POST /api/metrics/lock-expiration-distribution
 * Query Lock Expiration Days Distribution (for locked loans)
 * Body: { dateRange?: { start?: string, end?: string }, dateField?: string, additionalFilters?: object }
 */
router.post(
  "/lock-expiration-distribution",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { dateRange, dateField, additionalFilters } = req.body;
      const tenantPool = getTenantContext(req).tenantPool;

      const parsedDateRange = dateRange
        ? { start: dateRange.start || null, end: dateRange.end || null }
        : undefined;

      const options = {
        dateRange: parsedDateRange,
        dateField,
        additionalFilters,
      };

      const distribution = await queryLockExpirationDistribution(
        tenantPool,
        options
      );

      res.json({ distribution });
    } catch (error: any) {
      console.error(
        "[Metrics] Error querying lock expiration distribution:",
        error
      );
      res.status(500).json({
        error: error.message || "Failed to query lock expiration distribution",
      });
    }
  }
);

/**
 * POST /api/metrics/credit-risk
 * Combined Credit Risk data endpoint - fetches KPIs, distributions, and all loan mix tables
 * Body: { dateRange?: { start?: string, end?: string }, dateField?: string, additionalFilters?: object, applicationType?: string }
 */
router.post(
  "/credit-risk",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { dateRange, dateField, additionalFilters, applicationType } =
        req.body;
      const tenantPool = getTenantContext(req).tenantPool;

      // Handle application type filter - maps to Qlik's DateType field
      // 'Applications Taken' -> DateType={'Application'} -> application_date
      // 'Funded Production' -> DateType={'Funding'} -> funding_date
      // 'Lost Opportunities' -> [Withdrawn Flag]={1} with ANY date in range (Qlik associative model)
      // 'All Loans' -> include loan if ANY of its dates is in range (no single date required)
      let effectiveDateField = dateField || "application_date";
      let effectiveFilters = { ...additionalFilters };

      if (applicationType === "Funded Production") {
        effectiveDateField = "funding_date";
      } else if (applicationType === "Lost Opportunities") {
        // Credit Risk Management Lost Opportunities:
        // Qlik uses [Withdrawn Flag]={1},[$(vToDate)]={'Yes'} without specifying DateType
        // In Qlik's associative model, this means loans with Withdrawn Flag=1 where ANY date is in range
        // We need to check ALL date fields with OR logic to replicate this behavior
        effectiveDateField = "any_date"; // Special flag to trigger multi-date filtering
        effectiveFilters.withdrawn_filter = true;
      } else if (applicationType === "All Loans") {
        // All loans in the database for the date range: include if ANY date falls in range
        effectiveDateField = "any_date";
      }

      const parsedDateRange = dateRange
        ? { start: dateRange.start || null, end: dateRange.end || null }
        : undefined;

      const options = {
        dateRange: parsedDateRange,
        dateField: effectiveDateField,
        additionalFilters: effectiveFilters,
      };

      // KPI metric IDs
      const kpiMetricIds = [
        "total_units",
        "total_volume",
        "wac",
        "wa_fico",
        "wa_ltv",
        "wa_dti",
      ];

      // Fetch all data in parallel
      const [
        kpiResults,
        ficoDistribution,
        ltvDistribution,
        dtiDistribution,
        loanMixByType,
        loanMixByPurpose,
        loanMixByOccupancy,
        storyData,
      ] = await Promise.all([
        queryMetrics(tenantPool, kpiMetricIds, options),
        queryFicoDistribution(tenantPool, options),
        queryLtvDistribution(tenantPool, options),
        queryDtiDistribution(tenantPool, options),
        queryLoanMix(tenantPool, "loan_type", options),
        queryLoanMix(tenantPool, "loan_purpose", options),
        queryLoanMix(tenantPool, "occupancy_type", options),
        queryCreditRiskStory(tenantPool, options),
      ]);

      // Transform KPI results to a simple object
      // queryMetrics returns Record<string, MetricResult>, not an array
      const kpis: Record<string, number> = {};
      Object.entries(kpiResults).forEach(([metricId, result]) => {
        kpis[metricId] =
          typeof result.value === "number"
            ? result.value
            : parseFloat(result.value as string) || 0;
      });

      // Calculate largest categories from loan mix data (by VOLUME - matches Qlik!)
      // Qlik uses Sum([Loan Amount]) to find the largest category, not Count([Loan Number])
      const findLargestByVolume = (rows: LoanMixRow[]) => {
        if (!rows || rows.length === 0)
          return { category: "N/A", volumePercent: 0 };
        const sorted = [...rows].sort((a, b) => b.volume - a.volume);
        return {
          category: sorted[0].category,
          volumePercent: sorted[0].volumePercent,
        };
      };

      // Build complete story data
      const creditRiskStory = {
        largestLoanType: findLargestByVolume(loanMixByType),
        largestLoanPurpose: findLargestByVolume(loanMixByPurpose),
        largestOccupancy: findLargestByVolume(loanMixByOccupancy),
        conventionalQualifiedPercent: storyData.conventionalQualifiedPercent,
        governmentQualifiedPercent: storyData.governmentQualifiedPercent,
      };

      res.json({
        kpis,
        ficoDistribution,
        ltvDistribution,
        dtiDistribution,
        loanMixByType,
        loanMixByPurpose,
        loanMixByOccupancy,
        creditRiskStory,
        filters: {
          dateRange: parsedDateRange,
          dateField: effectiveDateField,
          applicationType,
        },
      });
    } catch (error: any) {
      console.error("[Metrics] Error querying credit risk data:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to query credit risk data" });
    }
  }
);

/**
 * POST /api/metrics/credit-risk/loans
 * Returns loan list for credit risk drilldown modal (FICO/LTV/DTI range or loan mix category).
 * Body: { applicationType?, dateRange?, year?, channel?, filterType, filterValue }
 * filterType: 'fico' | 'ltv' | 'dti' | 'loan_type' | 'loan_purpose' | 'occupancy_type'
 * filterValue: range string (e.g. '75.01-80.00') or category (e.g. 'Conventional')
 */
router.post(
  "/credit-risk/loans",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const {
        applicationType,
        dateRange: dateRangeBody,
        year,
        channel,
        filterType,
        filterValue,
      } = req.body;

      if (!filterType || filterValue == null) {
        return res.status(400).json({
          error: "filterType and filterValue are required",
        });
      }

      const tenantPool = getTenantContext(req).tenantPool;
      const accessCtx = await getLoanAccessContext(req, tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({ loans: [] });
      }

      let effectiveDateField = "application_date";
      const effectiveFilters: Record<string, any> = {};
      if (channel && channel !== "All") {
        effectiveFilters.consolidated_channel = channel;
      }

      if (applicationType === "Funded Production") {
        effectiveDateField = "funding_date";
      } else if (applicationType === "Lost Opportunities") {
        effectiveDateField = "any_date";
        effectiveFilters.withdrawn_filter = true;
      } else if (applicationType === "All Loans") {
        effectiveDateField = "any_date";
      }

      const parsedDateRange = dateRangeBody
        ? {
            start: dateRangeBody.start || null,
            end: dateRangeBody.end || null,
          }
        : year
          ? { start: `${year}-01-01`, end: `${year}-12-31` }
          : undefined;

      const options = {
        dateRange: parsedDateRange,
        dateField: effectiveDateField,
        additionalFilters: effectiveFilters,
        userAccessFilter: accessCtx.getFilter("l"),
        filterType:
          filterType === "occupancy" ? "occupancy_type" : String(filterType),
        filterValue: String(filterValue),
      };

      const loans = await queryCreditRiskDrilldownLoans(tenantPool, options);
      res.json({ loans });
    } catch (error: any) {
      console.error(
        "[Metrics] Error querying credit risk drilldown loans:",
        error
      );
      res.status(500).json({
        error:
          error.message || "Failed to query credit risk drilldown loans",
      });
    }
  }
);

// ============== AI-Powered Metrics Endpoints ==============

/**
 * GET /api/metrics/ai/descriptions
 * Get static natural language descriptions for all metrics (no API call required)
 */
router.get(
  "/ai/descriptions",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const descriptions = getStaticMetricDescriptions();
      res.json({ descriptions });
    } catch (error: any) {
      console.error("[Metrics] Error fetching descriptions:", error);
      res.status(500).json({ error: "Failed to fetch metric descriptions" });
    }
  }
);

/**
 * POST /api/metrics/ai/explain
 * Get AI-powered explanation of a metric
 * Body: { metricId: string }
 */
router.post(
  "/ai/explain",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { metricId } = req.body;
      const tenantId = await resolveTenantId(req);

      if (!metricId) {
        return res.status(400).json({ error: "metricId is required" });
      }

      console.log(
        `[Metrics AI] Explaining metric ${metricId} for tenant ${tenantId}`
      );
      const explanation = await explainMetric(metricId, tenantId);
      res.json({ explanation });
    } catch (error: any) {
      console.error(`[Metrics] Error explaining metric:`, error);
      res
        .status(500)
        .json({ error: error.message || "Failed to explain metric" });
    }
  }
);

/**
 * POST /api/metrics/ai/explain-result
 * Get AI-powered explanation of a specific metric result
 * Body: { metricId: string, value: number | string, metadata?: object }
 */
router.post(
  "/ai/explain-result",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { metricId, value, metadata } = req.body;
      const tenantId = await resolveTenantId(req);

      if (!metricId || value === undefined) {
        return res
          .status(400)
          .json({ error: "metricId and value are required" });
      }

      console.log(
        `[Metrics AI] Explaining result for ${metricId}, tenant ${tenantId}`
      );
      const explanation = await explainMetricResult(
        metricId,
        value,
        metadata,
        tenantId
      );
      res.json({ explanation });
    } catch (error: any) {
      console.error(`[Metrics] Error explaining result:`, error);
      res
        .status(500)
        .json({ error: error.message || "Failed to explain result" });
    }
  }
);

/**
 * POST /api/metrics/ai/chat
 * Interactive chat about metrics
 * Body: { messages: Array<{ role: 'user' | 'assistant', content: string }> }
 */
router.post(
  "/ai/chat",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { messages } = req.body;
      const tenantId = await resolveTenantId(req);

      if (!Array.isArray(messages) || messages.length === 0) {
        return res
          .status(400)
          .json({ error: "messages must be a non-empty array" });
      }

      console.log(`[Metrics AI] Chat for tenant ${tenantId}`);

      // Validate message format
      const validMessages: MetricChatMessage[] = messages.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || ""),
      }));

      const response = await chatAboutMetrics(validMessages, tenantId);
      res.json({ response });
    } catch (error: any) {
      console.error(`[Metrics] Error in chat:`, error);
      res
        .status(500)
        .json({ error: error.message || "Failed to process chat" });
    }
  }
);

// =============================================================================
// METRIC MANAGEMENT ENDPOINTS (Admin only)
// =============================================================================

/**
 * Helper to check if user is a platform admin
 * Platform admins can modify metrics across all tenants
 */
async function isPlatformAdmin(req: AuthRequest): Promise<boolean> {
  try {
    const result = await pool.query(
      "SELECT role FROM public.profiles WHERE user_id = $1",
      [req.userId]
    );
    const role = result.rows[0]?.role;
    return role === "platform_admin" || role === "super_admin";
  } catch (error) {
    console.error("[Metrics] Error checking admin status:", error);
    return false;
  }
}

/**
 * Helper to check if user is a tenant admin
 */
async function isTenantAdmin(
  req: AuthRequest,
  tenantId: string
): Promise<boolean> {
  try {
    const result = await pool.query(
      "SELECT role, tenant_id FROM public.profiles WHERE user_id = $1",
      [req.userId]
    );
    const profile = result.rows[0];
    if (!profile) return false;

    // Platform admins can manage any tenant
    if (profile.role === "platform_admin" || profile.role === "super_admin") {
      return true;
    }

    // Tenant admins can only manage their own tenant
    return profile.role === "tenant_admin" && profile.tenant_id === tenantId;
  } catch (error) {
    console.error("[Metrics] Error checking tenant admin status:", error);
    return false;
  }
}

/**
 * POST /api/metrics
 * Create a new custom metric definition
 * Body: { metricId, name, description, category, formula, sqlQuery, defaultDateField, notes }
 * Requires: platform_admin or tenant_admin role
 */
router.post(
  "/",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = await resolveTenantId(req);

      // Check authorization
      const isAdmin = tenantId
        ? await isTenantAdmin(req, tenantId)
        : await isPlatformAdmin(req);
      if (!isAdmin) {
        return res
          .status(403)
          .json({ error: "Admin privileges required to create metrics" });
      }

      const {
        metricId,
        name,
        description,
        category,
        formula,
        sqlQuery,
        defaultDateField,
        notes,
        ignoreDateFilter,
      } = req.body;

      // Validation
      if (!metricId || !name || !category || !sqlQuery) {
        return res.status(400).json({
          error: "Required fields: metricId, name, category, sqlQuery",
        });
      }

      // Validate category
      const validCategories = [
        "status",
        "turn_time",
        "revenue",
        "pull_through",
        "volume",
        "count",
        "custom",
      ];
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: `Invalid category. Must be one of: ${validCategories.join(
            ", "
          )}`,
        });
      }

      // Check for duplicate metric ID
      const existing = await pool.query(
        `SELECT id FROM metric_definitions WHERE metric_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) AND is_active = true`,
        [metricId, tenantId]
      );
      if (existing.rows.length > 0) {
        return res
          .status(409)
          .json({ error: `Metric with ID "${metricId}" already exists` });
      }

      // Insert the new metric
      const result = await pool.query(
        `INSERT INTO metric_definitions 
        (metric_id, tenant_id, name, description, category, formula, sql_query, default_date_field, notes, ignore_date_filter, is_system, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11)
       RETURNING *`,
        [
          metricId,
          tenantId,
          name,
          description,
          category,
          formula,
          sqlQuery,
          defaultDateField,
          notes,
          ignoreDateFilter || false,
          req.userId,
        ]
      );

      // Log the creation
      await pool.query(
        `INSERT INTO metric_audit_log (metric_id, metric_definition_id, tenant_id, action, new_value, changed_by)
       VALUES ($1, $2, $3, 'create', $4, $5)`,
        [
          metricId,
          result.rows[0].id,
          tenantId,
          JSON.stringify(result.rows[0]),
          req.userId,
        ]
      );

      console.log(
        `[Metrics] Created new metric: ${metricId} for tenant ${tenantId}`
      );
      res.status(201).json({ metric: result.rows[0] });
    } catch (error: any) {
      console.error(`[Metrics] Error creating metric:`, error);
      res
        .status(500)
        .json({ error: error.message || "Failed to create metric" });
    }
  }
);

/**
 * PUT /api/metrics/:metricId
 * Update an existing metric definition
 * Body: { name, description, category, formula, sqlQuery, defaultDateField, notes }
 * Requires: platform_admin for system metrics, tenant_admin for custom metrics
 */
router.put(
  "/:metricId",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { metricId } = req.params;
      const tenantId = await resolveTenantId(req);

      // Get current metric definition
      const current = await pool.query(
        `SELECT * FROM metric_definitions WHERE metric_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) AND is_active = true ORDER BY tenant_id NULLS LAST LIMIT 1`,
        [metricId, tenantId]
      );

      if (current.rows.length === 0) {
        return res
          .status(404)
          .json({ error: `Metric "${metricId}" not found` });
      }

      const currentMetric = current.rows[0];

      // Check authorization based on metric type
      if (currentMetric.is_system && !currentMetric.tenant_id) {
        // System metric without tenant override - requires platform admin
        const isAdmin = await isPlatformAdmin(req);
        if (!isAdmin) {
          return res.status(403).json({
            error: "Platform admin required to modify system metrics",
          });
        }
      } else {
        // Custom or tenant-overridden metric
        const isAdmin = tenantId
          ? await isTenantAdmin(req, tenantId)
          : await isPlatformAdmin(req);
        if (!isAdmin) {
          return res
            .status(403)
            .json({ error: "Admin privileges required to modify metrics" });
        }
      }

      const {
        name,
        description,
        category,
        formula,
        sqlQuery,
        defaultDateField,
        notes,
        ignoreDateFilter,
      } = req.body;

      // For system metrics, create a tenant-specific override instead of modifying the original
      if (currentMetric.is_system && !currentMetric.tenant_id && tenantId) {
        // Create tenant override
        const result = await pool.query(
          `INSERT INTO metric_definitions 
          (metric_id, tenant_id, name, description, category, formula, sql_query, default_date_field, notes, ignore_date_filter, is_system, is_override, previous_version_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, true, $11, $12)
         RETURNING *`,
          [
            metricId,
            tenantId,
            name || currentMetric.name,
            description || currentMetric.description,
            category || currentMetric.category,
            formula || currentMetric.formula,
            sqlQuery || currentMetric.sql_query,
            defaultDateField || currentMetric.default_date_field,
            notes || currentMetric.notes,
            ignoreDateFilter !== undefined
              ? ignoreDateFilter
              : currentMetric.ignore_date_filter,
            currentMetric.id,
            req.userId,
          ]
        );

        // Log the override
        await pool.query(
          `INSERT INTO metric_audit_log (metric_id, metric_definition_id, tenant_id, action, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, 'override', $4, $5, $6)`,
          [
            metricId,
            result.rows[0].id,
            tenantId,
            JSON.stringify(currentMetric),
            JSON.stringify(result.rows[0]),
            req.userId,
          ]
        );

        console.log(
          `[Metrics] Created tenant override for metric: ${metricId}, tenant ${tenantId}`
        );
        res.json({ metric: result.rows[0], isOverride: true });
      } else {
        // Update existing metric (custom or existing override)
        const result = await pool.query(
          `UPDATE metric_definitions SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          category = COALESCE($3, category),
          formula = COALESCE($4, formula),
          sql_query = COALESCE($5, sql_query),
          default_date_field = COALESCE($6, default_date_field),
          notes = COALESCE($7, notes),
          ignore_date_filter = COALESCE($8, ignore_date_filter),
          updated_by = $9,
          version = version + 1
         WHERE id = $10
         RETURNING *`,
          [
            name,
            description,
            category,
            formula,
            sqlQuery,
            defaultDateField,
            notes,
            ignoreDateFilter,
            req.userId,
            currentMetric.id,
          ]
        );

        // Log the update
        await pool.query(
          `INSERT INTO metric_audit_log (metric_id, metric_definition_id, tenant_id, action, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, 'update', $4, $5, $6)`,
          [
            metricId,
            currentMetric.id,
            tenantId,
            JSON.stringify(currentMetric),
            JSON.stringify(result.rows[0]),
            req.userId,
          ]
        );

        console.log(`[Metrics] Updated metric: ${metricId}`);
        res.json({ metric: result.rows[0] });
      }
    } catch (error: any) {
      console.error(`[Metrics] Error updating metric:`, error);
      res
        .status(500)
        .json({ error: error.message || "Failed to update metric" });
    }
  }
);

/**
 * DELETE /api/metrics/:metricId
 * Soft delete a metric (sets is_active = false)
 * Query params: ?tenant_id - specific tenant's override to delete
 * Requires: platform_admin for system metrics, tenant_admin for custom metrics
 */
router.delete(
  "/:metricId",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { metricId } = req.params;
      const tenantId = await resolveTenantId(req);

      // Get current metric definition
      const current = await pool.query(
        `SELECT * FROM metric_definitions WHERE metric_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) AND is_active = true ORDER BY tenant_id NULLS LAST LIMIT 1`,
        [metricId, tenantId]
      );

      if (current.rows.length === 0) {
        return res
          .status(404)
          .json({ error: `Metric "${metricId}" not found` });
      }

      const currentMetric = current.rows[0];

      // System metrics cannot be deleted (only overridden)
      if (currentMetric.is_system && !currentMetric.tenant_id) {
        return res.status(403).json({
          error:
            "System metrics cannot be deleted. Create a tenant override instead.",
        });
      }

      // Check authorization
      const isAdmin = tenantId
        ? await isTenantAdmin(req, tenantId)
        : await isPlatformAdmin(req);
      if (!isAdmin) {
        return res
          .status(403)
          .json({ error: "Admin privileges required to delete metrics" });
      }

      // Soft delete
      await pool.query(
        `UPDATE metric_definitions SET is_active = false, updated_by = $1 WHERE id = $2`,
        [req.userId, currentMetric.id]
      );

      // Log the deletion
      await pool.query(
        `INSERT INTO metric_audit_log (metric_id, metric_definition_id, tenant_id, action, old_value, changed_by)
       VALUES ($1, $2, $3, 'delete', $4, $5)`,
        [
          metricId,
          currentMetric.id,
          tenantId,
          JSON.stringify(currentMetric),
          req.userId,
        ]
      );

      console.log(`[Metrics] Deleted metric: ${metricId}`);
      res.json({
        success: true,
        message: `Metric "${metricId}" has been deleted`,
      });
    } catch (error: any) {
      console.error(`[Metrics] Error deleting metric:`, error);
      res
        .status(500)
        .json({ error: error.message || "Failed to delete metric" });
    }
  }
);

/**
 * GET /api/metrics/:metricId/history
 * Get version history for a metric
 * Returns audit log entries showing all changes
 */
router.get(
  "/:metricId/history",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { metricId } = req.params;
      const tenantId = await resolveTenantId(req);

      const history = await pool.query(
        `SELECT 
        mal.id,
        mal.action,
        mal.old_value,
        mal.new_value,
        mal.change_summary,
        mal.reason,
        mal.changed_at,
        mal.changed_by,
        p.display_name as changed_by_name
       FROM metric_audit_log mal
       LEFT JOIN public.profiles p ON mal.changed_by = p.user_id
       WHERE mal.metric_id = $1 AND (mal.tenant_id = $2 OR mal.tenant_id IS NULL)
       ORDER BY mal.changed_at DESC
       LIMIT 50`,
        [metricId, tenantId]
      );

      res.json({ history: history.rows });
    } catch (error: any) {
      console.error(`[Metrics] Error getting metric history:`, error);
      res
        .status(500)
        .json({ error: error.message || "Failed to get metric history" });
    }
  }
);

/**
 * POST /api/metrics/:metricId/test
 * Test a metric's SQL query with sample data
 * Body: { sqlQuery?, dateRange? }
 * Returns sample results for validation before saving
 */
router.post(
  "/:metricId/test",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { metricId } = req.params;
      const { sqlQuery, dateRange } = req.body;
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;

      // Get the metric definition (either from body or existing)
      let query = sqlQuery;
      if (!query) {
        const existing = getMetricsCatalog().find((m) => m.id === metricId);
        if (existing) {
          query = existing.sqlQuery;
        } else {
          return res
            .status(400)
            .json({ error: "sqlQuery is required for testing" });
        }
      }

      // Build a test query with LIMIT 10
      const testQuery = `
      SELECT ${query} as test_value
      FROM public.loans l
      ${dateRange?.start ? `WHERE l.application_date >= $1` : ""}
      ${
        dateRange?.end
          ? `${dateRange?.start ? "AND" : "WHERE"} l.application_date <= $${
              dateRange?.start ? "2" : "1"
            }`
          : ""
      }
      LIMIT 10
    `;

      const params: any[] = [];
      if (dateRange?.start) params.push(dateRange.start);
      if (dateRange?.end) params.push(dateRange.end);

      console.log(`[Metrics] Testing query for ${metricId}:`, testQuery);
      const result = await tenantPool.query(testQuery, params);

      res.json({
        success: true,
        result: result.rows[0]?.test_value,
        rowCount: result.rowCount,
        query: testQuery,
      });
    } catch (error: any) {
      console.error(`[Metrics] Error testing metric:`, error);
      res.status(400).json({
        success: false,
        error: error.message || "Query validation failed",
        hint: "Check SQL syntax and ensure column names match the loans table schema",
      });
    }
  }
);

export default router;
