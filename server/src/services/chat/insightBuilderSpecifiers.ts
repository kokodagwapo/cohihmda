/**
 * Normalize LLM-produced specifiers into My Insights ColumnFilter shape.
 */

import { buildSpecifierPredicateSql } from "../insights/userInsightSpecifierPredicate.js";
import { suggestLoanColumns } from "./suggestLoanColumns.js";

type TextFilter = { kind: "text"; selectedValues: string[] };
type ColumnFilter =
  | TextFilter
  | { kind: "number"; mode: string; selectedValues?: string[]; min?: string; max?: string; value?: string }
  | { kind: "date"; from?: string; to?: string; shortcut?: string }
  | { kind: "boolean"; value: string };

function isFilterActive(filter: ColumnFilter): boolean {
  if (filter.kind === "text") return filter.selectedValues.length > 0;
  if (filter.kind === "boolean") return filter.value !== "all";
  if (filter.kind === "number") {
    if (filter.mode === "all") return (filter.selectedValues?.length ?? 0) > 0;
    if (filter.mode === "range") return Boolean(filter.min?.trim() || filter.max?.trim());
    return Boolean(filter.value?.trim());
  }
  if (filter.kind === "date") {
    return Boolean(
      (filter.shortcut ?? "").trim() ||
        (filter.from ?? "").trim() ||
        (filter.to ?? "").trim(),
    );
  }
  return false;
}

function tryParseStructuredFilter(v: unknown): ColumnFilter | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "text" && Array.isArray(o.selectedValues)) {
    return { kind: "text", selectedValues: o.selectedValues.map((x) => String(x)) };
  }
  if (kind === "number" && typeof o.mode === "string") {
    return {
      kind: "number",
      mode: String(o.mode),
      selectedValues: Array.isArray(o.selectedValues)
        ? o.selectedValues.map((x) => String(x))
        : [],
      min: o.min != null ? String(o.min) : undefined,
      max: o.max != null ? String(o.max) : undefined,
      value: o.value != null ? String(o.value) : undefined,
    };
  }
  if (kind === "date") {
    return {
      kind: "date",
      from: o.from != null ? String(o.from) : undefined,
      to: o.to != null ? String(o.to) : undefined,
      shortcut: o.shortcut != null ? String(o.shortcut) : undefined,
    };
  }
  if (kind === "boolean" && typeof o.value === "string") {
    return { kind: "boolean", value: o.value };
  }
  return null;
}

/** Coerce common LLM shorthand into ColumnFilter (text cohort by default). */
export function coerceSpecifierValue(v: unknown): ColumnFilter | null {
  const structured = tryParseStructuredFilter(v);
  if (structured && isFilterActive(structured)) return structured;

  if (Array.isArray(v)) {
    const vals = v.map((x) => String(x).trim()).filter(Boolean);
    if (!vals.length) return null;
    return { kind: "text", selectedValues: vals };
  }

  if (v != null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.selectedValues)) {
      const vals = o.selectedValues.map((x) => String(x).trim()).filter(Boolean);
      if (vals.length) return { kind: "text", selectedValues: vals };
    }
    if (Array.isArray(o.values)) {
      const vals = o.values.map((x) => String(x).trim()).filter(Boolean);
      if (vals.length) return { kind: "text", selectedValues: vals };
    }
    if (o.value != null && String(o.value).trim()) {
      return { kind: "text", selectedValues: [String(o.value).trim()] };
    }
  }

  if (typeof v === "string" && v.trim()) {
    return { kind: "text", selectedValues: [v.trim()] };
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return { kind: "text", selectedValues: [String(v)] };
  }

  return null;
}

function resolveColumnKey(
  rawKey: string,
  columns: { name: string; type?: string }[],
  allowedColumns: Set<string>,
): string {
  const key = rawKey.trim();
  if (!key) return key;
  if (allowedColumns.has(key)) return key;
  const suggestions = suggestLoanColumns(key, columns, 3);
  if (suggestions.length === 1) return suggestions[0].name;
  const exact = suggestions.find(
    (s) => s.name.toLowerCase() === key.toLowerCase().replace(/\s+/g, "_"),
  );
  return exact?.name ?? key;
}

/**
 * Normalize specifiers from LLM JSON into validated column → ColumnFilter map.
 */
export function normalizeInsightBuilderSpecifiers(
  raw: unknown,
  columns: { name: string; type?: string }[],
  allowedColumns: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (raw == null) return out;

  const ingest = (colKey: string, val: unknown) => {
    const col = resolveColumnKey(colKey, columns, allowedColumns);
    if (col === "_prompt_tag") {
      out._prompt_tag = val;
      return;
    }
    const filter = coerceSpecifierValue(val);
    if (filter && isFilterActive(filter)) {
      out[col] = filter;
    }
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const col =
        (typeof o.column === "string" && o.column) ||
        (typeof o.name === "string" && o.name) ||
        (typeof o.key === "string" && o.key) ||
        "";
      if (!col) continue;
      const val = o.filter ?? o.value ?? o.values ?? o;
      ingest(col, val);
    }
    return out;
  }

  if (!raw || typeof raw !== "object") return out;

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === "_prompt_tag") {
      out._prompt_tag = v;
      continue;
    }
    ingest(k, v);
  }

  const pred = buildSpecifierPredicateSql(out, allowedColumns);
  if (pred.ok === false) {
    for (const bad of pred.invalidKeys) {
      delete out[bad];
    }
  }

  return out;
}
