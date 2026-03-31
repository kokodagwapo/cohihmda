/**
 * Shared helpers for persisted loan complexity_score: ingest writes, read-time fallback.
 */

import type {
  ComplexityConfig,
  ComplexityConfigV2,
  LoanComplexityData,
} from "../../utils/scorecard-utils.js";
import { calcLoanComplexity } from "../../utils/scorecard-utils.js";
import { LoanComplexityService, type LoanData } from "./loanComplexityService.js";
import { logWarn } from "../logger.js";

const DIVERGENCE_WARN_THRESHOLD = 5;

/** When true (default), NULL complexity_score on a loan falls back to read-time calc. Set LOAN_COMPLEXITY_READ_FALLBACK=false after backfill. */
export function isLoanComplexityReadFallbackEnabled(): boolean {
  return process.env.LOAN_COMPLEXITY_READ_FALLBACK !== "false";
}

/** Map a raw loan row (DB or ETL record) to LoanData for LoanComplexityService. */
export function loanRecordToLoanData(row: Record<string, any>): LoanData {
  return {
    loan_purpose: row.loan_purpose ?? undefined,
    loan_type: row.loan_type ?? undefined,
    loan_amount:
      row.loan_amount != null && row.loan_amount !== ""
        ? parseFloat(String(row.loan_amount))
        : undefined,
    occupancy_type: row.occupancy_type ?? undefined,
    fico_score:
      row.fico_score != null && row.fico_score !== ""
        ? parseInt(String(row.fico_score), 10)
        : undefined,
    ltv_ratio:
      row.ltv_ratio != null && row.ltv_ratio !== ""
        ? parseFloat(String(row.ltv_ratio))
        : undefined,
    be_dti_ratio:
      row.be_dti_ratio != null && row.be_dti_ratio !== ""
        ? parseFloat(String(row.be_dti_ratio))
        : undefined,
    borr_self_employed: row.borr_self_employed,
    co_borr_self_employed: row.co_borr_self_employed,
    non_qm: row.non_qm,
  };
}

/** Map row to LoanComplexityData for calcLoanComplexity (scorecard routes). */
export function loanRowToComplexityData(row: Record<string, any>): LoanComplexityData {
  const base = loanRecordToLoanData(row);
  return {
    loan_type: base.loan_type,
    loan_purpose: base.loan_purpose,
    loan_amount: base.loan_amount,
    fico_score: base.fico_score,
    ltv_ratio: base.ltv_ratio,
    be_dti_ratio: base.be_dti_ratio,
    occupancy_type: base.occupancy_type,
    borr_self_employed: base.borr_self_employed,
    non_qm: base.non_qm,
  };
}

export function normalizePersistedScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Resolve complexity for API/scorecard reads: prefer persisted column; optional read-time fallback.
 */
export function resolveLoanComplexityScoreForRead(
  row: Record<string, any>,
  complexityConfig?: ComplexityConfigV2 | ComplexityConfig,
  explicitFallback?: boolean,
): number | null {
  const persisted = normalizePersistedScore(row.complexity_score);
  if (persisted !== null) return persisted;
  const useFallback =
    explicitFallback !== undefined
      ? explicitFallback
      : isLoanComplexityReadFallbackEnabled();
  if (!useFallback) return null;
  return calcLoanComplexity(loanRowToComplexityData(row), complexityConfig);
}

/** Compute and set complexity_score on each record (mutates). Loads tenant weights once. */
export async function attachPersistedComplexityScores(
  tenantPool: import("pg").Pool,
  records: Record<string, any>[],
): Promise<void> {
  if (records.length === 0) return;
  const svc = new LoanComplexityService(tenantPool);
  await svc.loadCustomWeights();
  for (const r of records) {
    const score = svc.calculateComplexity(loanRecordToLoanData(r)).totalScore;
    r.complexity_score = Math.round(score * 100) / 100;
  }
}

export function warnIfCsvComplexityDiverges(
  importedScore: number | undefined,
  computedScore: number,
  context: { loan_id?: string },
): void {
  if (importedScore === undefined || Number.isNaN(importedScore)) return;
  if (Math.abs(importedScore - computedScore) > DIVERGENCE_WARN_THRESHOLD) {
    logWarn("[CSV Import] complexity_score differs from computed value", {
      ...context,
      importedScore,
      computedScore,
    });
  }
}
