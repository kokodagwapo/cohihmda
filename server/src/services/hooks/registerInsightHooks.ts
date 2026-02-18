/**
 * Register Insight Hooks
 *
 * Registers the agent insight generation and tracked insight evaluation
 * as post-sync hooks. Call once at server startup.
 */

import { registerPostSyncHook, type PostSyncContext } from "./postSyncHookService.js";
import { logInfo, logError } from "../logger.js";

let registered = false;

export function registerInsightHooks(): void {
  if (registered) return;
  registered = true;

  registerPostSyncHook(
    "agent-insight-generation",
    async (ctx: PostSyncContext) => {
      try {
        const { runInsightGeneration } = await import(
          "../insights/agents/insightOrchestrator.js"
        );
        logInfo(
          `[PostSyncHook] Triggering agent insight generation for tenant ${ctx.tenantId}`
        );
        const result = await runInsightGeneration(ctx.tenantId, ctx.tenantPool);
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
    "tracked-insight-evaluation",
    async (ctx: PostSyncContext) => {
      try {
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
    200 // runs after insight generation
  );
}
