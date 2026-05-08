/**
 * Unified numeric confidence score for metric-backed answers (0–100).
 */

import type { ComposerResult } from "./metricQueryComposer.js";

export interface ConfidenceInputs {
  rowCount: number;
  /** True when freeform LLM SQL path was used */
  usedFreeformSqlFallback?: boolean;
  /** Last loan updated timestamp age (optional — caller supplies from MAX(updated_at)) */
  dataAgeDays?: number | null;
}

export function scoreMetricAnswerConfidence(
  composed: ComposerResult | undefined,
  inputs: ConfidenceInputs
): number {
  let score = 85;

  if (inputs.usedFreeformSqlFallback) score = Math.min(score, 60);

  if (inputs.rowCount <= 0) score -= 40;
  else if (inputs.rowCount < 5) score -= 15;
  else if (inputs.rowCount < 20) score -= 5;

  if (composed?.estimatedComplexity === "high") score -= 5;

  if (
    inputs.dataAgeDays != null &&
    Number.isFinite(inputs.dataAgeDays) &&
    inputs.dataAgeDays > 14
  ) {
    score -= Math.min(15, Math.floor(inputs.dataAgeDays / 7));
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
