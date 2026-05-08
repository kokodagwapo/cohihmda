/**
 * Unified safe SQL execution for AI surfaces — timeouts, validation,
 * optional circuit breaker and per-tenant concurrency limiting.
 */

import pg from "pg";

export function maxPgPlaceholderIndex(sql: string): number {
  let max = 0;
  const re = /\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** Renumber `$n` placeholders so composed queries can prepend access predicates ($1…$k). */
export function shiftPgPlaceholderIndexes(sql: string, delta: number): string {
  if (delta === 0) return sql;
  return sql.replace(/\$(\d+)/g, (_m, digits: string) => {
    const n = parseInt(digits, 10);
    return `$${n + delta}`;
  });
}

export const DANGEROUS_SQL_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "TRUNCATE",
  "ALTER",
  "CREATE",
  "GRANT",
  "REVOKE",
];

export interface SafeSqlExecutorOptions {
  /** Postgres statement_timeout duration string (default 30s) */
  statementTimeoutMs?: number;
  /** Skip keyword validation (still SELECT/WITH only) */
  skipDangerousKeywordScan?: boolean;
}

export interface SafeSqlQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
  executionTimeMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const tenantFailureCounts = new Map<string, number>();
const tenantCircuitOpenUntil = new Map<string, number>();
const CIRCUIT_THRESHOLD = 8;
const CIRCUIT_COOLDOWN_MS = 60_000;

const tenantConcurrency = new Map<string, number>();
const MAX_CONCURRENT_PER_TENANT = 3;

function sanitizeSQL(sql: string): string {
  let sanitized = sql.trim();
  if (sanitized.endsWith(";")) sanitized = sanitized.slice(0, -1).trim();
  return sanitized;
}

export function validateReadOnlySql(sql: string): void {
  const upper = sql.trim().toUpperCase();
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    throw new Error("Only SELECT queries (and CTEs starting with WITH) are allowed.");
  }
  for (const kw of DANGEROUS_SQL_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\s`, "i");
    if (regex.test(upper)) {
      throw new Error(`Query contains forbidden keyword: ${kw}`);
    }
  }
}

/**
 * Validate read-only SQL (exported for reuse outside executor).
 */
export function sanitizeAndValidateReadOnlySql(sql: string): string {
  const sanitized = sanitizeSQL(sql);
  validateReadOnlySql(sanitized);
  return sanitized;
}

async function withConcurrencyLimit<T>(
  tenantId: string,
  fn: () => Promise<T>
): Promise<T> {
  const cur = tenantConcurrency.get(tenantId) ?? 0;
  if (cur >= MAX_CONCURRENT_PER_TENANT) {
    throw new Error(
      `Too many concurrent AI SQL queries for this workspace (max ${MAX_CONCURRENT_PER_TENANT}). Try again shortly.`
    );
  }
  tenantConcurrency.set(tenantId, cur + 1);
  try {
    return await fn();
  } finally {
    const n = (tenantConcurrency.get(tenantId) ?? 1) - 1;
    tenantConcurrency.set(tenantId, Math.max(0, n));
  }
}

function recordCircuitFailure(tenantId: string): void {
  const n = (tenantFailureCounts.get(tenantId) ?? 0) + 1;
  tenantFailureCounts.set(tenantId, n);
  if (n >= CIRCUIT_THRESHOLD) {
    tenantCircuitOpenUntil.set(tenantId, Date.now() + CIRCUIT_COOLDOWN_MS);
    tenantFailureCounts.set(tenantId, 0);
  }
}

function recordCircuitSuccess(tenantId: string): void {
  tenantFailureCounts.delete(tenantId);
}

function assertCircuitClosed(tenantId: string): void {
  const until = tenantCircuitOpenUntil.get(tenantId);
  if (until && Date.now() < until) {
    throw new Error(
      "Database query circuit breaker is open due to repeated failures. Try again in a minute."
    );
  }
  if (until && Date.now() >= until) {
    tenantCircuitOpenUntil.delete(tenantId);
  }
}

/**
 * Execute validated read-only SQL with statement_timeout and placeholder checks.
 * Intended as the single execution path for composed + gated freeform AI SQL.
 */
export async function executeSafeTenantSql(
  sql: string,
  tenantPool: pg.Pool,
  tenantId: string,
  params?: unknown[],
  options: SafeSqlExecutorOptions = {}
): Promise<SafeSqlQueryResult> {
  assertCircuitClosed(tenantId);
  const sanitized = sanitizeAndValidateReadOnlySql(sql);

  const maxIdx = maxPgPlaceholderIndex(sanitized);
  if (maxIdx > 0) {
    if (!params || params.length !== maxIdx) {
      throw new Error(
        `SQL has ${maxIdx} placeholder(s) ($1..$${maxIdx}) but received ${params?.length ?? 0} parameter(s)`
      );
    }
  } else if (params && params.length > 0) {
    throw new Error("SQL has no $n placeholders but parameters were provided");
  }

  const timeoutMs = options.statementTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return withConcurrencyLimit(tenantId, async () => {
    const startTime = Date.now();
    try {
      await tenantPool.query(`SET statement_timeout = '${timeoutMs}'`);
      const result =
        maxIdx > 0
          ? await tenantPool.query(sanitized, params)
          : await tenantPool.query(sanitized);
      recordCircuitSuccess(tenantId);
      const executionTimeMs = Date.now() - startTime;
      const rows = result.rows.slice(0, 5000) as Record<string, unknown>[];
      return {
        rows,
        rowCount: result.rows.length,
        fields:
          result.fields?.map((f: { name: string }) => f.name) ||
          Object.keys(rows[0] || {}),
        executionTimeMs,
      };
    } catch (err: unknown) {
      recordCircuitFailure(tenantId);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`SQL execution error: ${msg}`);
    }
  });
}
