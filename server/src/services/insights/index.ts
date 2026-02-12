/**
 * Insights Service
 * Exports for the LLM-driven insights system
 */

export { collectInsightMetrics } from './insightMetricsCollector.js';
export type { InsightMetricsPayload, PredictionData, PeriodSnapshot } from './insightMetricsCollector.js';

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
