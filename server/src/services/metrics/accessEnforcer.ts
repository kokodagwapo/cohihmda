/**
 * Loan access injection for SQL that uses alias `l` on public.loans.
 */

import type { LoanAccessFilter } from "../userLoanAccessService.js";
import { maxPgPlaceholderIndex, shiftPgPlaceholderIndexes } from "./safeSqlExecutor.js";

function trimSql(sql: string): string {
  return sql.replace(/;+\s*$/g, "").trim();
}

/**
 * Injects a loan access predicate into a query that uses `FROM public.loans l`.
 * - If the subquery already has `WHERE` immediately after the loans alias, inserts `(filter) AND`.
 * - Otherwise inserts `WHERE (1=1) AND (filter)`.
 */
export function injectLoanAccessForLoansAlias(
  sql: string,
  filter: LoanAccessFilter | null | undefined
): { sql: string; params: unknown[] } {
  const base = trimSql(sql);
  if (!filter?.sql) return { sql: base, params: [] };
  if (filter.sql === "FALSE") {
    return {
      sql: `SELECT * FROM (${base}) AS _access_guard WHERE FALSE`,
      params: [],
    };
  }

  const merged = base.replace(
    /\bFROM\s+public\.loans\s+l\s+WHERE\b/i,
    `FROM public.loans l WHERE (${filter.sql}) AND`
  );
  if (merged !== base) {
    return { sql: merged, params: [...filter.params] };
  }

  const merged2 = base.replace(
    /\bFROM\s+public\.loans\s+l\b/i,
    `FROM public.loans l WHERE (1=1) AND (${filter.sql})`
  );
  return { sql: merged2, params: [...filter.params] };
}

export function logFreeformSqlWithoutAccessAudit(surface: string): void {
  console.warn(
    `[accessEnforcer] Freeform SQL executed without deterministic access injection — surface=${surface}`
  );
}

/**
 * Merge loan-scope predicate with SQL that may already use `$1…$n` placeholders.
 * Access filter placeholders stay `$1…$k`; inner SQL is shifted by `filter.params.length`.
 */
export function mergeLoanAccessWithParameterizedSql(
  sql: string,
  params: unknown[] | undefined,
  filter: LoanAccessFilter | null | undefined
): { sql: string; params: unknown[] } {
  const baseParams = params ?? [];
  if (!filter?.sql) {
    return { sql: trimSql(sql), params: baseParams };
  }
  if (filter.sql === "FALSE") {
    return { sql: "SELECT 1 AS _no_loan_access WHERE FALSE", params: [] };
  }

  const innerMax = maxPgPlaceholderIndex(sql);
  if (innerMax === 0) {
    const inj = injectLoanAccessForLoansAlias(sql, filter);
    return { sql: inj.sql, params: [...inj.params, ...baseParams] };
  }

  const offset = filter.params.length;
  const shifted = shiftPgPlaceholderIndexes(sql, offset);
  const inj = injectLoanAccessForLoansAlias(shifted, filter);
  return { sql: inj.sql, params: [...inj.params, ...baseParams] };
}
