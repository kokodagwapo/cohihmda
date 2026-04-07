/**
 * Shared polarity resolution for tracked metrics (explicit map + name inference).
 */

import { inferTrackedMetricPolarity } from "./trackedPolarityInference.js";

export type MetricPolarity = "higher_better" | "lower_better" | "neutral";

export function resolvePolarityForKey(
  key: string,
  explicit?: Record<string, MetricPolarity>
): MetricPolarity {
  const base = key.replace(/_(avg|sum|count)$/i, "");
  const fromExplicit = explicit?.[key] ?? explicit?.[base];
  if (
    fromExplicit === "higher_better" ||
    fromExplicit === "lower_better" ||
    fromExplicit === "neutral"
  ) {
    return fromExplicit;
  }
  return inferTrackedMetricPolarity(base);
}
