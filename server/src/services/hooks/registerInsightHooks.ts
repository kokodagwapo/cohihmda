/**
 * Register Insight Hooks
 *
 * Registers post-sync hooks in order: prediction pipeline (so market data is populated)
 * → agent insight generation → tracked insight evaluation.
 * Call once at server startup.
 */

import { registerPostSyncHook, type PostSyncContext } from "./postSyncHookService.js";
import { logInfo, logError } from "../logger.js";
import { queueAutoRefreshForSourceTenant } from "../tenantRefreshService.js";
import {
  enqueueCohiPrefetchJob,
} from "../cohiPrefetchWorker.js";
import {
  normalizeSchedulerTimezone,
  shouldRunScheduledPostSyncInsights,
  type SyncTrigger,
} from "../../utils/schedulerPolicy.js";

let registered = false;

export interface PostSyncInsightPolicy {
  insightsAutoEnabled: boolean;
  insightsBusinessDaysOnly: boolean;
  schedulerTimezone: string;
}

export async function loadPostSyncInsightPolicy(ctx: PostSyncContext): Promise<PostSyncInsightPolicy> {
  const connResult = await ctx.tenantPool.query(
    `SELECT insights_auto_enabled, insights_business_days_only, scheduler_timezone
     FROM public.los_connections WHERE id = $1`,
    [ctx.connectionId],
  );
  const row = connResult.rows[0];
  return {
    insightsAutoEnabled: row?.insights_auto_enabled ?? true,
    insightsBusinessDaysOnly: row?.insights_business_days_only ?? false,
    schedulerTimezone: normalizeSchedulerTimezone(row?.scheduler_timezone),
  };
}

export function shouldRunInsightHookForPolicy(input: {
  policy: PostSyncInsightPolicy;
  trigger?: SyncTrigger;
  scheduledInsightsEnabled?: boolean;
  now?: Date;
}): boolean {
  if (!input.policy.insightsAutoEnabled) return false;
  if (input.trigger === "scheduled" && input.scheduledInsightsEnabled !== true) {
    return false;
  }
  return shouldRunScheduledPostSyncInsights({
    trigger: input.trigger,
    businessDaysOnly: input.policy.insightsBusinessDaysOnly,
    timeZone: input.policy.schedulerTimezone,
    now: input.now,
  });
}

async function loadPostSyncInsightPolicyForHook(ctx: PostSyncContext): Promise<{
  insightsAutoEnabled: boolean;
  insightsBusinessDaysOnly: boolean;
  schedulerTimezone: string;
}> {
  return loadPostSyncInsightPolicy(ctx);
}

function insightTrigger(ctx: PostSyncContext): SyncTrigger {
  return ctx.trigger ?? "unknown";
}

export function registerInsightHooks(): void {
  if (registered) return;
  registered = true;

  // Run predictions first so loan_predictions and loans.market_* are populated before insights.
  registerPostSyncHook(
    "prediction-pipeline",
    async (ctx: PostSyncContext) => {
      try {
        const policy = await loadPostSyncInsightPolicyForHook(ctx);
        if (!policy.insightsAutoEnabled) {
          logInfo(
            `[PostSyncHook] Auto-insights disabled for connection ${ctx.connectionId} — skipping prediction pipeline`,
          );
          return;
        }
        if (
          !shouldRunInsightHookForPolicy({
            trigger: insightTrigger(ctx),
            scheduledInsightsEnabled: ctx.scheduledInsightsEnabled,
            policy,
          })
        ) {
          logInfo(
            `[PostSyncHook] Skipping prediction pipeline (business-day insight policy, trigger=${insightTrigger(
              ctx,
            )}) for connection ${ctx.connectionId}`,
          );
          return;
        }

        const { runPredictionPipeline } = await import(
          "../dashboard/predictionPipelineService.js"
        );
        logInfo(
          `[PostSyncHook] Running prediction pipeline for tenant ${ctx.tenantId} (before insights)`,
        );
        const result = await runPredictionPipeline(ctx.tenantPool, {
          tenantId: ctx.tenantId,
        });
        logInfo(
          `[PostSyncHook] Prediction pipeline: ${result.summary.totalAnalyzed} loans, ${result.summary.predictedWithdraw} withdraw, ${result.summary.predictedDeny} deny in ${result.metadata.processingTimeMs}ms`,
        );
      } catch (err: any) {
        logError(
          `[PostSyncHook] Prediction pipeline failed: ${err.message}`,
          err,
        );
      }
    },
    50
  );

  registerPostSyncHook(
    "agent-insight-generation",
    async (ctx: PostSyncContext) => {
      try {
        const policy = await loadPostSyncInsightPolicyForHook(ctx);
        if (!policy.insightsAutoEnabled) {
          logInfo(
            `[PostSyncHook] Auto-insights disabled for connection ${ctx.connectionId} — skipping`,
          );
          return;
        }
        if (
          !shouldRunInsightHookForPolicy({
            trigger: insightTrigger(ctx),
            scheduledInsightsEnabled: ctx.scheduledInsightsEnabled,
            policy,
          })
        ) {
          logInfo(
            `[PostSyncHook] Skipping agent insight generation (business-day insight policy, trigger=${insightTrigger(
              ctx,
            )}) for connection ${ctx.connectionId}`,
          );
          return;
        }

        const { runInsightGeneration } = await import(
          "../insights/agents/insightOrchestrator.js"
        );
        logInfo(
          `[PostSyncHook] Triggering agent insight generation for tenant ${ctx.tenantId}`
        );
        const result = await runInsightGeneration(
          ctx.tenantId,
          ctx.tenantPool,
          undefined,
          { forceFresh: true }
        );
        logInfo(
          `[PostSyncHook] Agent insights: ${result.insightCount} generated in ${result.durationMs}ms`
        );
      } catch (err: any) {
        logError(`[PostSyncHook] Agent insight generation failed: ${err.message}`, err);
      }
    },
    100
  );

  registerPostSyncHook(
    "my-insights-generation",
    async (ctx: PostSyncContext) => {
      try {
        const policy = await loadPostSyncInsightPolicyForHook(ctx);
        if (!policy.insightsAutoEnabled) {
          return;
        }
        if (
          !shouldRunInsightHookForPolicy({
            trigger: insightTrigger(ctx),
            scheduledInsightsEnabled: ctx.scheduledInsightsEnabled,
            policy,
          })
        ) {
          logInfo(
            `[PostSyncHook] Skipping My Insights generation (business-day insight policy, trigger=${insightTrigger(
              ctx,
            )}) for connection ${ctx.connectionId}`,
          );
          return;
        }

        const { runMyInsightsForTenant } = await import(
          "../insights/agents/userInsightOrchestrator.js"
        );
        logInfo(`[PostSyncHook] Running My Insights generation for tenant ${ctx.tenantId}`);
        const result = await runMyInsightsForTenant(ctx.tenantId, ctx.tenantPool, {});
        logInfo(
          `[PostSyncHook] My Insights: users=${result.usersProcessed} errors=${result.errors} insights=${result.insightsTotal}`,
        );
      } catch (err: any) {
        logError(`[PostSyncHook] My Insights generation failed: ${err.message}`, err);
      }
    },
    150
  );

  registerPostSyncHook(
    "tracked-insight-evaluation",
    async (ctx: PostSyncContext) => {
      try {
        const policy = await loadPostSyncInsightPolicyForHook(ctx);
        if (!policy.insightsAutoEnabled) return;
        if (
          !shouldRunInsightHookForPolicy({
            trigger: insightTrigger(ctx),
            scheduledInsightsEnabled: ctx.scheduledInsightsEnabled,
            policy,
          })
        ) {
          logInfo(
            `[PostSyncHook] Skipping tracked insight evaluation (business-day insight policy, trigger=${insightTrigger(
              ctx,
            )}) for connection ${ctx.connectionId}`,
          );
          return;
        }

        const { evaluateTrackedInsights } = await import(
          "../insights/trackedInsightEvaluator.js"
        );
        logInfo(
          `[PostSyncHook] Evaluating tracked insights for tenant ${ctx.tenantId}`
        );
        const result = await evaluateTrackedInsights(ctx.tenantId, ctx.tenantPool);
        logInfo(
          `[PostSyncHook] Tracked insights: ${result.evaluated} evaluated, ${result.errors} errors`
        );
      } catch (err: any) {
        logError(`[PostSyncHook] Tracked insight evaluation failed: ${err.message}`, err);
      }
    },
    200
  );

  // Run podcast generation after all insight hooks complete so that the
  // briefing context uses the freshest generated_insights rows.
  registerPostSyncHook(
    "podcast-auto-generation",
    async (ctx: PostSyncContext) => {
      try {
        const connResult = await ctx.tenantPool.query(
          "SELECT podcast_auto_enabled FROM public.los_connections WHERE id = $1",
          [ctx.connectionId],
        );
        const enabled = connResult.rows[0]?.podcast_auto_enabled ?? true;
        if (!enabled) {
          logInfo(
            `[PostSyncHook] Auto-podcast disabled for connection ${ctx.connectionId} — skipping`,
          );
          return;
        }

        const { buildDefaultCohiBriefingContext, hashBriefingContext } =
          await import("../../routes/podcast.js");

        logInfo(
          `[PostSyncHook] Enqueuing podcast generation for tenant ${ctx.tenantId}`,
        );
        const briefingContext = await buildDefaultCohiBriefingContext(ctx.tenantId);
        const contextHash = hashBriefingContext(briefingContext);
        const jobId = await enqueueCohiPrefetchJob({
          tenantId: ctx.tenantId,
          contextHash,
          briefingContext,
          requestedBy: "post-sync-hook",
        });
        logInfo(
          `[PostSyncHook] Podcast job ${jobId} enqueued for tenant ${ctx.tenantId}`,
        );
      } catch (err: any) {
        logError(`[PostSyncHook] Podcast auto-generation failed: ${err.message}`, err);
      }
    },
    250
  );

  registerPostSyncHook(
    "demo-tenant-auto-refresh",
    async (ctx: PostSyncContext) => {
      try {
        const queued = await queueAutoRefreshForSourceTenant(ctx.tenantId);
        if (queued > 0) {
          logInfo(
            `[PostSyncHook] Queued ${queued} demo tenant refresh job(s) for source tenant ${ctx.tenantId}`
          );
        }
      } catch (err: any) {
        logError(`[PostSyncHook] Demo tenant auto-refresh failed: ${err.message}`, err);
      }
    },
    300
  );
}
