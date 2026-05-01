/**
 * Period preset → hook-specific filter shapes (shared by WidgetDataProvider and SingleSourceWidgetProvider).
 */

import type { SectionFilters } from "@/stores/widgetSectionStore";

/** Map PeriodPreset to Operations Scorecard DateRangeType ('3-months'|'6-months'|'12-months') */
export function mapToOpsDateRange(filters: SectionFilters): "3-months" | "6-months" | "12-months" {
  const preset = filters.periodSelection?.preset;
  if (preset === "rolling-6") return "6-months";
  if (preset === "rolling-12") return "12-months";
  return "3-months";
}

/** Map PeriodPreset to Sales Trends DateRangeOption ('3-months'|'6-months') */
export function mapToSalesTrendsDateRange(filters: SectionFilters): "3-months" | "6-months" {
  const preset = filters.periodSelection?.preset;
  if (preset === "rolling-6") return "6-months";
  return "3-months";
}

/** Map PeriodPreset to TopTiering TimeFilterType */
export type TimeFilterType =
  | "last-year"
  | "last-quarter"
  | "last-month"
  | "ytd"
  | "qtd"
  | "mtd"
  | "trailing-12"
  | "custom";

export function mapToTopTieringTimeFilter(filters: SectionFilters): {
  timeFilter: TimeFilterType;
  customDateRange?: { start: string; end: string };
} {
  const ps = filters.periodSelection;
  if (!ps) return { timeFilter: "last-year" };

  if (ps.type === "custom") {
    return { timeFilter: "custom", customDateRange: ps.dateRange };
  }

  const directMap: Record<string, TimeFilterType> = {
    mtd: "mtd",
    qtd: "qtd",
    ytd: "ytd",
    "last-month": "last-month",
    "last-quarter": "last-quarter",
    "last-year": "last-year",
    "trailing-12": "trailing-12",
  };
  const preset = ps.preset;
  if (preset && directMap[preset]) {
    return { timeFilter: directMap[preset] };
  }

  if (ps.dateRange) {
    return { timeFilter: "custom", customDateRange: ps.dateRange };
  }

  return { timeFilter: "last-year" };
}

/** Map PeriodPreset to LeaderboardTimeframe */
export type LeaderboardTimeframe = "wtd" | "mtd" | "qtd" | "lm" | "lq" | "ly" | "custom";

export function mapToLeaderboardTimeframe(filters: SectionFilters): {
  timeframe: LeaderboardTimeframe;
  startDate?: string;
  endDate?: string;
} {
  const ps = filters.periodSelection;
  if (!ps) return { timeframe: "mtd" };

  if (ps.type === "custom") {
    return { timeframe: "custom", startDate: ps.dateRange.start, endDate: ps.dateRange.end };
  }

  const presetMap: Record<string, LeaderboardTimeframe> = {
    mtd: "mtd",
    qtd: "qtd",
    "last-month": "lm",
    "last-quarter": "lq",
    "last-year": "ly",
  };
  const preset = ps.preset;
  if (preset && presetMap[preset]) {
    return { timeframe: presetMap[preset] };
  }

  if (ps.dateRange) {
    return { timeframe: "custom", startDate: ps.dateRange.start, endDate: ps.dateRange.end };
  }

  return { timeframe: "mtd" };
}
