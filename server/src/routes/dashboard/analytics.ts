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
  getHighPerformersRankings,
  getInsights,
  getClosingFalloutForecast,
  getDashboardOverview,
  getFinancialModelingBaseline,
  type FinancialModelingPeriod,
} from "../../services/dashboard/analyticsService.js";
import {
  getWorkflowConversionData,
  getWorkflowConversionSegmentLoans,
  getWorkflowConversionMilestones,
  type WorkflowSegmentInput,
} from "../../services/dashboard/workflowConversionService.js";
import {
  getActorsDashboardData,
  type ActorDimension,
} from "../../services/dashboard/actorsService.js";
import {
  getLoanComplexityDashboardData,
  getLoanComplexityGroupLoans,
  getLoanComplexityGroupLoansMulti,
  getLoanComplexityGroupLoansCrossDimension,
  getLoanComplexityLoansInPeriod,
  getLoanComplexityStatusOptions,
  getLoanComplexityPivotData,
  type LoanComplexityGroupBy,
} from "../../services/dashboard/loanComplexityDashboardService.js";
import { getEstimatedClosingsRiskData } from "../../services/dashboard/estimatedClosingsRiskService.js";
import { parseEstimatedClosingsDetailFiltersJson } from "../../services/dashboard/estimatedClosingsRiskFilterSql.js";
import { getStaffingUnitTargets } from "../../utils/staffingUnitTargets.js";
import { buildDimensionFilterWhereClause } from "../../utils/scorecard-utils.js";
import { deleteInsightById } from "../../services/insights/llmInsightGenerator.js";
import {
  runInsightGeneration,
  isGenerationRunning,
  generateMoreForBucketAgent,
  isBucketGenerationRunning,
  generateInsightsForCategory,
  isCategoryGenerationRunning,
} from "../../services/insights/agents/insightOrchestrator.js";
import { FUNCTIONAL_CATEGORIES } from "../../services/insights/agents/categoryDefinitions.js";
import { createJob, updateProgress, completeJob, failJob } from "../../services/jobManager.js";

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
        actor_status: z.string().optional(),
      });

      const {
        timeframe = "mtd",
        branch,
        scope,
        startDate,
        endDate,
        channel_group,
        actor_status,
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
      const dimensionFilterClause = buildDimensionFilterWhereClause(req.query as Record<string, any>, 'l', new Set(['channel_group', 'tenant_id']));
      const filters = {
        branch: branch || undefined,
        scope: (scope as "all" | "branch" | "team") || "all",
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        channelGroup: channel_group || undefined,
        actorStatusFilter: actor_status || undefined,
        userAccessFilter: accessCtx.getFilter("l"),
        dimensionFilterClause: dimensionFilterClause || undefined,
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
 * GET /api/dashboard/high-performers
 * Branch and loan officer rankings by date type (funding_date, closing_date, application_date)
 * and time period (mtd, lm, ytd, ly, rolling_13). Respects user-level loan access filtering.
 */
router.get(
  "/high-performers",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const querySchema = z.object({
        dateType: z
          .enum(["funding_date", "closing_date", "application_date"])
          .default("funding_date"),
        timePeriod: z
          .enum(["mtd", "lm", "ytd", "ly", "rolling_13"])
          .default("mtd"),
        channel_group: z.string().optional(),
      });
      const { dateType, timePeriod, channel_group } = querySchema.parse(
        req.query
      );
      const tenantContext = getTenantContext(req);
      const accessCtx = await getLoanAccessContext(
        req,
        tenantContext.tenantPool
      );
      if (accessCtx.hasNoAccess) {
        return res.json({
          branchRankings: [],
          loanOfficerRankings: [],
          accessFiltered: true,
        });
      }
      const filter = accessCtx.getFilter("l", 3);
      const hpDimensionFilterClause = buildDimensionFilterWhereClause(req.query as Record<string, any>, 'l', new Set(['channel_group', 'tenant_id']));
      const result = await getHighPerformersRankings(tenantContext.tenantPool, {
        dateType: dateType as "funding_date" | "closing_date" | "application_date",
        timePeriod: timePeriod as "mtd" | "lm" | "ytd" | "ly" | "rolling_13",
        userAccessFilter: filter ?? undefined,
        channelGroup: channel_group,
        dimensionFilterClause: hpDimensionFilterClause || undefined,
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid request data", details: error.errors });
      }
      console.error("Error fetching high-performers:", error);
      if (handleDatabaseError(error, res, "Failed to fetch high-performers")) {
        return;
      }
      res.status(500).json({ error: "Failed to fetch high-performers" });
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
          // Legacy generation methods are archived; insights always read from agent runs.
          generationMethod: "agent",
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

      const job = createJob("insight-refresh", req.userId!, tenantContext.tenantId);
      res.status(202).json({ jobId: job.id, status: "processing" });

      setImmediate(async () => {
        try {
          updateProgress(job.id, 10, "Starting agentic insight generation...");
          const generation = await runInsightGeneration(
            tenantContext.tenantId,
            tenantContext.tenantPool,
            (event) => {
              const phaseProgress: Record<string, number> = {
                init: 5, context: 10, planning: 20,
                investigating: 50, evaluating: 80, persisting: 90, complete: 100,
              };
              updateProgress(job.id, phaseProgress[event.phase] ?? 50, event.detail);
            },
            req.query.fresh === "true" ? { forceFresh: true } : undefined
          );

          if (!generation.success) {
            failJob(job.id, generation.error || "Agent generation failed");
            return;
          }

          // Re-hydrate API response using the default agent generation method.
          const refreshed = await getInsights(
            tenantContext.tenantPool,
            dateFilter as string,
            undefined,
            {
              useLLM: true,
              tenantId: tenantContext.tenantId,
              userAccessFilter: accessCtx.getFilter("l"),
              channelGroup: channel_group as string | undefined,
              generationMethod: "agent",
            }
          );

          completeJob(job.id, refreshed);
        } catch (error: any) {
          console.error("Error refreshing insights:", error);
          failJob(job.id, error.message || "Failed to refresh insights");
        }
      });
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
      const userRole = (req as any).userRole || (req as any).role;
      if (!["super_admin", "platform_admin"].includes(userRole)) {
        return res.status(403).json({ error: "Platform admin access required" });
      }

      const tenantContext = getTenantContext(req);
      const forceFresh = req.query.fresh === "true";

      const running = isGenerationRunning(tenantContext.tenantId);
      if (running.running) {
        return res.status(409).json({
          success: false,
          error: `Generation already in progress`,
          generationBatch: running.batch,
        });
      }

      const job = createJob("insight-generate-agent", req.userId!, tenantContext.tenantId);
      res.status(202).json({ jobId: job.id, status: "processing" });

      setImmediate(async () => {
        try {
          const result = await runInsightGeneration(
            tenantContext.tenantId,
            tenantContext.tenantPool,
            (event) => {
              const phaseProgress: Record<string, number> = {
                init: 5, context: 10, planning: 20,
                investigating: 50, evaluating: 80, persisting: 90, complete: 100,
              };
              updateProgress(job.id, phaseProgress[event.phase] ?? 50, event.detail);
            },
            forceFresh ? { forceFresh: true } : undefined
          );
          if (result.success) {
            completeJob(job.id, result);
          } else {
            failJob(job.id, result.error || "Generation failed");
          }
        } catch (error: any) {
          console.error("Error in agent insight generation:", error);
          failJob(job.id, error.message || "Failed to generate insights");
        }
      });
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
    return res.status(410).json({
      error: "Legacy insights endpoint archived",
      message: "Use /api/dashboard/insights/refresh (agentic workflow).",
    });
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
    return res.status(410).json({
      error: "Legacy bucket refresh archived",
      message: "Use /api/dashboard/insights/refresh (agentic workflow).",
    });
  }
);

const VALID_BUCKETS = ["critical", "attention", "working", "context"];

/**
 * POST /api/dashboard/insights/generate-more
 * Generates additional insights for a single bucket and APPENDS them (does not remove existing).
 * Platform admin only. Uses agent pipeline with bucket-focused planner.
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
      const userRole = (req as any).userRole || (req as any).role;
      if (!["super_admin", "platform_admin"].includes(userRole)) {
        return res.status(403).json({ error: "Platform admin access required" });
      }

      const bucket = (req.query.bucket as string)?.toLowerCase();
      if (!bucket || !VALID_BUCKETS.includes(bucket)) {
        return res.status(400).json({
          error: "Invalid or missing bucket",
          message: `bucket must be one of: ${VALID_BUCKETS.join(", ")}`,
        });
      }

      const tenantContext = getTenantContext(req);
      const running = isBucketGenerationRunning(tenantContext.tenantId, bucket);
      if (running.running) {
        return res.status(409).json({
          success: false,
          error: "Generate-more already in progress for this bucket",
          generationBatch: running.batch,
        });
      }

      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({
          insights: [],
          metrics: {},
          accessFiltered: true,
          noAccess: true,
        });
      }

      const { dateFilter = "ytd", channel_group } = req.query;
      const job = createJob("insight-generate-more", req.userId!, tenantContext.tenantId);
      res.status(202).json({ jobId: job.id, status: "processing" });

      setImmediate(async () => {
        try {
          updateProgress(job.id, 5, `Starting generate-more for "${bucket}"...`);
          const result = await generateMoreForBucketAgent(
            tenantContext.tenantId,
            tenantContext.tenantPool,
            bucket,
            (event) => {
              const phaseProgress: Record<string, number> = {
                init: 5, context: 10, planning: 20,
                investigating: 50, evaluating: 80, persisting: 90, complete: 100,
              };
              updateProgress(job.id, phaseProgress[event.phase] ?? 50, event.detail);
            }
          );

          if (!result.success) {
            failJob(job.id, result.error || "Generate-more failed");
            return;
          }

          const refreshed = await getInsights(
            tenantContext.tenantPool,
            dateFilter as string,
            undefined,
            {
              useLLM: true,
              tenantId: tenantContext.tenantId,
              userAccessFilter: accessCtx.getFilter("l"),
              channelGroup: channel_group as string | undefined,
              generationMethod: "agent",
            }
          );
          completeJob(job.id, refreshed);
        } catch (error: any) {
          console.error("Error in generate-more for bucket:", error);
          failJob(job.id, error.message || "Failed to generate more insights");
        }
      });
    } catch (error: any) {
      console.error("Error starting generate-more:", error);
      res.status(500).json({ error: "Failed to start generate-more" });
    }
  }
);

/**
 * POST /api/dashboard/insights/refresh-category
 * Regenerates insights for a single functional category, replacing only that category's rows.
 * Platform admin only. Uses the per-category agent pipeline.
 * Body: { category: 'operations' | 'sales' | 'finance' | 'secondary_marketing' | 'compliance' }
 */
router.post(
  "/insights/refresh-category",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const { isPlatformStaff } = req as any;
      if (typeof isPlatformStaff === "function" && !isPlatformStaff()) {
        return res.status(403).json({ error: "Platform staff only" });
      }

      const { category } = req.body as { category?: string };
      const validIds = FUNCTIONAL_CATEGORIES.map((c) => c.id);
      if (!category || !validIds.includes(category)) {
        return res.status(400).json({ error: `Invalid category. Must be one of: ${validIds.join(", ")}` });
      }

      const running = isCategoryGenerationRunning(tenantContext.tenantId, category);
      if (running.running) {
        return res.status(409).json({
          error: `Category generation already in progress`,
          batch: running.batch,
        });
      }

      const job = createJob("insight-refresh-category", req.userId!, tenantContext.tenantId);
      res.status(202).json({ jobId: job.id, status: "processing", category });

      setImmediate(async () => {
        try {
          updateProgress(job.id, 5, `Starting ${category} insight generation...`);
          const result = await generateInsightsForCategory(
            tenantContext.tenantId,
            tenantContext.tenantPool,
            category,
            (event) => {
              const pct = event.phase.startsWith("planning")
                ? 15
                : event.phase.startsWith("investigating")
                ? 40
                : event.phase.startsWith("evaluating")
                ? 70
                : event.phase.startsWith("persisting")
                ? 90
                : 95;
              updateProgress(job.id, pct, event.detail);
            }
          );

          if (result.success) {
            completeJob(job.id, {
              insightCount: result.insightCount,
              category,
              durationMs: result.durationMs,
            });
          } else {
            failJob(job.id, result.error || "Category generation failed");
          }
        } catch (error: any) {
          console.error(`Error in refresh-category for ${category}:`, error);
          failJob(job.id, error.message || "Failed to refresh category insights");
        }
      });
    } catch (error: any) {
      console.error("Error starting refresh-category:", error);
      res.status(500).json({ error: "Failed to start category refresh" });
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

const workflowSegmentSchema = z.object({ from: z.string(), to: z.string() });

/**
 * GET /api/dashboard/workflow-conversion/milestones
 * Returns all date/timestamptz columns from the tenant's loans table for use as milestone dropdown options.
 */
router.get(
  "/workflow-conversion/milestones",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const milestones = await getWorkflowConversionMilestones(tenantContext.tenantPool);
      res.json({ milestones });
    } catch (error: any) {
      console.error("Error fetching workflow conversion milestones:", error);
      if (handleDatabaseError(error, res, "Failed to fetch workflow conversion milestones")) return;
      res.status(500).json({
        error: "Failed to fetch workflow conversion milestones",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/workflow-conversion/loans
 * Loans for a segment filtered by initial | fallout | pull-through.
 */
router.get(
  "/workflow-conversion/loans",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const querySchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        segments: z.string().transform((s) => {
          const arr = JSON.parse(s) as unknown;
          return z.array(workflowSegmentSchema).parse(arr);
        }),
        grouping: z.enum(["workflow", "individual"]).optional(),
        segmentIndex: z.string().transform(Number),
        filter: z.enum(["initial", "fallout", "pull-through"]),
        channel_group: z.string().optional(),
      });
      const { startDate, endDate, segments, grouping = "workflow", segmentIndex, filter, channel_group } =
        querySchema.parse(req.query);
      const tenantContext = getTenantContext(req);
      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({ loans: [] });
      }
      const { accessClause, accessParams } = accessCtx.buildWhereClause("l", 3);
      const dimensionFilterClause = buildDimensionFilterWhereClause(
        req.query as Record<string, unknown>,
        "l",
        new Set(["startDate", "endDate", "segments", "grouping", "segmentIndex", "filter", "channel_group", "tenant_id"]),
      );
      const result = await getWorkflowConversionSegmentLoans(tenantContext.tenantPool, {
        startDate,
        endDate,
        segments: segments as WorkflowSegmentInput[],
        grouping: grouping as "workflow" | "individual",
        channelGroup: channel_group || undefined,
        accessClause: accessClause ? " " + accessClause.trim() : undefined,
        accessParams: accessParams.length > 0 ? accessParams : undefined,
        dimensionFilterClause: dimensionFilterClause || undefined,
        segmentIndex,
        filter,
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request", details: error.errors });
      }
      console.error("Error fetching workflow conversion segment loans:", error);
      if (handleDatabaseError(error, res, "Failed to fetch workflow conversion segment loans")) return;
      res.status(500).json({
        error: "Failed to fetch workflow conversion segment loans",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/workflow-conversion
 * Cohort = loans where started_date is in [startDate, endDate]. All segments use this cohort.
 * Query: startDate, endDate, segments (JSON array of {from, to} milestone ids), metric (conversion|turn_time), channel_group, tenant_id
 */
router.get(
  "/workflow-conversion",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const querySchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        segments: z.string().transform((s) => {
          const arr = JSON.parse(s) as unknown;
          return z.array(workflowSegmentSchema).parse(arr);
        }),
        metric: z.enum(["conversion", "turn_time"]).optional(),
        grouping: z.enum(["workflow", "individual"]).optional(),
        channel_group: z.string().optional(),
        tenant_id: z.string().uuid().optional(),
      });
      const { startDate, endDate, segments, metric = "conversion", grouping = "workflow", channel_group } = querySchema.parse(req.query);
      const tenantContext = getTenantContext(req);
      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({
          segments: segments.map((s: { from: string; to: string }) => ({
            ...s,
            leftCount: 0,
            rightCount: 0,
            conversionPercent: null,
            avgTurnTimeDays: null,
            series: [],
          })),
        });
      }
      const { accessClause, accessParams } = accessCtx.buildWhereClause("l", 3);
      const dimensionFilterClause = buildDimensionFilterWhereClause(
        req.query as Record<string, unknown>,
        "l",
        new Set(["startDate", "endDate", "segments", "metric", "grouping", "channel_group", "tenant_id"]),
      );
      const result = await getWorkflowConversionData(tenantContext.tenantPool, {
        startDate,
        endDate,
        segments: segments as WorkflowSegmentInput[],
        metric: metric as "conversion" | "turn_time",
        grouping: grouping as "workflow" | "individual",
        channelGroup: channel_group || undefined,
        accessClause: accessClause ? " " + accessClause.trim() : undefined,
        accessParams: accessParams.length > 0 ? accessParams : undefined,
        dimensionFilterClause: dimensionFilterClause || undefined,
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request", details: error.errors });
      }
      console.error("Error fetching workflow conversion:", error);
      if (handleDatabaseError(error, res, "Failed to fetch workflow conversion")) return;
      res.status(500).json({
        error: "Failed to fetch workflow conversion",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/actors
 * Actors dashboard: status counts, KPIs, and four actor tables.
 * Base loan set: application_date in [startDate, endDate], channel/tenant/access.
 * Optional: actor_type + actor_name to filter to that actor's loans.
 */
const actorDimensionSchema = z.enum([
  "channel", "processor", "closer", "underwriter", "loan_officer", "branch", "investor", "warehouse_co_name",
]);
router.get(
  "/actors",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const querySchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        calculation: z.enum(["average", "median"]).default("average"),
        turnTimeType: z.enum(["app_to_fund_days", "app_to_closing_days"]).default("app_to_fund_days"),
        dateRangeType: z.enum(["calendar_days", "business_days"]).default("calendar_days"),
        measure: z.enum(["volume", "units"]).default("units"),
        channel_group: z.string().optional(),
        tenant_id: z.string().uuid().optional(),
        actor_type: z.string().optional(),
        actor_name: z.string().optional(),
        status_filter: z.string().optional(),
        tableDimensions: z
          .string()
          .optional()
          .transform((s) => {
            if (!s) return undefined;
            const arr = JSON.parse(s) as unknown;
            return z.tuple([actorDimensionSchema, actorDimensionSchema, actorDimensionSchema, actorDimensionSchema]).parse(arr) as [ActorDimension, ActorDimension, ActorDimension, ActorDimension];
          }),
      });
      const parsed = querySchema.parse(req.query);
      const tenantContext = getTenantContext(req);
      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({
          statusCounts: [],
          kpis: { units: 0, volume: 0, averageBalance: 0, wac: null, wam: null, waFico: null, waLtv: null, waDti: null },
          tables: [
            { rows: [], totals: { name: "Totals", units: 0, volume: 0, avgAppToFund: null, approvalPct: 0, deniedPct: 0, withdrawnPct: 0, loanComplexity: null } },
            { rows: [], totals: { name: "Totals", units: 0, volume: 0, avgAppToFund: null, approvalPct: 0, deniedPct: 0, withdrawnPct: 0, loanComplexity: null } },
            { rows: [], totals: { name: "Totals", units: 0, volume: 0, avgAppToFund: null, approvalPct: 0, deniedPct: 0, withdrawnPct: 0, loanComplexity: null } },
            { rows: [], totals: { name: "Totals", units: 0, volume: 0, avgAppToFund: null, approvalPct: 0, deniedPct: 0, withdrawnPct: 0, loanComplexity: null } },
          ],
        });
      }
      const { accessClause, accessParams } = accessCtx.buildWhereClause("l", 3);
      const actorsDimensionFilterClause = buildDimensionFilterWhereClause(req.query as Record<string, any>, 'l', new Set(['channel_group', 'tenant_id']));
      const selectedActor =
        parsed.actor_type && parsed.actor_name != null && parsed.actor_name !== ""
          ? { type: parsed.actor_type as ActorDimension, name: parsed.actor_name }
          : undefined;
      const result = await getActorsDashboardData(tenantContext.tenantPool, {
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        calculation: parsed.calculation as "average" | "median",
        turnTimeType: parsed.turnTimeType as "app_to_fund_days" | "app_to_closing_days",
        dateRangeType: parsed.dateRangeType as "calendar_days" | "business_days",
        measure: parsed.measure as "volume" | "units",
        channelGroup: parsed.channel_group || undefined,
        accessClause: accessClause ? " " + accessClause.trim() : undefined,
        accessParams: accessParams.length > 0 ? accessParams : undefined,
        selectedActor,
        statusFilter: parsed.status_filter || undefined,
        tableDimensions: parsed.tableDimensions,
        dimensionFilterClause: actorsDimensionFilterClause || undefined,
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request", details: error.errors });
      }
      console.error("Error fetching actors dashboard:", error);
      if (handleDatabaseError(error, res, "Failed to fetch actors dashboard")) return;
      res.status(500).json({
        error: "Failed to fetch actors dashboard",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/loan-complexity
 * Loan Complexity dashboard: average complexity per loan officer, branch, or current_loan_status.
 * Base loan set: application_date in [startDate, endDate], channel/tenant/access.
 */
router.get(
  "/estimated-closings-risk",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const querySchema = z.object({
        dateRangeType: z.enum(["calendar_days", "business_days"]).default("calendar_days"),
        channel_group: z.string().optional(),
        tenant_id: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(10000).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        ecd_slice: z.preprocess(
          (v) => (v === "remaining_to_fund" ? "this_months_ecd" : v),
          z.enum(["empty_ecd", "past_ecd", "this_months_ecd", "after_this_month"]).optional(),
        ),
        complexity_bucket: z.enum(["gte_130", "gte_120", "gte_110", "all_rest"]).optional(),
        remaining_complexity_group: z.string().max(400).optional(),
        remaining_processing_stage: z.string().max(120).optional(),
        detail_filters: z.string().max(500_000).optional(),
      });
      const parsed = querySchema.parse(req.query);
      const tenantContext = getTenantContext(req);
      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);

      if (accessCtx.hasNoAccess) {
        return res.json({
          kpis: {
            totalActivePipeline: 0,
            ecdEmptyOrAfterThisMonth: 0,
            remainingToFund: 0,
            fundedThisMonth: 0,
            maxPossibleFunding: 0,
            fundingYtdUnits: 0,
            prevMonthActualUnits: 0,
            prevMonthActualVolume: 0,
            unitsLastMonthVsPriorPct: null,
            volumeLastMonthVsPriorPct: null,
          },
          activePipelineEcdSlices: [],
          maxPossibleFundingByComplexity: [],
          remainingToFundByComplexity: [],
          historicalFalloutPooled13Months: null,
          remainingToFundByProcessingStage: [],
          detail: { total: 0, limit: parsed.limit ?? 0, offset: parsed.offset ?? 0, rows: [] },
        });
      }

      const { accessClause, accessParams } = accessCtx.buildWhereClause("l", 3);
      const dimensionFilterClause = buildDimensionFilterWhereClause(
        req.query as Record<string, any>,
        "l",
        new Set([
          "dateRangeType",
          "channel_group",
          "tenant_id",
          "limit",
          "offset",
          "ecd_slice",
          "complexity_bucket",
          "remaining_complexity_group",
          "remaining_processing_stage",
          "detail_filters",
        ])
      );
      const detailColumnFilters = parseEstimatedClosingsDetailFiltersJson(parsed.detail_filters);
      const result = await getEstimatedClosingsRiskData(tenantContext.tenantPool, {
        dateRangeType: parsed.dateRangeType,
        channelGroup: parsed.channel_group || undefined,
        accessClause: accessClause ? ` ${accessClause.trim()}` : undefined,
        accessParams: accessParams.length > 0 ? accessParams : undefined,
        dimensionFilterClause: dimensionFilterClause || undefined,
        detailLimit: parsed.limit,
        detailOffset: parsed.offset ?? 0,
        ecdSlice: parsed.ecd_slice,
        complexityBarBucket: parsed.complexity_bucket,
        remainingFundComplexityGroup: parsed.remaining_complexity_group || undefined,
        remainingFundProcessingStage: parsed.remaining_processing_stage || undefined,
        detailColumnFilters,
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request", details: error.errors });
      }
      console.error("Error fetching estimated closings and risk dashboard:", error);
      if (handleDatabaseError(error, res, "Failed to fetch estimated closings and risk dashboard")) return;
      res.status(500).json({
        error: "Failed to fetch estimated closings and risk dashboard",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

router.get(
  "/loan-complexity",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const querySchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        groupBy: z.enum(["loan_officer", "processor", "underwriter", "closer", "branch", "current_loan_status"]),
        channel_group: z.string().optional(),
        tenant_id: z.string().uuid().optional(),
      });
      const parsed = querySchema.parse(req.query);
      const tenantContext = getTenantContext(req);
      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({ bars: [] });
      }
      const { accessClause, accessParams } = accessCtx.buildWhereClause("l", 3);
      const dimensionFilterClause = buildLoanComplexityDimensionFilterClause(
        req.query as Record<string, unknown>
      );
      const result = await getLoanComplexityDashboardData(tenantContext.tenantPool, {
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        groupBy: parsed.groupBy as LoanComplexityGroupBy,
        channelGroup: parsed.channel_group || undefined,
        accessClause: accessClause ? ` ${accessClause.trim()}` : undefined,
        accessParams: accessParams.length > 0 ? accessParams : undefined,
        dimensionFilterClause: dimensionFilterClause || undefined,
      });
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request", details: error.errors });
      }
      console.error("Error fetching loan complexity dashboard:", error);
      if (handleDatabaseError(error, res, "Failed to fetch loan complexity dashboard")) return;
      res.status(500).json({
        error: "Failed to fetch loan complexity dashboard",
        details: process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
      });
    }
  }
);

/** Build dimension filter clause for loan-complexity; when current_loan_status=Fallout use OR of Application Denied | Application Withdrawn; when Non-active exclude Active Loan. */
function buildLoanComplexityDimensionFilterClause(query: Record<string, unknown>): string {
  const currentStatus = query.current_loan_status;
  const statusStr = typeof currentStatus === "string" ? currentStatus.trim() : "";
  const isFallout = statusStr.toLowerCase() === "fallout";
  const isNonActive = statusStr.toLowerCase() === "non-active";
  const skip = new Set<string>(["channel_group", "tenant_id"]);
  if (isFallout) skip.add("current_loan_status");
  if (isNonActive) skip.add("current_loan_status");
  let clause = buildDimensionFilterWhereClause(query, "l", skip);
  if (isFallout) {
    clause +=
      " AND (l.current_loan_status ILIKE 'Application Denied' OR l.current_loan_status ILIKE 'Application Withdrawn')";
  }
  if (isNonActive) {
    clause +=
      " AND (l.current_loan_status IS NOT NULL AND TRIM(UPPER(l.current_loan_status)) != 'ACTIVE LOAN')";
  }
  return clause;
}

/**
 * GET /api/dashboard/loan-complexity/status-options
 * Distinct current_loan_status values for the selected period (for filter dropdown). Includes hasFallout when denied/withdrawn exist.
 */
router.get(
  "/loan-complexity/status-options",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const querySchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        channel_group: z.string().optional(),
        tenant_id: z.string().uuid().optional(),
      });
      const parsed = querySchema.parse(req.query);
      const tenantContext = getTenantContext(req);
      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({ statuses: [], hasFallout: false });
      }
      const { accessClause, accessParams } = accessCtx.buildWhereClause("l", 3);
      const result = await getLoanComplexityStatusOptions(tenantContext.tenantPool, {
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        channelGroup: parsed.channel_group || undefined,
        accessClause: accessClause ? ` ${accessClause.trim()}` : undefined,
        accessParams: accessParams.length > 0 ? accessParams : undefined,
      });
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request", details: error.errors });
      }
      console.error("Error fetching loan complexity status options:", error);
      if (handleDatabaseError(error, res, "Failed to fetch loan complexity status options")) return;
      res.status(500).json({
        error: "Failed to fetch loan complexity status options",
        details: process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/loan-complexity/loans
 * Loan rows: when groupBy and groupName(s) are provided, returns loans for those groups; otherwise returns all loans in period (same filters).
 * Multi-select: either (1) one groupBy + multiple groupName for same dimension, or (2) repeated groupBy+groupName pairs for cross-dimension (OR across dimensions).
 */
router.get(
  "/loan-complexity/loans",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const rawQuery = req.query as Record<string, unknown>;
      const groupByRaw = rawQuery.groupBy;
      const groupNameRaw = rawQuery.groupName;
      const groupByArray = Array.isArray(groupByRaw)
        ? (groupByRaw as string[]).map((s) => String(s).trim()).filter(Boolean)
        : typeof groupByRaw === "string" && groupByRaw.trim()
          ? [groupByRaw.trim()]
          : [];
      const groupNamesArray = Array.isArray(groupNameRaw)
        ? (groupNameRaw as string[]).map((s) => String(s).trim()).filter(Boolean)
        : typeof groupNameRaw === "string" && groupNameRaw.trim()
          ? [groupNameRaw.trim()]
          : [];
      const querySchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        channel_group: z.string().optional(),
        tenant_id: z.string().uuid().optional(),
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { startDate, endDate, channel_group, tenant_id } = parsed.data;
      const tenantContext = getTenantContext(req);
      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({ loans: [] });
      }
      const { accessClause, accessParams } = accessCtx.buildWhereClause("l", 3);
      const dimensionFilterClause = buildLoanComplexityDimensionFilterClause(rawQuery);
      const baseOptions = {
        startDate,
        endDate,
        channelGroup: channel_group || undefined,
        accessClause: accessClause ? ` ${accessClause.trim()}` : undefined,
        accessParams: accessParams.length > 0 ? accessParams : undefined,
        dimensionFilterClause: dimensionFilterClause || undefined,
      };
      const groupByEnum = z.enum(["loan_officer", "processor", "underwriter", "closer", "branch", "current_loan_status"]);
      let loans;
      if (groupByArray.length === groupNamesArray.length && groupByArray.length > 0) {
        const validPairs = groupByArray
          .map((g, i) => ({ groupBy: groupByEnum.safeParse(g), groupName: groupNamesArray[i] }))
          .filter((p): p is { groupBy: z.SafeParseSuccess<LoanComplexityGroupBy>; groupName: string } => p.groupBy.success);
        if (validPairs.length === groupByArray.length) {
          loans = await getLoanComplexityGroupLoansCrossDimension(tenantContext.tenantPool, {
            ...baseOptions,
            groupFilters: validPairs.map((p) => ({ groupBy: p.groupBy.data, groupName: p.groupName })),
          });
        } else {
          loans = await getLoanComplexityLoansInPeriod(tenantContext.tenantPool, baseOptions);
        }
      } else if (groupByArray.length === 1 && groupNamesArray.length > 0) {
        const singleGroupBy = groupByEnum.safeParse(groupByArray[0]);
        if (singleGroupBy.success) {
          loans =
            groupNamesArray.length === 1
              ? await getLoanComplexityGroupLoans(tenantContext.tenantPool, {
                  ...baseOptions,
                  groupBy: singleGroupBy.data,
                  groupName: groupNamesArray[0],
                })
              : await getLoanComplexityGroupLoansMulti(tenantContext.tenantPool, {
                  ...baseOptions,
                  groupBy: singleGroupBy.data,
                  groupNames: groupNamesArray,
                });
        } else {
          loans = await getLoanComplexityLoansInPeriod(tenantContext.tenantPool, baseOptions);
        }
      } else {
        loans = await getLoanComplexityLoansInPeriod(tenantContext.tenantPool, baseOptions);
      }
      res.json({ loans });
    } catch (error: unknown) {
      console.error("Error fetching loan complexity group loans:", error);
      if (handleDatabaseError(error, res, "Failed to fetch loan complexity group loans")) return;
      res.status(500).json({
        error: "Failed to fetch loan complexity group loans",
        details: process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
      });
    }
  }
);

/**
 * GET /api/dashboard/loan-complexity/pivot
 * Pivot table: dimensions (Loan Officer, Branch, Underwriter, Processor, Closer) with units, WA complexity, time in motion, % by type/purpose, % locked, % originated/denied/withdrawn (non-active).
 */
router.get(
  "/loan-complexity/pivot",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const querySchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        channel_group: z.string().optional(),
        tenant_id: z.string().uuid().optional(),
      });
      const parsed = querySchema.parse(req.query);
      const tenantContext = getTenantContext(req);
      const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
      if (accessCtx.hasNoAccess) {
        return res.json({
          dimensions: [],
          loanTypes: [],
          purposes: [],
        });
      }
      const { accessClause, accessParams } = accessCtx.buildWhereClause("l", 3);
      const dimensionFilterClause = buildLoanComplexityDimensionFilterClause(
        req.query as Record<string, unknown>
      );
      const result = await getLoanComplexityPivotData(tenantContext.tenantPool, {
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        channelGroup: parsed.channel_group || undefined,
        accessClause: accessClause ? ` ${accessClause.trim()}` : undefined,
        accessParams: accessParams.length > 0 ? accessParams : undefined,
        dimensionFilterClause: dimensionFilterClause || undefined,
      });
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request", details: error.errors });
      }
      console.error("Error fetching loan complexity pivot:", error);
      if (handleDatabaseError(error, res, "Failed to fetch loan complexity pivot")) return;
      res.status(500).json({
        error: "Failed to fetch loan complexity pivot",
        details: process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
      });
    }
  }
);

export default router;
