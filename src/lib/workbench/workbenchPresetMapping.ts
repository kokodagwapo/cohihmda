/**
 * Map LLM/workbench filterConfig.defaultPreset tokens to UI PeriodPreset keys.
 */

import {
  computePresetDateRange,
  type PeriodPreset,
} from "@/components/ui/DatePeriodPicker";
import type { PeriodSelection } from "@/components/ui/DatePeriodPicker";
import type { WidgetFilterConfig, WidgetFilterState } from "@/components/workbench/canvas/types";

const LLM_TO_UI_PRESET: Record<string, PeriodPreset> = {
  MTD: "mtd",
  mtd: "mtd",
  YTD: "ytd",
  ytd: "ytd",
  QTD: "qtd",
  qtd: "qtd",
  L13M: "rolling-13",
  L12M: "rolling-12",
  L6M: "rolling-6",
  L3M: "rolling-3",
  CY: "ytd",
  PY: "last-year",
  LM: "last-month",
  LQ: "last-quarter",
  LY: "last-year",
};

export function mapWorkbenchPresetToPeriodPreset(
  token: string | null | undefined,
): PeriodPreset | null {
  if (!token) return null;
  if (token in LLM_TO_UI_PRESET) return LLM_TO_UI_PRESET[token];
  const known = [
    "rolling-3",
    "rolling-6",
    "rolling-12",
    "rolling-13",
    "mtd",
    "qtd",
    "ytd",
    "last-month",
    "last-quarter",
    "last-year",
    "trailing-12",
    "last-30-days",
  ] as const;
  if ((known as readonly string[]).includes(token)) {
    return token as PeriodPreset;
  }
  return null;
}

export function buildPeriodSelectionFromFilterConfig(
  fc: WidgetFilterConfig | undefined,
): PeriodSelection | undefined {
  if (!fc?.filterable) return undefined;
  const preset = mapWorkbenchPresetToPeriodPreset(fc.defaultPreset);
  if (!preset) return undefined;
  const dateRange = computePresetDateRange(preset);
  return { type: "preset", preset, dateRange };
}

export function filterConfigToInitialState(
  fc: WidgetFilterConfig | undefined,
): WidgetFilterState | undefined {
  if (!fc || !fc.filterable) return undefined;
  const state: WidgetFilterState = {};
  if (fc.dateColumn && fc.dateColumn !== "application_date") {
    state.dateField = fc.dateColumn;
  }
  const selection = buildPeriodSelectionFromFilterConfig(fc);
  if (selection?.preset) {
    state.preset = selection.preset;
    state.dateRange = selection.dateRange;
  }
  return Object.keys(state).length > 0 ? state : undefined;
}

export type GroupSavedFiltersPayload = {
  dateField?: string;
  periodSelection?: PeriodSelection;
  dateRange?: { start: string; end: string };
  year?: number;
};

export function buildGroupSavedFiltersFromFilterConfig(
  fc: WidgetFilterConfig | undefined,
): GroupSavedFiltersPayload | undefined {
  if (!fc?.filterable) return undefined;
  const dateField = fc.dateColumn ?? "application_date";
  const selection = buildPeriodSelectionFromFilterConfig(fc);
  if (!selection) {
    return dateField !== "application_date" ? { dateField } : undefined;
  }
  return {
    dateField,
    periodSelection: selection,
    dateRange: selection.dateRange,
  };
}

export function dominantDefaultPresetFromActions(
  actions: Array<{ filterConfig?: WidgetFilterConfig }>,
): string | null {
  const counts = new Map<string, number>();
  for (const a of actions) {
    const p = a.filterConfig?.defaultPreset;
    if (!p) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  for (const [preset, n] of counts) {
    if (n > max) {
      max = n;
      best = preset;
    }
  }
  return best;
}

export function allActionsShareSamePreset(
  actions: Array<{ filterConfig?: WidgetFilterConfig }>,
): boolean {
  const presets = actions
    .map((a) => a.filterConfig?.defaultPreset ?? null)
    .filter((p) => p != null);
  if (presets.length <= 1) return true;
  const first = presets[0];
  return presets.every((p) => p === first);
}
