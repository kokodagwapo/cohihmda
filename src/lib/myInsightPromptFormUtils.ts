/**
 * Shared My Insights custom prompt form helpers (Add prompt modal + Insight builder).
 */

import type { ColumnFilter, LoanDetailFilterKind } from "@/utils/loanDetailFilters";
import { EMPTY_FILTER_TOKEN, isFilterActive } from "@/utils/loanDetailFilters";

export interface LoanColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  displayName: string;
  category: string;
}

export const MY_INSIGHT_PROMPT_TAG_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "", label: "(blank)" },
  { id: "operations", label: "Operations" },
  { id: "sales", label: "Sales" },
  { id: "finance", label: "Finance" },
  { id: "secondary_marketing", label: "Secondary Marketing" },
  { id: "compliance", label: "Compliance" },
];

export interface MyInsightPromptDraft {
  title: string;
  prompt_text: string;
  schedule: "batch" | "on_demand";
  prompt_tag: string;
  specifiers: Record<string, unknown>;
}

export interface PromptSpecifierRow {
  id: string;
  column: string;
  filter: ColumnFilter;
  options: string[];
  optionsLoading: boolean;
  optionsError: string | null;
}

export function inferFilterKindFromPgColumn(
  meta: LoanColumnMeta | undefined,
  columnName: string,
): LoanDetailFilterKind {
  if (!meta) {
    return columnName.toLowerCase().includes("date") ? "date" : "text";
  }
  const t = meta.type.toLowerCase();
  if (t === "boolean") return "boolean";
  if (
    t.includes("numeric") ||
    t === "integer" ||
    t === "bigint" ||
    t === "double precision" ||
    t === "real" ||
    t === "smallint"
  ) {
    return "number";
  }
  if (t.includes("date") || t.includes("timestamp")) return "date";
  return "text";
}

export function defaultFilterForKind(kind: LoanDetailFilterKind): ColumnFilter {
  if (kind === "boolean") return { kind: "boolean", value: "all" };
  if (kind === "number") return { kind: "number", mode: "all", selectedValues: [] };
  if (kind === "date") return { kind: "date" };
  return { kind: "text", selectedValues: [] };
}

export function createEmptySpecifierRow(): PromptSpecifierRow {
  return {
    id: `sr-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    column: "",
    filter: { kind: "text", selectedValues: [] },
    options: [],
    optionsLoading: false,
    optionsError: null,
  };
}

export function specifiersObjectFromRows(
  rows: PromptSpecifierRow[],
  promptTag: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const key = r.column.trim();
    if (!key || !isFilterActive(r.filter)) continue;
    out[key] = r.filter;
  }
  const tag = promptTag.trim().toLowerCase();
  if (
    tag &&
    ["operations", "sales", "finance", "secondary_marketing", "compliance"].includes(tag)
  ) {
    out._prompt_tag = tag;
  }
  return out;
}

/** Coerce LLM shorthand or legacy shapes before strict ColumnFilter parse. */
export function coerceSpecifierValueForUi(v: unknown): ColumnFilter | null {
  const parsed = tryParseStoredFilter(v);
  if (parsed) return parsed;
  if (Array.isArray(v)) {
    const vals = v.map((x) => String(x).trim()).filter(Boolean);
    if (vals.length) return { kind: "text", selectedValues: vals };
  }
  if (v != null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.selectedValues)) {
      return {
        kind: "text",
        selectedValues: o.selectedValues.map((x) => String(x)),
      };
    }
    if (Array.isArray(o.values)) {
      return { kind: "text", selectedValues: o.values.map((x) => String(x)) };
    }
    if (o.value != null && String(o.value).trim()) {
      return { kind: "text", selectedValues: [String(o.value).trim()] };
    }
  }
  if (typeof v === "string" && v.trim()) {
    return { kind: "text", selectedValues: [v.trim()] };
  }
  return null;
}

export function tryParseStoredFilter(v: unknown): ColumnFilter | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.kind !== "string") return null;
  if (o.kind === "text" && Array.isArray(o.selectedValues)) {
    return { kind: "text", selectedValues: o.selectedValues.map((x) => String(x)) };
  }
  if (o.kind === "number" && typeof o.mode === "string") {
    const mode = o.mode as "all" | "range" | "min" | "max";
    if (!["all", "range", "min", "max"].includes(mode)) return null;
    return {
      kind: "number",
      mode,
      selectedValues: Array.isArray(o.selectedValues) ? o.selectedValues.map((x) => String(x)) : [],
      min: o.min != null ? String(o.min) : undefined,
      max: o.max != null ? String(o.max) : undefined,
      value: o.value != null ? String(o.value) : undefined,
    };
  }
  if (o.kind === "date") {
    return {
      kind: "date",
      from: o.from != null ? String(o.from) : undefined,
      to: o.to != null ? String(o.to) : undefined,
      shortcut: o.shortcut != null ? String(o.shortcut) : undefined,
    };
  }
  if (o.kind === "boolean" && typeof o.value === "string" && ["all", "yes", "no"].includes(o.value)) {
    return { kind: "boolean", value: o.value as "all" | "yes" | "no" };
  }
  return null;
}

function legacyArrayToFilter(arr: string[], kind: LoanDetailFilterKind): ColumnFilter {
  if (kind === "number") return { kind: "number", mode: "all", selectedValues: arr };
  if (kind === "boolean") {
    const s = arr[0]?.toLowerCase();
    if (s === "yes" || s === "no") return { kind: "boolean", value: s };
    return { kind: "boolean", value: "all" };
  }
  return { kind: "text", selectedValues: arr };
}

export function rowsFromSpecifiersObject(
  spec: Record<string, unknown> | null | undefined,
  columns: LoanColumnMeta[],
): PromptSpecifierRow[] {
  if (!spec || typeof spec !== "object") return [];
  const rows: PromptSpecifierRow[] = [];
  for (const [k, v] of Object.entries(spec)) {
    if (k === "_prompt_tag") continue;
    if (v === undefined || v === null) continue;
    const row = createEmptySpecifierRow();
    const colMeta = columns.find((c) => c.name === k);
    const fk = inferFilterKindFromPgColumn(colMeta, k);
    if (Array.isArray(v)) {
      const vals = v.map((x) => String(x)).filter((s) => s.length > 0);
      if (!vals.length) continue;
      rows.push({ ...row, column: k, filter: legacyArrayToFilter(vals, fk) });
      continue;
    }
    const parsed = tryParseStoredFilter(v) ?? coerceSpecifierValueForUi(v);
    if (parsed) {
      rows.push({ ...row, column: k, filter: parsed });
      continue;
    }
    if (["string", "number", "boolean"].includes(typeof v)) {
      rows.push({ ...row, column: k, filter: legacyArrayToFilter([String(v)], fk) });
    }
  }
  return rows;
}

export function summarizeSpecifierFilterButton(
  colMeta: LoanColumnMeta | undefined,
  column: string,
  filter: ColumnFilter,
): string {
  if (!column.trim()) return "Choose column…";
  if (!isFilterActive(filter)) return "Set filter…";
  const name = colMeta?.displayName ?? column;
  if (filter.kind === "boolean") {
    return `${name}: ${filter.value === "all" ? "All" : filter.value === "yes" ? "Yes" : "No"}`;
  }
  if (filter.kind === "date") {
    const sc = (filter.shortcut ?? "").trim();
    if (sc === "-") return `${name}: No date (blank)`;
    if (sc === "after" && filter.from) return `${name}: After ${filter.from}`;
    if (sc === "before" && filter.to) return `${name}: Before ${filter.to}`;
    if (sc && filter.from && filter.to) return `${name}: ${sc} (${filter.from}–${filter.to})`;
    if (filter.from && filter.to) return `${name}: ${filter.from}–${filter.to}`;
    if (filter.from) return `${name}: from ${filter.from}`;
    if (filter.to) return `${name}: to ${filter.to}`;
    return `${name}: date filter`;
  }
  if (filter.kind === "number") {
    if (filter.mode === "all")
      return filter.selectedValues.length <= 1
        ? `${name}: ${filter.selectedValues[0] === EMPTY_FILTER_TOKEN ? "(Blank)" : (filter.selectedValues[0] ?? "")}`
        : `${name}: ${filter.selectedValues.length} values`;
    if (filter.mode === "range") return `${name}: ${filter.min ?? "…"} – ${filter.max ?? "…"}`;
    if (filter.mode === "min") return `${name}: ≥ ${filter.value ?? ""}`;
    return `${name}: ≤ ${filter.value ?? ""}`;
  }
  const n = filter.selectedValues.length;
  if (n === 0) return "Set filter…";
  if (n === 1) {
    const s = filter.selectedValues[0] === EMPTY_FILTER_TOKEN ? "(Blank)" : filter.selectedValues[0];
    const t = s.length > 36 ? `${s.slice(0, 34)}…` : s;
    return `${name}: ${t}`;
  }
  return `${name}: ${n} selected`;
}

export function syncDraftSpecifiersFromRows(
  draft: MyInsightPromptDraft,
  rows: PromptSpecifierRow[],
): MyInsightPromptDraft {
  return {
    ...draft,
    specifiers: specifiersObjectFromRows(rows, draft.prompt_tag),
  };
}
