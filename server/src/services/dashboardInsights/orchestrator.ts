/**
 * Dashboard Insights — orchestrator
 *
 * runDashboardInsightsForTenant: iterate adapters × filter combinations, run pipeline (used by Phase 3 post-sync hook).
 * runDashboardInsightsForPage: single page + filters, run pipeline (used by on-demand POST /generate).
 */

import type { Pool } from "pg";
import { getDashboardAdapters, getDashboardAdapterByPageId } from "./adapters/index.js";
import { runDashboardInsightsPipeline } from "./pipeline.js";
import type { DashboardInsight } from "./types.js";

export interface RunForTenantResult {
  totalInsights: number;
  runs: Array<{ pageId: string; filters: Record<string, unknown>; count: number }>;
}

/**
 * Run dashboard insights for all adapters and their filter combinations.
 * Used by the Phase 3 post-sync hook (not in Phase 1–2 scope).
 */
export async function runDashboardInsightsForTenant(
  tenantId: string,
  tenantPool: Pool,
  _options?: { pageIds?: string[] }
): Promise<RunForTenantResult> {
  const adapters = getDashboardAdapters();
  const runs: RunForTenantResult["runs"] = [];
  let totalInsights = 0;

  for (const adapter of adapters) {
    const combinations = await adapter.getFilterCombinations(tenantPool);
    for (const filters of combinations) {
      try {
        const context = await adapter.buildContext(tenantPool, filters);
        const result = await runDashboardInsightsPipeline(
          context,
          tenantPool,
          tenantId
        );
        totalInsights += result.count;
        runs.push({
          pageId: adapter.pageId,
          filters,
          count: result.count,
        });
      } catch (err: unknown) {
        console.error(
          `[DashboardInsights] runDashboardInsightsForTenant failed for ${adapter.pageId} with filters ${JSON.stringify(filters)}:`,
          err
        );
      }
    }
  }

  return { totalInsights, runs };
}

export interface RunForPageResult {
  insights: DashboardInsight[];
  count: number;
  pageId: string;
  pageName: string;
  generationBatch: string;
}

/**
 * Run dashboard insights for a single page and filter set.
 * Used by POST /api/dashboard-insights/generate.
 */
export async function runDashboardInsightsForPage(
  tenantId: string,
  tenantPool: Pool,
  pageId: string,
  filters: Record<string, unknown>
): Promise<RunForPageResult> {
  const adapter = getDashboardAdapterByPageId(pageId);
  if (!adapter) {
    throw new Error(`Unknown dashboard page: ${pageId}`);
  }

  const context = await adapter.buildContext(tenantPool, filters);
  const result = await runDashboardInsightsPipeline(
    context,
    tenantPool,
    tenantId
  );

  const { loadDashboardInsights } = await import("./storage.js");
  const { insights } = await loadDashboardInsights(
    tenantPool,
    pageId,
    context.filters as Record<string, unknown>
  );

  return {
    insights,
    count: result.count,
    pageId: result.pageId,
    pageName: result.pageName,
    generationBatch: result.generationBatch,
  };
}
