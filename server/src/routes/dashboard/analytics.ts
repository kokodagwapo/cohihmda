import { Router } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { z } from "zod";
import { handleDatabaseError } from "../../config/database.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../../middleware/tenantContext.js";
import { getLoanAccessContext } from "../../services/userLoanAccessService.js";
import {
  getLeaderboardData,
  getInsights,
  refreshInsights,
  refreshAllChannels,
  getClosingFalloutForecast,
  getDashboardOverview,
  getFinancialModelingBaseline,
  type FinancialModelingPeriod,
} from "../../services/dashboard/analyticsService.js";
import { getStaffingUnitTargets } from "../../utils/staffingUnitTargets.js";
import {
  refreshSingleBucket,
  generateMoreForBucket,
  deleteInsightById,
  loadStoredInsights,
} from "../../services/insights/llmInsightGenerator.js";
import { collectInsightMetrics } from "../../services/insights/insightMetricsCollector.js";
import { runInsightGeneration, isGenerationRunning } from "../../services/insights/agents/insightOrchestrator.js";

const router = Router();

// Validation schemas
const yearQuerySchema = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});

// =============================================================================
// REMOVED DUPLICATE ENDPOINTS (Backend Routes Consolidation)
// =============================================================================
// /funnel - Use /api/loans/funnel instead (more feature-complete with filters)
// /top-tiering - Use /api/toptiering instead (consolidated endpoint)
// /business-overview - Use /api/dashboard/overview instead (consolidated)
// =============================================================================

/**
 * GET /api/dashboard/leaderboard
 * Get leaderboard data for a specific timeframe
 * Supports filters: branch, scope (all/branch/team), channel_group
 * Supports custom date range with startDate and endDate parameters
 * Respects user-level loan access filtering
 */
router.get(
  "/leaderboard",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const querySchema = z.object({
        // Extended timeframes: wtd, mtd, qtd, ytd, lm (last month), lq (last quarter), ly (last year), custom
        timeframe: z
          .enum(["wtd", "mtd", "qtd", "ytd", "lm", "lq", "ly", "custom"])
          .optional(),
        branch: z.string().optional(),
        scope: z.enum(["all", "branch", "team"]).optional(),
        startDate: z.string().optional(), // For custom date range (YYYY-MM-DD)
        endDate: z.string().optional(), // For custom date range (YYYY-MM-DD)
        channel_group: z.string().optional(), // Channel filter (e.g., 'Retail', 'TPO', or specific channel)
      });

      const {
        timeframe = "mtd",
        branch,
        scope,
        startDate,
        endDate,
        channel_group,
      } = querySchema.parse(req.query);

      const tenantContext = getTenantContext(req);

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(
        req,
        tenantContext.tenantPool
      );

      // If user has no access, return empty leaderboard
      if (accessCtx.hasNoAccess) {
        return res.json({
          timeframe,
          entries: [],
          period: { start: startDate || "", end: endDate || "" },
          accessFiltered: true,
        });
      }

      // Build filters object with access filter
      const filters = {
        branch: branch || undefined,
        scope: (scope as "all" | "branch" | "team") || "all",
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        channelGroup: channel_group || undefined,
        userAccessFilter: accessCtx.getFilter("l"),
      };

      const result = await getLeaderboardData(
        tenantContext.tenantPool,
        timeframe as
          | "wtd"
          | "mtd"
          | "qtd"
          | "ytd"
          | "lm"
          | "lq"
          | "ly"
          | "custom",
        filters
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid request data", details: error.errors });
      }
      console.error("Error fetching leaderboard:", error);

      // Handle database connection errors
      if (handleDatabaseError(error, res, "Failed to fetch leaderboard")) {
        return;
      }

      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  }
);

/**
 * GET /api/dashboard/insights
 * Get comprehensive insights based on loan data, business overview, leaderboard, and industry news
 * Respects user-level loan access filtering
 *
 * Query params:
 * - dateFilter: 'today' | 'mtd' | 'ytd' | 'rolling_90_days' | 'rolling_13_months' (default: 'ytd')
 * - useLLM: 'true' | 'false' - Use LLM-based dynamic insights (default: true)
 * - forceRefresh: 'true' | 'false' - Force regeneration, bypass cache (default: false)
 * - channel_group: 'Retail' | 'TPO' | specific channel - Filter insights by channel (optional)
 */
router.get(
  "/insights",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const {
        dateFilter = "ytd",
        useLLM = "true",
        forceRefresh = "false",
        channel_group,
        generation_method,
      } = req.query;
      const authHeader = req.headers.authorization;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(
        req,
        tenantContext.tenantPool
      );

      // If user has no access, return empty insights
      if (accessCtx.hasNoAccess) {
        return res.json({
          insights: [],
          metrics: {},
          accessFiltered: true,
          noAccess: true,
        });
      }

      const result = await getInsights(
        tenantContext.tenantPool,
        dateFilter as string,
        authHeader,
        {
          useLLM: useLLM === "true",
          tenantId: tenantContext.tenantId,
          forceRefresh: forceRefresh === "true",
          userAccessFilter: accessCtx.getFilter("l"),
          channelGroup: channel_group as string | undefined,
          generationMethod: generation_method as string | undefined,
        }
      );
      res.json(result);
    } catch (error: any) {
      console.error("Error generating insights:", error);

      // Handle database connection errors
      if (handleDatabaseError(error, res, "Failed to generate insights")) {
        return;
      }

      res.status(500).json({
        error: "Failed to generate insights",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * POST /api/dashboard/insights/refresh
 * Triggers fresh insight generation: collects metrics → 4 parallel LLM calls → persists to DB → returns new insights.
 * Query params:
 * - dateFilter: 'today' | 'mtd' | 'ytd' (default: 'ytd')
 * - channel_group: optional channel filter
 */
router.post(
  "/insights/refresh",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const { dateFilter = "ytd", channel_group } = req.query;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(
        req,
        tenantContext.tenantPool
      );

      if (accessCtx.hasNoAccess) {
        return res.json({
          insights: [],
          metrics: {},
          accessFiltered: true,
          noAccess: true,
        });
      }

      const result = await refreshInsights(
        tenantContext.tenantPool,
        dateFilter as string,
        {
          tenantId: tenantContext.tenantId,
          channelGroup: channel_group as string | undefined,
        }
      );
      res.json(result);
    } catch (error: any) {
      console.error("Error refreshing insights:", error);

      if (handleDatabaseError(error, res, "Failed to refresh insights")) {
        return;
      }

      res.status(500).json({
        error: "Failed to refresh insights",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * POST /api/dashboard/insights/generate-agent
 * Triggers the agent-driven insight generation pipeline.
 * Platform admin only — runs planner → investigators → evaluator → persist.
 */
router.post(
  "/insights/generate-agent",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      // Platform admin gate
      const userRole = (req as any).userRole || (req as any).role;
      if (!["super_admin", "platform_admin"].includes(userRole)) {
        return res.status(403).json({ error: "Platform admin access required" });
      }

      const tenantContext = getTenantContext(req);

      const result = await runInsightGeneration(
        tenantContext.tenantId,
        tenantContext.tenantPool
      );

      if (!result.success && result.error?.includes("already in progress")) {
        return res.status(409).json(result);
      }

      res.json(result);
    } catch (error: any) {
      console.error("Error starting agent insight generation:", error);
      res.status(500).json({ error: "Failed to start agent insight generation" });
    }
  }
);

/**
 * GET /api/dashboard/insights/generation-status
 * Returns whether agent insight generation is currently running for the tenant.
 */
router.get(
  "/insights/generation-status",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const status = isGenerationRunning(tenantContext.tenantId);
      res.json(status);
    } catch (error: any) {
      res.json({ running: false });
    }
  }
);

/**
 * POST /api/dashboard/insights/refresh-all-channels
 * Triggers fresh insight generation for ALL channel variants (Retail, TPO, All) in parallel.
 * This pre-populates insights for every channel so switching channels is instant.
 * Query params:
 * - dateFilter: 'today' | 'mtd' | 'ytd' (default: 'ytd')
 */
router.post(
  "/insights/refresh-all-channels",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const { dateFilter = "ytd" } = req.query;

      const accessCtx = await getLoanAccessContext(
        req,
        tenantContext.tenantPool
      );
      if (accessCtx.hasNoAccess) {
        return res.json({
          channels: [],
          results: {},
          accessFiltered: true,
          noAccess: true,
        });
      }

      const result = await refreshAllChannels(
        tenantContext.tenantPool,
        dateFilter as string,
        {
          tenantId: tenantContext.tenantId,
        }
      );
      res.json(result);
    } catch (error: any) {
      console.error("Error refreshing all-channel insights:", error);

      if (
        handleDatabaseError(error, res, "Failed to refresh all-channel insights")
      ) {
        return;
      }

      res.status(500).json({
        error: "Failed to refresh all-channel insights",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * POST /api/dashboard/insights/refresh-bucket
 * Regenerates insights for a single bucket (working, attention, critical, context) without touching others.
 * Query params:
 * - dateFilter: 'today' | 'mtd' | 'ytd' (default: 'ytd')
 * - bucket: 'working' | 'attention' | 'critical' | 'context'
 * - channel_group: optional channel filter
 */
router.post(
  "/insights/refresh-bucket",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const { dateFilter = "ytd", bucket, channel_group } = req.query;

      if (!bucket || !["working", "attention", "critical", "context"].includes(bucket as string)) {
        return res.status(400).json({ error: "Invalid or missing 'bucket' param (working|attention|critical|context)" });
      }

      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({ insights: [], accessFiltered: true, noAccess: true });
      }

      // Collect metrics (same as full refresh)
      const metricsPayload = await collectInsightMetrics(
        tenantContext.tenantPool,
        dateFilter as string,
        { channelGroup: channel_group as string | undefined }
      );

      // Regenerate just the requested bucket
      const allInsights = await refreshSingleBucket(
        bucket as string,
        metricsPayload,
        tenantContext.tenantPool,
        tenantContext.tenantId,
        { channelGroup: channel_group as string | undefined }
      );

      // Map to API response format (same mapping as getInsights)
      const insights = allInsights.map((ins: any) => {
        const ev = typeof ins.evidence === "string" ? JSON.parse(ins.evidence) : (ins.evidence || {});
        return {
          id: ins.id,
          type: ins.insight_type,
          message: ins.headline,
          priority:
            ins.severity_score >= 0.8
              ? "critical"
              : ins.severity_score >= 0.55
                ? "high"
                : ins.severity_score >= 0.3
                  ? "medium"
                  : "low",
          reasoning: ins.understory,
          source: ins.source,
          bucket: ins.bucket,
          headline: ins.headline,
          understory: ins.understory,
          severity_score: ins.severity_score,
          bucketPriority: ins.priority,
          impact: typeof ins.impact === "string" ? JSON.parse(ins.impact) : ins.impact,
          evidence: ev,
          // ETM fields (stored in evidence JSONB)
          what_changed: ev.what_changed,
          why: ev.why,
          business_impact: ev.business_impact,
          risk_if_ignored: ev.risk_if_ignored,
          recommended_action: ev.recommended_action,
          owner: ev.owner,
        };
      });

      res.json({
        insights,
        refreshedBucket: bucket,
        generatedAt: new Date().toISOString(),
        usedLLM: true,
      });
    } catch (error: any) {
      console.error("Error refreshing bucket:", error);
      if (handleDatabaseError(error, res, "Failed to refresh bucket")) return;
      res.status(500).json({
        error: "Failed to refresh bucket",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * POST /api/dashboard/insights/generate-more
 * Generates additional insights for a single bucket and APPENDS them (does not remove existing).
 * Query params:
 * - dateFilter: 'today' | 'mtd' | 'ytd' (default: 'ytd')
 * - bucket: 'working' | 'attention' | 'critical' | 'context'
 * - channel_group: optional channel filter
 */
router.post(
  "/insights/generate-more",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const { dateFilter = "ytd", bucket, channel_group } = req.query;

      if (!bucket || !["working", "attention", "critical", "context"].includes(bucket as string)) {
        return res.status(400).json({ error: "Invalid or missing 'bucket' param (working|attention|critical|context)" });
      }

      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({ insights: [], accessFiltered: true, noAccess: true });
      }

      const metricsPayload = await collectInsightMetrics(
        tenantContext.tenantPool,
        dateFilter as string,
        { channelGroup: channel_group as string | undefined }
      );

      const allInsights = await generateMoreForBucket(
        bucket as string,
        metricsPayload,
        tenantContext.tenantPool,
        tenantContext.tenantId,
        { channelGroup: channel_group as string | undefined }
      );

      const insights = allInsights.map((ins: any) => {
        const ev = typeof ins.evidence === "string" ? JSON.parse(ins.evidence) : (ins.evidence || {});
        return {
          id: ins.id,
          type: ins.insight_type,
          message: ins.headline,
          priority:
            ins.severity_score >= 0.8
              ? "critical"
              : ins.severity_score >= 0.55
                ? "high"
                : ins.severity_score >= 0.3
                  ? "medium"
                  : "low",
          reasoning: ins.understory,
          source: ins.source,
          bucket: ins.bucket,
          headline: ins.headline,
          understory: ins.understory,
          severity_score: ins.severity_score,
          bucketPriority: ins.priority,
          impact: typeof ins.impact === "string" ? JSON.parse(ins.impact) : ins.impact,
          evidence: ev,
          what_changed: ev.what_changed,
          why: ev.why,
          business_impact: ev.business_impact,
          risk_if_ignored: ev.risk_if_ignored,
          recommended_action: ev.recommended_action,
          owner: ev.owner,
        };
      });

      res.json({
        insights,
        appendedBucket: bucket,
        generatedAt: new Date().toISOString(),
        usedLLM: true,
      });
    } catch (error: any) {
      console.error("Error generating more insights:", error);
      if (handleDatabaseError(error, res, "Failed to generate more insights")) return;
      res.status(500).json({
        error: "Failed to generate more insights",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * POST /api/dashboard/insights/:id/feedback
 * Submit feedback (thumbs up/down, tags, comment) on a specific insight.
 * Requires authentication. Stores user_id/email/name from JWT.
 */
router.post(
  "/insights/:id/feedback",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const insightId = parseInt(req.params.id as string, 10);

      if (isNaN(insightId)) {
        return res.status(400).json({ error: "Invalid insight ID" });
      }

      const feedbackSchema = z.object({
        rating: z.union([z.literal(-1), z.literal(1)]),
        tags: z.array(z.string()).optional().default([]),
        comment: z.string().optional().default(""),
      });

      const { rating, tags, comment } = feedbackSchema.parse(req.body);

      // Fetch insight headline/bucket for denormalized storage
      const insightResult = await tenantContext.tenantPool.query(
        `SELECT headline, bucket FROM generated_insights WHERE id = $1`,
        [insightId]
      );

      if (insightResult.rows.length === 0) {
        return res.status(404).json({ error: "Insight not found" });
      }

      const { headline, bucket } = insightResult.rows[0];

      // Upsert feedback (one rating per user per insight)
      const result = await tenantContext.tenantPool.query(
        `INSERT INTO insight_feedback (insight_id, user_id, user_email, user_name, rating, tags, comment, insight_headline, insight_bucket)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT ON CONSTRAINT insight_feedback_pkey DO NOTHING
         RETURNING id`,
        [
          insightId,
          req.userId,
          req.userEmail || "",
          req.userEmail || null,
          rating,
          tags,
          comment,
          headline,
          bucket,
        ]
      );

      // If the insert was a no-op because the user already rated, update instead
      if (result.rows.length === 0) {
        await tenantContext.tenantPool.query(
          `UPDATE insight_feedback
           SET rating = $1, tags = $2, comment = $3, created_at = NOW()
           WHERE insight_id = $4 AND user_id = $5`,
          [rating, tags, comment, insightId, req.userId]
        );
      }

      res.json({ success: true, insightId, rating });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid feedback data", details: error.errors });
      }
      console.error("Error submitting insight feedback:", error);
      if (handleDatabaseError(error, res, "Failed to submit feedback")) return;
      res.status(500).json({
        error: "Failed to submit feedback",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/insights/:id/feedback
 * Get feedback for a specific insight. Returns all feedback entries.
 */
router.get(
  "/insights/:id/feedback",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const insightId = parseInt(req.params.id as string, 10);

      if (isNaN(insightId)) {
        return res.status(400).json({ error: "Invalid insight ID" });
      }

      const result = await tenantContext.tenantPool.query(
        `SELECT id, insight_id, user_id, user_email, user_name, rating, tags, comment, created_at
         FROM insight_feedback
         WHERE insight_id = $1
         ORDER BY created_at DESC`,
        [insightId]
      );

      // Also get the current user's feedback for this insight (for UI state)
      const myFeedback = result.rows.find((r: any) => r.user_id === req.userId) || null;

      res.json({
        feedback: result.rows,
        myFeedback,
        total: result.rows.length,
      });
    } catch (error: any) {
      console.error("Error fetching insight feedback:", error);
      if (handleDatabaseError(error, res, "Failed to fetch feedback")) return;
      res.status(500).json({
        error: "Failed to fetch feedback",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * DELETE /api/dashboard/insights/:id
 * Removes a single insight by its database ID.
 */
router.delete(
  "/insights/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const insightId = parseInt(req.params.id as string, 10);

      if (isNaN(insightId)) {
        return res.status(400).json({ error: "Invalid insight ID" });
      }

      const deleted = await deleteInsightById(tenantContext.tenantPool, insightId);

      if (!deleted) {
        return res.status(404).json({ error: "Insight not found" });
      }

      res.json({ success: true, deletedId: insightId });
    } catch (error: any) {
      console.error("Error deleting insight:", error);
      if (handleDatabaseError(error, res, "Failed to delete insight")) return;
      res.status(500).json({
        error: "Failed to delete insight",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/closing-fallout-forecast
 * Get closing and fallout forecast with Qlik formulas (pull-through by loan type, active aging, predictions)
 * Respects user-level loan access filtering
 */
router.get(
  "/closing-fallout-forecast",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const { dateFilter = "ytd" } = req.query;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(
        req,
        tenantContext.tenantPool
      );

      // If user has no access, return empty forecast
      if (accessCtx.hasNoAccess) {
        return res.json({
          forecast: {},
          accessFiltered: true,
          noAccess: true,
        });
      }

      const result = await getClosingFalloutForecast(
        tenantContext.tenantPool,
        dateFilter as "today" | "mtd" | "ytd" | "custom",
        { userAccessFilter: accessCtx.getFilter("l") }
      );
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching closing and fallout forecast:", error);

      // Handle database connection errors
      if (
        handleDatabaseError(
          error,
          res,
          "Failed to fetch closing and fallout forecast"
        )
      ) {
        return;
      }

      res.status(500).json({
        error: "Failed to fetch closing and fallout forecast",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/overview
 * PERFORMANCE: Consolidated endpoint that returns stats, funnel, critical loans, and predictions in one call.
 * This reduces frontend API calls from 4 to 1, improving initial page load and reducing network waterfall.
 * Query params: period (optional: 'all' | 'mtd' | 'ytd' | 'last_month' | 'last_year' | year string)
 * Respects user-level loan access filtering
 */
router.get(
  "/overview",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const { period = "all" } = req.query;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(
        req,
        tenantContext.tenantPool
      );

      // If user has no access, return empty overview
      if (accessCtx.hasNoAccess) {
        return res.json({
          stats: { total: 0, active: 0, closed: 0, locked: 0 },
          funnel: [],
          criticalLoans: [],
          accessFiltered: true,
          noAccess: true,
        });
      }

      const result = await getDashboardOverview(
        tenantContext.tenantPool,
        period as string,
        { userAccessFilter: accessCtx.getFilter("l") }
      );
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching dashboard overview:", error);

      // Handle database connection errors
      if (
        handleDatabaseError(error, res, "Failed to fetch dashboard overview")
      ) {
        return;
      }

      res.status(500).json({
        error: "Failed to fetch dashboard overview",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/financial-modeling-baseline
 * Returns baseline metrics for the Financial Modeling Sandbox (revenue, volume, margin BPS, pull-through, units by role).
 * Query params: period (optional: 'all' | 'mtd' | 'ytd' | 'last_month' | 'last_year', default 'ytd')
 * Respects user-level loan access filtering
 */
router.get(
  "/financial-modeling-baseline",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);

      const accessCtx = await getLoanAccessContext(
        req,
        tenantContext.tenantPool
      );

      if (accessCtx.hasNoAccess) {
        const targetUnits = await getStaffingUnitTargets(tenantContext.tenantPool);
        return res.json({
          totalRevenue: 0,
          totalVolume: 0,
          fundedUnits: 0,
          marginBps: 0,
          pullThroughRate: 0,
          mloCount: 0,
          avgUnitsPerMlo: 0,
          avgUnitsPerProcessor: 0,
          avgUnitsPerUnderwriter: 0,
          avgUnitsPerCloser: 0,
          targetUnits,
          dateRange: { start: null, end: null },
          accessFiltered: true,
        });
      }

      const period = (req.query.period as FinancialModelingPeriod) || "trailing_12";
      const validPeriods: FinancialModelingPeriod[] = [
        "all",
        "mtd",
        "ytd",
        "trailing_12",
        "last_month",
        "last_year",
      ];
      const effectivePeriod = validPeriods.includes(period) ? period : "trailing_12";

      const result = await getFinancialModelingBaseline(
        tenantContext.tenantPool,
        effectivePeriod,
        { userAccessFilter: accessCtx.getFilter("l") }
      );
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching financial modeling baseline:", error);
      if (handleDatabaseError(error, res, "Failed to fetch financial modeling baseline")) {
        return;
      }
      res.status(500).json({
        error: "Failed to fetch financial modeling baseline",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

export default router;
