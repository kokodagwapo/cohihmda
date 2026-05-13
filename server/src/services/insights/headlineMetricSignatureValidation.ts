/**
 * Validates investigator-provided headlineMetricSignature at agent insight persist time.
 * Ensures SQL runs, returns exactly one row, and includes all keyFields as columns.
 */

import pg from "pg";
import { safeExecuteSQL, type SafeExecuteSqlOptions } from "../research/tools.js";
import type { LoanAccessFilter } from "../userLoanAccessService.js";
import { inferTrackedMetricPolarity } from "./trackedPolarityInference.js";
import { logWarn } from "../logger.js";
import { safeParseMetricSpec } from "../metrics/metricSpec.js";
import { composeMetricSql } from "../metrics/metricQueryComposer.js";

export type HeadlineMetricPolarity = "higher_better" | "lower_better" | "neutral";

export type HeadlineMetricSignatureShape = {
  sql: string;
  keyFields: string[];
  comparisonKeyFields?: string[];
  polarities?: Record<string, HeadlineMetricPolarity>;
};

export type HeadlineMetricValidationResult =
  | { ok: true; normalized: HeadlineMetricSignatureShape }
  | { ok: false; error: string };

function derivePolarities(
  keyFields: string[]
): Record<string, HeadlineMetricPolarity> {
  const out: Record<string, HeadlineMetricPolarity> = {};
  for (const k of keyFields) {
    const p = inferTrackedMetricPolarity(k);
    if (p !== "neutral") out[k] = p;
  }
  return out;
}

function parseRawHeadlineSig(
  raw: unknown,
  metricComposeAccessFilter?: LoanAccessFilter | null
):
  | {
      sql: string;
      params?: unknown[];
      keyFields: string[];
      comparisonKeyFields?: string[];
    }
  | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sqlRaw = typeof o.sql === "string" ? o.sql.trim() : "";
  const hasMetricSpec =
    o.metricSpec != null && typeof o.metricSpec === "object";

  let sql = sqlRaw;
  let params: unknown[] | undefined;

  if (!sql && hasMetricSpec) {
    const sp = safeParseMetricSpec(o.metricSpec);
    if (!sp.success) return null;
    try {
      const composed = composeMetricSql(sp.data, metricComposeAccessFilter ?? null);
      sql = composed.sql.trim();
      params = composed.params;
    } catch {
      return null;
    }
  }

  if (!sql) return null;
  const kf = o.keyFields;
  if (!Array.isArray(kf) || kf.length === 0) return null;
  const keyFields = kf
    .filter((x) => typeof x === "string")
    .map((x) => String(x).trim())
    .filter((k) => k.length > 0);
  if (keyFields.length === 0) return null;

  let comparisonKeyFields: string[] | undefined;
  const ck = o.comparisonKeyFields;
  if (Array.isArray(ck)) {
    const c = ck
      .filter((x) => typeof x === "string")
      .map((x) => String(x).trim())
      .filter((k) => keyFields.includes(k));
    if (c.length > 0) comparisonKeyFields = [...new Set(c)];
  }
  return { sql, params, keyFields, comparisonKeyFields };
}

function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "") {
    const t = v.trim();
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type ValidateHeadlineMetricSqlOptions = Pick<
  SafeExecuteSqlOptions,
  "tenantId" | "accessFilter"
> & {
  /** When headline uses metricSpec, pass the same composed loan-scope filter used at investigation time. */
  metricComposeAccessFilter?: LoanAccessFilter | null;
};

/**
 * Dry-run headline SQL; on success returns normalized shape for detail_data.
 * keyMetrics: optional loose numeric sanity check (logs warning on &gt;8% relative drift).
 */
export async function validateHeadlineMetricSignatureForPersist(
  tenantPool: pg.Pool,
  raw: unknown,
  keyMetrics: Record<string, string | number> | undefined,
  sqlOptions?: ValidateHeadlineMetricSqlOptions
): Promise<HeadlineMetricValidationResult> {
  const parsed = parseRawHeadlineSig(raw, sqlOptions?.metricComposeAccessFilter);
  if (!parsed) {
    return {
      ok: false as const,
      error:
        "headlineMetricSignature must include non-empty sql (or metricSpec) and keyFields",
    };
  }

  const execOpts: SafeExecuteSqlOptions | undefined =
    sqlOptions?.tenantId != null || sqlOptions?.accessFilter != null
      ? {
          tenantId: sqlOptions.tenantId,
          accessFilter: sqlOptions.accessFilter,
        }
      : undefined;

  let queryResult;
  try {
    queryResult = await safeExecuteSQL(parsed.sql, tenantPool, parsed.params, execOpts);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false as const, error: `SQL error: ${msg}` };
  }

  if (queryResult.rowCount !== 1) {
    return {
      ok: false as const,
      error: `Expected exactly 1 row from headlineMetricSignature SQL, got ${queryResult.rowCount}`,
    };
  }

  const row = queryResult.rows[0] as Record<string, unknown>;
  for (const f of parsed.keyFields) {
    if (!(f in row)) {
      return {
        ok: false as const,
        error: `Result row missing keyField column "${f}"`,
      };
    }
  }

  const km = keyMetrics && typeof keyMetrics === "object" ? keyMetrics : {};
  for (const [k, mv] of Object.entries(km)) {
    if (!parsed.keyFields.includes(k)) continue;
    const expected = coerceFiniteNumber(mv);
    const actual = coerceFiniteNumber(row[k]);
    if (expected === null || actual === null) continue;
    const denom = Math.max(Math.abs(expected), Math.abs(actual), 1);
    if (Math.abs(expected - actual) / denom > 0.08) {
      logWarn(
        `[HeadlineMetricSig] keyMetrics vs SQL drift for "${k}": keyMetrics=${expected} row=${actual}`
      );
    }
  }

  const inferred = derivePolarities(parsed.keyFields);
  const normalized: HeadlineMetricSignatureShape = {
    sql: parsed.sql,
    keyFields: parsed.keyFields,
  };
  if (parsed.comparisonKeyFields?.length) {
    normalized.comparisonKeyFields = parsed.comparisonKeyFields;
  }
  if (Object.keys(inferred).length > 0) {
    normalized.polarities = { ...inferred };
  }

  return { ok: true as const, normalized };
}
