/**
 * Prediction Pipeline Service
 *
 * Reusable pipeline: load active loans → sync market rates → enrich market data →
 * run fallout sequencer → build bucketed loans with signal strengths → persist loan_data.
 * Used by POST /api/predictions and by post-sync hook (before insights).
 */

import type { Pool } from "pg";
import {
  getHistoricalFalloutRates,
  runFalloutSequencer,
  runNumericOutcomeProfileDerivation,
  runSegmentFalloutRates,
} from "../fallout/index.js";
import { norm } from "../fallout/numericOutcomeProfileService.js";
import {
  computeMarketDeltaForDates,
  getMarketRateForDate,
  autoSyncMarketRatesIfNeeded,
  initializeMarketRateCache,
} from "./marketRateService.js";
import { calculatePullthroughForRole } from "./predictionService.js";
import { logInfo, logWarn, logError, logDebug } from "../logger.js";

export interface PredictionPipelineOptions {
  /** Optional filter to run only for these loan IDs */
  loanIds?: string[];
  /** Tenant ID for logging */
  tenantId?: string;
  /** Optional progress callback (e.g. for job progress) */
  onProgress?: (pct: number, message: string) => void;
}

export interface PredictionPipelineResult {
  predictions: Array<{ loanId: string; predictedOutcome: string }>;
  bucketedLoans: any[];
  bucketSummary: Record<string, number>;
  totalBucketedLoans: number;
  summary: {
    totalAnalyzed: number;
    predictedWithdraw: number;
    predictedDeny: number;
    predictedOriginate: number;
    likelyCloseLateCount: number;
  };
  metadata: {
    model: string;
    timestamp: string;
    processingTimeMs: number;
  };
}

const MAX_DENIED_POINTS = 24;
const MAX_WITHDRAWN_POINTS = 30;
const MAX_OTHER_POINTS = 18;

/** True if loan has a valid market_delta (used for withdrawn max points: 30 vs 24). */
function loanHasMarketDelta(loan: any): boolean {
  const delta = loan?.marketChangeDelta ?? loan?.market_change_delta;
  return delta != null && !isNaN(Number(delta));
}

function reasonCodesToRiskScore(
  raw: any,
  predictedOutcome?: string,
  loan?: any
): number | null {
  if (raw == null) return null;
  const codes = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as any[];
          } catch {
            return [];
          }
        })()
      : [];
  const sum = (codes as Array<{ risk_score?: number }>).reduce(
    (acc, r) => acc + (Number(r?.risk_score) || 0),
    0
  );
  const maxPoints =
    predictedOutcome === "deny"
      ? MAX_DENIED_POINTS
      : predictedOutcome === "withdraw"
        ? loan != null && loanHasMarketDelta(loan)
          ? MAX_WITHDRAWN_POINTS
          : MAX_DENIED_POINTS
        : MAX_OTHER_POINTS;
  return Math.min(100, Math.max(0, Math.round((sum / maxPoints) * 100)));
}

function pullthroughPctToSignal(pct: number): number {
  const p = pct > 1 ? pct : pct * 100;
  if (p >= 90) return 1;
  if (p >= 80) return 2;
  if (p >= 70) return 3;
  if (p >= 60) return 4;
  if (p >= 30) return 5;
  return 6;
}

function calcCreditMetricsSignal(l: any): number | null {
  const fico = l.fico_score != null ? Number(l.fico_score) : null;
  const ltv = l.ltv_ratio != null ? Number(l.ltv_ratio) : null;
  const dti = l.be_dti_ratio != null ? Number(l.be_dti_ratio) : null;
  if (fico === null && ltv === null && dti === null) return null;
  let ficoB = 3;
  if (fico != null) {
    if (fico >= 760) ficoB = 1;
    else if (fico >= 720) ficoB = 2;
    else if (fico >= 680) ficoB = 3;
    else if (fico >= 640) ficoB = 4;
    else if (fico >= 600) ficoB = 5;
    else ficoB = 6;
  }
  let ltvB = 3;
  if (ltv != null) {
    if (ltv <= 60) ltvB = 1;
    else if (ltv <= 70) ltvB = 2;
    else if (ltv <= 80) ltvB = 3;
    else if (ltv <= 90) ltvB = 4;
    else if (ltv <= 95) ltvB = 5;
    else ltvB = 6;
  }
  let dtiB = 3;
  if (dti != null) {
    if (dti <= 28) dtiB = 1;
    else if (dti <= 36) dtiB = 2;
    else if (dti <= 43) dtiB = 3;
    else if (dti <= 50) dtiB = 4;
    else if (dti <= 55) dtiB = 5;
    else dtiB = 6;
  }
  return Math.round((ficoB + ltvB + dtiB) / 3);
}

function getSegment(l: any) {
  return {
    loan_type: norm(l.loan_type),
    loan_purpose: norm(l.loan_purpose),
    occupancy: norm(l.occupancy_type ?? l.occupancyType),
  };
}

function calcLoanCharacteristicsSignal(l: any): number | null {
  const lt = (l.loan_type || "").toLowerCase();
  const lp = (l.loan_purpose || "").toLowerCase();
  const ch = (l.channel || "").toLowerCase();
  if (!lt && !lp && !ch) return null;
  let typeB = 3;
  if (lt.includes("conventional") || lt.includes("conf")) typeB = 2;
  else if (lt.includes("fha") || lt.includes("va")) typeB = 3;
  else if (lt.includes("jumbo")) typeB = 4;
  let purposeB = 3;
  if (lp.includes("purchase")) purposeB = 2;
  else if (lp.includes("rate") || lp.includes("refi")) purposeB = 3;
  else if (lp.includes("cash")) purposeB = 4;
  let channelB = 3;
  if (ch.includes("retail")) channelB = 2;
  else if (ch.includes("broker") || ch.includes("correspondent")) channelB = 4;
  return Math.round((typeB + purposeB + channelB) / 3);
}

function calcTimeInMotionSignal(l: any): number | null {
  const app = l.application_date;
  if (!app) return null;
  const days = Math.floor((Date.now() - new Date(app).getTime()) / (1000 * 60 * 60 * 24));
  if (isNaN(days)) return null;
  if (days <= 15) return 1;
  if (days <= 30) return 2;
  if (days <= 45) return 3;
  if (days <= 60) return 4;
  if (days <= 90) return 5;
  return 6;
}

function calcInterestLockVsMarketSignal(l: any): number | null {
  // Only show Lock vs Market when loan has a lock date; otherwise N/A
  if (l.lock_date == null && l.lockDate == null) return null;
  const deltaFromFred =
    l.marketChangeDelta != null && !isNaN(Number(l.marketChangeDelta))
      ? Number(l.marketChangeDelta)
      : null;
  if (deltaFromFred !== null) {
    return staticMarketDeltaBucket(deltaFromFred);
  }
  const rate = l.interest_rate != null ? Number(l.interest_rate) : null;
  if (rate === null) return null;
  const market = l.market_rate ?? l.market_rate_at_lock;
  if (market != null && !isNaN(Number(market))) {
    return staticMarketDeltaBucket(Number(market) - rate);
  }
  return null;
}

function calcMarketChangeDeltaSignal(delta: number | null): number | null {
  return staticMarketDeltaBucket(delta);
}

/**
 * Static market delta bucket (1=low risk, 6=high risk). Same ranges used by the sequencer and UI.
 * ≤−0.25% → 1, −0.25 to 0% → 2, 0 to 0.1% → 3, 0.1 to 0.2% → 4, 0.2 to 0.3% → 5, >0.3% → 6.
 */
function staticMarketDeltaBucket(delta: number | null): number | null {
  if (delta == null || isNaN(delta)) return null;
  if (delta <= -0.25) return 1;
  if (delta <= 0) return 2;
  if (delta <= 0.1) return 3;
  if (delta <= 0.2) return 4;
  if (delta <= 0.3) return 5;
  return 6;
}

const FIELDS_TO_STORE = [
  "loan_id",
  "loan_number",
  "loan_officer",
  "loan_officer_id",
  "loan_amount",
  "loan_type",
  "loan_purpose",
  "current_milestone",
  "fico_score",
  "ltv_ratio",
  "be_dti_ratio",
  "interest_rate",
  "application_date",
  "lock_date",
  "lock_expiration_date",
  "estimated_closing_date",
  "channel",
  "property_type",
  "underwriter",
  "closer",
  "processor",
  "current_loan_status",
  "market_rate",
  "market_rate_at_lock",
  "activeDays",
  "marketChangeDelta",
  "marketChangeDeltaSignal",
  "lockMarketRate",
  "rateReferenceType",
  "rateAtApplicationDate",
  "loPullthroughPercentage",
  "loPullthroughSignal",
  "mloAeFalloutProneSignalStrength",
  "creditMetricsSignalStrength",
  "loanCharacteristicsSignalStrength",
  "timeInMotionSignalStrength",
  "interestLockVsMarketSignalStrength",
  "riskScore",
  "bucket",
  "closeLateRisk",
  "riskSummary",
  "reasonCodes",
] as const;

/**
 * Run the full prediction pipeline: outcome profiles → market sync → sequencer → bucketed loans → persist loan_data.
 * Used by POST /api/predictions and by post-sync hook so insights see populated market/prediction data.
 */
export async function runPredictionPipeline(
  tenantPool: Pool,
  options: PredictionPipelineOptions = {}
): Promise<PredictionPipelineResult> {
  const { loanIds: filterLoanIds, tenantId, onProgress } = options;
  const startMs = Date.now();
  const safeLog = (msg: string, data?: Record<string, unknown>) =>
    logInfo(msg, tenantId != null ? { ...data, tenantId } : data);

  const baseCols = `
    loan_id, loan_number, loan_amount, branch, current_milestone,
    loan_type, loan_purpose, occupancy_type, fico_score, ltv_ratio, be_dti_ratio,
    borr_self_employed, application_date, lock_date, lock_expiration_date, interest_rate,
    estimated_closing_date, funding_date, closing_date, current_status_date, ctc_date, uw_final_approval_date, conditional_approval_date,
    loan_officer_id, loan_officer, loan_processor_id, processor, underwriter_id, underwriter, closer_id, closer,
    channel`;
  const activeWhere = `current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND (is_archived IS DISTINCT FROM TRUE)`;
  const activeLoansQuery = `SELECT ${baseCols} FROM public.loans WHERE ${activeWhere} ORDER BY application_date DESC LIMIT 5000`;

  let activeLoans: any[];
  try {
    const withAll = await tenantPool.query(
      `SELECT ${baseCols}, market_rate, market_rate_at_lock, market_change_delta FROM public.loans WHERE ${activeWhere} ORDER BY application_date DESC LIMIT 5000`
    );
    activeLoans = withAll.rows;
  } catch (e: any) {
    if (e?.code === "42703") {
      try {
        const withDelta = await tenantPool.query(
          `SELECT ${baseCols}, market_change_delta FROM public.loans WHERE ${activeWhere} ORDER BY application_date DESC LIMIT 5000`
        );
        activeLoans = withDelta.rows;
      } catch (e2: any) {
        if (e2?.code === "42703") {
          activeLoans = (await tenantPool.query(activeLoansQuery)).rows;
        } else {
          throw e2;
        }
      }
    } else {
      throw e;
    }
  }

  if (filterLoanIds && Array.isArray(filterLoanIds) && filterLoanIds.length > 0) {
    const loanIdSet = new Set(filterLoanIds);
    activeLoans = activeLoans.filter((l: any) => loanIdSet.has(l.loan_id));
  }

  onProgress?.(20, "Loading active loans...");

  if (activeLoans.length === 0) {
    return {
      predictions: [],
      bucketedLoans: [],
      bucketSummary: { high: 0, medium: 0, low: 0 },
      totalBucketedLoans: 0,
      summary: {
        totalAnalyzed: 0,
        predictedWithdraw: 0,
        predictedDeny: 0,
        predictedOriginate: 0,
        likelyCloseLateCount: 0,
      },
      metadata: {
        model: "fallout-sequencer-v1",
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startMs,
      },
    };
  }

  onProgress?.(30, "Computing outcome profiles...");
  await runNumericOutcomeProfileDerivation(tenantPool).catch((e) => {
    logError("Numeric outcome profile derivation failed in Predict", e, {});
  });

  const getLoanCharacteristicsBucket = await runSegmentFalloutRates(tenantPool).catch(() => () => 3);

  await autoSyncMarketRatesIfNeeded().catch(() => 0);
  await initializeMarketRateCache().catch(() => {});

  const today = new Date();
  await Promise.all(
    activeLoans.map(async (loan: any) => {
      const stored =
        loan.market_change_delta != null && !isNaN(Number(loan.market_change_delta))
          ? Number(loan.market_change_delta)
          : null;
      if (stored != null) {
        // Only use stored delta when loan has a lock date; otherwise leave blank (unlocked = no market data)
        const hasLock = loan.lock_date != null || loan.lockDate != null;
        if (hasLock) {
          loan.marketChangeDelta = stored;
        } else {
          loan.marketChangeDelta = undefined;
        }
      } else {
        // Only compute market delta when loan has a lock date; do not use application date
        const lockDate = loan.lock_date ?? null;
        if (lockDate) {
          const delta = await computeMarketDeltaForDates(lockDate, today);
          loan.marketChangeDelta = delta ?? undefined;
        }
      }
      const hasRateAtLock = loan.market_rate_at_lock != null && !isNaN(Number(loan.market_rate_at_lock));
      if (!hasRateAtLock && loan.lock_date) {
        const refObj = typeof loan.lock_date === "string" ? new Date(loan.lock_date) : loan.lock_date;
        if (!isNaN(refObj.getTime())) {
          let dateStr = refObj.toISOString().split("T")[0];
          let rate = await getMarketRateForDate(dateStr);
          if (rate === null) {
            for (let d = 1; d <= 7; d++) {
              const d2 = new Date(refObj);
              d2.setDate(d2.getDate() - d);
              rate = await getMarketRateForDate(d2.toISOString().split("T")[0]);
              if (rate !== null) break;
            }
          }
          if (rate != null && !isNaN(rate)) loan.market_rate_at_lock = rate;
        }
      }
      if (loan.lock_date) {
        loan.rateReferenceType = "lock";
      } else if (loan.application_date) {
        const appRate = await getMarketRateForDate(loan.application_date);
        loan.rateAtApplicationDate = appRate ?? undefined;
        loan.rateReferenceType = "application";
      }
    })
  );

  const withMarketDelta = activeLoans.filter(
    (l: any) => l.marketChangeDelta != null && !isNaN(Number(l.marketChangeDelta))
  );
  if (withMarketDelta.length < activeLoans.length) {
    safeLog("[Predict] Market delta missing for some active loans (will show — on UI)", {
      total: activeLoans.length,
      withDelta: withMarketDelta.length,
      withoutDelta: activeLoans.length - withMarketDelta.length,
    });
  }

  const withDelta = activeLoans.filter(
    (l: any) =>
      l.loan_id != null && l.marketChangeDelta != null && !isNaN(Number(l.marketChangeDelta))
  );
  if (withDelta.length > 0) {
    try {
      await tenantPool.query(
        `UPDATE public.loans AS l SET market_change_delta = v.delta
         FROM (SELECT unnest($1::text[]) AS loan_id, unnest($2::decimal[]) AS delta) AS v
         WHERE l.loan_id = v.loan_id`,
        [withDelta.map((l: any) => l.loan_id), withDelta.map((l: any) => Number(l.marketChangeDelta))]
      );
    } catch (e: any) {
      if (e?.code !== "42703") logWarn("[Predict] Persist market_change_delta failed", { message: e?.message });
    }
  }

  // Clear stored market_change_delta for active loans that have no lock date (so no stale market data for unlocked loans)
  try {
    const clearResult = await tenantPool.query(
      `UPDATE public.loans SET market_change_delta = NULL
       WHERE current_loan_status = 'Active Loan' AND (lock_date IS NULL OR lock_date::text = '')`
    );
    if (clearResult.rowCount != null && clearResult.rowCount > 0) {
      logDebug("[Predict] Cleared market_change_delta for unlocked active loans", { count: clearResult.rowCount });
    }
  } catch (e: any) {
    if (e?.code !== "42703") logWarn("[Predict] Clear market_change_delta for unlocked loans failed", { message: e?.message });
  }

  const withRates = activeLoans.filter((l: any) => l.loan_id != null);
  if (withRates.length > 0) {
    try {
      const todayStr = today.toISOString().split("T")[0];
      const todayRate = await getMarketRateForDate(todayStr);
      const loanIds = withRates.map((l: any) => l.loan_id);
      const marketRates = withRates.map(() => (todayRate != null && !isNaN(todayRate) ? todayRate : null));
      const marketRatesAtLock = withRates.map((l: any) => {
        const v = l.market_rate_at_lock;
        return v != null && !isNaN(Number(v)) ? Number(v) : null;
      });
      await tenantPool.query(
        `UPDATE public.loans AS l SET
           market_rate = COALESCE(v.mr, l.market_rate),
           market_rate_at_lock = COALESCE(v.mr_lock, l.market_rate_at_lock)
         FROM (SELECT unnest($1::text[]) AS loan_id, unnest($2::decimal[]) AS mr, unnest($3::decimal[]) AS mr_lock) AS v
         WHERE l.loan_id = v.loan_id`,
        [loanIds, marketRates, marketRatesAtLock]
      );
    } catch (e: any) {
      if (e?.code !== "42703")
        logWarn("[Predict] Persist market_rate / market_rate_at_lock failed", { message: e?.message });
    }
  }

  let loPullthroughPctByRole = new Map<string, number>();
  try {
    const histResult = await tenantPool.query(
      `SELECT loan_officer, current_loan_status FROM public.loans
       WHERE current_loan_status IS NOT NULL AND TRIM(current_loan_status) <> 'Active Loan'
       AND (loan_officer IS NOT NULL AND TRIM(loan_officer) <> '')
       ORDER BY application_date DESC NULLS LAST LIMIT 15000`
    );
    if (histResult.rows.length > 0) {
      const pullthroughMap = calculatePullthroughForRole(histResult.rows, ["loan_officer"]);
      loPullthroughPctByRole = new Map(Object.entries(pullthroughMap));
      safeLog("[Predict] LO pullthrough from historical loans", {
        historicalCount: histResult.rows.length,
        pullthroughEntries: loPullthroughPctByRole.size,
      });
    }
  } catch (e: any) {
    logWarn("[Predict] Historical pullthrough query failed, cards will show — for LO/MLO", {
      message: e?.message,
    });
  }

  const rates = await getHistoricalFalloutRates(tenantPool);

  onProgress?.(60, "Running fallout sequencer...");
  const seq = await runFalloutSequencer(tenantPool, activeLoans, {
    historicalDeniedRate: rates.deniedRate,
    historicalWithdrawnRate: rates.withdrawnRate,
  });

  onProgress?.(80, "Building prediction results...");
  const loanIdsArr = activeLoans.map((l: any) => l.loan_id);
  const predResult = await tenantPool.query(
    `SELECT loan_id, predicted_outcome, confidence, projected_status, reason_codes
     FROM public.loan_predictions WHERE loan_id = ANY($1)`,
    [loanIdsArr]
  );
  const predByLoanId = new Map(predResult.rows.map((r: any) => [r.loan_id, r]));

  const predictions: Array<{ loanId: string; predictedOutcome: string }> = [];
  let predictedWithdraw = 0;
  let predictedDeny = 0;
  let predictedOriginate = 0;
  let likelyCloseLateCount = 0;
  const bucketedLoans: any[] = [];

  for (const loan of activeLoans) {
    const lid = (loan.loan_id ?? loan.loanId ?? "").toString();
    const row = predByLoanId.get(lid);
    const outcome = row?.predicted_outcome ?? "originate";
    const projectedStatus = row?.projected_status;
    if (outcome === "withdraw") predictedWithdraw++;
    else if (outcome === "deny") predictedDeny++;
    else predictedOriginate++;
    if (projectedStatus === "ClosingLate") likelyCloseLateCount++;
    predictions.push({ loanId: lid, predictedOutcome: outcome });
    const bucket = outcome === "deny" || outcome === "withdraw" ? "high" : "low";
    const isClosingLate = projectedStatus === "ClosingLate";
    const confidence = row?.confidence ?? 50;

    const loName = (loan.loan_officer ?? "").toString().trim() || null;
    const loId = (loan.loan_officer_id ?? loan.loan_officer ?? "Unknown").toString().trim() || "Unknown";
    const loNameLower = loName ? loName.toLowerCase() : "";
    const getPullthroughForOfficer = (): number | null => {
      if (loName && loPullthroughPctByRole.has(loName)) return loPullthroughPctByRole.get(loName)!;
      if (loNameLower && loPullthroughPctByRole.has(loNameLower)) return loPullthroughPctByRole.get(loNameLower)!;
      const stripped = loNameLower.replace(/\s+second tier\s*-\s*\d+$/i, "").trim();
      if (stripped && loPullthroughPctByRole.has(stripped)) return loPullthroughPctByRole.get(stripped)!;
      const noSuffix = loNameLower.replace(/\s*-\s*\d+$/, "").trim();
      if (noSuffix && loPullthroughPctByRole.has(noSuffix)) return loPullthroughPctByRole.get(noSuffix)!;
      for (const [key, pct] of loPullthroughPctByRole) {
        if (loNameLower.startsWith(key) || key.startsWith(loNameLower)) return pct;
      }
      if (loPullthroughPctByRole.has(loId)) return loPullthroughPctByRole.get(loId)!;
      if (loPullthroughPctByRole.has(loId.toLowerCase())) return loPullthroughPctByRole.get(loId.toLowerCase())!;
      if (loPullthroughPctByRole.has("unknown")) return loPullthroughPctByRole.get("unknown")!;
      return null;
    };
    const loPullthroughPct = getPullthroughForOfficer();
    const mloSignal = loPullthroughPct != null ? pullthroughPctToSignal(loPullthroughPct) : null;

    const appDate = loan.application_date;
    const activeDays =
      appDate != null
        ? Math.floor((Date.now() - new Date(appDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;
    const hasLock = loan.lock_date != null || loan.lockDate != null;
    const lockRate = loan.interest_rate != null ? Number(loan.interest_rate) : null;
    const marketRate =
      loan.market_rate != null
        ? Number(loan.market_rate)
        : loan.market_rate_at_lock != null
          ? Number(loan.market_rate_at_lock)
          : null;
    const marketChangeDeltaFromDb =
      hasLock && lockRate != null && marketRate != null && !isNaN(lockRate) && !isNaN(marketRate)
        ? marketRate - lockRate
        : null;
    const marketChangeDelta = hasLock
      ? (loan.marketChangeDelta != null && !isNaN(Number(loan.marketChangeDelta))
          ? Number(loan.marketChangeDelta)
          : marketChangeDeltaFromDb)
      : null;

    const sequencerRisk = reasonCodesToRiskScore(row?.reason_codes, outcome, loan);
    const rawReasonCodes = row?.reason_codes;
    const normalizedReasonCodes =
      rawReasonCodes != null
        ? Array.isArray(rawReasonCodes)
          ? rawReasonCodes
          : typeof rawReasonCodes === "string"
            ? (() => {
                try {
                  return JSON.parse(rawReasonCodes) as any[];
                } catch {
                  return [];
                }
              })()
            : []
        : [];

    bucketedLoans.push({
      ...loan,
      loan_id: lid,
      bucket,
      closeLateRisk: isClosingLate,
      riskScore: sequencerRisk ?? confidence,
      reasonCodes: normalizedReasonCodes,
      loPullthroughPercentage: loPullthroughPct != null ? loPullthroughPct : null,
      mloAeFalloutProneSignalStrength: mloSignal ?? undefined,
      loPullthroughSignal: mloSignal ?? undefined,
      creditMetricsSignalStrength: calcCreditMetricsSignal(loan) ?? undefined,
      loanCharacteristicsSignalStrength:
        getLoanCharacteristicsBucket(
          getSegment(loan),
          outcome === "deny" ? "deny" : outcome === "withdraw" ? "withdraw" : "originate"
        ) ?? calcLoanCharacteristicsSignal(loan) ?? undefined,
      timeInMotionSignalStrength: calcTimeInMotionSignal(loan) ?? undefined,
      interestLockVsMarketSignalStrength: calcInterestLockVsMarketSignal(loan) ?? undefined,
      marketChangeDeltaSignal: hasLock ? (calcMarketChangeDeltaSignal(marketChangeDelta) ?? undefined) : undefined,
      activeDays: activeDays ?? undefined,
      market_rate: hasLock && loan.market_rate != null ? Number(loan.market_rate) : undefined,
      market_rate_at_lock: hasLock && loan.market_rate_at_lock != null ? Number(loan.market_rate_at_lock) : undefined,
      lockMarketRate:
        hasLock && loan.market_rate_at_lock != null
          ? Number(loan.market_rate_at_lock)
          : hasLock && loan.interest_rate != null
            ? Number(loan.interest_rate)
            : undefined,
      marketChangeDelta: hasLock && marketChangeDelta != null ? marketChangeDelta : null,
      riskSummary: {
        predictedOutcome: outcome,
        confidence,
        overallRisk: bucket,
        ...(sequencerRisk != null && { riskScore: sequencerRisk }),
      },
    });
  }

  const bucketSummary: Record<string, number> = {};
  bucketedLoans.forEach((l: any) => {
    const b = l.bucket || "medium";
    bucketSummary[b] = (bucketSummary[b] || 0) + 1;
  });

  try {
    const updatePromises = bucketedLoans.map((bl: any) => {
      const loanDataSnapshot: Record<string, any> = {};
      for (const key of FIELDS_TO_STORE) {
        if (bl[key] !== undefined) loanDataSnapshot[key] = bl[key];
      }
      return tenantPool.query(
        `UPDATE public.loan_predictions SET loan_data = $1
         WHERE loan_id = $2 AND created_at = (
           SELECT MAX(created_at) FROM public.loan_predictions WHERE loan_id = $2
         )`,
        [JSON.stringify(loanDataSnapshot), bl.loan_id]
      );
    });
    await Promise.all(updatePromises);
    logDebug("[Predictions] Persisted enriched loan_data for " + bucketedLoans.length + " loans");
  } catch (e: any) {
    logWarn("[Predictions] Failed to persist enriched loan_data", { error: e.message });
  }

  const processingTimeMs = Date.now() - startMs;
  safeLog("[Predictions] Document pipeline complete", {
    saved: seq.saved,
    predictedWithdraw,
    predictedDeny,
    predictedOriginate,
    likelyCloseLateCount,
    processingTimeMs,
  });

  return {
    predictions,
    bucketedLoans,
    bucketSummary,
    totalBucketedLoans: bucketedLoans.length,
    summary: {
      totalAnalyzed: activeLoans.length,
      predictedWithdraw,
      predictedDeny,
      predictedOriginate,
      likelyCloseLateCount,
    },
    metadata: {
      model: "fallout-sequencer-v1",
      timestamp: new Date().toISOString(),
      processingTimeMs,
    },
  };
}
