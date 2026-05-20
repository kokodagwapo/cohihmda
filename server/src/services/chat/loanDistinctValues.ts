/**
 * Tenant loans distinct values for insight builder filter validation.
 */

import type { Pool } from "pg";

const DISTINCT_LIMIT = 100;

function isSafeLoansColumnName(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/i.test(name) && name.length <= 120;
}

function quoteIdent(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

export async function fetchDistinctValuesForColumn(
  tenantPool: Pool,
  column: string,
): Promise<string[]> {
  if (!isSafeLoansColumnName(column)) return [];

  const colCheck = await tenantPool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = $1
     LIMIT 1`,
    [column],
  );
  if (!colCheck.rows.length) return [];

  const q = quoteIdent(column);
  const result = await tenantPool.query(
    `SELECT DISTINCT ${q}::text AS value FROM public.loans
     WHERE ${q} IS NOT NULL AND TRIM(${q}::text) <> ''
     ORDER BY 1
     LIMIT ${DISTINCT_LIMIT}`,
  );
  return result.rows.map((r) => String(r.value));
}
