/**
 * Insights Service
 * Exports for the LLM-driven insights system
 */

export { collectInsightMetrics } from './insightMetricsCollector.js';
export type { InsightMetricsPayload, PredictionData } from './insightMetricsCollector.js';

export { generateLLMInsights, getFromCache, setCache, clearCache } from './llmInsightGenerator.js';
export type { GeneratedInsight, LLMInsightsResponse } from './llmInsightGenerator.js';
