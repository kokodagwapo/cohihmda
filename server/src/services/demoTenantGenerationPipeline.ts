import type { Pool } from "pg";
import { runPredictionPipeline } from "./dashboard/predictionPipelineService.js";
import { runInsightGeneration } from "./insights/agents/insightOrchestrator.js";
import { enqueueCohiPrefetchJob } from "./CohiPrefetchWorker.js";
import {
  buildDefaultCohiBriefingContext,
  hashBriefingContext,
} from "../routes/podcast.js";
import { logError, logInfo } from "./logger.js";

export async function runDemoTenantGenerationPipeline(
  tenantId: string,
  tenantPool: Pool,
): Promise<void> {
  try {
    logInfo(`[DemoRefresh] Starting prediction pipeline for tenant ${tenantId}`);
    await runPredictionPipeline(tenantPool, { tenantId });
  } catch (error: any) {
    logError(
      `[DemoRefresh] Prediction pipeline failed for tenant ${tenantId}: ${error.message}`,
      error,
    );
  }

  try {
    logInfo(`[DemoRefresh] Starting insight generation for tenant ${tenantId}`);
    await runInsightGeneration(tenantId, tenantPool);
  } catch (error: any) {
    logError(
      `[DemoRefresh] Insight generation failed for tenant ${tenantId}: ${error.message}`,
      error,
    );
  }

  try {
    logInfo(`[DemoRefresh] Enqueueing podcast generation for tenant ${tenantId}`);
    const briefingContext = await buildDefaultCohiBriefingContext(tenantId);
    const contextHash = hashBriefingContext(briefingContext);
    await enqueueCohiPrefetchJob({
      tenantId,
      contextHash,
      briefingContext,
      requestedBy: "demo-refresh",
    });
  } catch (error: any) {
    logError(
      `[DemoRefresh] Podcast prefetch enqueue failed for tenant ${tenantId}: ${error.message}`,
      error,
    );
  }
}
