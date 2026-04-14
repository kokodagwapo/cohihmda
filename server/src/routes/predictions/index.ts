/**
 * Predictions API Routes
 * Consolidated endpoints for loan predictions and recommendations
 *
 * Migrated from /api/loans/predict, /api/loans/predict/status,
 * /api/loans/predictions, /api/loans/:loanId/recommendations
 */

import { Router } from "express";
import { handleDatabaseError } from "../../config/database.js";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../../middleware/tenantContext.js";
import { apiLimiter } from "../../middleware/rateLimiter.js";
import { logError, logWarn, logInfo, logDebug } from "../../services/logger.js";
import { createJob, updateProgress, completeJob, failJob } from "../../services/jobManager.js";
import {
  computeMarketDeltaForDates,
  getMarketRateForDate,
  initializeMarketRateCache,
} from "../../services/dashboard/marketRateService.js";
import { calculatePullthroughForRole } from "../../services/dashboard/predictionService.js";
import { runPredictionPipeline } from "../../services/dashboard/predictionPipelineService.js";
import { generateEmbeddings } from "../../services/embeddingService.js";
import { postOpenAIChatCompletions } from "../../services/openai/chatCompletionsCompat.js";

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
      logInfo("[Predict] POST /api/predictions started", { tenantId });
      try {
        const { loanIds } = req.body || {};
        const result = await runPredictionPipeline(tenantContext.tenantPool, {
          loanIds: loanIds && Array.isArray(loanIds) ? loanIds : undefined,
          tenantId,
          onProgress: (pct, message) => updateProgress(job.id, pct, message),
        });
        completeJob(job.id, result);
      } catch (error: any) {
        logError("Error running prediction pipeline", error, { userId: req.userId });
        failJob(job.id, error.message || "Failed to predict loan outcomes");
      }
    });
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
            row.lock_date
        );
        if (needDelta.length > 0) {
          await initializeMarketRateCache().catch(() => {});
          for (const row of needDelta) {
            const lockDate = row.lock_date;
            if (lockDate) {
              const delta = await computeMarketDeltaForDates(lockDate, today);
              if (delta != null && !isNaN(delta)) {
                loanDataMap[row.loan_id] = { ...row, market_change_delta: delta };
              }
            }
          }
        }

        // Enrich market_rate_at_lock when missing: only for loans with lock_date (use market rate at lock date)
        const needMarketRateAtLock = loanDataResult.rows.filter(
          (row: any) => {
            const current = loanDataMap[row.loan_id] ?? row;
            const hasRate = current.market_rate_at_lock != null && !isNaN(Number(current.market_rate_at_lock));
            return !hasRate && row.lock_date;
          }
        );
        if (needMarketRateAtLock.length > 0) {
          await initializeMarketRateCache().catch(() => {});
          for (const row of needMarketRateAtLock) {
            const refDate = row.lock_date;
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

      function staticMarketDeltaBucketLocal(delta: number | null): number | null {
        if (delta == null || isNaN(delta)) return null;
        if (delta <= -0.25) return 1;
        if (delta <= 0) return 2;
        if (delta <= 0.1) return 3;
        if (delta <= 0.2) return 4;
        if (delta <= 0.3) return 5;
        return 6;
      }

      function calculateInterestLockVsMarketSignal(loan: any): number | null {
        const delta =
          loan.market_change_delta != null && !isNaN(Number(loan.market_change_delta))
            ? Number(loan.market_change_delta)
            : loan.marketChangeDelta != null && !isNaN(Number(loan.marketChangeDelta))
              ? Number(loan.marketChangeDelta)
              : null;
        if (delta !== null) {
          return staticMarketDeltaBucketLocal(delta);
        }
        const interestRate =
          loan.interest_rate != null ? Number(loan.interest_rate) : null;
        if (interestRate === null) return null;
        const market = loan.market_rate ?? loan.market_rate_at_lock;
        if (market != null && !isNaN(Number(market))) {
          return staticMarketDeltaBucketLocal(Number(market) - interestRate);
        }
        return null;
      }

      function calculateMarketChangeDelta(loan: any): number | null {
        // Only compute delta when loan has a lock date; otherwise leave blank (Lock vs Market = N/A)
        if (loan.lock_date == null && loan.lockDate == null) return null;
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
        return staticMarketDeltaBucketLocal(delta);
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
        // Use outcome-specific max to match sequencer: Denied max=24 (4 features × 6 pts).
        // Withdrawn: max=30 if loan has market_delta (5 features), else 24 (4 features). Other: 18.
        const MAX_DENIED_POINTS = 24;
        const MAX_WITHDRAWN_POINTS = 30;
        const MAX_OTHER_POINTS = 18;
        const withdrawHasMarketDelta =
          mergedLoanData.marketChangeDelta != null &&
          !isNaN(Number(mergedLoanData.marketChangeDelta));
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
                ? withdrawHasMarketDelta
                  ? MAX_WITHDRAWN_POINTS
                  : MAX_DENIED_POINTS
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
          market_rate: (mergedLoanData.lock_date ?? mergedLoanData.lockDate) != null && mergedLoanData.market_rate != null ? Number(mergedLoanData.market_rate) : null,
          market_rate_at_lock: (mergedLoanData.lock_date ?? mergedLoanData.lockDate) != null && mergedLoanData.market_rate_at_lock != null ? Number(mergedLoanData.market_rate_at_lock) : null,
          rateReferenceType: mergedLoanData.rateReferenceType ??
            ((mergedLoanData.lock_date ?? mergedLoanData.lockDate) != null ? "lock" : "application"),
          rateAtApplicationDate: mergedLoanData.rateAtApplicationDate != null ? Number(mergedLoanData.rateAtApplicationDate) : null,
          lockMarketRate:
            (mergedLoanData.lock_date ?? mergedLoanData.lockDate) != null
              ? (mergedLoanData.lockMarketRate != null ? Number(mergedLoanData.lockMarketRate) :
                (mergedLoanData.market_rate_at_lock != null
                  ? Number(mergedLoanData.market_rate_at_lock)
                  : mergedLoanData.interest_rate != null ? Number(mergedLoanData.interest_rate) : null))
              : null,
          marketChangeDelta:
            (mergedLoanData.lock_date ?? mergedLoanData.lockDate) != null
              ? (mergedLoanData.marketChangeDelta != null ? Number(mergedLoanData.marketChangeDelta) : calculateMarketChangeDelta(mergedLoanData))
              : null,
          marketChangeDeltaSignal:
            (mergedLoanData.lock_date ?? mergedLoanData.lockDate) != null
              ? (mergedLoanData.marketChangeDeltaSignal ??
                calculateMarketChangeDeltaSignal(mergedLoanData.marketChangeDelta != null ? Number(mergedLoanData.marketChangeDelta) : calculateMarketChangeDelta(mergedLoanData)))
              : null,
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

      // Fetch the latest prediction for enriched context
      let prediction: any = null;
      try {
        const predResult = await tenantPool.query(
          `SELECT predicted_outcome, confidence, confidence_score, risk_factors, loan_data, reasoning, model_version, created_at
           FROM public.loan_predictions
           WHERE loan_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [loanId]
        );
        prediction = predResult.rows[0] || null;
      } catch (predErr: any) {
        logInfo("[Predictions] Could not fetch prediction for recommendations", { error: predErr.message });
      }

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
        const recommendations = generateRuleBasedRecommendations(loan, prediction);
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
          prediction,
          tenantPool,
          apiKeyToUse
        );
        res.json({
          loanId,
          recommendations,
          source: "ai",
        });
      } catch (aiError: any) {
        logError("[Predictions] AI recommendation generation failed", aiError);
        const recommendations = generateRuleBasedRecommendations(loan, prediction);
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
// ---------------------------------------------------------------------------
// Shared helper – human-readable labels for raw risk factor names
// ---------------------------------------------------------------------------
const RISK_FACTOR_LABEL_MAP: Record<string, string> = {
  TurnTime: "Turn Time",
  fico_score: "FICO Score",
  ltv_ratio: "Loan-to-Value Ratio",
  dti_ratio: "Debt-to-Income Ratio",
  be_dti_ratio: "Back-End DTI",
  interest_rate: "Interest Rate",
  loan_amount: "Loan Amount",
  loan_type: "Loan Type",
  loan_purpose: "Loan Purpose",
  property_type: "Property Type",
  occupancy_type: "Occupancy Type",
  estimated_closing_date: "Estimated Closing Date",
  application_date: "Application Date",
  current_milestone: "Current Milestone",
  lock_expiration_date: "Rate Lock Expiration",
  market_delta: "Market Rate Delta",
  pullthrough_rate: "LO Pullthrough Rate",
  close_late_risk: "Close-Late Risk",
};

function humanizeRiskFactor(raw: string): string {
  return RISK_FACTOR_LABEL_MAP[raw] || raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Rule-based recommendations (enriched with prediction data)
// ---------------------------------------------------------------------------
function generateRuleBasedRecommendations(loan: any, prediction?: any | null): string[] {
  const recommendations: string[] = [];

  const fico = loan.fico_score || loan.credit_score;
  const dti = loan.be_dti_ratio || loan.dti_ratio || loan.dti;
  const ltv = loan.ltv || loan.loan_to_value || loan.ltv_ratio;

  // --- FICO risk ---
  if (fico && fico < 580) {
    recommendations.push(
      `FICO ${fico} is critically low — initiate rapid rescoring immediately. Identify open collections, utilization spikes, or recent derogatory events. A 20–40 point improvement may require 30–60 days.`
    );
  } else if (fico && fico < 640) {
    recommendations.push(
      `FICO ${fico} is near minimum threshold for most programs. Run a rapid rescore simulation to find quick wins: pay down revolving balances to <10%, request deletion of erroneous tradelines.`
    );
  } else if (fico && fico < 700) {
    recommendations.push(
      `FICO ${fico} qualifies for standard programs but limits pricing. Confirm borrower can avoid new credit inquiries until closing.`
    );
  }

  // --- DTI risk ---
  if (dti && dti > 50) {
    recommendations.push(
      `Back-end DTI at ${dti}% exceeds conventional overlays (typically ≤50%). Evaluate eliminating a liability (auto lease, student loan IBR, etc.) or adding a non-occupant co-borrower to reduce ratio.`
    );
  } else if (dti && dti > 43) {
    recommendations.push(
      `DTI of ${dti}% is above the traditional 43% QM threshold. Confirm AUS approval (DU/LP) and verify no manual underwriting applies. Explore debt payoff or additional income documentation.`
    );
  }

  // --- LTV / PMI risk ---
  if (ltv && ltv > 97) {
    recommendations.push(
      `LTV at ${ltv}% is near maximum — verify program eligibility (e.g., HomeReady/Home Possible). Confirm appraisal value is firm and no changes have occurred since application.`
    );
  } else if (ltv && ltv > 80) {
    recommendations.push(
      `LTV of ${ltv}% requires mortgage insurance. Review PMI options (monthly, single, split), lender-paid MI, or piggyback structure with borrower to find most cost-effective path to close.`
    );
  }

  // --- Pipeline age / close-late risk ---
  const appDate = loan.application_date ? new Date(loan.application_date) : null;
  const ecd = loan.estimated_closing_date ? new Date(loan.estimated_closing_date) : null;
  const today = new Date();
  const daysSinceApp = appDate
    ? Math.floor((today.getTime() - appDate.getTime()) / 86400000)
    : null;
  const daysToEcd = ecd
    ? Math.floor((ecd.getTime() - today.getTime()) / 86400000)
    : null;

  if (daysSinceApp !== null && daysSinceApp > 60) {
    recommendations.push(
      `Loan has been in pipeline ${daysSinceApp} days — this significantly increases fallout risk. Schedule an urgent borrower and agent status call to address outstanding conditions and re-confirm commitment to close.`
    );
  } else if (daysSinceApp !== null && daysSinceApp > 30) {
    recommendations.push(
      `Loan is ${daysSinceApp} days in pipeline. Audit outstanding conditions list and confirm each has an owner and a due date. Stalled milestones are the #1 predictor of fallout.`
    );
  }

  if (ecd && ecd < today) {
    recommendations.push(
      `Estimated closing date has passed. Immediately contact escrow, title, and the real estate agents to establish a new closing date and lock extension if needed. Document reasons for delay for compliance.`
    );
  } else if (daysToEcd !== null && daysToEcd <= 7) {
    recommendations.push(
      `Closing is in ${daysToEcd} day(s). Confirm all clear-to-close conditions, wire instructions sent, and borrower has verified final cash-to-close amount.`
    );
  } else if (daysToEcd !== null && daysToEcd <= 14) {
    recommendations.push(
      `${daysToEcd} days to estimated close. Verify CD (Closing Disclosure) has been issued with the required 3-business-day waiting period and that all outstanding suspense conditions are cleared.`
    );
  }

  // --- Rate lock expiration ---
  const lockExp = loan.lock_expiration_date ? new Date(loan.lock_expiration_date) : null;
  if (lockExp) {
    const daysToLockExp = Math.floor((lockExp.getTime() - today.getTime()) / 86400000);
    if (daysToLockExp < 0) {
      recommendations.push(
        `Rate lock has expired — immediately coordinate a lock extension or re-lock at current market rates. Document pricing impact for borrower transparency.`
      );
    } else if (daysToLockExp <= 7) {
      recommendations.push(
        `Rate lock expires in ${daysToLockExp} day(s). Initiate extension now before the lock desk cutoff — same-day extensions are often not available. Evaluate whether current market rates warrant a float-down option.`
      );
    } else if (daysToLockExp <= 14) {
      recommendations.push(
        `Rate lock expires in ${daysToLockExp} days. Monitor market conditions. If closing is at risk, proactively price a lock extension to avoid last-minute fees.`
      );
    }
  }

  // --- Current milestone stall detection ---
  const milestone = (loan.current_milestone || "").toLowerCase();
  if (milestone.includes("suspend") || milestone.includes("on hold")) {
    recommendations.push(
      `File is in a suspended/on-hold status. Identify all suspense conditions, assign clear ownership with deadlines, and communicate daily with the processor until conditions are cleared.`
    );
  } else if (milestone.includes("approval") || milestone.includes("conditional")) {
    recommendations.push(
      `Loan is in conditional approval. Prioritize clearing all prior-to-doc (PTD) conditions. Delays at this stage are the most common cause of closing date extensions.`
    );
  }

  // --- Loan type and purpose specific guidance ---
  const loanType = (loan.loan_type || "").toLowerCase();
  if (loanType.includes("jumbo") || loanType.includes("non-conforming")) {
    recommendations.push(
      `Jumbo/non-conforming loan — verify reserves (typically 6–12 months PITI), all asset statements are sourced, and appraisal has met investor guidelines. Jumbo overlays are strictly enforced.`
    );
  }
  if (loanType.includes("fha")) {
    recommendations.push(
      `FHA loan — confirm CAIVRS clearance, MIP structure, and that property condition satisfies FHA Minimum Property Requirements (MPR). FHA appraisals flag deferred maintenance that can cause delays.`
    );
  }
  if (loanType.includes("va")) {
    recommendations.push(
      `VA loan — verify Certificate of Eligibility (COE) is on file, NOV (Notice of Value) is issued, and borrower has confirmed VA funding fee status. VA appraisals have strict MPR requirements.`
    );
  }
  if (loanType.includes("usda") || loanType.includes("rural")) {
    recommendations.push(
      `USDA Rural Development loan — confirm property is in an eligible area and that the file has been submitted to USDA for conditional commitment. USDA turn times can add 2–4 weeks.`
    );
  }

  const loanPurpose = (loan.loan_purpose || loan.purpose || "").toLowerCase();
  if (loanPurpose.includes("cash") && loanPurpose.includes("out")) {
    recommendations.push(
      `Cash-out refinance — confirm 6-month seasoning requirement, verify use of funds is documented, and review state-specific rescission period that could affect wire timing.`
    );
  }
  if (loanPurpose.includes("investment") || (loan.occupancy_type || "").toLowerCase().includes("investment")) {
    recommendations.push(
      `Investment property — verify rental income (2-year history or signed lease), confirm reserves meet investor requirements (typically 6 months per financed property), and check LLPA pricing adjustments.`
    );
  }

  // --- Prediction-driven guidance ---
  if (prediction) {
    const outcome = prediction.predicted_outcome || "";
    const confidence = prediction.confidence_score || prediction.confidence || 0;
    const riskFactors: string[] = Array.isArray(prediction.risk_factors)
      ? prediction.risk_factors
      : typeof prediction.risk_factors === "string"
      ? JSON.parse(prediction.risk_factors || "[]")
      : [];

    if (outcome === "withdraw") {
      recommendations.push(
        `AI model predicts ${(confidence * 100).toFixed(0)}% probability of withdrawal — the borrower may disengage. Schedule a personal call to gauge commitment level and uncover any unspoken objections (competing offers, life changes, financing alternatives).`
      );
    } else if (outcome === "decline") {
      recommendations.push(
        `AI model predicts ${(confidence * 100).toFixed(0)}% probability of decline. Proactively review AUS findings for any remaining approval paths, and prepare a denial notice with specific adverse action reasons per ECOA/FCRA requirements.`
      );
    }

    if (riskFactors.includes("TurnTime") || riskFactors.includes("turn_time")) {
      recommendations.push(
        `Turn time is a primary risk signal — confirm all vendor orders (appraisal, title, HOI, flood) are in and escalate any outstanding items directly with the provider.`
      );
    }
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Loan metrics are within acceptable ranges. Maintain weekly borrower contact to confirm commitment and identify any life-event changes that could affect qualification."
    );
    recommendations.push(
      "Conduct a full conditions audit and assign clear owners with deadlines — proactive pipeline management is the most reliable way to protect your pull-through rate."
    );
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Fetch knowledge center context (RAG) for recommendations
// ---------------------------------------------------------------------------
async function fetchRecommendationKnowledgeContext(
  tenantPool: any,
  topRiskFactors: string[],
  predictedOutcome: string,
  apiKey: string
): Promise<string> {
  try {
    // Check that rag_embeddings table and data exist
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'rag_embeddings'
      ) AS exists
    `);
    if (!tableCheck.rows[0]?.exists) return "";

    const countCheck = await tenantPool.query(
      `SELECT COUNT(*) AS cnt FROM public.rag_embeddings`
    );
    if (parseInt(countCheck.rows[0]?.cnt || "0") === 0) return "";

    // Build natural language query from top risk factors + outcome
    const humanFactors = topRiskFactors.slice(0, 4).map(humanizeRiskFactor);
    const queryText = `mortgage loan ${predictedOutcome || "fallout"} risk: ${humanFactors.join(", ")}. Recommended actions to prevent fallout and improve pull-through.`;

    const embedResults = await generateEmbeddings(
      [queryText],
      "openai/text-embedding-3-large"
    );
    if (!embedResults || embedResults.length === 0) return "";

    const emb = embedResults[0].embedding;
    const embStr = `[${emb.join(",")}]`;

    const result = await tenantPool.query(
      `SELECT
         e.chunk_text,
         d.title,
         d.filename,
         1 - (e.embedding <=> $1::vector) AS similarity
       FROM rag_embeddings e
       JOIN rag_documents d ON e.document_id = d.id
       WHERE d.status = 'indexed'
         AND 1 - (e.embedding <=> $1::vector) >= 0.3
       ORDER BY e.embedding <=> $1::vector
       LIMIT 6`,
      [embStr]
    );

    // Also fetch rag_knowledge_base entries categorized as Recommendations
    let kbEntries: Array<{ title: string; content: string }> = [];
    try {
      const kbResult = await tenantPool.query(
        `SELECT title, content FROM public.rag_knowledge_base
         WHERE category = 'Recommendations' AND is_active = true
         ORDER BY priority DESC, created_at DESC
         LIMIT 5`
      );
      kbEntries = kbResult.rows;
    } catch {
      // table may not exist yet
    }

    const parts: string[] = [];

    if (kbEntries.length > 0) {
      parts.push("ORGANIZATION RECOMMENDATION GUIDELINES (from Knowledge Center):");
      for (const kb of kbEntries) {
        parts.push(`[${kb.title}]`);
        parts.push(kb.content.trim());
        parts.push("");
      }
    }

    if (result.rows.length > 0) {
      parts.push("RELEVANT KNOWLEDGE BASE CONTEXT (semantic search):");
      for (const row of result.rows) {
        const sim = parseFloat(row.similarity);
        parts.push(`[Source: ${row.title || row.filename || "Unknown"} — ${(sim * 100).toFixed(0)}% relevance]`);
        parts.push(row.chunk_text?.trim() || "");
        parts.push("");
      }
    }

    return parts.join("\n");
  } catch (err: any) {
    logWarn(`[Predictions] Knowledge context fetch failed (non-fatal): ${err.message}`, {});
    return "";
  }
}

// ---------------------------------------------------------------------------
// AI recommendations using GPT-4o with enriched context
// ---------------------------------------------------------------------------
async function generateAIRecommendations(
  loan: any,
  prediction: any | null,
  tenantPool: any,
  apiKey: string
): Promise<string[]> {

  // ---- Build enriched loan context ----
  const loanData = prediction?.loan_data
    ? (typeof prediction.loan_data === "string"
        ? JSON.parse(prediction.loan_data)
        : prediction.loan_data)
    : {};

  const riskFactors: string[] = Array.isArray(prediction?.risk_factors)
    ? prediction.risk_factors
    : typeof prediction?.risk_factors === "string"
    ? JSON.parse(prediction?.risk_factors || "[]")
    : [];

  const riskSummary = loanData?.riskSummary || null;
  const signalStrengths: Record<string, any> = loanData?.signalStrengths || loanData?.signals || {};
  const reasonCodes: string[] = loanData?.reasonCodes || loanData?.reason_codes || [];
  const pullthroughRate: number | null = loanData?.pullthroughRate ?? loanData?.pullthrough_rate ?? null;
  const marketDelta: number | null = loanData?.marketDelta ?? loanData?.market_delta ?? null;

  const today = new Date();
  const appDate = loan.application_date ? new Date(loan.application_date) : null;
  const ecd = loan.estimated_closing_date ? new Date(loan.estimated_closing_date) : null;
  const lockExp = loan.lock_expiration_date ? new Date(loan.lock_expiration_date) : null;

  const daysInPipeline = appDate
    ? Math.floor((today.getTime() - appDate.getTime()) / 86400000)
    : null;
  const daysToClose = ecd
    ? Math.floor((ecd.getTime() - today.getTime()) / 86400000)
    : null;
  const daysToLockExp = lockExp
    ? Math.floor((lockExp.getTime() - today.getTime()) / 86400000)
    : null;
  const isPastEcd = ecd ? ecd < today : false;
  const isLockExpiring = daysToLockExp !== null && daysToLockExp <= 7;

  const closeLateRisk =
    loanData?.closeLateRisk ??
    (ecd !== null && ecd < today && (prediction?.predicted_outcome || "originate") === "originate");

  const outcome = prediction?.predicted_outcome || "unknown";
  const confidence = Math.round(
    ((prediction?.confidence_score ?? prediction?.confidence ?? 0) as number) * 100
  );

  // ---- Fetch knowledge context ----
  const knowledgeContext = await fetchRecommendationKnowledgeContext(
    tenantPool,
    riskFactors,
    outcome,
    apiKey
  );

  // ---- Build system prompt ----
  const systemPrompt = process.env.RECOMMENDATION_MODEL
    ? `You are an expert mortgage lending advisor. Respond only with a valid JSON array of strings.`
    : `You are a senior mortgage lending expert with deep knowledge of GSE guidelines (Fannie Mae, Freddie Mac), FHA/VA/USDA programs, underwriting best practices, and pipeline management. You specialize in identifying loans at risk of fallout and providing specific, actionable coaching to loan officers.

Your task is to analyze a loan's risk profile and provide 5–7 targeted, actionable recommendations that directly address the identified risk drivers. Each recommendation must:
- Reference the specific risk signal or data point driving the concern
- Explain WHY it matters for this loan
- Include a concrete next step or tactic (not generic advice)
- Be written for a loan officer who will act on it today

Respond ONLY with a valid JSON array of strings. No markdown, no explanation outside the array.`;

  // ---- Build user prompt ----
  const signalLines = Object.entries(signalStrengths)
    .map(([k, v]: [string, any]) => {
      const label = humanizeRiskFactor(k);
      const val = typeof v === "object" ? JSON.stringify(v) : String(v ?? "N/A");
      return `  - ${label}: ${val}`;
    })
    .join("\n");

  const riskFactorLines = riskFactors
    .map((f) => `  - ${humanizeRiskFactor(f)}`)
    .join("\n") || "  (none identified)";

  const reasonCodeLines = reasonCodes.length
    ? reasonCodes.map((r: string) => `  - ${r}`).join("\n")
    : "  (none)";

  const riskSummaryBlock = riskSummary
    ? `Risk Summary:
  - Overall Risk: ${riskSummary.overallRisk || "N/A"}
  - Key Risks: ${(riskSummary.risks || []).join("; ") || "none"}
  - Positive Factors: ${(riskSummary.positives || []).join("; ") || "none"}`
    : "";

  const knowledgeBlock = knowledgeContext
    ? `\n---\nORGANIZATION KNOWLEDGE CONTEXT\n${knowledgeContext}\n---`
    : "";

  const userPrompt = `Analyze the following loan and provide 5–7 specific, actionable recommendations for the loan officer. Tie each recommendation directly to a named risk driver or data point below.

=== LOAN PROFILE ===
Loan ID: ${loan.loan_id || "N/A"}
Loan Amount: $${Number(loan.loan_amount || 0).toLocaleString()}
Loan Type: ${loan.loan_type || "N/A"}
Loan Purpose: ${loan.loan_purpose || loan.purpose || "N/A"}
Property Type: ${loan.property_type || "N/A"}
Occupancy: ${loan.occupancy_type || "N/A"}
Current Milestone: ${loan.current_milestone || "N/A"}

Borrower Financials:
  - FICO Score: ${loan.fico_score || loan.credit_score || "N/A"}
  - Back-End DTI: ${loan.be_dti_ratio || loan.dti_ratio || "N/A"}%
  - LTV Ratio: ${loan.ltv || loan.ltv_ratio || loan.loan_to_value || "N/A"}%
  - Loan Amount: $${Number(loan.loan_amount || 0).toLocaleString()}
  - Interest Rate: ${loan.interest_rate || "N/A"}%

Timeline:
  - Application Date: ${loan.application_date ? new Date(loan.application_date).toLocaleDateString() : "N/A"}
  - Days in Pipeline: ${daysInPipeline !== null ? daysInPipeline : "N/A"}
  - Estimated Closing Date: ${ecd ? ecd.toLocaleDateString() : "N/A"}
  - Days to Close: ${daysToClose !== null ? (daysToClose < 0 ? `PAST ECD (${Math.abs(daysToClose)} days overdue)` : daysToClose) : "N/A"}
  - Rate Lock Expires: ${lockExp ? lockExp.toLocaleDateString() : "N/A"}${daysToLockExp !== null ? ` (${daysToLockExp < 0 ? "EXPIRED" : `${daysToLockExp} days remaining`})` : ""}
  - Past Estimated Close: ${isPastEcd ? "YES ⚠️" : "No"}
  - Lock Expiring Soon: ${isLockExpiring ? "YES ⚠️" : "No"}

=== AI PREDICTION ===
  - Predicted Outcome: ${outcome.toUpperCase()} (${confidence}% confidence)
  - Close-Late Risk: ${closeLateRisk ? "YES ⚠️" : "No"}
  - LO Pullthrough Rate: ${pullthroughRate !== null ? `${(pullthroughRate * 100).toFixed(1)}%` : "N/A"}
  - Market Rate Delta: ${marketDelta !== null ? `${marketDelta > 0 ? "+" : ""}${marketDelta.toFixed(2)}%` : "N/A"}

Top Risk Factors (model-identified drivers):
${riskFactorLines}

Signal Strengths (model feature values):
${signalLines || "  (not available)"}

Reason Codes:
${reasonCodeLines}

${riskSummaryBlock}
${knowledgeBlock}

=== INSTRUCTIONS ===
For each recommendation:
1. Name the specific risk factor or data point you are addressing
2. Explain the impact on this loan if not addressed
3. Give a concrete, immediate action the loan officer should take
4. Note any regulatory, guideline, or timeline constraint that applies

Return ONLY a JSON array of strings. Each string is one complete recommendation (2–4 sentences).`;

  const model = process.env.RECOMMENDATION_MODEL || "gpt-5.4";

  const response = await postOpenAIChatCompletions(
    apiKey,
    {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
    },
    1800,
  );

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
