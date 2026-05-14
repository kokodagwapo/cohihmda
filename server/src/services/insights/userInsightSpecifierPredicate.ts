/**
 * Deterministic SQL predicates for My Insights custom prompt specifiers.
 *
 * Supported per-column shapes:
 * - Legacy: { [loans_column]: string[] } — `l.col = ANY($n::text[])`
 * - Structured (matches client ColumnFilter): { kind: "text" | "number" | "date" | "boolean", ... }
 *
 * Reserved keys (not SQL cohort columns): `_prompt_tag` — UI-only tag → functional_category at persist time.
 */

import { DateTime } from "luxon";
import type { LoanAccessFilter } from "../userLoanAccessService.js";
import { shiftPgPlaceholderIndexes } from "../metrics/safeSqlExecutor.js";

const SAFE_COL = /^[a-z][a-z0-9_]*$/i;

/** Keys stored alongside loan-column specifiers; never sent to SQL column allowlist. */
export const RESERVED_MY_INSIGHT_SPECIFIER_KEYS = new Set(["_prompt_tag"]);

const ALLOWED_PROMPT_TAGS = new Set([
  "operations",
  "sales",
  "finance",
  "secondary_marketing",
  "compliance",
]);

export type SpecifierPredicateBuildResult =
  | { ok: true; filter: LoanAccessFilter | null }
  | { ok: false; invalidKeys: string[] };

type TextFilter = { kind: "text"; selectedValues: string[] };
type NumberFilter = {
  kind: "number";
  mode: "all" | "range" | "min" | "max";
  selectedValues: string[];
  min?: string;
  max?: string;
  value?: string;
};
type DateFilter = { kind: "date"; from?: string; to?: string; shortcut?: string };
type BooleanFilter = { kind: "boolean"; value: "all" | "yes" | "no" };
type ColumnFilter = TextFilter | NumberFilter | DateFilter | BooleanFilter;

const EMPTY_FILTER_TOKEN = "__EMPTY__";
const DATE_FILTER_BLANK_SHORTCUT = "-";

function isBlankishTextColSql(col: string): string {
  return `(l.${col} IS NULL OR lower(trim(l.${col}::text)) IN ('', '-', '–', 'null'))`;
}

function isSpecifierColumnFilterActive(f: ColumnFilter): boolean {
  if (f.kind === "text") return f.selectedValues.length > 0;
  if (f.kind === "number") {
    if (f.mode === "all") return f.selectedValues.length > 0;
    if (f.mode === "range") return Boolean((f.min ?? "").trim() || (f.max ?? "").trim());
    return Boolean((f.value ?? "").trim());
  }
  if (f.kind === "date") {
    const sc = (f.shortcut ?? "").trim();
    if (sc === DATE_FILTER_BLANK_SHORTCUT) return true;
    if (sc === "after") return Boolean((f.from ?? "").trim());
    if (sc === "before") return Boolean((f.to ?? "").trim());
    if (sc) return true;
    return Boolean((f.from ?? "").trim() || (f.to ?? "").trim());
  }
  return f.value !== "all";
}

function tryParseColumnFilter(v: unknown): ColumnFilter | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "text" && Array.isArray(o.selectedValues)) {
    return { kind: "text", selectedValues: o.selectedValues.map((x) => String(x)) };
  }
  if (kind === "number" && typeof o.mode === "string") {
    const mode = o.mode as NumberFilter["mode"];
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
  if (kind === "date") {
    return {
      kind: "date",
      from: o.from != null ? String(o.from) : undefined,
      to: o.to != null ? String(o.to) : undefined,
      shortcut: o.shortcut != null ? String(o.shortcut) : undefined,
    };
  }
  if (kind === "boolean" && typeof o.value === "string" && ["all", "yes", "no"].includes(o.value)) {
    return { kind: "boolean", value: o.value as BooleanFilter["value"] };
  }
  return null;
}

function presetRangeIso(preset: string, now = DateTime.now()): { start: string; end: string } | null {
  const p = preset.trim().toLowerCase();
  const today = now.startOf("day");
  const iso = (d: DateTime) => d.toISODate()!;

  switch (p) {
    case "last-30-days":
    case "last 30 days":
      return { start: iso(today.minus({ days: 29 })), end: iso(today) };
    case "mtd":
      return { start: iso(today.startOf("month")), end: iso(today) };
    case "qtd":
      return { start: iso(today.startOf("quarter")), end: iso(today) };
    case "ytd":
      return { start: iso(today.startOf("year")), end: iso(today) };
    case "last-month": {
      const d = today.minus({ months: 1 });
      return { start: iso(d.startOf("month")), end: iso(d.endOf("month")) };
    }
    case "last-quarter": {
      const d = today.minus({ quarters: 1 });
      return { start: iso(d.startOf("quarter")), end: iso(d.endOf("quarter")) };
    }
    case "rolling-13":
      return { start: iso(today.minus({ months: 13 }).startOf("month")), end: iso(today) };
    case "rolling-12":
      return { start: iso(today.minus({ months: 12 }).startOf("month")), end: iso(today) };
    default: {
      if (/^\d{4}$/.test(p)) {
        const y = Number(p);
        return { start: `${y}-01-01`, end: `${y}-12-31` };
      }
      return null;
    }
  }
}

function valuesForLegacyEntry(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter((s) => s.length > 0);
  }
  if (["string", "number", "boolean"].includes(typeof v)) {
    const s = String(v).trim();
    return s.length ? [s] : [];
  }
  return [];
}

function isSpecifierEntryActive(col: string, v: unknown): boolean {
  if (RESERVED_MY_INSIGHT_SPECIFIER_KEYS.has(col)) return false;
  const parsed = tryParseColumnFilter(v);
  if (parsed) return isSpecifierColumnFilterActive(parsed);
  return valuesForLegacyEntry(v).length > 0;
}

/**
 * True when specifiers object has no cohort keys with values (ignores reserved keys like `_prompt_tag`).
 */
export function isSpecifierObjectEmpty(specifiers: Record<string, unknown> | null | undefined): boolean {
  if (!specifiers || typeof specifiers !== "object") return true;
  for (const [k, v] of Object.entries(specifiers)) {
    if (isSpecifierEntryActive(k, v)) return false;
  }
  return true;
}

/** Optional functional_category from saved prompt UI (not a loans column). */
export function parsePromptFunctionalCategoryFromSpecifiers(
  specifiers: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!specifiers || typeof specifiers !== "object") return undefined;
  const raw = specifiers["_prompt_tag"];
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s || !ALLOWED_PROMPT_TAGS.has(s)) return undefined;
  return s;
}

function pushTextAllMode(col: string, selected: string[], clauses: string[], params: unknown[]): void {
  const hasEmpty = selected.includes(EMPTY_FILTER_TOKEN);
  const rest = selected.filter((x) => x !== EMPTY_FILTER_TOKEN);
  const parts: string[] = [];
  if (hasEmpty) parts.push(isBlankishTextColSql(col));
  if (rest.length > 0) {
    const p = params.length + 1;
    params.push(rest);
    parts.push(`trim(l.${col}::text) = ANY($${p}::text[])`);
  }
  if (parts.length === 1) {
    clauses.push(parts[0]!);
  } else if (parts.length === 2) {
    clauses.push(`(${parts[0]} OR ${parts[1]})`);
  }
}

function pushNumberAllMode(col: string, selected: string[], clauses: string[], params: unknown[]): void {
  const hasEmpty = selected.includes(EMPTY_FILTER_TOKEN);
  const rest = selected.filter((x) => x !== EMPTY_FILTER_TOKEN);
  const parts: string[] = [];
  if (hasEmpty) parts.push(`${isBlankishTextColSql(col)} OR trim(l.${col}::text) !~ '^[-0-9.]+$'`);
  if (rest.length > 0) {
    const p = params.length + 1;
    params.push(rest);
    parts.push(
      `(nullif(trim(l.${col}::text), '') IS NOT NULL AND nullif(trim(l.${col}::text), '')::numeric = ANY(SELECT unnest($${p}::text[])::numeric))`,
    );
  }
  if (parts.length === 1) clauses.push(parts[0]!);
  else if (parts.length === 2) clauses.push(`(${parts[0]} OR ${parts[1]})`);
}

function sqlForColumnFilter(col: string, f: ColumnFilter, clauses: string[], params: unknown[]): void {
  if (!isSpecifierColumnFilterActive(f)) return;

  if (f.kind === "boolean") {
    if (f.value === "all") return;
    if (f.value === "yes") {
      clauses.push(
        `(lower(trim(l.${col}::text)) IN ('yes','y','true','1') OR l.${col}::text = 't' OR l.${col} IS TRUE)`,
      );
    } else {
      clauses.push(
        `(NOT (lower(trim(l.${col}::text)) IN ('yes','y','true','1') OR l.${col}::text = 't' OR l.${col} IS TRUE) OR l.${col} IS NULL)`,
      );
    }
    return;
  }

  if (f.kind === "text") {
    pushTextAllMode(col, f.selectedValues, clauses, params);
    return;
  }

  if (f.kind === "number") {
    if (f.mode === "all") {
      pushNumberAllMode(col, f.selectedValues, clauses, params);
      return;
    }
    if (f.mode === "range") {
      const minT = (f.min ?? "").trim();
      const maxT = (f.max ?? "").trim();
      const parts: string[] = [`(nullif(trim(l.${col}::text), '') IS NOT NULL)`];
      if (minT) {
        const p = params.length + 1;
        params.push(minT);
        parts.push(`nullif(trim(l.${col}::text), '')::numeric >= $${p}::numeric`);
      }
      if (maxT) {
        const p = params.length + 1;
        params.push(maxT);
        parts.push(`nullif(trim(l.${col}::text), '')::numeric <= $${p}::numeric`);
      }
      clauses.push(`(${parts.join(" AND ")})`);
      return;
    }
    const valT = (f.value ?? "").trim();
    if (!valT) return;
    const p = params.length + 1;
    params.push(valT);
    if (f.mode === "min") {
      clauses.push(
        `(nullif(trim(l.${col}::text), '') IS NOT NULL AND nullif(trim(l.${col}::text), '')::numeric >= $${p}::numeric)`,
      );
    } else {
      clauses.push(
        `(nullif(trim(l.${col}::text), '') IS NOT NULL AND nullif(trim(l.${col}::text), '')::numeric <= $${p}::numeric)`,
      );
    }
    return;
  }

  // date
  const sc = (f.shortcut ?? "").trim();
  if (sc === DATE_FILTER_BLANK_SHORTCUT) {
    clauses.push(isBlankishTextColSql(col));
    return;
  }
  if (sc === "after") {
    const from = (f.from ?? "").trim();
    if (!from) return;
    const p = params.length + 1;
    params.push(from);
    clauses.push(`(l.${col}::date >= $${p}::date)`);
    return;
  }
  if (sc === "before") {
    const to = (f.to ?? "").trim();
    if (!to) return;
    const p = params.length + 1;
    params.push(to);
    clauses.push(`(l.${col}::date <= $${p}::date)`);
    return;
  }
  if (sc) {
    const r = presetRangeIso(sc);
    if (!r) return;
    const p1 = params.length + 1;
    const p2 = params.length + 2;
    params.push(r.start, r.end);
    clauses.push(`(l.${col}::date >= $${p1}::date AND l.${col}::date <= $${p2}::date)`);
    return;
  }
  const from = (f.from ?? "").trim();
  const to = (f.to ?? "").trim();
  if (!from && !to) return;
  const parts: string[] = [];
  if (from) {
    const p = params.length + 1;
    params.push(from);
    parts.push(`l.${col}::date >= $${p}::date`);
  }
  if (to) {
    const p = params.length + 1;
    params.push(to);
    parts.push(`l.${col}::date <= $${p}::date`);
  }
  clauses.push(`(${parts.join(" AND ")})`);
}

/**
 * Build a LoanAccessFilter-shaped predicate on loans alias `l` from specifiers.
 * Fail-fast: any key not in allowlist or failing SAFE_COL yields ok: false.
 */
export function buildSpecifierPredicateSql(
  specifiers: Record<string, unknown>,
  allowedColumns: Set<string>,
): SpecifierPredicateBuildResult {
  if (!specifiers || typeof specifiers !== "object") {
    return { ok: true, filter: null };
  }

  const invalidKeys: string[] = [];
  const clauses: string[] = [];
  const params: unknown[] = [];

  const keys = Object.keys(specifiers).sort();
  for (const col of keys) {
    if (RESERVED_MY_INSIGHT_SPECIFIER_KEYS.has(col)) continue;

    const raw = specifiers[col];
    const parsed = tryParseColumnFilter(raw);
    if (parsed) {
      if (!isSpecifierColumnFilterActive(parsed)) continue;
    } else if (valuesForLegacyEntry(raw).length === 0) {
      continue;
    }

    if (!SAFE_COL.test(col)) {
      invalidKeys.push(col);
      continue;
    }
    if (!allowedColumns.has(col)) {
      invalidKeys.push(col);
      continue;
    }

    if (parsed) {
      sqlForColumnFilter(col, parsed, clauses, params);
      continue;
    }

    const vals = valuesForLegacyEntry(raw);
    const p = params.length + 1;
    clauses.push(`l.${col}::text = ANY($${p}::text[])`);
    params.push(vals);
  }

  if (invalidKeys.length > 0) {
    return { ok: false, invalidKeys: [...new Set(invalidKeys)] };
  }

  if (clauses.length === 0) {
    return { ok: true, filter: null };
  }

  const sql = clauses.length === 1 ? clauses[0]! : `(${clauses.join(" AND ")})`;
  return { ok: true, filter: { sql, params, paramOffset: params.length } };
}

/**
 * Merge loan access filter with specifier cohort predicate for `public.loans l` injection.
 * - access null: specifier-only (or TRUE if specifier empty).
 * - specifier filter sql "TRUE" with empty params: treated as no specifier constraint.
 */
export function composeAccessAndSpecifierFilters(
  accessFilter: LoanAccessFilter | null | undefined,
  specifierFilter: LoanAccessFilter | null | undefined,
): LoanAccessFilter | null {
  const spec = specifierFilter;
  const hasSpec = !!(spec && spec.sql && (spec.params?.length ?? 0) > 0);

  if (accessFilter?.sql === "FALSE") {
    return accessFilter;
  }

  if (!accessFilter?.sql && !hasSpec) {
    return accessFilter ?? null;
  }

  if (!accessFilter?.sql && hasSpec && spec) {
    return { sql: spec.sql, params: [...spec.params], paramOffset: spec.params.length };
  }

  if (accessFilter?.sql && !hasSpec) {
    return accessFilter;
  }

  if (accessFilter?.sql && hasSpec && spec) {
    const offset = accessFilter.params.length;
    const shiftedSpecSql = shiftPgPlaceholderIndexes(spec.sql, offset);
    const sql = `(${accessFilter.sql}) AND (${shiftedSpecSql})`;
    const params = [...accessFilter.params, ...spec.params];
    return { sql, params, paramOffset: params.length };
  }

  return accessFilter ?? null;
}
