/**
 * Predictions API Routes
 * Consolidated endpoints for loan predictions and recommendations
 *
 * Migrated from /api/loans/predict, /api/loans/predict/status,
 * /api/loans/predictions, /api/loans/:loanId/recommendations
 */

import { Router } from "express";
import { pool, handleDatabaseError } from "../../config/database.js";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../../middleware/tenantContext.js";
import { apiLimiter } from "../../middleware/rateLimiter.js";
import { logError, logWarn, logInfo, logDebug } from "../../services/logger.js";
import { createJob, updateProgress, completeJob, failJob } from "../../services/jobManager.js";
import {
  getHistoricalFalloutRates,
  runFalloutSequencer,
  runNumericOutcomeProfileDerivation,
  runSegmentFalloutRates,
} from "../../services/fallout/index.js";
import { norm } from "../../services/fallout/numericOutcomeProfileService.js";
import {
  computeMarketDeltaForDates,
  getMarketRateForDate,
  autoSyncMarketRatesIfNeeded,
  initializeMarketRateCache,
} from "../../services/dashboard/marketRateService.js";
import { calculatePullthroughForRole } from "../../services/dashboard/predictionService.js";

const router = Router();

// =============================================================================
// PREDICT - POST /api/predictions
// =============================================================================
// Migrated from: /api/loans/predict
// =============================================================================

/**
 * POST /api/predictions
 * Runs numeric outcome profile derivation + fallout sequencer and returns loan-level predictions.
 */
router.post(
  "/",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    const tenantContext = getTenantContext(req);
    const tenantId = tenantContext.tenantId;
    const job = createJob("predictions", req.userId!, tenantId);
    res.status(202).json({ jobId: job.id, status: "processing" });

    setImmediate(async () => {
    const startMs = Date.now();
    logInfo("[Predict] POST /api/predictions started", { tenantId });
    try {
      const tenantPool = tenantContext.tenantPool;
      const { loanIds } = req.body || {};

      // Fetch active loans: sequencer columns + display fields so UI shows loan number, amount, channel, etc.
      const baseCols = `
        loan_id, loan_number, loan_amount, branch, current_milestone,
        loan_type, loan_purpose, occupancy_type, fico_score, ltv_ratio, be_dti_ratio,
        borr_self_employed, application_date, lock_date, lock_expiration_date, interest_rate,
        estimated_closing_date, funding_date, closing_date, current_status_date, ctc_date, uw_final_approval_date, conditional_approval_date,
        loan_officer_id, loan_officer, loan_processor_id, processor, underwriter_id, underwriter, closer_id, closer,
        channel`;
      const activeWhere = `current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND (is_archived IS DISTINCT FROM TRUE)`;
      const activeLoansQuery = `
        SELECT ${baseCols}
        FROM public.loans
        WHERE ${activeWhere}
        ORDER BY application_date DESC
        LIMIT 5000`;
      let activeLoans: any[];
      try {
        const withAll = await tenantPool.query(
          `SELECT ${baseCols}, market_rate, market_rate_at_lock, market_change_delta
           FROM public.loans
           WHERE ${activeWhere}
           ORDER BY application_date DESC
           LIMIT 5000`
        );
        activeLoans = withAll.rows;
      } catch (e: any) {
        if (e?.code === "42703") {
          try {
            const withDelta = await tenantPool.query(
              `SELECT ${baseCols}, market_change_delta
               FROM public.loans
               WHERE ${activeWhere}
               ORDER BY application_date DESC
               LIMIT 5000`
            );
            activeLoans = withDelta.rows;
          } catch (e2: any) {
            if (e2?.code === "42703") {
              const baseOnly = await tenantPool.query(activeLoansQuery);
              activeLoans = baseOnly.rows;
            } else {
              throw e2;
            }
          }
        } else {
          throw e;
        }
      }

      if (loanIds && Array.isArray(loanIds) && loanIds.length > 0) {
        const loanIdSet = new Set(loanIds);
        activeLoans = activeLoans.filter((l: any) => loanIdSet.has(l.loan_id));
      }

      updateProgress(job.id, 20, "Loading active loans...");

      if (activeLoans.length === 0) {
        return completeJob(job.id, {
          predictions: [],
          bucketedLoans: [],
          bucketSummary: { high: 0, medium: 0, low: 0 },
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
        });
      }

      updateProgress(job.id, 30, "Computing outcome profiles...");
      await runNumericOutcomeProfileDerivation(tenantPool).catch((e) => {
        logError("Numeric outcome profile derivation failed in Predict", e, {});
      });

      // Loan Characteristics bucket: segment (type|purpose|occupancy) fallout rates, rank-based 1–6. Does not affect prediction.
      const getLoanCharacteristicsBucket = await runSegmentFalloutRates(tenantPool).catch(() => () => 3);

      // Ensure market rates are available so Market Delta populates on cards (FRED sync + cache).
      await autoSyncMarketRatesIfNeeded().catch(() => 0);
      await initializeMarketRateCache().catch(() => {});

      // Enrich active loans with market delta and market_rate_at_lock when missing.
      const today = new Date();
      await Promise.all(
        activeLoans.map(async (loan: any) => {
          const stored = loan.market_change_delta != null && !isNaN(Number(loan.market_change_delta))
            ? Number(loan.market_change_delta)
            : null;
          if (stored != null) {
            loan.marketChangeDelta = stored;
          } else {
            const lockDate = loan.lock_date ?? loan.application_date;
            if (lockDate) {
              const delta = await computeMarketDeltaForDates(lockDate, today);
              loan.marketChangeDelta = delta ?? undefined;
            }
          }
          // Market rate at lock: use lock date, else application date; get market rate for that date
          const hasRateAtLock = loan.market_rate_at_lock != null && !isNaN(Number(loan.market_rate_at_lock));
          if (!hasRateAtLock && (loan.lock_date || loan.application_date)) {
            const refDate = loan.lock_date ?? loan.application_date;
            const refObj = typeof refDate === "string" ? new Date(refDate) : refDate;
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
              if (rate != null && !isNaN(rate)) {
                loan.market_rate_at_lock = rate;
              }
            }
          }
          // For unlocked loans, look up the FRED market rate at application date
          if (!loan.lock_date && loan.application_date) {
            const appRate = await getMarketRateForDate(loan.application_date);
            loan.rateAtApplicationDate = appRate ?? undefined;
          }
          loan.rateReferenceType = loan.lock_date != null ? "lock" : "application";
        })
      );
      const withMarketDelta = activeLoans.filter((l: any) => l.marketChangeDelta != null && !isNaN(Number(l.marketChangeDelta)));
      if (withMarketDelta.length < activeLoans.length) {
        logInfo("[Predict] Market delta missing for some active loans (will show — on UI)", {
          total: activeLoans.length,
          withDelta: withMarketDelta.length,
          withoutDelta: activeLoans.length - withMarketDelta.length,
          sampleLoanIds: activeLoans.filter((l: any) => !(l.marketChangeDelta != null && !isNaN(Number(l.marketChangeDelta)))).slice(0, 3).map((l: any) => l.loan_id),
        });
      }

      // Persist market_change_delta to loans when column exists (migration 038).
      const withDelta = activeLoans.filter(
        (l: any) => l.loan_id != null && l.marketChangeDelta != null && !isNaN(Number(l.marketChangeDelta))
      );
      if (withDelta.length > 0) {
        try {
          await tenantPool.query(
            `UPDATE public.loans AS l SET market_change_delta = v.delta
             FROM (SELECT unnest($1::text[]) AS loan_id, unnest($2::decimal[]) AS delta) AS v
             WHERE l.loan_id = v.loan_id`,
            [
              withDelta.map((l: any) => l.loan_id),
              withDelta.map((l: any) => Number(l.marketChangeDelta)),
            ]
          );
        } catch (e: any) {
          if (e?.code !== "42703") logWarn("[Predict] Persist market_change_delta failed", { message: e?.message });
        }
      }

      // Persist market_rate and market_rate_at_lock to loans (migration 043) so insights and other readers see market data.
      const withRates = activeLoans.filter((l: any) => l.loan_id != null);
      if (withRates.length > 0) {
        try {
          const todayStr = today.toISOString().split("T")[0];
          const todayRate = await getMarketRateForDate(todayStr);
          const loanIds = withRates.map((l: any) => l.loan_id);
          const marketRates = withRates.map(
            () => (todayRate != null && !isNaN(todayRate) ? todayRate : null)
          );
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
          if (e?.code !== "42703") logWarn("[Predict] Persist market_rate / market_rate_at_lock failed", { message: e?.message });
        }
      }

      // LO pullthrough % by role (from historical loans) so MLO Fallout Prone and LO Pullthrough show on cards.
      let loPullthroughPctByRole = new Map<string, number>();
      try {
        const histResult = await tenantPool.query(
          `SELECT loan_officer, current_loan_status FROM public.loans
           WHERE current_loan_status IS NOT NULL AND TRIM(current_loan_status) <> 'Active Loan'
           AND (loan_officer IS NOT NULL AND TRIM(loan_officer) <> '')
           ORDER BY application_date DESC NULLS LAST
           LIMIT 15000`
        );
        if (histResult.rows.length > 0) {
          const pullthroughMap = calculatePullthroughForRole(histResult.rows, ["loan_officer"]);
          loPullthroughPctByRole = new Map(Object.entries(pullthroughMap));
          logInfo("[Predict] LO pullthrough from historical loans", {
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

      updateProgress(job.id, 60, "Running fallout sequencer...");
      const seq = await runFalloutSequencer(tenantPool, activeLoans, {
        historicalDeniedRate: rates.deniedRate,
        historicalWithdrawnRate: rates.withdrawnRate,
      });

      updateProgress(job.id, 80, "Building prediction results...");
      const loanIdsArr = activeLoans.map((l: any) => l.loan_id);
      const predResult = await tenantPool.query(
        `SELECT loan_id, predicted_outcome, confidence, projected_status, reason_codes
         FROM public.loan_predictions
         WHERE loan_id = ANY($1)`,
        [loanIdsArr]
      );
      const predByLoanId = new Map(predResult.rows.map((r: any) => [r.loan_id, r]));

      // Helper: risk score 0-100 from reason_codes; use outcome-specific max to match sequencer (deny=24, withdraw=30, else 18)
      const MAX_DENIED_POINTS = 24;
      const MAX_WITHDRAWN_POINTS = 30;
      const MAX_OTHER_POINTS = 18;
      const reasonCodesToRiskScore = (raw: any, predictedOutcome?: string): number | null => {
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
              ? MAX_WITHDRAWN_POINTS
              : MAX_OTHER_POINTS;
        return Math.min(100, Math.max(0, Math.round((sum / maxPoints) * 100)));
      };

      // MLO Fallout Prone: bucket from LO pullthrough % only. 1=90-100%, 2=80-90%, 3=70-80%, 4=60-70%, 5=30-60%, 6=0-30%. Accept pct as 0-100 or 0-1.
      const pullthroughPctToSignal = (pct: number): number => {
        const p = pct > 1 ? pct : pct * 100;
        if (p >= 90) return 1;
        if (p >= 80) return 2;
        if (p >= 70) return 3;
        if (p >= 60) return 4;
        if (p >= 30) return 5;
        return 6;
      };

      // Signal strength helpers for card display (match GET /api/predictions logic)
      const calcCreditMetricsSignal = (l: any): number | null => {
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
      };
      const getSegment = (l: any) => ({
        loan_type: norm(l.loan_type),
        loan_purpose: norm(l.loan_purpose),
        occupancy: norm(l.occupancy_type ?? l.occupancyType),
      });
      const calcLoanCharacteristicsSignal = (l: any): number | null => {
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
      };
      const calcTimeInMotionSignal = (l: any): number | null => {
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
      };
      const calcInterestLockVsMarketSignal = (l: any): number | null => {
        // Prefer FRED-computed market delta (lock - close); positive = rates dropped = unfavorable
        const deltaFromFred = l.marketChangeDelta != null && !isNaN(Number(l.marketChangeDelta))
          ? Number(l.marketChangeDelta)
          : null;
        if (deltaFromFred !== null) {
          if (deltaFromFred <= -0.3) return 1;
          if (deltaFromFred <= -0.1) return 2;
          if (deltaFromFred <= 0.05) return 3;
          if (deltaFromFred <= 0.2) return 4;
          if (deltaFromFred <= 0.5) return 5;
          return 6;
        }
        const rate = l.interest_rate != null ? Number(l.interest_rate) : null;
        if (rate === null) return null;
        const market = l.market_rate ?? l.market_rate_at_lock;
        if (market != null && !isNaN(Number(market))) {
          const delta = Number(market) - rate;
          if (delta <= -0.3) return 1;
          if (delta <= 0) return 2;
          if (delta <= 0.25) return 3;
          if (delta <= 0.5) return 5;
          return 6;
        }
        if (rate <= 5.5) return 2;
        if (rate <= 6.5) return 3;
        if (rate <= 7.5) return 4;
        return 5;
      };

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
        // Pullthrough map keys are lowercase (from calculatePullthroughForRole). Try exact, normalized, stripped suffix, then prefix match.
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
        const lockRate = loan.interest_rate != null ? Number(loan.interest_rate) : null;
        const marketRate =
          loan.market_rate != null
            ? Number(loan.market_rate)
            : loan.market_rate_at_lock != null
              ? Number(loan.market_rate_at_lock)
              : null;
        const marketChangeDeltaFromDb =
          lockRate != null && marketRate != null && !isNaN(lockRate) && !isNaN(marketRate)
            ? marketRate - lockRate
            : null;
        const marketChangeDelta =
          loan.marketChangeDelta != null && !isNaN(Number(loan.marketChangeDelta))
            ? Number(loan.marketChangeDelta)
            : marketChangeDeltaFromDb;

        const calcMarketChangeDeltaSignal = (delta: number | null): number | null => {
          if (delta == null) return null;
          if (delta <= -0.5) return 1;
          if (delta <= -0.25) return 2;
          if (delta <= 0.1) return 3;
          if (delta <= 0.25) return 4;
          if (delta <= 0.5) return 5;
          return 6;
        };

        const sequencerRisk = reasonCodesToRiskScore(row?.reason_codes, outcome);
        const rawReasonCodes = row?.reason_codes;
        const normalizedReasonCodes = rawReasonCodes != null
          ? (Array.isArray(rawReasonCodes)
              ? rawReasonCodes
              : typeof rawReasonCodes === "string"
                ? (() => {
                    try {
                      return JSON.parse(rawReasonCodes) as any[];
                    } catch {
                      return [];
                    }
                  })()
                : [])
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
            getLoanCharacteristicsBucket(getSegment(loan), outcome === "deny" ? "deny" : outcome === "withdraw" ? "withdraw" : "originate")
            ?? calcLoanCharacteristicsSignal(loan)
            ?? undefined,
          timeInMotionSignalStrength: calcTimeInMotionSignal(loan) ?? undefined,
          interestLockVsMarketSignalStrength: calcInterestLockVsMarketSignal(loan) ?? undefined,
          marketChangeDeltaSignal: calcMarketChangeDeltaSignal(marketChangeDelta) ?? undefined,
          activeDays: activeDays ?? undefined,
          market_rate: loan.market_rate ?? undefined,
          market_rate_at_lock: loan.market_rate_at_lock ?? undefined,
          lockMarketRate: loan.market_rate_at_lock != null ? Number(loan.market_rate_at_lock) : loan.interest_rate != null ? Number(loan.interest_rate) : undefined,
          marketChangeDelta: marketChangeDelta != null ? marketChangeDelta : null,
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

      // Persist enriched loan data back to loan_predictions.loan_data
      // so the GET handler can reconstruct full card data on page refresh
      try {
        const updatePromises = bucketedLoans.map((bl: any) => {
          const loanDataSnapshot: Record<string, any> = {};
          const fieldsToStore = [
            "loan_id", "loan_number", "loan_officer", "loan_officer_id",
            "loan_amount", "loan_type", "loan_purpose", "current_milestone",
            "fico_score", "ltv_ratio", "be_dti_ratio", "interest_rate",
            "application_date", "lock_date", "lock_expiration_date",
            "estimated_closing_date", "channel", "property_type",
            "underwriter", "closer", "processor", "current_loan_status",
            "market_rate", "market_rate_at_lock",
            "activeDays", "marketChangeDelta", "marketChangeDeltaSignal",
            "lockMarketRate", "rateReferenceType", "rateAtApplicationDate",
            "loPullthroughPercentage", "loPullthroughSignal",
            "mloAeFalloutProneSignalStrength",
            "creditMetricsSignalStrength", "loanCharacteristicsSignalStrength",
            "timeInMotionSignalStrength", "interestLockVsMarketSignalStrength",
            "riskScore", "bucket", "closeLateRisk", "riskSummary", "reasonCodes",
          ];
          for (const key of fieldsToStore) {
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
      logInfo("[Predictions] Document pipeline complete", {
        tenantId,
        saved: seq.saved,
        predictedWithdraw,
        predictedDeny,
        predictedOriginate,
        likelyCloseLateCount,
        processingTimeMs,
      });

      const slimResult = {
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

      completeJob(job.id, slimResult);
    } catch (error: any) {
      logError("Error running prediction pipeline", error, { userId: req.userId });
      failJob(job.id, error.message || "Failed to predict loan outcomes");
    }
    }); // end setImmediate
  }
);

// =============================================================================
// PREDICT STATUS - GET /api/predictions/status
// =============================================================================
// Migrated from: /api/loans/predict/status
// =============================================================================

/**
 * GET /api/predictions/status
 * Returns whether the prediction pipeline is still in progress for this tenant
 */
router.get(
  "/status",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const tenantId = tenantContext.tenantId;

      const { getPredictInProgress } = await import(
        "../../services/dashboard/predictionService.js"
      );
      const inProgress = getPredictInProgress(tenantId ?? null);
      res.json({ inProgress });
    } catch (error: any) {
      logError("Error fetching predict status", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch predict status" });
    }
  }
);

// =============================================================================
// GET PREDICTIONS - GET /api/predictions
// =============================================================================
// Migrated from: /api/loans/predictions
// =============================================================================

/**
 * Helper function to calculate date range for a period
 * Used by predictions endpoint to filter by application_date
 */
function getPeriodDateRange(
  period: string
): { startDate: Date; endDate: Date } | null {
  const now = new Date();
  const endDate = new Date(now);
  let startDate: Date;

  switch (period) {
    case "rolling_3_months":
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case "rolling_6_months":
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case "rolling_12_months":
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 12);
      break;
    case "rolling_18_months":
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 18);
      break;
    case "rolling_90_days":
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 90);
      break;
    case "mtd":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "ytd":
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    case "all_time":
    case "all":
    default:
      return null; // No date filter
  }

  return { startDate, endDate };
}

/**
 * GET /api/predictions
 * Fetch stored AI predictions for loans
 * Returns the most recent prediction for each loan
 *
 * Query params:
 *   - loanIds: Filter by specific loan IDs
 *   - outcome: Filter by prediction outcome (withdraw, deny, originate)
 *   - limit: Max number of results (default 10000)
 *   - period: Filter by application_date period (rolling_3_months, rolling_6_months, etc.)
 */
router.get(
  "/",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;

      // Optional filters
      const loanIds = req.query.loanIds
        ? Array.isArray(req.query.loanIds)
          ? req.query.loanIds
          : [req.query.loanIds]
        : null;
      const outcome = req.query.outcome as string | null;
      const limit = parseInt(req.query.limit as string) || 10000;
      const period = req.query.period as string | null;

      // Calculate date range for period filter
      const dateRange = period ? getPeriodDateRange(period) : null;

      // Single query: get latest prediction per loan AND join loans table in one round trip
      // The composite index idx_loan_predictions_loan_created covers DISTINCT ON efficiently
      let query = `
      WITH latest_predictions AS (
        SELECT DISTINCT ON (loan_id)
          loan_id,
          predicted_outcome,
          confidence,
          reasoning,
          risk_factors,
          bucket,
          loan_data,
          model_version,
          created_at,
          updated_at,
          reason_codes,
          projected_status
        FROM public.loan_predictions
        WHERE 1=1
    `;

      const params: any[] = [];
      let paramIndex = 1;

      if (loanIds && loanIds.length > 0) {
        query += ` AND loan_id = ANY($${paramIndex})`;
        params.push(loanIds);
        paramIndex++;
      }

      if (outcome && ["withdraw", "deny", "originate"].includes(outcome)) {
        query += ` AND predicted_outcome = $${paramIndex}`;
        params.push(outcome);
        paramIndex++;
      }

      query += ` ORDER BY loan_id, created_at DESC
      )
      SELECT lp.*,
        l.loan_number, l.loan_officer, l.loan_officer_id AS l_loan_officer_id,
        l.loan_amount AS l_loan_amount, l.loan_type AS l_loan_type,
        l.current_milestone AS l_current_milestone, l.fico_score AS l_fico_score,
        l.ltv_ratio AS l_ltv_ratio, l.be_dti_ratio AS l_be_dti_ratio,
        l.interest_rate AS l_interest_rate, l.application_date AS l_application_date,
        l.lock_date AS l_lock_date, l.lock_expiration_date AS l_lock_expiration_date,
        l.estimated_closing_date AS l_estimated_closing_date, l.channel AS l_channel,
        l.property_type AS l_property_type, l.loan_purpose AS l_loan_purpose,
        l.underwriter AS l_underwriter, l.closer AS l_closer, l.processor AS l_processor,
        l.current_loan_status AS l_current_loan_status,
        l.market_rate AS l_market_rate, l.market_rate_at_lock AS l_market_rate_at_lock
      FROM latest_predictions lp
      LEFT JOIN public.loans l ON l.loan_id = lp.loan_id
    `;

      const activeWhere = `l.current_loan_status = 'Active Loan' AND l.application_date IS NOT NULL AND l.application_date::text != '' AND (l.is_archived IS DISTINCT FROM TRUE)`;
      if (dateRange) {
        query += `
        WHERE ${activeWhere}
          AND l.application_date >= $${paramIndex}::date
          AND l.application_date < $${paramIndex + 1}::date
      `;
        params.push(dateRange.startDate.toISOString().split("T")[0]);
        params.push(dateRange.endDate.toISOString().split("T")[0]);
        paramIndex += 2;
      } else {
        query += `
        WHERE ${activeWhere}
      `;
      }

      query += ` LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await tenantPool.query(query, params);

      // Build loanDataMap from the joined result (no second query needed)
      let loanDataMap: Record<string, any> = {};
      result.rows.forEach((row) => {
        if (row.loan_number != null || row.l_fico_score != null) {
          loanDataMap[row.loan_id] = {
            loan_id: row.loan_id,
            loan_number: row.loan_number,
            loan_officer: row.loan_officer,
            loan_amount: row.l_loan_amount,
            loan_type: row.l_loan_type,
            current_milestone: row.l_current_milestone,
            fico_score: row.l_fico_score,
            ltv_ratio: row.l_ltv_ratio,
            be_dti_ratio: row.l_be_dti_ratio,
            interest_rate: row.l_interest_rate,
            application_date: row.l_application_date,
            lock_date: row.l_lock_date,
            lock_expiration_date: row.l_lock_expiration_date,
            estimated_closing_date: row.l_estimated_closing_date,
            channel: row.l_channel,
            property_type: row.l_property_type,
            loan_purpose: row.l_loan_purpose,
            underwriter: row.l_underwriter,
            closer: row.l_closer,
            processor: row.l_processor,
            current_loan_status: row.l_current_loan_status,
            loan_officer_id: row.l_loan_officer_id,
            market_rate: row.l_market_rate,
            market_rate_at_lock: row.l_market_rate_at_lock,
          };
        }
      });

      // LO pullthrough % for MLO Fallout Prone (same as POST so period-filtered GET has same data)
      let getLoPullthroughMap = new Map<string, number>();
      try {
        const histResult = await tenantPool.query(
          `SELECT loan_officer, current_loan_status FROM public.loans
           WHERE current_loan_status IS NOT NULL AND TRIM(current_loan_status) <> 'Active Loan'
           AND (loan_officer IS NOT NULL AND TRIM(loan_officer) <> '')
           ORDER BY application_date DESC NULLS LAST
           LIMIT 15000`
        );
        if (histResult.rows.length > 0) {
          const pullthroughMap = calculatePullthroughForRole(histResult.rows, ["loan_officer"]);
          getLoPullthroughMap = new Map(Object.entries(pullthroughMap));
        }
      } catch (e: any) {
        logWarn("[Predictions GET] Historical pullthrough query failed", { message: e?.message });
      }

      // Fetch loan data with signal strengths and market fields for the critical loan cards
      const predictionLoanIds = result.rows.map((r: any) => r.loan_id).filter(Boolean);
      loanDataMap = {};
      if (predictionLoanIds.length > 0) {
        let loanDataResult: { rows: any[] };
        try {
          loanDataResult = await tenantPool.query(
            `SELECT 
              loan_id, loan_number, loan_officer, loan_amount, loan_type,
              current_milestone, fico_score, ltv_ratio, be_dti_ratio,
              interest_rate, application_date, lock_date, lock_expiration_date,
              estimated_closing_date, channel, property_type, loan_purpose,
              underwriter, closer, processor, current_loan_status,
              market_rate, market_rate_at_lock, market_change_delta
            FROM public.loans 
            WHERE loan_id = ANY($1)`,
            [predictionLoanIds]
          );
        } catch (e: any) {
          if (e?.code === "42703") {
            loanDataResult = await tenantPool.query(
              `SELECT 
                loan_id, loan_number, loan_officer, loan_amount, loan_type,
                current_milestone, fico_score, ltv_ratio, be_dti_ratio,
                interest_rate, application_date, lock_date, lock_expiration_date,
                estimated_closing_date, channel, property_type, loan_purpose,
                underwriter, closer, processor, current_loan_status
              FROM public.loans 
              WHERE loan_id = ANY($1)`,
              [predictionLoanIds]
            );
          } else {
            throw e;
          }
        }
        loanDataResult.rows.forEach((row) => {
          loanDataMap[row.loan_id] = row;
        });

        // Enrich with computed market delta when missing (so period-filtered GET shows market data like POST)
        const today = new Date();
        const needDelta = loanDataResult.rows.filter(
          (row: any) =>
            (row.market_change_delta == null || (typeof row.market_change_delta === "number" && isNaN(row.market_change_delta))) &&
            (row.lock_date || row.application_date)
        );
        if (needDelta.length > 0) {
          await initializeMarketRateCache().catch(() => {});
          for (const row of needDelta) {
            const lockDate = row.lock_date ?? row.application_date;
            if (lockDate) {
              const delta = await computeMarketDeltaForDates(lockDate, today);
              if (delta != null && !isNaN(delta)) {
                loanDataMap[row.loan_id] = { ...row, market_change_delta: delta };
              }
            }
          }
        }

        // Enrich market_rate_at_lock when missing: use lock date, else application date, then get market rate for that date
        const needMarketRateAtLock = loanDataResult.rows.filter(
          (row: any) => {
            const current = loanDataMap[row.loan_id] ?? row;
            const hasRate = current.market_rate_at_lock != null && !isNaN(Number(current.market_rate_at_lock));
            return !hasRate && (row.lock_date || row.application_date);
          }
        );
        if (needMarketRateAtLock.length > 0) {
          await initializeMarketRateCache().catch(() => {});
          for (const row of needMarketRateAtLock) {
            const refDate = row.lock_date ?? row.application_date;
            if (!refDate) continue;
            const refObj = typeof refDate === "string" ? new Date(refDate) : refDate;
            if (isNaN(refObj.getTime())) continue;
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
            if (rate != null && !isNaN(rate)) {
              const current = loanDataMap[row.loan_id] ?? row;
              loanDataMap[row.loan_id] = { ...current, market_rate_at_lock: rate };
            }
          }
        }
      }

      // Calculate signal strengths from loan data (since loan_prediction_buckets table may not exist)
      // These are simplified calculations based on the prediction service logic
      function calculateCreditMetricsSignal(loan: any): number | null {
        const fico = loan.fico_score != null ? Number(loan.fico_score) : null;
        const ltv = loan.ltv_ratio != null ? Number(loan.ltv_ratio) : null;
        const dti =
          loan.be_dti_ratio != null ? Number(loan.be_dti_ratio) : null;

        if (fico === null && ltv === null && dti === null) return null;

        // Calculate individual buckets (1=best, 6=worst)
        let ficoBucket = 3;
        if (fico != null) {
          if (fico >= 760) ficoBucket = 1;
          else if (fico >= 720) ficoBucket = 2;
          else if (fico >= 680) ficoBucket = 3;
          else if (fico >= 640) ficoBucket = 4;
          else if (fico >= 600) ficoBucket = 5;
          else ficoBucket = 6;
        }

        let ltvBucket = 3;
        if (ltv != null) {
          if (ltv <= 60) ltvBucket = 1;
          else if (ltv <= 70) ltvBucket = 2;
          else if (ltv <= 80) ltvBucket = 3;
          else if (ltv <= 90) ltvBucket = 4;
          else if (ltv <= 95) ltvBucket = 5;
          else ltvBucket = 6;
        }

        let dtiBucket = 3;
        if (dti != null) {
          if (dti <= 28) dtiBucket = 1;
          else if (dti <= 36) dtiBucket = 2;
          else if (dti <= 43) dtiBucket = 3;
          else if (dti <= 50) dtiBucket = 4;
          else if (dti <= 55) dtiBucket = 5;
          else dtiBucket = 6;
        }

        // Average of available metrics
        const signals = [ficoBucket, ltvBucket, dtiBucket];
        return Math.round(signals.reduce((a, b) => a + b, 0) / signals.length);
      }

      function calculateLoanCharacteristicsSignal(loan: any): number | null {
        const loanType = (loan.loan_type || "").toLowerCase();
        const loanPurpose = (loan.loan_purpose || "").toLowerCase();
        const channel = (loan.channel || "").toLowerCase();

        if (!loanType && !loanPurpose && !channel) return null;

        // Loan type bucket
        let typeBucket = 3;
        if (loanType.includes("conventional") || loanType.includes("conf"))
          typeBucket = 2;
        else if (loanType.includes("fha") || loanType.includes("va"))
          typeBucket = 3;
        else if (loanType.includes("jumbo")) typeBucket = 4;

        // Loan purpose bucket
        let purposeBucket = 3;
        if (loanPurpose.includes("purchase")) purposeBucket = 2;
        else if (loanPurpose.includes("rate") || loanPurpose.includes("refi"))
          purposeBucket = 3;
        else if (loanPurpose.includes("cash")) purposeBucket = 4;

        // Channel bucket
        let channelBucket = 3;
        if (channel.includes("retail")) channelBucket = 2;
        else if (
          channel.includes("broker") ||
          channel.includes("correspondent")
        )
          channelBucket = 4;

        return Math.round((typeBucket + purposeBucket + channelBucket) / 3);
      }

      function calculateTimeInMotionSignal(loan: any): number | null {
        // First check if activeDays is already stored
        let activeDays: number | null = null;

        if (loan.activeDays != null) {
          activeDays = Number(loan.activeDays);
        } else {
          // Calculate from application_date
          const appDate = loan.application_date;
          if (!appDate) return null;

          const applicationDate = new Date(appDate);
          const now = new Date();
          activeDays = Math.floor(
            (now.getTime() - applicationDate.getTime()) / (1000 * 60 * 60 * 24)
          );
        }

        if (activeDays == null || isNaN(activeDays)) return null;

        if (activeDays <= 15) return 1;
        if (activeDays <= 30) return 2;
        if (activeDays <= 45) return 3;
        if (activeDays <= 60) return 4;
        if (activeDays <= 90) return 5;
        return 6;
      }

      // Lock vs Market: prefer market delta (same bands as POST); fallback to rate-only
      function calculateInterestLockVsMarketSignal(loan: any): number | null {
        const delta =
          loan.market_change_delta != null && !isNaN(Number(loan.market_change_delta))
            ? Number(loan.market_change_delta)
            : loan.marketChangeDelta != null && !isNaN(Number(loan.marketChangeDelta))
              ? Number(loan.marketChangeDelta)
              : null;
        if (delta !== null) {
          if (delta <= -0.3) return 1;
          if (delta <= -0.1) return 2;
          if (delta <= 0.05) return 3;
          if (delta <= 0.2) return 4;
          if (delta <= 0.5) return 5;
          return 6;
        }
        const interestRate =
          loan.interest_rate != null ? Number(loan.interest_rate) : null;
        if (interestRate === null) return null;
        const market = loan.market_rate ?? loan.market_rate_at_lock;
        if (market != null && !isNaN(Number(market))) {
          const d = Number(market) - interestRate;
          if (d <= -0.3) return 1;
          if (d <= 0) return 2;
          if (d <= 0.25) return 3;
          if (d <= 0.5) return 5;
          return 6;
        }
        if (interestRate <= 5.5) return 2;
        if (interestRate <= 6.5) return 3;
        if (interestRate <= 7.5) return 4;
        return 5;
      }

      function calculateMarketChangeDelta(loan: any): number | null {
        const lockRate = loan.interest_rate != null ? Number(loan.interest_rate) : null;
        const marketRate =
          loan.market_rate != null ? Number(loan.market_rate)
            : loan.market_rate_at_lock != null ? Number(loan.market_rate_at_lock) : null;
        if (lockRate != null && marketRate != null && !isNaN(lockRate) && !isNaN(marketRate)) {
          return marketRate - lockRate;
        }
        return null;
      }

      function calculateMarketChangeDeltaSignal(delta: number | null): number | null {
        if (delta == null) return null;
        if (delta <= -0.5) return 1;
        if (delta <= -0.25) return 2;
        if (delta <= 0.1) return 3;
        if (delta <= 0.25) return 4;
        if (delta <= 0.5) return 5;
        return 6;
      }

      // MLO Fallout Prone: from LO pullthrough % only. 1=90-100%, 2=80-90%, 3=70-80%, 4=60-70%, 5=30-60%, 6=0-30%. Accept decimal (0-1) or percentage.
      function calculatePullthroughSignal(
        pct: number | null | undefined
      ): number | null {
        if (pct == null) return null;
        const percentage = Number(pct);
        if (isNaN(percentage)) return null;
        const p = percentage > 1 ? percentage : percentage * 100;

        if (p >= 90) return 1;
        if (p >= 80) return 2;
        if (p >= 70) return 3;
        if (p >= 60) return 4;
        if (p >= 30) return 5;
        return 6;
      }

      const predictions = result.rows.map((row) => {
        // Use stored loan_data from predictions (contains all signal strengths, loan_purpose, channel, etc.)
        // Fall back to loans table data if loan_data is not stored
        const storedLoanData = row.loan_data || {};
        const loanTableData = loanDataMap[row.loan_id] || {};

        // Merge data: prefer stored loan_data, fall back to loans table
        const mergedLoanData = { ...loanTableData, ...storedLoanData };

        // Use stored bucket or derive from prediction outcome
        const riskBucket =
          row.bucket ||
          (row.predicted_outcome === "withdraw" ||
          row.predicted_outcome === "deny"
            ? "high"
            : "low");

        // Use stored signal strengths from loan_data, or calculate if not present
        const creditMetricsSignal =
          mergedLoanData.creditMetricsSignalStrength ??
          calculateCreditMetricsSignal(mergedLoanData);
        const loanCharacteristicsSignal =
          mergedLoanData.loanCharacteristicsSignalStrength ??
          calculateLoanCharacteristicsSignal(mergedLoanData);
        const timeInMotionSignal =
          mergedLoanData.timeInMotionSignalStrength ??
          calculateTimeInMotionSignal(mergedLoanData);
        const interestLockVsMarketSignal =
          mergedLoanData.interestLockVsMarketSignalStrength ??
          calculateInterestLockVsMarketSignal(mergedLoanData);

        // LO pullthrough %: use stored, or from map (legacy human_pattern_stats no longer populated)
        const loPctFromMap =
          (mergedLoanData.loan_officer && getLoPullthroughMap.get(String(mergedLoanData.loan_officer).trim())) ??
          (mergedLoanData.loan_officer_id && getLoPullthroughMap.get(String(mergedLoanData.loan_officer_id).trim())) ??
          null;
        const loPullthroughPercentage =
          mergedLoanData.loPullthroughPercentage ?? loPctFromMap ?? null;

        // Calculate LO pullthrough signal from percentage if not stored
        const loPullthroughSignal =
          mergedLoanData.loPullthroughSignal ??
          calculatePullthroughSignal(loPullthroughPercentage);

        // MLO/AE fallout signal - use stored value, fall back to LO pullthrough signal
        const mloAeFalloutSignal =
          mergedLoanData.mloAeFalloutProneSignalStrength ?? loPullthroughSignal;

        // Risk score from fallout sequencer reason_codes (zone points sum scaled to 0-100).
        // Use outcome-specific max to match sequencer: Denied max=24 (4 features × 6 pts), Withdrawn max=30 (5 × 6), else 18.
        const MAX_DENIED_POINTS = 24;
        const MAX_WITHDRAWN_POINTS = 30;
        const MAX_OTHER_POINTS = 18;
        let sequencerRiskScore100: number | null = null;
        const rawReasonCodes = row.reason_codes;
        const normalizedReasonCodes = rawReasonCodes != null
          ? (Array.isArray(rawReasonCodes)
              ? rawReasonCodes
              : typeof rawReasonCodes === "string"
                ? (() => {
                    try {
                      return JSON.parse(rawReasonCodes) as any[];
                    } catch {
                      return [];
                    }
                  })()
                : [])
          : [];
        if (normalizedReasonCodes.length > 0) {
          const sum = (normalizedReasonCodes as Array<{ risk_score?: number }>).reduce(
            (acc, r) => acc + (Number(r?.risk_score) || 0),
            0
          );
          const maxPoints =
            row.predicted_outcome === "deny"
              ? MAX_DENIED_POINTS
              : row.predicted_outcome === "withdraw"
                ? MAX_WITHDRAWN_POINTS
                : MAX_OTHER_POINTS;
          sequencerRiskScore100 = Math.min(
            100,
            Math.max(0, Math.round((sum / maxPoints) * 100))
          );
        }

        const storedRiskSummary =
          mergedLoanData.riskSummary &&
          typeof mergedLoanData.riskSummary === "object"
            ? { ...mergedLoanData.riskSummary }
            : {
                predictedOutcome: row.predicted_outcome,
                confidence: row.confidence,
                risks: row.risk_factors || [],
                positives: [],
                overallRisk:
                  riskBucket === "high"
                    ? "high"
                    : riskBucket === "low"
                      ? "low"
                      : "medium",
              };
        if (sequencerRiskScore100 != null) {
          (storedRiskSummary as any).riskScore = sequencerRiskScore100;
          // Keep outcome in sync with sequencer so merged/stale data doesn't show wrong outcome
          (storedRiskSummary as any).predictedOutcome = row.predicted_outcome;
          (storedRiskSummary as any).overallRisk =
            row.predicted_outcome === "deny" || row.predicted_outcome === "withdraw" ? "high" : riskBucket === "low" ? "low" : "medium";
        }

        // Build loanData: spread full stored loan_data first so all bucket signals and riskSummary come through,
        // then override with computed/fallback fields so display works even when DB has older schema.
        const baseLoanData = {
          ...mergedLoanData,
          ...(sequencerRiskScore100 != null && { riskScore: sequencerRiskScore100 }),
          loan_id: row.loan_id,
          loan_number:
            mergedLoanData.loan_number ?? mergedLoanData.loanNumber,
          loan_officer: mergedLoanData.loan_officer,
          loan_amount: mergedLoanData.loan_amount,
          loan_type: mergedLoanData.loan_type,
          current_milestone:
            mergedLoanData.current_milestone ??
            mergedLoanData.lastCompletedMilestone,
          fico_score: mergedLoanData.fico_score ?? mergedLoanData.ficoScore,
          ltv_ratio: mergedLoanData.ltv_ratio ?? mergedLoanData.ltv,
          be_dti_ratio: mergedLoanData.be_dti_ratio ?? mergedLoanData.dti,
          application_date: mergedLoanData.application_date,
          lock_date: mergedLoanData.lock_date ?? mergedLoanData.lockDate,
          lock_expiration_date:
            mergedLoanData.lock_expiration_date ??
            mergedLoanData.lockExpirationDate,
          estimated_closing_date:
            mergedLoanData.estimated_closing_date ??
            mergedLoanData.estimatedClosingDate,
          channel: mergedLoanData.channel,
          loan_purpose:
            mergedLoanData.loan_purpose ?? mergedLoanData.loanPurpose,
          underwriter: mergedLoanData.underwriter,
          closer: mergedLoanData.closer,
          processor: mergedLoanData.processor,
          current_loan_status:
            mergedLoanData.current_loan_status ??
            mergedLoanData.currentLoanStatus,
          activeDays: mergedLoanData.activeDays ?? null,
          loPullthroughPercentage: loPullthroughPercentage ?? null,
          uwPullthroughPercentage:
            mergedLoanData.uwPullthroughPercentage ?? null,
          closerPullthroughPercentage:
            mergedLoanData.closerPullthroughPercentage ?? null,
          processorPullthroughPercentage:
            mergedLoanData.processorPullthroughPercentage ?? null,
          creditMetricsSignalStrength:
            mergedLoanData.creditMetricsSignalStrength ?? creditMetricsSignal,
          loanCharacteristicsSignalStrength:
            mergedLoanData.loanCharacteristicsSignalStrength ??
            loanCharacteristicsSignal,
          timeInMotionSignalStrength:
            calculateTimeInMotionSignal({ ...mergedLoanData, activeDays: undefined }) ?? timeInMotionSignal,
          timeInMotionSignal:
            calculateTimeInMotionSignal({ ...mergedLoanData, activeDays: undefined }) ?? timeInMotionSignal,
          mloAeFalloutProneSignalStrength:
            mergedLoanData.mloAeFalloutProneSignalStrength ?? mloAeFalloutSignal,
          interestLockVsMarketSignalStrength:
            mergedLoanData.interestLockVsMarketSignalStrength ??
            interestLockVsMarketSignal,
          uwPullthroughSignalStrength:
            mergedLoanData.uwPullthroughSignalStrength ?? null,
          closerPullthroughSignalStrength:
            mergedLoanData.closerPullthroughSignalStrength ?? null,
          processorPullthroughSignalStrength:
            mergedLoanData.processorPullthroughSignalStrength ?? null,
          loPullthroughSignal:
            mergedLoanData.loPullthroughSignal ?? loPullthroughSignal,
          market_rate: mergedLoanData.market_rate ?? null,
          market_rate_at_lock: mergedLoanData.market_rate_at_lock ?? null,
          rateReferenceType: mergedLoanData.rateReferenceType ??
            ((mergedLoanData.lock_date ?? mergedLoanData.lockDate) != null ? "lock" : "application"),
          rateAtApplicationDate: mergedLoanData.rateAtApplicationDate ?? null,
          lockMarketRate:
            mergedLoanData.lockMarketRate ??
            ((mergedLoanData.lock_date ?? mergedLoanData.lockDate) != null
              ? (mergedLoanData.market_rate_at_lock != null
                  ? Number(mergedLoanData.market_rate_at_lock)
                  : mergedLoanData.interest_rate != null ? Number(mergedLoanData.interest_rate) : null)
              : (mergedLoanData.rateAtApplicationDate != null
                  ? Number(mergedLoanData.rateAtApplicationDate)
                  : null)),
          marketChangeDelta:
            mergedLoanData.marketChangeDelta ?? calculateMarketChangeDelta(mergedLoanData),
          marketChangeDeltaSignal:
            mergedLoanData.marketChangeDeltaSignal ??
            calculateMarketChangeDeltaSignal(mergedLoanData.marketChangeDelta ?? calculateMarketChangeDelta(mergedLoanData)),
          bucket: riskBucket,
          riskSummary: storedRiskSummary,
          closeOnTimeProbability: mergedLoanData.closeOnTimeProbability ?? null,
          closeLateRisk: mergedLoanData.closeLateRisk ?? (row.projected_status === 'ClosingLate'),
          pipelineStage: mergedLoanData.pipelineStage ?? null,
          pipelineReadiness: mergedLoanData.pipelineReadiness ?? null,
          closingLatePrediction: mergedLoanData.closingLatePrediction ?? null,
          closingProjection: mergedLoanData.closingProjection ?? null,
          reasonCodes: normalizedReasonCodes,
        };

        return {
          loanId: row.loan_id,
          predictedOutcome: row.predicted_outcome,
          confidence: row.confidence,
          reasoning: row.reasoning,
          riskFactors: row.risk_factors || [],
          modelVersion: row.model_version,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          bucket: riskBucket,
          loanData: baseLoanData,
        };
      });

      // Log for debugging
      logInfo("[Predictions GET] Results", {
        filteredCount: predictions.length,
        period,
      });

      // Count close-late risk from stored loan data
      const likelyCloseLateCount = predictions.filter(
        (p: any) => p.loanData?.closeLateRisk === true
      ).length;

      res.json({
        predictions,
        count: predictions.length,
        summary: {
          withdraw: predictions.filter((p) => p.predictedOutcome === "withdraw")
            .length,
          deny: predictions.filter((p) => p.predictedOutcome === "deny").length,
          originate: predictions.filter(
            (p) => p.predictedOutcome === "originate"
          ).length,
          likelyCloseLateCount,
        },
        dateFilter: dateRange
          ? {
              startDate: dateRange.startDate.toISOString().split("T")[0],
              endDate: dateRange.endDate.toISOString().split("T")[0],
              period,
            }
          : null,
        debug: {
          filteredCount: predictions.length,
        },
      });
    } catch (error: any) {
      logError("Error fetching loan predictions", error, {
        userId: req.userId,
      });

      if (handleDatabaseError(error, res, "Failed to fetch loan predictions")) {
        return;
      }

      res
        .status(500)
        .json({ error: error.message || "Failed to fetch loan predictions" });
    }
  }
);

// =============================================================================
// LOAN RECOMMENDATIONS - GET /api/predictions/:loanId/recommendations
// =============================================================================
// Migrated from: /api/loans/:loanId/recommendations
// =============================================================================

/**
 * GET /api/predictions/:loanId/recommendations
 * Get AI-powered recommendations for a specific loan
 */
router.get(
  "/:loanId/recommendations",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;
      const { loanId } = req.params;

      if (!loanId) {
        return res.status(400).json({ error: "Loan ID is required" });
      }

      // Fetch the loan data
      const loanResult = await tenantPool.query(
        `SELECT * FROM public.loans WHERE loan_id = $1`,
        [loanId]
      );

      if (loanResult.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }

      const loan = loanResult.rows[0];

      // Fetch OpenAI API key
      let apiKey: string | undefined;
      try {
        const { decryptAPIKeys } = await import("../../services/encryption.js");
        const apiKeyResult = await tenantPool.query(
          `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
        );
        if (apiKeyResult.rows[0]?.openai_api_key) {
          const decrypted = await decryptAPIKeys({
            openai_api_key: apiKeyResult.rows[0].openai_api_key,
          });
          apiKey = decrypted.openai_api_key || undefined;
        }
      } catch (apiKeyError: any) {
        logInfo(
          "[Predictions] Could not fetch tenant API key for recommendations",
          { error: apiKeyError.message }
        );
      }

      // Fall back to environment variable
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
      const apiKeyToUse = apiKey || OPENAI_API_KEY;

      // Validate API key
      const hasValidApiKey =
        apiKeyToUse &&
        apiKeyToUse.trim().length > 0 &&
        !apiKeyToUse.includes("your-api-key") &&
        apiKeyToUse.trim().startsWith("sk-");

      if (!hasValidApiKey) {
        // Return rule-based recommendations
        const recommendations = generateRuleBasedRecommendations(loan);
        return res.json({
          loanId,
          recommendations,
          source: "rule-based",
          message:
            "AI recommendations unavailable - using rule-based suggestions",
        });
      }

      // Generate AI recommendations
      try {
        const recommendations = await generateAIRecommendations(
          loan,
          apiKeyToUse
        );
        res.json({
          loanId,
          recommendations,
          source: "ai",
        });
      } catch (aiError: any) {
        logError("[Predictions] AI recommendation generation failed", aiError);
        const recommendations = generateRuleBasedRecommendations(loan);
        res.json({
          loanId,
          recommendations,
          source: "rule-based",
          message: "AI generation failed - using rule-based suggestions",
        });
      }
    } catch (error: any) {
      logError("Error getting loan recommendations", error, {
        userId: req.userId,
        loanId: req.params.loanId,
      });
      res
        .status(500)
        .json({ error: error.message || "Failed to get loan recommendations" });
    }
  }
);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate rule-based recommendations based on loan characteristics
 */
function generateRuleBasedRecommendations(loan: any): string[] {
  const recommendations: string[] = [];

  const fico = loan.fico_score || loan.credit_score;
  const dti = loan.dti_ratio || loan.dti || loan.be_dti_ratio;
  const ltv = loan.ltv || loan.loan_to_value || loan.ltv_ratio;

  if (fico && fico < 680) {
    recommendations.push(
      "Consider credit counseling or rapid rescoring to improve FICO score before proceeding"
    );
  }
  if (dti && dti > 43) {
    recommendations.push(
      "High DTI detected - explore debt payoff strategies or income documentation to improve qualification"
    );
  }
  if (ltv && ltv > 80) {
    recommendations.push(
      "High LTV may require PMI - discuss options with borrower including larger down payment"
    );
  }

  const appDate = loan.application_date
    ? new Date(loan.application_date)
    : null;
  if (appDate) {
    const daysSinceApp = Math.floor(
      (Date.now() - appDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceApp > 30) {
      recommendations.push(
        `Loan has been in pipeline ${daysSinceApp} days - review status and address any outstanding conditions`
      );
    }
    if (daysSinceApp > 45) {
      recommendations.push(
        "Consider rate lock extension options to protect borrower from market volatility"
      );
    }
  }

  const loanType = (loan.loan_type || "").toLowerCase();
  if (loanType.includes("jumbo") || loanType.includes("non-conforming")) {
    recommendations.push(
      "Jumbo loan - ensure all reserve requirements and documentation are complete"
    );
  }
  if (loanType.includes("investment") || loanType.includes("investor")) {
    recommendations.push(
      "Investment property - verify rental income documentation and DSCR requirements"
    );
  }

  const loanPurpose = (loan.loan_purpose || loan.purpose || "").toLowerCase();
  if (loanPurpose.includes("cash") && loanPurpose.includes("out")) {
    recommendations.push(
      "Cash-out refinance - confirm seasoning requirements and verify use of funds"
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Continue monitoring loan progress and maintain regular borrower communication"
    );
    recommendations.push(
      "Ensure all conditions are cleared promptly to minimize pipeline time"
    );
  }

  return recommendations;
}

/**
 * Generate AI-powered recommendations using GPT
 */
async function generateAIRecommendations(
  loan: any,
  apiKey: string
): Promise<string[]> {
  const loanSummary = {
    loanAmount: loan.loan_amount,
    loanType: loan.loan_type,
    loanPurpose: loan.loan_purpose || loan.purpose,
    fico: loan.fico_score || loan.credit_score,
    dti: loan.dti_ratio || loan.dti || loan.be_dti_ratio,
    ltv: loan.ltv || loan.loan_to_value || loan.ltv_ratio,
    interestRate: loan.interest_rate,
    applicationDate: loan.application_date,
    currentStatus: loan.current_loan_status || loan.status,
    loanOfficer: loan.loan_officer,
    branch: loan.branch,
    propertyType: loan.property_type,
    occupancy: loan.occupancy_type,
  };

  const prompt = `You are a mortgage loan advisor. Based on the following loan details, provide 3-5 specific, actionable recommendations to help this loan close successfully.

Loan Details:
${JSON.stringify(loanSummary, null, 2)}

Provide recommendations as a JSON array of strings. Focus on:
1. Risk mitigation strategies
2. Communication touchpoints
3. Documentation requirements
4. Timeline optimization
5. Borrower support actions

Return ONLY a JSON array of recommendation strings, no other text.
Example: ["Recommendation 1", "Recommendation 2", "Recommendation 3"]`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a mortgage lending expert. Respond only with valid JSON arrays.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || "[]";

  try {
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const recommendations = JSON.parse(cleanContent);
    return Array.isArray(recommendations) ? recommendations : [];
  } catch (parseError) {
    logError("[Predictions] Failed to parse AI recommendations", parseError);
    return [];
  }
}

export default router;
