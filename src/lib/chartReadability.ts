/**
 * Client-side chart readability guardrails for ranking/category-heavy visualizations.
 */

import type { EnhancedVisualizationConfig } from "@/components/visualizations/EnhancedVisualization";

export const CHART_CATEGORY_CAP = 25;

export interface ChartReadabilityResult {
  config: EnhancedVisualizationConfig;
  fullData?: any[];
  trimmed: boolean;
  shownCount: number;
  totalCount: number;
}

export function applyChartReadabilityGuard(
  config: EnhancedVisualizationConfig,
  options?: { maxCategories?: number },
): ChartReadabilityResult {
  const max = options?.maxCategories ?? CHART_CATEGORY_CAP;
  const data = config.data ?? [];
  const totalCount = data.length;

  if (
    totalCount <= max ||
    !["bar", "horizontal_bar", "stacked_bar", "grouped_bar"].includes(config.type)
  ) {
    return {
      config,
      trimmed: false,
      shownCount: totalCount,
      totalCount,
    };
  }

  const categoryKey =
    config.xKey ??
    config.nameKey ??
    (data[0] ? Object.keys(data[0]).find((k) => typeof data[0][k] === "string") : undefined);
  const valueKey =
    config.yKey ??
    config.valueKey ??
    (data[0]
      ? Object.keys(data[0]).find((k) => typeof data[0][k] === "number")
      : undefined);

  let sorted = [...data];
  if (valueKey) {
    sorted.sort((a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0));
  }
  const trimmedData = sorted.slice(0, max);
  const subtitle = `Showing top ${trimmedData.length} of ${totalCount}`;

  return {
    config: {
      ...config,
      data: trimmedData,
      subtitle: config.subtitle ? `${config.subtitle} · ${subtitle}` : subtitle,
    },
    fullData: data,
    trimmed: true,
    shownCount: trimmedData.length,
    totalCount,
  };
}
