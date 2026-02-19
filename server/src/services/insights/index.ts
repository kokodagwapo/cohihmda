/**
 * Insights Service
 * Exports for the LLM-driven insights system
 */

export { collectInsightMetrics, computeSignals, formatSignalsForPrompt } from './insightMetricsCollector.js';
export type { InsightMetricsPayload, PredictionData, Signal } from './insightMetricsCollector.js';
// PeriodSnapshot is canonical — re-export from the shared module
export type { PeriodSnapshot } from '../metrics/canonicalMetrics.js';
export {
  computePeriodSnapshot,
  computeAllPeriodSnapshots,
  getStandardDateRanges,
  getVerifiedMetricsSQL,
} from '../metrics/canonicalMetrics.js';

export {
  generateLLMInsights,
  generateCategorizedInsights,
  loadStoredInsights,
  clearCache,
  getFromCache,
  setCache,
} from './llmInsightGenerator.js';
export type {
  GeneratedInsight,
  LLMInsightsResponse,
  CategorizedInsight,
  CategorizedInsightsResponse,
} from './llmInsightGenerator.js';
