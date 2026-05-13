/**
 * Deterministic SQL predicates for My Insights custom prompt specifiers.
 * Specifiers shape: { [loans_column]: string[] } (see CohiPromptsCard specifiersObjectFromRows).
 */

import type { LoanAccessFilter } from "../userLoanAccessService.js";
import { shiftPgPlaceholderIndexes } from "../metrics/safeSqlExecutor.js";

const SAFE_COL = /^[a-z][a-z0-9_]*$/i;

export type SpecifierPredicateBuildResult =
  | { ok: true; filter: LoanAccessFilter | null }
  | { ok: false; invalidKeys: string[] };

/**
 * True when specifiers object has no cohort keys with values.
 */
export function isSpecifierObjectEmpty(specifiers: Record<string, unknown> | null | undefined): boolean {
  if (!specifiers || typeof specifiers !== "object") return true;
  for (const [, v] of Object.entries(specifiers)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (Array.isArray(v) && v.some((x) => String(x).trim().length > 0)) return false;
    if (!Array.isArray(v) && String(v).trim().length > 0) return false;
  }
  return true;
}

function valuesForEntry(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter((s) => s.length > 0);
  }
  if (["string", "number", "boolean"].includes(typeof v)) {
    const s = String(v).trim();
    return s.length ? [s] : [];
  }
  return [JSON.stringify(v)];
}

/**
 * Build a LoanAccessFilter-shaped predicate on loans alias `l` from specifiers.
 * Fail-fast: any key not in allowlist or failing SAFE_COL yields ok: false.
 */
export function buildSpecifierPredicateSql(
  specifiers: Record<string, unknown>,
  allowedColumns: Set<string>
): SpecifierPredicateBuildResult {
  if (!specifiers || typeof specifiers !== "object") {
    return { ok: true, filter: null };
  }

  const invalidKeys: string[] = [];
  const clauses: string[] = [];
  const params: unknown[] = [];

  const keys = Object.keys(specifiers).sort();
  for (const col of keys) {
    const vals = valuesForEntry(specifiers[col]);
    if (vals.length === 0) continue;

    if (!SAFE_COL.test(col)) {
      invalidKeys.push(col);
      continue;
    }
    if (!allowedColumns.has(col)) {
      invalidKeys.push(col);
      continue;
    }

    const p = params.length + 1;
    clauses.push(`l.${col} = ANY($${p}::text[])`);
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
  specifierFilter: LoanAccessFilter | null | undefined
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
