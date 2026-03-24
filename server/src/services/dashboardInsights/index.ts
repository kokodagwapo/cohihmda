/**
 * Dashboard Insights service
 */

export { runDashboardInsightsForTenant, runDashboardInsightsForPage } from "./orchestrator.js";
export type { RunForTenantResult, RunForPageResult } from "./orchestrator.js";
export { runDashboardInsightsPipeline } from "./pipeline.js";
export type { RunPipelineResult, GeneratorCandidate } from "./pipeline.js";
export {
  saveDashboardInsights,
  loadDashboardInsights,
  loadEscalatedDashboardInsights,
} from "./storage.js";
export type {
  DashboardPageContext,
  DashboardInsight,
  DashboardDimension,
  WidgetCatalogEntry,
  EvidenceRef,
  EvidenceRefTarget,
  DashboardInsightFilterContext,
} from "./types.js";
export { getDashboardAdapters, getDashboardAdapterByPageId } from "./adapters/index.js";
export type { DashboardAdapter } from "./adapters/baseDashboardAdapter.js";
