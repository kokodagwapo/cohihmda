/**
 * insightDetailHydrator.ts
 *
 * Runs immediately after insight generation to populate `detail_data` on each
 * insight.  This stores the complete detail snapshot (title, summary, rows,
 * displayConfig) so the frontend never needs to re-query the database.
 *
 * Strategy:
 *  - Loan-ID-based insights: single batch query for all loan IDs across all
 *    insights, then slice per-insight.
 *  - Performance / Tiering: use already-collected officer data from the metrics
 *    payload.
 *  - Comparisons: single monthly trend query.
 *  - Pipeline: dedicated query using stored params (min_days / lock_filter).
 *  - Margin: pure aggregate from the metrics payload (no rows).
 */

import pg from "pg";
import { CategorizedInsight, InsightDetailSnapshot } from "./llmInsightGenerator.js";
import { InsightMetricsPayload } from "./insightMetricsCollector.js";
import { createSchemaResolver } from "../tenantSchemaResolver.js";
import { getTenantRevenueExpression, isActorMissing } from "../../utils/scorecard-utils.js";

// ============================================================================
// Default columns & summary metrics (mirrors src/config/insightFieldRegistry.ts)
// ============================================================================

const DEFAULT_COLUMNS: Record<string, string[]> = {
  predictions:       ["loanNumber", "predictedOutcome", "confidence", "loanAmount", "milestone", "interestRate", "loanOfficer"],
  credit_risk:       ["loanNumber", "riskReason", "ficoScore", "ltv", "dti", "loanAmount", "milestone", "interestRate"],
  lost_opportunity:  ["loanNumber", "status", "loanAmount", "loanType", "milestone", "interestRate", "loanOfficer"],
  pipeline:          ["loanNumber", "loanAmount", "loanType", "milestone", "interestRate", "daysInPipeline", "loanOfficer"],
  performance:       ["name", "totalLoans", "fundedLoans", "pullThrough", "fundedVolume", "avgCycleTime"],
  comparisons:       ["month", "loansStarted", "loansFunded", "pullThrough", "fundedVolume", "avgCycleTime"],
  closing_risk:      ["loanNumber", "loanAmount", "milestone", "estimatedClosingDate", "daysToClose", "ctcDate", "loanOfficer"],
  lock_expiration:   ["loanNumber", "loanAmount", "milestone", "interestRate", "lockExpirationDate", "daysToExpiry", "lockDays", "loanOfficer"],
  trid:              ["loanNumber", "loanAmount", "milestone", "estimatedClosingDate", "daysToClose", "closingDisclosureSentDate", "loanOfficer"],
  margin:            [],
  condition_backlog: ["loanNumber", "loanAmount", "conditions", "milestone", "loanType", "status", "loanOfficer"],
  tiering:           ["name", "tier", "revenue", "units", "fundedVolume", "revenueBps", "pullThrough", "avgCycleTime", "lostOpportunityUnits", "deniedUnits"],
};

const DEFAULT_SUMMARY_METRICS: Record<string, string[]> = {
  predictions:       ["totalAtRisk", "likelyWithdraw", "likelyDeny", "totalVolume"],
  credit_risk:       ["totalHighRisk", "lowFico", "highLtv", "highDti"],
  lost_opportunity:  ["totalLost", "withdrawn", "denied", "estimatedLostRevenue"],
  pipeline:          ["totalActive", "locked", "over30Days", "totalVolume"],
  performance:       ["totalOfficers", "totalLoans", "totalFunded", "totalVolume", "avgCycleTime"],
  comparisons:       ["currentYtdVolume", "priorYtdVolume", "ytdVolumeDelta", "currentYtdFunded", "priorYtdFunded"],
  closing_risk:      ["totalAtRisk", "totalVolume", "avgDaysToClose"],
  lock_expiration:   ["totalExpiring", "totalVolume", "avgDaysToExpiry"],
  trid:              ["totalAtRisk", "totalVolume", "avgDaysToClose"],
  margin:            ["currentMonthBps", "priorMonthBps", "deltaBps"],
  condition_backlog: ["totalLoans", "avgConditions", "totalVolume"],
  tiering:           ["totalActors", "topCount", "secondCount", "bottomCount"],
};

// ============================================================================
// Types for batch query results
// ============================================================================

interface LoanRow {
  loan_id: string;
  loan_number: string | null;
  loan_amount: number;
  loan_type: string | null;
  status: string | null;
  milestone: string | null;
  interest_rate: number | null;
  fico_score: number | null;
  ltv: number | null;
  dti: number | null;
  application_date: string | null;
  loan_officer: string | null;
  funding_date: string | null;
  closing_date: string | null;
  estimated_closing_date: string | null;
  ctc_date: string | null;
  lock_date: string | null;
  lock_expiration_date: string | null;
  lock_days: number | null;
  closing_disclosure_sent_date: string | null;
  closing_disclosure_received_date: string | null;
  conditions: number;
  revenue: number;
  days_in_pipeline: number | null;
  days_to_close: number | null;
  days_to_expiry: number | null;
  // prediction fields (may be null for non-prediction loans)
  predicted_outcome: string | null;
  confidence: number | null;
  reasoning: string | null;
  risk_factors: string[] | null;
  // computed credit risk reason
  risk_reason: string | null;
}

// ============================================================================
// Main entry point
// ============================================================================

export async function hydrateInsightDetails(
  insights: CategorizedInsight[],
  metrics: InsightMetricsPayload,
  tenantPool: pg.Pool,
  channelGroup?: string,
): Promise<void> {
  if (insights.length === 0) return;

  const t0 = Date.now();

  try {
    // Collect all loan IDs across all insights that need batch fetching
    const loanIdInsightSources = new Set([
      "predictions", "credit_risk", "lost_opportunity",
      "closing_risk", "lock_expiration", "trid", "condition_backlog",
    ]);

    const allLoanIds = new Set<string>();
    for (const ins of insights) {
      if (loanIdInsightSources.has(ins.source) && Array.isArray(ins.detail_query?.loan_ids)) {
        for (const id of ins.detail_query!.loan_ids) allLoanIds.add(id);
      }
    }

    // Batch fetch all loan rows in one query
    const loanMap = allLoanIds.size > 0
      ? await batchFetchLoans(tenantPool, [...allLoanIds])
      : new Map<string, LoanRow>();

    // Fetch comparison data (shared across all comparison insights)
    let comparisonData: any[] | null = null;
    const hasComparisons = insights.some(i => i.source === "comparisons");
    if (hasComparisons) {
      comparisonData = await fetchComparisonRows(tenantPool);
    }

    // Hydrate each insight
    for (const ins of insights) {
      try {
        ins.detail_data = await buildDetailData(
          ins, metrics, tenantPool, loanMap, comparisonData,
        );
      } catch (err) {
        console.warn(`[Hydrator] Failed to hydrate ${ins.source} insight: ${(err as Error).message}`);
        ins.detail_data = null;
      }
    }

    console.log(
      `[Hydrator] Hydrated ${insights.length} insights in ${Date.now() - t0}ms ` +
      `(${allLoanIds.size} loan IDs batch-fetched)`,
    );
  } catch (err) {
    console.error(`[Hydrator] Top-level hydration error:`, err);
    // Non-fatal — insights will still be saved, just without detail_data
  }
}

// ============================================================================
// Batch loan fetcher
// ============================================================================

async function batchFetchLoans(
  tenantPool: pg.Pool,
  loanIds: string[],
): Promise<Map<string, LoanRow>> {
  if (loanIds.length === 0) return new Map();

  const loans = await createSchemaResolver(tenantPool, "loans");
  const revenueExpr = await getTenantRevenueExpression(tenantPool);

  const query = `
    SELECT
      l.loan_id,
      l.loan_number,
      COALESCE(l.loan_amount, 0)                 AS loan_amount,
      l.loan_type,
      l.current_loan_status                       AS status,
      l.current_milestone                         AS milestone,
      l.interest_rate,
      ${loans.selectExpr("fico_score", "l")},
      ${loans.selectExpr("ltv", "l")},
      ${loans.selectExpr("dti", "l")},
      l.application_date,
      l.funding_date,
      l.closing_date,
      l.estimated_closing_date,
      l.ctc_date,
      l.lock_date,
      l.lock_expiration_date,
      l.lock_days,
      l.closing_disclosure_sent_date,
      l.closing_disclosure_received_date,
      COALESCE(l.number_of_conditions, 0)         AS conditions,
      COALESCE(${revenueExpr}, 0)                 AS revenue,
      CASE WHEN l.application_date IS NOT NULL
        THEN CURRENT_DATE - DATE(l.application_date) END AS days_in_pipeline,
      CASE WHEN l.estimated_closing_date IS NOT NULL
        THEN l.estimated_closing_date - CURRENT_DATE END AS days_to_close,
      CASE WHEN l.lock_expiration_date IS NOT NULL
        THEN l.lock_expiration_date - CURRENT_DATE END   AS days_to_expiry,
      COALESCE(e.first_name || ' ' || e.last_name,
               ${loans.whereExpr("loan_officer", "l")})  AS loan_officer,
      lp.predicted_outcome,
      lp.confidence,
      lp.reasoning,
      lp.risk_factors,
      CASE
        WHEN ${loans.castExpr("fico_score", "INTEGER", "l")} < 620 THEN 'Low FICO'
        WHEN ${loans.castExpr("ltv", "DECIMAL", "l")} > 95         THEN 'High LTV'
        WHEN ${loans.castExpr("dti", "DECIMAL", "l")} > 50         THEN 'High DTI'
        ELSE 'Multiple Factors'
      END AS risk_reason
    FROM public.loans l
    LEFT JOIN public.employees e
      ON e.id::TEXT = ${loans.whereExpr("loan_officer_id", "l")}
    LEFT JOIN public.loan_predictions lp
      ON lp.loan_id = l.loan_id
    WHERE l.loan_id = ANY($1)
  `;

  const result = await tenantPool.query(query, [loanIds]);

  const map = new Map<string, LoanRow>();
  for (const r of result.rows) {
    map.set(r.loan_id, {
      loan_id: r.loan_id,
      loan_number: r.loan_number || null,
      loan_amount: parseFloat(r.loan_amount) || 0,
      loan_type: r.loan_type,
      status: r.status,
      milestone: r.milestone || null,
      interest_rate: r.interest_rate ? parseFloat(r.interest_rate) : null,
      fico_score: r.fico_score ? parseInt(r.fico_score) : null,
      ltv: r.ltv ? parseFloat(r.ltv) : null,
      dti: r.dti ? parseFloat(r.dti) : null,
      application_date: r.application_date,
      loan_officer: r.loan_officer,
      funding_date: r.funding_date,
      closing_date: r.closing_date,
      estimated_closing_date: r.estimated_closing_date,
      ctc_date: r.ctc_date,
      lock_date: r.lock_date,
      lock_expiration_date: r.lock_expiration_date,
      lock_days: r.lock_days ? parseInt(r.lock_days) : null,
      closing_disclosure_sent_date: r.closing_disclosure_sent_date,
      closing_disclosure_received_date: r.closing_disclosure_received_date,
      conditions: parseInt(r.conditions) || 0,
      revenue: parseFloat(r.revenue) || 0,
      days_in_pipeline: r.days_in_pipeline != null ? parseInt(r.days_in_pipeline) : null,
      days_to_close: r.days_to_close != null ? parseInt(r.days_to_close) : null,
      days_to_expiry: r.days_to_expiry != null ? parseInt(r.days_to_expiry) : null,
      predicted_outcome: r.predicted_outcome,
      confidence: r.confidence != null ? parseFloat(r.confidence) : null,
      reasoning: r.reasoning,
      risk_factors: r.risk_factors || null,
      risk_reason: r.risk_reason,
    });
  }

  return map;
}

// ============================================================================
// Comparison rows fetcher
// ============================================================================

async function fetchComparisonRows(tenantPool: pg.Pool): Promise<any[]> {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0];

  const query = `
    SELECT
      TO_CHAR(DATE_TRUNC('month', COALESCE(l.funding_date, l.application_date)), 'YYYY-MM') AS month,
      COUNT(*)                                                AS loans_in_month,
      COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END) AS loans_funded,
      SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount ELSE 0 END) AS funded_volume,
      SUM(l.loan_amount)                                      AS total_volume,
      AVG(CASE
        WHEN l.funding_date IS NOT NULL AND l.application_date IS NOT NULL
        THEN DATE(l.funding_date) - DATE(l.application_date) END) AS avg_cycle_time
    FROM public.loans l
    WHERE (l.funding_date >= ($1::date - INTERVAL '12 months')
           OR (l.funding_date IS NULL AND l.application_date >= ($1::date - INTERVAL '12 months')))
    GROUP BY DATE_TRUNC('month', COALESCE(l.funding_date, l.application_date))
    ORDER BY month DESC
    LIMIT 13
  `;

  const result = await tenantPool.query(query, [startOfYear]);
  return result.rows;
}

// ============================================================================
// Per-source detail builders
// ============================================================================

function resolveDisplayConfig(
  insight: CategorizedInsight,
): { columns: string[]; summaryMetrics: string[] } {
  return {
    columns: insight.detail_query?.detail_columns?.length
      ? insight.detail_query.detail_columns
      : (DEFAULT_COLUMNS[insight.source] || []),
    summaryMetrics: insight.detail_query?.summary_metrics?.length
      ? insight.detail_query.summary_metrics
      : (DEFAULT_SUMMARY_METRICS[insight.source] || []),
  };
}

function getLoanRows(
  loanIds: string[],
  loanMap: Map<string, LoanRow>,
): LoanRow[] {
  return loanIds
    .map(id => loanMap.get(id))
    .filter((r): r is LoanRow => r != null);
}

async function buildDetailData(
  insight: CategorizedInsight,
  metrics: InsightMetricsPayload,
  tenantPool: pg.Pool,
  loanMap: Map<string, LoanRow>,
  comparisonData: any[] | null,
): Promise<InsightDetailSnapshot | null> {
  const src = insight.source;
  const dq = insight.detail_query;
  const displayConfig = resolveDisplayConfig(insight);

  switch (src) {

    // ====================================================================
    // PREDICTIONS
    // ====================================================================
    case "predictions": {
      const ids: string[] = dq?.loan_ids || [];
      const rawRows = getLoanRows(ids, loanMap)
        .filter(r => r.status === "Active Loan" && r.predicted_outcome)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

      const rows = rawRows.map(r => ({
        loanNumber: r.loan_number || r.loan_id,
        predictedOutcome: r.predicted_outcome,
        confidence: r.confidence != null ? Math.round(r.confidence) : null,
        reasoning: r.reasoning,
        riskFactors: r.risk_factors || [],
        loanAmount: r.loan_amount,
        loanType: r.loan_type,
        status: r.status,
        milestone: r.milestone,
        interestRate: r.interest_rate,
        ficoScore: r.fico_score,
        ltv: r.ltv,
        dti: r.dti,
        applicationDate: r.application_date,
        loanOfficer: r.loan_officer,
      }));

      const withdrawCount = rows.filter(r => r.predictedOutcome === "withdraw").length;
      const denyCount = rows.filter(r => r.predictedOutcome === "deny").length;
      const highConfCount = rows.filter(r => (r.confidence || 0) >= 70).length;
      const totalVol = rows.reduce((s, r) => s + r.loanAmount, 0);

      const confLabel = dq?.confidence_min ? `≥${dq.confidence_min}%` : "";

      return {
        title: confLabel
          ? `At-Risk Loans (${confLabel} Fallout Probability)`
          : "At-Risk Loans (Fallout Predictions)",
        summary: {
          totalAtRisk: rows.length,
          likelyWithdraw: withdrawCount,
          likelyDeny: denyCount,
          highConfidence: highConfCount,
          totalVolume: totalVol,
          avgConfidence: rows.length > 0
            ? rows.reduce((s, r) => s + (r.confidence || 0), 0) / rows.length
            : 0,
        },
        rows,
        displayConfig,
      };
    }

    // ====================================================================
    // CREDIT RISK
    // ====================================================================
    case "credit_risk": {
      const ids: string[] = dq?.loan_ids || [];
      const rawRows = getLoanRows(ids, loanMap)
        .sort((a, b) => b.loan_amount - a.loan_amount);

      const rows = rawRows.map(r => ({
        loanNumber: r.loan_number || r.loan_id,
        loanAmount: r.loan_amount,
        loanType: r.loan_type,
        status: r.status,
        milestone: r.milestone,
        interestRate: r.interest_rate,
        ficoScore: r.fico_score,
        ltv: r.ltv,
        dti: r.dti,
        applicationDate: r.application_date,
        loanOfficer: r.loan_officer,
        riskReason: r.risk_reason,
      }));

      return {
        title: "Credit Risk Loans",
        summary: {
          totalHighRisk: rows.length,
          lowFico: rows.filter(r => (r.ficoScore || 999) < 620).length,
          highLtv: rows.filter(r => (r.ltv || 0) > 95).length,
          highDti: rows.filter(r => (r.dti || 0) > 50).length,
          totalVolume: rows.reduce((s, r) => s + r.loanAmount, 0),
        },
        rows,
        displayConfig,
      };
    }

    // ====================================================================
    // LOST OPPORTUNITY
    // ====================================================================
    case "lost_opportunity": {
      const ids: string[] = dq?.loan_ids || [];
      const rawRows = getLoanRows(ids, loanMap)
        .sort((a, b) => b.loan_amount - a.loan_amount);

      const rows = rawRows.map(r => ({
        loanNumber: r.loan_number || r.loan_id,
        loanAmount: r.loan_amount,
        loanType: r.loan_type,
        status: r.status,
        milestone: r.milestone,
        interestRate: r.interest_rate,
        applicationDate: r.application_date,
        ficoScore: r.fico_score,
        ltv: r.ltv,
        loanOfficer: r.loan_officer,
      }));

      const withdrawn = rows.filter(r =>
        ["withdrawn", "cancelled", "Withdrawn"].some(s =>
          (r.status || "").toLowerCase().includes(s.toLowerCase()),
        ),
      );
      const denied = rows.filter(r =>
        ["denied", "declined", "Denied"].some(s =>
          (r.status || "").toLowerCase().includes(s.toLowerCase()),
        ),
      );

      return {
        title: "Lost Opportunity (Withdrawn & Denied)",
        summary: {
          totalLost: rows.length,
          withdrawn: withdrawn.length,
          denied: denied.length,
          withdrawnVolume: withdrawn.reduce((s, r) => s + r.loanAmount, 0),
          deniedVolume: denied.reduce((s, r) => s + r.loanAmount, 0),
          estimatedLostRevenue: rows.reduce((s, r) => s + r.loanAmount, 0) * 0.01,
        },
        rows,
        displayConfig,
      };
    }

    // ====================================================================
    // PIPELINE
    // ====================================================================
    case "pipeline": {
      const pipelineRows = await fetchPipelineRows(tenantPool, dq);
      const lockedCount = pipelineRows.filter(r => r.lockDate).length;
      const over30 = pipelineRows.filter(r => (r.daysInPipeline || 0) > 30).length;
      const over45 = pipelineRows.filter(r => (r.daysInPipeline || 0) > 45).length;

      const minDays: number | null = dq?.min_days ?? null;
      const lockFilter: string | null = dq?.lock_filter ?? null;

      const title = minDays
        ? `Pipeline Loans (>${minDays} Days)`
        : lockFilter === "unlocked"
          ? "Active Pipeline (Unlocked)"
          : lockFilter === "locked"
            ? "Active Pipeline (Locked)"
            : "Active Pipeline";

      return {
        title,
        summary: {
          totalActive: pipelineRows.length,
          locked: lockedCount,
          unlocked: pipelineRows.length - lockedCount,
          over30Days: over30,
          over45Days: over45,
          totalVolume: pipelineRows.reduce((s, r) => s + r.loanAmount, 0),
          avgDaysInPipeline: pipelineRows.length > 0
            ? Math.round(pipelineRows.reduce((s, r) => s + (r.daysInPipeline || 0), 0) / pipelineRows.length)
            : 0,
        },
        rows: pipelineRows,
        displayConfig,
      };
    }

    // ====================================================================
    // PERFORMANCE
    // ====================================================================
    case "performance": {
      return buildOfficerSnapshot(insight, metrics, displayConfig, "Performance by Loan Officer");
    }

    // ====================================================================
    // COMPARISONS
    // ====================================================================
    case "comparisons": {
      if (!comparisonData) return null;

      const currentYear = new Date().getFullYear().toString();
      const priorYear = (new Date().getFullYear() - 1).toString();
      const currentMonth = new Date().getMonth() + 1;

      const rows = comparisonData.map((r: any) => ({
        month: r.month,
        loansStarted: parseInt(r.loans_in_month) || 0,
        loansFunded: parseInt(r.loans_funded) || 0,
        totalVolume: parseFloat(r.total_volume) || 0,
        fundedVolume: parseFloat(r.funded_volume) || 0,
        avgCycleTime: r.avg_cycle_time ? Math.round(parseFloat(r.avg_cycle_time)) : null,
        pullThrough: parseInt(r.loans_in_month) > 0
          ? Math.round((parseInt(r.loans_funded) / parseInt(r.loans_in_month)) * 100)
          : 0,
      }));

      const currentYtd = rows.filter((r: any) => r.month?.startsWith(currentYear));
      const priorYtd = rows.filter((r: any) => {
        if (!r.month?.startsWith(priorYear)) return false;
        const monthNum = parseInt(r.month.split("-")[1]);
        return monthNum <= currentMonth;
      });

      const curVol = currentYtd.reduce((s: number, r: any) => s + r.fundedVolume, 0);
      const priorVol = priorYtd.reduce((s: number, r: any) => s + r.fundedVolume, 0);
      const curFunded = currentYtd.reduce((s: number, r: any) => s + r.loansFunded, 0);
      const priorFunded = priorYtd.reduce((s: number, r: any) => s + r.loansFunded, 0);

      return {
        title: "Monthly Trends (by Funding Month)",
        summary: {
          monthsAnalyzed: rows.length,
          totalLoans: rows.reduce((s: number, r: any) => s + r.loansStarted, 0),
          totalFunded: rows.reduce((s: number, r: any) => s + r.loansFunded, 0),
          currentYtdVolume: curVol,
          priorYtdVolume: priorVol,
          currentYtdFunded: curFunded,
          priorYtdFunded: priorFunded,
          ytdVolumeDelta: priorVol > 0
            ? Math.round(((curVol - priorVol) / priorVol) * 1000) / 10
            : 0,
        },
        rows,
        displayConfig,
      };
    }

    // ====================================================================
    // CLOSING RISK
    // ====================================================================
    case "closing_risk": {
      const ids: string[] = dq?.loan_ids || [];
      const rawRows = getLoanRows(ids, loanMap)
        .sort((a, b) => (a.days_to_close ?? 999) - (b.days_to_close ?? 999));

      const rows = rawRows.map(r => ({
        loanNumber: r.loan_number || r.loan_id,
        loanAmount: r.loan_amount,
        loanType: r.loan_type,
        status: r.status,
        milestone: r.milestone,
        interestRate: r.interest_rate,
        estimatedClosingDate: r.estimated_closing_date,
        ctcDate: r.ctc_date,
        daysToClose: r.days_to_close ?? 0,
        applicationDate: r.application_date,
        loanOfficer: r.loan_officer,
      }));

      return {
        title: "Closing-Late Risk (No CTC within 10 Days of Close)",
        summary: {
          totalAtRisk: rows.length,
          totalVolume: rows.reduce((s, r) => s + r.loanAmount, 0),
          avgDaysToClose: rows.length > 0
            ? Math.round(rows.reduce((s, r) => s + r.daysToClose, 0) / rows.length)
            : 0,
        },
        rows,
        displayConfig,
      };
    }

    // ====================================================================
    // LOCK EXPIRATION
    // ====================================================================
    case "lock_expiration": {
      const ids: string[] = dq?.loan_ids || [];
      const rawRows = getLoanRows(ids, loanMap)
        .sort((a, b) => (a.days_to_expiry ?? 999) - (b.days_to_expiry ?? 999));

      const rows = rawRows.map(r => ({
        loanNumber: r.loan_number || r.loan_id,
        loanAmount: r.loan_amount,
        loanType: r.loan_type,
        status: r.status,
        milestone: r.milestone,
        interestRate: r.interest_rate,
        lockDate: r.lock_date,
        lockExpirationDate: r.lock_expiration_date,
        lockDays: r.lock_days,
        ctcDate: r.ctc_date,
        daysToExpiry: r.days_to_expiry ?? 0,
        applicationDate: r.application_date,
        loanOfficer: r.loan_officer,
      }));

      return {
        title: "Lock Expiration Exposure (Expiring within 7 Days, No CTC)",
        summary: {
          totalExpiring: rows.length,
          totalVolume: rows.reduce((s, r) => s + r.loanAmount, 0),
          avgDaysToExpiry: rows.length > 0
            ? Math.round(rows.reduce((s, r) => s + r.daysToExpiry, 0) / rows.length)
            : 0,
        },
        rows,
        displayConfig,
      };
    }

    // ====================================================================
    // TRID
    // ====================================================================
    case "trid": {
      const ids: string[] = dq?.loan_ids || [];
      const rawRows = getLoanRows(ids, loanMap)
        .sort((a, b) => (a.days_to_close ?? 999) - (b.days_to_close ?? 999));

      const rows = rawRows.map(r => ({
        loanNumber: r.loan_number || r.loan_id,
        loanAmount: r.loan_amount,
        loanType: r.loan_type,
        status: r.status,
        milestone: r.milestone,
        interestRate: r.interest_rate,
        estimatedClosingDate: r.estimated_closing_date,
        closingDisclosureSentDate: r.closing_disclosure_sent_date,
        closingDisclosureReceivedDate: r.closing_disclosure_received_date,
        daysToClose: r.days_to_close ?? 0,
        applicationDate: r.application_date,
        loanOfficer: r.loan_officer,
      }));

      return {
        title: "TRID Timing Exposure (CD Not Sent, Closing within 5 Days)",
        summary: {
          totalAtRisk: rows.length,
          totalVolume: rows.reduce((s, r) => s + r.loanAmount, 0),
          avgDaysToClose: rows.length > 0
            ? Math.round(rows.reduce((s, r) => s + r.daysToClose, 0) / rows.length)
            : 0,
        },
        rows,
        displayConfig,
      };
    }

    // ====================================================================
    // MARGIN
    // ====================================================================
    case "margin": {
      return {
        title: "Gain-on-Sale Margin (MoM Comparison)",
        summary: {
          currentMonthBps: metrics.marginData?.currentMonthBps ?? dq?.currentMonthBps ?? 0,
          priorMonthBps: metrics.marginData?.priorMonthBps ?? dq?.priorMonthBps ?? 0,
          deltaBps: metrics.marginData?.deltaBps ?? dq?.deltaBps ?? 0,
        },
        rows: [],
        displayConfig,
      };
    }

    // ====================================================================
    // CONDITION BACKLOG
    // ====================================================================
    case "condition_backlog": {
      const ids: string[] = dq?.loan_ids || [];
      const rawRows = getLoanRows(ids, loanMap)
        .sort((a, b) => b.conditions - a.conditions);

      const rows = rawRows.map(r => ({
        loanNumber: r.loan_number || r.loan_id,
        loanAmount: r.loan_amount,
        loanType: r.loan_type,
        status: r.status,
        milestone: r.milestone,
        interestRate: r.interest_rate,
        conditions: r.conditions,
        applicationDate: r.application_date,
        loanOfficer: r.loan_officer,
      }));

      return {
        title: "Condition Backlog (Loans with High Outstanding Conditions)",
        summary: {
          totalLoans: rows.length,
          avgConditions: rows.length > 0
            ? Math.round(rows.reduce((s, r) => s + r.conditions, 0) / rows.length * 10) / 10
            : 0,
          totalVolume: rows.reduce((s, r) => s + r.loanAmount, 0),
        },
        rows,
        displayConfig,
      };
    }

    // ====================================================================
    // TIERING
    // ====================================================================
    case "tiering": {
      return buildTieringSnapshot(insight, metrics, displayConfig);
    }

    default:
      return null;
  }
}

// ============================================================================
// Pipeline dedicated fetch (no stored loan IDs)
// ============================================================================

async function fetchPipelineRows(
  tenantPool: pg.Pool,
  dq: Record<string, any> | null | undefined,
): Promise<Array<Record<string, any>>> {
  const loans = await createSchemaResolver(tenantPool, "loans");

  const minDays: number | null = dq?.min_days ?? null;
  const lockFilter: string | null = dq?.lock_filter ?? null;

  let ageClause = "";
  if (minDays !== null) {
    ageClause = `AND (CURRENT_DATE - DATE(l.application_date)) > ${Number(minDays)}`;
  }
  let lockClause = "";
  if (lockFilter === "unlocked") lockClause = "AND l.lock_date IS NULL";
  else if (lockFilter === "locked") lockClause = "AND l.lock_date IS NOT NULL";

  const query = `
    SELECT
      l.loan_id,
      l.loan_number,
      COALESCE(l.loan_amount, 0) AS loan_amount,
      l.loan_type,
      l.current_loan_status AS status,
      l.current_milestone AS milestone,
      l.interest_rate,
      l.application_date,
      l.lock_date,
      ${loans.selectExpr("fico_score", "l")},
      ${loans.selectExpr("ltv", "l")},
      COALESCE(e.first_name || ' ' || e.last_name,
               ${loans.whereExpr("loan_officer", "l")}) AS loan_officer,
      CASE WHEN l.application_date IS NOT NULL
        THEN CURRENT_DATE - DATE(l.application_date) END AS days_in_pipeline
    FROM public.loans l
    LEFT JOIN public.employees e
      ON e.id::TEXT = ${loans.whereExpr("loan_officer_id", "l")}
    WHERE l.current_loan_status = 'Active Loan'
      ${ageClause}
      ${lockClause}
    ORDER BY l.loan_amount DESC
    LIMIT 200
  `;

  const result = await tenantPool.query(query);

  return result.rows.map((r: any) => ({
    loanNumber: r.loan_number || r.loan_id,
    loanAmount: parseFloat(r.loan_amount) || 0,
    loanType: r.loan_type,
    status: r.status,
    milestone: r.milestone || null,
    interestRate: r.interest_rate ? parseFloat(r.interest_rate) : null,
    applicationDate: r.application_date,
    lockDate: r.lock_date,
    ficoScore: r.fico_score ? parseInt(r.fico_score) : null,
    ltv: r.ltv ? parseFloat(r.ltv) : null,
    loanOfficer: r.loan_officer,
    daysInPipeline: r.days_in_pipeline != null ? parseInt(r.days_in_pipeline) : null,
  }));
}

// ============================================================================
// Performance / Tiering officer-based builders
// ============================================================================

function buildOfficerSnapshot(
  insight: CategorizedInsight,
  metrics: InsightMetricsPayload,
  displayConfig: { columns: string[]; summaryMetrics: string[] },
  baseTitle: string,
): InsightDetailSnapshot | null {
  const dq = insight.detail_query;
  const actorNames: string[] | undefined = dq?.actorNames;
  const snapshots = dq?.actorSnapshots as Record<string, { units: number; revenue: number; volume: number; pullThrough: number }> | undefined;

  // Gather all officer data from tiering metrics
  const allActors = metrics.tiering?.byActorType?.flatMap(t =>
    [...(t.topPerformers || []), ...(t.bottomPerformers || [])],
  ) || [];

  // Filter to mentioned officers if specified
  const isFiltered = actorNames && actorNames.length > 0;
  const displayActors = isFiltered
    ? allActors.filter(a =>
        actorNames!.some(n => a.name.toLowerCase() === n.toLowerCase()),
      )
    : allActors.filter(a => !isActorMissing(a.name));

  const rows = displayActors.map(a => {
    const snap = snapshots?.[a.name];
    return {
      name: a.name,
      totalLoans: (snap?.units ?? a.units) + (a.lostOpportunityUnits || 0) + (a.deniedUnits || 0),
      fundedLoans: snap?.units ?? a.units,
      completed: (snap?.units ?? a.units) + (a.lostOpportunityUnits || 0) + (a.deniedUnits || 0),
      pullThrough: snap?.pullThrough ?? a.pullThrough,
      totalVolume: snap?.volume ?? a.volume,
      fundedVolume: snap?.volume ?? a.volume,
      fundedRevenue: snap?.revenue ?? a.revenue,
      avgCycleTime: a.avgCycleTime || null,
      lostOpportunityUnits: a.lostOpportunityUnits || 0,
      deniedUnits: a.deniedUnits || 0,
    };
  });

  let summary: Record<string, number>;
  let overrideSummaryMetrics: string[] | null = null;

  if (isFiltered && rows.length > 0 && rows.length <= 10) {
    const totalUnits = rows.reduce((s, r) => s + r.fundedLoans, 0);
    const totalVol = rows.reduce((s, r) => s + r.fundedVolume, 0);
    const totalRev = rows.reduce((s, r) => s + r.fundedRevenue, 0);
    const avgPT = rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.pullThrough, 0) / rows.length * 10) / 10
      : 0;
    const avgCycle = rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + (r.avgCycleTime || 0), 0) / rows.length)
      : 0;
    const totalLost = rows.reduce((s, r) => s + r.lostOpportunityUnits, 0);
    const totalDenied = rows.reduce((s, r) => s + r.deniedUnits, 0);

    summary = {
      officerUnits: totalUnits,
      officerVolume: totalVol,
      officerRevenue: totalRev,
      officerPullThrough: avgPT,
      ...(avgCycle > 0 ? { officerCycleTime: avgCycle } : {}),
      ...(totalLost > 0 ? { officerLost: totalLost } : {}),
      ...(totalDenied > 0 ? { officerDenied: totalDenied } : {}),
    };
    overrideSummaryMetrics = Object.keys(summary);
  } else {
    let totalCycleWeightedSum = 0;
    let totalCycleWeightCount = 0;
    for (const r of rows) {
      if ((r.avgCycleTime || 0) > 0 && r.fundedLoans > 0) {
        totalCycleWeightedSum += (r.avgCycleTime || 0) * r.fundedLoans;
        totalCycleWeightCount += r.fundedLoans;
      }
    }

    summary = {
      totalOfficers: rows.length,
      totalFunded: rows.reduce((s, r) => s + r.fundedLoans, 0),
      totalVolume: rows.reduce((s, r) => s + r.fundedVolume, 0),
      totalRevenue: rows.reduce((s, r) => s + r.fundedRevenue, 0),
      avgCycleTime: totalCycleWeightCount > 0
        ? Math.round(totalCycleWeightedSum / totalCycleWeightCount)
        : 0,
    };
  }

  const titleSuffix = isFiltered ? ` — ${actorNames!.join(", ")}` : "";
  const finalDisplayConfig = overrideSummaryMetrics
    ? { ...displayConfig, summaryMetrics: overrideSummaryMetrics }
    : displayConfig;

  return {
    title: `${baseTitle}${titleSuffix}`,
    summary,
    rows,
    displayConfig: finalDisplayConfig,
  };
}

function buildTieringSnapshot(
  insight: CategorizedInsight,
  metrics: InsightMetricsPayload,
  displayConfig: { columns: string[]; summaryMetrics: string[] },
): InsightDetailSnapshot | null {
  const dq = insight.detail_query;
  const actorType = dq?.actorType || "loan_officer";
  const actorLabel = actorType === "branch" ? "Branch" : "Loan Officer";
  const actorNames: string[] | undefined = dq?.actorNames;
  const snapshots = dq?.actorSnapshots as Record<string, { units: number; revenue: number; volume: number; pullThrough: number }> | undefined;

  // Gather all officer data from tiering metrics
  const actorData = metrics.tiering?.byActorType?.find(
    t => t.actorType === actorType,
  );
  if (!actorData) return null;

  const allActors = [...(actorData.topPerformers || []), ...(actorData.bottomPerformers || [])]
    .filter(a => !isActorMissing(a.name));

  // Compute tiers (same 50/80 cumulative revenue thresholds)
  const totalRevenue = allActors.reduce((s, a) => s + a.revenue, 0);
  let cumRev = 0;
  const tieredActors = allActors.map(a => {
    cumRev += a.revenue;
    const pct = totalRevenue > 0 ? (cumRev / totalRevenue) * 100 : 0;
    const tier = pct <= 50 ? "Top" : pct <= 80 ? "Second" : "Bottom";
    return { ...a, tier };
  });

  // Filter to mentioned actors if specified
  const isFiltered = actorNames && actorNames.length > 0;
  const displayActors = isFiltered
    ? tieredActors.filter(a =>
        actorNames!.some(n => a.name.toLowerCase() === n.toLowerCase()),
      )
    : tieredActors;

  const rows = displayActors.map(a => {
    const snap = snapshots?.[a.name];
    return {
      name: a.name,
      tier: a.tier,
      revenue: snap?.revenue ?? a.revenue,
      units: snap?.units ?? a.units,
      fundedVolume: snap?.volume ?? a.volume,
      revenueBps: a.revenueBps,
      revenuePerLoan: a.units > 0 ? Math.round(a.revenue / a.units) : 0,
      pullThrough: snap?.pullThrough ?? a.pullThrough,
      avgCycleTime: a.avgCycleTime || 0,
      lostOpportunityUnits: a.lostOpportunityUnits || 0,
      deniedUnits: a.deniedUnits || 0,
    };
  });

  let summary: Record<string, number>;
  let overrideSummaryMetrics: string[] | null = null;

  if (isFiltered && rows.length > 0 && rows.length <= 10) {
    const totalUnits = rows.reduce((s, r) => s + r.units, 0);
    const totalVol = rows.reduce((s, r) => s + r.fundedVolume, 0);
    const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
    const avgPT = rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.pullThrough, 0) / rows.length * 10) / 10
      : 0;
    const avgCycle = rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.avgCycleTime, 0) / rows.length)
      : 0;
    const totalLost = rows.reduce((s, r) => s + r.lostOpportunityUnits, 0);
    const totalDenied = rows.reduce((s, r) => s + r.deniedUnits, 0);

    summary = {
      officerUnits: totalUnits,
      officerVolume: totalVol,
      officerRevenue: totalRev,
      officerPullThrough: avgPT,
      ...(avgCycle > 0 ? { officerCycleTime: avgCycle } : {}),
      ...(totalLost > 0 ? { officerLost: totalLost } : {}),
      ...(totalDenied > 0 ? { officerDenied: totalDenied } : {}),
    };
    overrideSummaryMetrics = Object.keys(summary);
  } else {
    const topCount = tieredActors.filter(a => a.tier === "Top").length;
    const secondCount = tieredActors.filter(a => a.tier === "Second").length;
    const bottomCount = tieredActors.filter(a => a.tier === "Bottom").length;

    summary = {
      totalActors: tieredActors.length,
      topCount,
      secondCount,
      bottomCount,
      totalRevenue,
      totalVolume: tieredActors.reduce((s, a) => s + a.volume, 0),
    };
  }

  const titleSuffix = isFiltered ? ` — ${actorNames!.join(", ")}` : "";
  const finalDisplayConfig = overrideSummaryMetrics
    ? { ...displayConfig, summaryMetrics: overrideSummaryMetrics }
    : displayConfig;

  return {
    title: `${actorLabel} Tiering — Revenue-Based Pareto Tiers (YTD)${titleSuffix}`,
    summary,
    rows,
    displayConfig: finalDisplayConfig,
  };
}
