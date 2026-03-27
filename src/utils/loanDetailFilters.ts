export type LoanDetailFilterKind = "text" | "number" | "date" | "boolean";
export type NumericFilterMode = "all" | "range" | "min" | "max";
export type BooleanFilterValue = "all" | "yes" | "no";
export const EMPTY_FILTER_TOKEN = "__EMPTY__";

export type TextColumnFilter = {
  kind: "text";
  selectedValues: string[];
};

export type NumberColumnFilter = {
  kind: "number";
  mode: NumericFilterMode;
  selectedValues: string[];
  min?: string;
  max?: string;
  value?: string;
};

export type DateColumnFilter = {
  kind: "date";
  from?: string;
  to?: string;
  shortcut?: string;
};

export type BooleanColumnFilter = {
  kind: "boolean";
  value: BooleanFilterValue;
};

export type ColumnFilter =
  | TextColumnFilter
  | NumberColumnFilter
  | DateColumnFilter
  | BooleanColumnFilter;

export type ColumnFilterState = Record<string, ColumnFilter | undefined>;

import { computePresetDateRange, type PeriodPreset } from "@/components/ui/DatePeriodPicker";

function sortStringArray(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function normalizeFilterState(filters: ColumnFilterState): ColumnFilterState {
  const normalized: ColumnFilterState = {};
  const keys = Object.keys(filters).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const filter = filters[key];
    if (!filter || !isFilterActive(filter)) continue;
    if (filter.kind === "text") {
      normalized[key] = { kind: "text", selectedValues: sortStringArray(filter.selectedValues) };
      continue;
    }
    if (filter.kind === "number") {
      normalized[key] =
        filter.mode === "all"
          ? { kind: "number", mode: "all", selectedValues: sortStringArray(filter.selectedValues) }
          : filter.mode === "range"
            ? { kind: "number", mode: "range", selectedValues: [], min: filter.min ?? "", max: filter.max ?? "" }
            : { kind: "number", mode: filter.mode, selectedValues: [], value: filter.value ?? "" };
      continue;
    }
    if (filter.kind === "date") {
      normalized[key] = { kind: "date", from: filter.from ?? "", to: filter.to ?? "", shortcut: filter.shortcut ?? "" };
      continue;
    }
    normalized[key] = { kind: "boolean", value: filter.value };
  }
  return normalized;
}

export function areFilterStatesEquivalent(a: ColumnFilterState, b: ColumnFilterState): boolean {
  return JSON.stringify(normalizeFilterState(a)) === JSON.stringify(normalizeFilterState(b));
}

export function parseFilterDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const str = String(value).trim();
  if (!str) return null;

  const direct = new Date(str);
  if (!Number.isNaN(direct.getTime())) return direct;

  const usMatch = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function parseNumericValue(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[$,%\s,]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isEmptyLike(value: unknown): boolean {
  if (value == null) return true;
  const normalized = normalizeText(value);
  return normalized === "" || normalized === "-" || normalized === "–";
}

function getShortcutRange(shortcut: string): { start: Date | null; end: Date | null } {
  const token = shortcut.trim().toLowerCase();
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Prefer DatePeriodPicker for any matching preset token.
  const preset =
    token === "last 30 days"
      ? ("last-30-days" as const) // back-compat
      : (token as PeriodPreset);
  const presetTokens: PeriodPreset[] = ["last-30-days", "mtd", "ytd", "last-month", "rolling-13", "rolling-12"];
  if (presetTokens.includes(preset)) {
    const range = computePresetDateRange(preset);
    const start = new Date(range.start);
    const endDate = new Date(range.end);
    return {
      start: Number.isNaN(start.getTime()) ? null : start,
      end: Number.isNaN(endDate.getTime()) ? null : endDate,
    };
  }

  if (/^\d{4}$/.test(token)) {
    const year = Number(token);
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31) };
  }
  return { start: null, end: null };
}

function hasDateFilter(filter: DateColumnFilter): boolean {
  return Boolean(filter.shortcut?.trim() || filter.from?.trim() || filter.to?.trim());
}

export function isFilterActive(filter: ColumnFilter | undefined): boolean {
  if (!filter) return false;
  if (filter.kind === "text") return filter.selectedValues.length > 0;
  if (filter.kind === "number") {
    if (filter.mode === "all") return filter.selectedValues.length > 0;
    if (filter.mode === "range") return Boolean(filter.min?.trim() || filter.max?.trim());
    return Boolean(filter.value?.trim());
  }
  if (filter.kind === "date") return hasDateFilter(filter);
  return filter.value !== "all";
}

function matchesTextFilter(filter: TextColumnFilter, rawValue: unknown): boolean {
  if (filter.selectedValues.length === 0) return true;
  if (filter.selectedValues.includes(EMPTY_FILTER_TOKEN) && isEmptyLike(rawValue)) return true;
  const current = normalizeText(rawValue);
  return filter.selectedValues.some((v) => v !== EMPTY_FILTER_TOKEN && normalizeText(v) === current);
}

function matchesNumberFilter(filter: NumberColumnFilter, rawValue: unknown): boolean {
  const num = parseNumericValue(rawValue);
  if (filter.mode === "all") {
    if (filter.selectedValues.length === 0) return true;
    if (filter.selectedValues.includes(EMPTY_FILTER_TOKEN) && isEmptyLike(rawValue)) return true;
    if (num == null) return false;
    return filter.selectedValues.some((v) => v !== EMPTY_FILTER_TOKEN && parseNumericValue(v) === num);
  }
  if (num == null) return false;
  if (filter.mode === "range") {
    const min = parseNumericValue(filter.min);
    const max = parseNumericValue(filter.max);
    if (min == null && max == null) return true;
    if (min != null && num < min) return false;
    if (max != null && num > max) return false;
    return true;
  }
  const target = parseNumericValue(filter.value);
  if (target == null) return true;
  return filter.mode === "min" ? num >= target : num <= target;
}

function matchesDateFilter(filter: DateColumnFilter, rawValue: unknown): boolean {
  if (!hasDateFilter(filter)) return true;
  const valueDate = parseFilterDate(rawValue);
  if (!valueDate) return false;
  valueDate.setHours(0, 0, 0, 0);

  if (filter.shortcut?.trim()) {
    const { start, end } = getShortcutRange(filter.shortcut);
    if (!start || !end) return true;
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return valueDate >= start && valueDate <= end;
  }
  const from = parseFilterDate(filter.from);
  const to = parseFilterDate(filter.to);
  if (from) {
    from.setHours(0, 0, 0, 0);
    if (valueDate < from) return false;
  }
  if (to) {
    to.setHours(0, 0, 0, 0);
    if (valueDate > to) return false;
  }
  return true;
}

function matchesBooleanFilter(filter: BooleanColumnFilter, rawValue: unknown): boolean {
  if (filter.value === "all") return true;
  const yes = String(rawValue ?? "").trim().toLowerCase() === "yes" || rawValue === true;
  return filter.value === "yes" ? yes : !yes;
}

export function evaluateLoanDetailFilters<T>(
  rows: T[],
  filters: ColumnFilterState,
  getColumnValue: (row: T, columnId: string) => unknown,
): T[] {
  const activeEntries = Object.entries(filters).filter(([, filter]) => isFilterActive(filter));
  if (activeEntries.length === 0) return rows;

  return rows.filter((row) => {
    for (const [columnId, filter] of activeEntries) {
      if (!filter) continue;
      const value = getColumnValue(row, columnId);
      const ok =
        filter.kind === "text"
          ? matchesTextFilter(filter, value)
          : filter.kind === "number"
            ? matchesNumberFilter(filter, value)
            : filter.kind === "date"
              ? matchesDateFilter(filter, value)
              : matchesBooleanFilter(filter, value);
      if (!ok) return false;
    }
    return true;
  });
}
