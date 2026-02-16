/**
 * Insight Deep Dive — Widget Generator
 *
 * Given a stored insight (source, headline, detail_query, metrics_snapshot),
 * generates a set of SQL-backed canvas widgets that allow the user to explore
 * the topic in depth inside the Workbench.
 *
 * Each source type has a "template" that produces 2-4 widgets tailored to
 * the insight's context (date range, officer names, loan IDs, etc.).
 */

import pg from "pg";
import { getTenantRevenueExpression } from "../metrics/canonicalMetrics.js";

// ============================================================================
// Types
// ============================================================================

export interface SourceInsightMeta {
  id: number;
  headline: string;
  source: string;
  bucket: string;
  detail_query: Record<string, any> | null;
}

/** A single widget spec ready to be placed on a canvas. */
export interface DeepDiveWidget {
  title: string;
  sql: string;
  vizConfig: {
    type: string;
    title: string;
    xKey?: string;
    yKey?: string;
    yKeys?: string[];
    colors?: string[];
    showLegend?: boolean;
    columns?: { key: string; label: string; format?: string }[];
    [key: string]: any;
  };
  explanation?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

function startOfYear(): string {
  return new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];
}

// ============================================================================
// Per-Source Widget Templates
// ============================================================================

function performanceWidgets(meta: SourceInsightMeta, revenueExpr: string): DeepDiveWidget[] {
  return [
    {
      title: "Pull-Through Trend (Monthly)",
      sql: `SELECT
        DATE_TRUNC('month', l.application_date) AS sort_period,
        TO_CHAR(DATE_TRUNC('month', l.application_date), 'Mon YYYY') AS period,
        COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END) AS completed,
        COUNT(CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL OR l.investor_purchase_date IS NOT NULL)
          AND l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END) AS funded,
        ROUND(
          COUNT(CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL OR l.investor_purchase_date IS NOT NULL)
            AND l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END) * 100.0
          / NULLIF(COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END), 0),
        1) AS pull_through_rate
      FROM public.loans l
      WHERE l.application_date >= '${daysAgo(365)}'
      GROUP BY sort_period, period
      ORDER BY sort_period`,
      vizConfig: {
        type: "line",
        title: "Pull-Through Rate Trend",
        xKey: "period",
        yKey: "pull_through_rate",
        yKeys: ["pull_through_rate"],
        colors: ["#3b82f6"],
        showLegend: false,
      },
      explanation: "Monthly pull-through rate trend over the last 12 months.",
    },
    {
      title: "Cycle Time Trend (Monthly)",
      sql: `SELECT
        DATE_TRUNC('month', l.application_date) AS sort_period,
        TO_CHAR(DATE_TRUNC('month', l.application_date), 'Mon YYYY') AS period,
        ROUND(AVG(COALESCE(l.funding_date::date, l.closing_date) - l.application_date)) AS avg_cycle_days,
        COUNT(*) AS funded_count
      FROM public.loans l
      WHERE (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL)
        AND l.application_date >= '${daysAgo(365)}'
      GROUP BY sort_period, period
      ORDER BY sort_period`,
      vizConfig: {
        type: "line",
        title: "Average Cycle Time",
        xKey: "period",
        yKey: "avg_cycle_days",
        yKeys: ["avg_cycle_days"],
        colors: ["#f59e0b"],
        showLegend: false,
      },
      explanation: "Average days from application to close for funded loans.",
    },
    {
      title: "Volume vs Revenue (Monthly)",
      sql: `SELECT
        DATE_TRUNC('month', l.application_date) AS sort_period,
        TO_CHAR(DATE_TRUNC('month', l.application_date), 'Mon YYYY') AS period,
        ROUND(SUM(CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL) THEN l.loan_amount ELSE 0 END)) AS funded_volume,
        ROUND(SUM(CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL) THEN (${revenueExpr}) ELSE 0 END)) AS revenue
      FROM public.loans l
      WHERE l.application_date >= '${daysAgo(365)}'
      GROUP BY sort_period, period
      ORDER BY sort_period`,
      vizConfig: {
        type: "bar",
        title: "Funded Volume & Revenue (Monthly)",
        xKey: "period",
        yKey: "funded_volume",
        yKeys: ["funded_volume", "revenue"],
        colors: ["#3b82f6", "#10b981"],
        showLegend: true,
      },
      explanation: "Monthly funded volume and gain-on-sale revenue.",
    },
  ];
}

function tieringWidgets(meta: SourceInsightMeta, revenueExpr: string): DeepDiveWidget[] {
  const dq = meta.detail_query || {};
  const actorNames: string[] = dq.actorNames || [];
  const nameFilter = actorNames.length > 0
    ? `AND COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) IN (${actorNames.map(n => `'${n.replace(/'/g, "''")}'`).join(",")})`
    : "";

  return [
    {
      title: "Top Officers by Revenue YTD",
      sql: `SELECT
        COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) AS officer,
        COUNT(DISTINCT COALESCE(l.loan_number, l.loan_id::text)) AS units,
        ROUND(SUM(l.loan_amount)) AS volume,
        ROUND(SUM(${revenueExpr})) AS revenue,
        ROUND(AVG(COALESCE(l.funding_date::date, l.closing_date) - l.application_date)) AS avg_cycle
      FROM public.loans l
      WHERE (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL)
        AND COALESCE(l.funding_date::date, l.closing_date) >= '${startOfYear()}'
        AND COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) IS NOT NULL
        ${nameFilter}
      GROUP BY officer
      HAVING SUM(${revenueExpr}) > 0
      ORDER BY revenue DESC
      LIMIT 20`,
      vizConfig: {
        type: "horizontal_bar",
        title: "Top Officers by Revenue (YTD)",
        xKey: "officer",
        yKey: "revenue",
        yKeys: ["revenue"],
        colors: ["#6366f1"],
        showLegend: false,
      },
      explanation: "Officers ranked by gain-on-sale revenue year-to-date.",
    },
    {
      title: "Officer Pull-Through Comparison",
      sql: `SELECT
        COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) AS officer,
        COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END) AS completed,
        COUNT(CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL OR l.investor_purchase_date IS NOT NULL)
          AND l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END) AS funded,
        ROUND(
          COUNT(CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL OR l.investor_purchase_date IS NOT NULL)
            AND l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END) * 100.0
          / NULLIF(COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END), 0),
        1) AS pull_through
      FROM public.loans l
      WHERE l.application_date >= '${startOfYear()}'
        AND COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) IS NOT NULL
        ${nameFilter}
      GROUP BY officer
      HAVING COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END) >= 3
      ORDER BY pull_through DESC
      LIMIT 20`,
      vizConfig: {
        type: "bar",
        title: "Officer Pull-Through Rate (YTD)",
        xKey: "officer",
        yKey: "pull_through",
        yKeys: ["pull_through"],
        colors: ["#3b82f6"],
        showLegend: false,
      },
      explanation: "Pull-through rate by officer for the year.",
    },
    {
      title: "Officer Performance Detail",
      sql: `SELECT
        COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) AS officer,
        COUNT(DISTINCT COALESCE(l.loan_number, l.loan_id::text)) AS units,
        ROUND(SUM(l.loan_amount)) AS volume,
        ROUND(SUM(${revenueExpr})) AS revenue,
        CASE WHEN SUM(l.loan_amount) > 0
          THEN ROUND((SUM(${revenueExpr}) / SUM(l.loan_amount)) * 10000)
          ELSE 0 END AS bps,
        ROUND(AVG(COALESCE(l.funding_date::date, l.closing_date) - l.application_date)) AS avg_cycle
      FROM public.loans l
      WHERE (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL)
        AND COALESCE(l.funding_date::date, l.closing_date) >= '${startOfYear()}'
        AND COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) IS NOT NULL
        ${nameFilter}
      GROUP BY officer
      HAVING SUM(${revenueExpr}) > 0
      ORDER BY revenue DESC
      LIMIT 30`,
      vizConfig: {
        type: "table",
        title: "Officer Performance Detail",
        columns: [
          { key: "officer", label: "Officer" },
          { key: "units", label: "Units", format: "number" },
          { key: "volume", label: "Volume", format: "currency" },
          { key: "revenue", label: "Revenue", format: "currency" },
          { key: "bps", label: "BPS", format: "number" },
          { key: "avg_cycle", label: "Cycle (d)", format: "number" },
        ],
      },
      explanation: "Detailed officer-level performance metrics.",
    },
  ];
}

function pipelineWidgets(meta: SourceInsightMeta): DeepDiveWidget[] {
  return [
    {
      title: "Pipeline Aging Distribution",
      sql: `SELECT
        CASE
          WHEN (CURRENT_DATE - l.application_date) <= 15 THEN '0-15 days'
          WHEN (CURRENT_DATE - l.application_date) <= 30 THEN '16-30 days'
          WHEN (CURRENT_DATE - l.application_date) <= 45 THEN '31-45 days'
          WHEN (CURRENT_DATE - l.application_date) <= 60 THEN '46-60 days'
          ELSE '60+ days'
        END AS age_bucket,
        CASE
          WHEN (CURRENT_DATE - l.application_date) <= 15 THEN 1
          WHEN (CURRENT_DATE - l.application_date) <= 30 THEN 2
          WHEN (CURRENT_DATE - l.application_date) <= 45 THEN 3
          WHEN (CURRENT_DATE - l.application_date) <= 60 THEN 4
          ELSE 5
        END AS sort_key,
        COUNT(*) AS loan_count,
        ROUND(SUM(l.loan_amount)) AS volume
      FROM public.loans l
      WHERE l.current_loan_status = 'Active Loan'
      GROUP BY age_bucket, sort_key
      ORDER BY sort_key`,
      vizConfig: {
        type: "bar",
        title: "Pipeline Aging",
        xKey: "age_bucket",
        yKey: "loan_count",
        yKeys: ["loan_count"],
        colors: ["#f59e0b"],
        showLegend: false,
      },
      explanation: "Distribution of active loans by age since application.",
    },
    {
      title: "At-Risk Loans (Closing Soon, No CTC)",
      sql: `SELECT
        COALESCE(l.loan_number, l.loan_id::text) AS loan_number,
        COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) AS officer,
        l.loan_amount,
        l.estimated_closing_date,
        (l.estimated_closing_date - CURRENT_DATE) AS days_to_close,
        l.current_loan_status
      FROM public.loans l
      WHERE l.current_loan_status = 'Active Loan'
        AND l.estimated_closing_date IS NOT NULL
        AND l.estimated_closing_date <= CURRENT_DATE + INTERVAL '10 days'
        AND l.estimated_closing_date >= CURRENT_DATE
        AND l.ctc_date IS NULL
      ORDER BY l.estimated_closing_date ASC
      LIMIT 50`,
      vizConfig: {
        type: "table",
        title: "At-Risk Loans (Closing ≤10 Days, No CTC)",
        columns: [
          { key: "loan_number", label: "Loan #" },
          { key: "officer", label: "Officer" },
          { key: "loan_amount", label: "Amount", format: "currency" },
          { key: "estimated_closing_date", label: "Est. Close", format: "date" },
          { key: "days_to_close", label: "Days Left", format: "number" },
        ],
      },
      explanation: "Active loans closing soon without Clear to Close.",
    },
  ];
}

function lostOpportunityWidgets(meta: SourceInsightMeta, revenueExpr: string): DeepDiveWidget[] {
  return [
    {
      title: "Fallout Reasons Breakdown",
      sql: `SELECT
        CASE
          WHEN l.current_loan_status ILIKE '%withdraw%' THEN 'Withdrawn'
          WHEN l.current_loan_status ILIKE '%cancel%' THEN 'Cancelled'
          WHEN l.current_loan_status ILIKE '%denied%' OR l.current_loan_status ILIKE '%declined%' THEN 'Denied'
          WHEN l.current_loan_status ILIKE '%not accepted%' THEN 'Not Accepted'
          WHEN l.current_loan_status ILIKE '%incomplete%' THEN 'Incomplete'
          ELSE 'Other'
        END AS reason,
        COUNT(*) AS loan_count,
        ROUND(SUM(l.loan_amount)) AS lost_volume
      FROM public.loans l
      WHERE l.application_date >= '${startOfYear()}'
        AND l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
        AND (l.funding_date IS NULL AND l.closing_date IS NULL AND l.investor_purchase_date IS NULL)
      GROUP BY reason
      ORDER BY loan_count DESC`,
      vizConfig: {
        type: "donut",
        title: "Fallout by Reason (YTD)",
        xKey: "reason",
        yKey: "loan_count",
        colors: ["#ef4444", "#f59e0b", "#8b5cf6", "#6366f1", "#64748b", "#94a3b8"],
        showLegend: true,
      },
      explanation: "Breakdown of loan fallout by reason category.",
    },
    {
      title: "Fallout Trend (Monthly)",
      sql: `SELECT
        DATE_TRUNC('month', l.application_date) AS sort_period,
        TO_CHAR(DATE_TRUNC('month', l.application_date), 'Mon YYYY') AS period,
        COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END) AS completed,
        COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
          AND (l.funding_date IS NULL AND l.closing_date IS NULL AND l.investor_purchase_date IS NULL) THEN 1 END) AS fallen_out,
        ROUND(
          COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
            AND (l.funding_date IS NULL AND l.closing_date IS NULL AND l.investor_purchase_date IS NULL) THEN 1 END) * 100.0
          / NULLIF(COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END), 0),
        1) AS fallout_rate
      FROM public.loans l
      WHERE l.application_date >= '${daysAgo(365)}'
      GROUP BY sort_period, period
      ORDER BY sort_period`,
      vizConfig: {
        type: "line",
        title: "Fallout Rate Trend",
        xKey: "period",
        yKey: "fallout_rate",
        yKeys: ["fallout_rate"],
        colors: ["#ef4444"],
        showLegend: false,
      },
      explanation: "Monthly fallout rate over the last 12 months.",
    },
    {
      title: "Fallout by Officer",
      sql: `SELECT
        COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) AS officer,
        COUNT(*) AS total_fallout,
        ROUND(SUM(l.loan_amount)) AS lost_volume
      FROM public.loans l
      WHERE l.application_date >= '${startOfYear()}'
        AND l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
        AND (l.funding_date IS NULL AND l.closing_date IS NULL AND l.investor_purchase_date IS NULL)
        AND COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) IS NOT NULL
      GROUP BY officer
      ORDER BY total_fallout DESC
      LIMIT 15`,
      vizConfig: {
        type: "horizontal_bar",
        title: "Fallout by Officer (YTD)",
        xKey: "officer",
        yKey: "total_fallout",
        yKeys: ["total_fallout"],
        colors: ["#ef4444"],
        showLegend: false,
      },
      explanation: "Officers with the highest fallout counts year-to-date.",
    },
  ];
}

function creditRiskWidgets(meta: SourceInsightMeta): DeepDiveWidget[] {
  return [
    {
      title: "FICO Distribution (Active Pipeline)",
      sql: `SELECT
        CASE
          WHEN CAST(l.fico_score AS DECIMAL) < 620 THEN '<620 (High Risk)'
          WHEN CAST(l.fico_score AS DECIMAL) < 660 THEN '620-659'
          WHEN CAST(l.fico_score AS DECIMAL) < 700 THEN '660-699'
          WHEN CAST(l.fico_score AS DECIMAL) < 740 THEN '700-739'
          WHEN CAST(l.fico_score AS DECIMAL) < 780 THEN '740-779'
          ELSE '780+'
        END AS fico_bucket,
        COUNT(*) AS loan_count,
        ROUND(SUM(l.loan_amount)) AS volume
      FROM public.loans l
      WHERE l.current_loan_status = 'Active Loan'
        AND l.fico_score IS NOT NULL
      GROUP BY fico_bucket
      ORDER BY MIN(CAST(l.fico_score AS DECIMAL))`,
      vizConfig: {
        type: "bar",
        title: "FICO Score Distribution",
        xKey: "fico_bucket",
        yKey: "loan_count",
        yKeys: ["loan_count"],
        colors: ["#6366f1"],
        showLegend: false,
      },
      explanation: "Distribution of active loans by FICO score bucket.",
    },
    {
      title: "High-Risk Loans Detail",
      sql: `SELECT
        COALESCE(l.loan_number, l.loan_id::text) AS loan_number,
        COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) AS officer,
        l.loan_amount,
        l.fico_score,
        l.ltv_ratio,
        l.be_dti_ratio AS dti,
        l.current_loan_status
      FROM public.loans l
      WHERE l.current_loan_status = 'Active Loan'
        AND (
          (l.fico_score IS NOT NULL AND CAST(l.fico_score AS DECIMAL) < 620)
          OR (l.ltv_ratio IS NOT NULL AND CAST(l.ltv_ratio AS DECIMAL) > 95)
          OR (l.be_dti_ratio IS NOT NULL AND CAST(l.be_dti_ratio AS DECIMAL) > 50)
        )
      ORDER BY l.loan_amount DESC
      LIMIT 50`,
      vizConfig: {
        type: "table",
        title: "High-Risk Active Loans",
        columns: [
          { key: "loan_number", label: "Loan #" },
          { key: "officer", label: "Officer" },
          { key: "loan_amount", label: "Amount", format: "currency" },
          { key: "fico_score", label: "FICO", format: "number" },
          { key: "ltv_ratio", label: "LTV%", format: "number" },
          { key: "dti", label: "DTI%", format: "number" },
        ],
      },
      explanation: "Active loans with high credit risk indicators.",
    },
  ];
}

function predictionsWidgets(meta: SourceInsightMeta): DeepDiveWidget[] {
  return [
    {
      title: "Prediction Outcomes (Active Loans)",
      sql: `SELECT
        p.predicted_outcome AS outcome,
        COUNT(*) AS loan_count,
        ROUND(SUM(l.loan_amount)) AS volume,
        ROUND(AVG(p.confidence), 1) AS avg_confidence
      FROM public.loan_predictions p
      JOIN public.loans l ON p.loan_id = l.loan_id
      WHERE l.current_loan_status = 'Active Loan'
        AND p.created_at = (SELECT MAX(p2.created_at) FROM public.loan_predictions p2 WHERE p2.loan_id = p.loan_id)
      GROUP BY p.predicted_outcome
      ORDER BY loan_count DESC`,
      vizConfig: {
        type: "donut",
        title: "Predicted Outcomes",
        xKey: "outcome",
        yKey: "loan_count",
        colors: ["#10b981", "#f59e0b", "#ef4444"],
        showLegend: true,
      },
      explanation: "AI-predicted outcomes for currently active loans.",
    },
    {
      title: "High-Risk Predictions (≥70% Confidence)",
      sql: `SELECT
        COALESCE(l.loan_number, l.loan_id::text) AS loan_number,
        COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) AS officer,
        l.loan_amount,
        p.predicted_outcome,
        ROUND(p.confidence, 1) AS confidence,
        p.risk_factors
      FROM public.loan_predictions p
      JOIN public.loans l ON p.loan_id = l.loan_id
      WHERE l.current_loan_status = 'Active Loan'
        AND (p.predicted_outcome = 'withdraw' OR p.predicted_outcome = 'deny')
        AND p.confidence >= 70
        AND p.created_at = (SELECT MAX(p2.created_at) FROM public.loan_predictions p2 WHERE p2.loan_id = p.loan_id)
      ORDER BY p.confidence DESC
      LIMIT 30`,
      vizConfig: {
        type: "table",
        title: "High-Confidence Risk Predictions",
        columns: [
          { key: "loan_number", label: "Loan #" },
          { key: "officer", label: "Officer" },
          { key: "loan_amount", label: "Amount", format: "currency" },
          { key: "predicted_outcome", label: "Prediction" },
          { key: "confidence", label: "Confidence %" },
        ],
      },
      explanation: "Loans with high-confidence withdraw or deny predictions.",
    },
  ];
}

function comparisonsWidgets(meta: SourceInsightMeta, revenueExpr: string): DeepDiveWidget[] {
  return performanceWidgets(meta, revenueExpr);
}

function closingRiskWidgets(meta: SourceInsightMeta): DeepDiveWidget[] {
  return pipelineWidgets(meta);
}

function lockExpirationWidgets(meta: SourceInsightMeta): DeepDiveWidget[] {
  return [
    {
      title: "Expiring Locks Detail",
      sql: `SELECT
        COALESCE(l.loan_number, l.loan_id::text) AS loan_number,
        COALESCE(NULLIF(TRIM(l.loan_officer), ''), NULLIF(TRIM(l.account_executive), '')) AS officer,
        l.loan_amount,
        l.lock_expiration_date,
        (l.lock_expiration_date - CURRENT_DATE) AS days_to_expiry,
        l.current_loan_status
      FROM public.loans l
      WHERE l.current_loan_status = 'Active Loan'
        AND l.lock_date IS NOT NULL
        AND l.lock_expiration_date IS NOT NULL
        AND l.lock_expiration_date <= CURRENT_DATE + INTERVAL '7 days'
        AND l.lock_expiration_date >= CURRENT_DATE
        AND l.ctc_date IS NULL
      ORDER BY l.lock_expiration_date ASC
      LIMIT 50`,
      vizConfig: {
        type: "table",
        title: "Locks Expiring Within 7 Days (No CTC)",
        columns: [
          { key: "loan_number", label: "Loan #" },
          { key: "officer", label: "Officer" },
          { key: "loan_amount", label: "Amount", format: "currency" },
          { key: "lock_expiration_date", label: "Lock Expires", format: "date" },
          { key: "days_to_expiry", label: "Days Left", format: "number" },
        ],
      },
      explanation: "Locked loans with approaching expiration dates.",
    },
  ];
}

function marginWidgets(meta: SourceInsightMeta, revenueExpr: string): DeepDiveWidget[] {
  return [
    {
      title: "Margin Trend (Monthly BPS)",
      sql: `SELECT
        DATE_TRUNC('month', l.funding_date) AS sort_period,
        TO_CHAR(DATE_TRUNC('month', l.funding_date), 'Mon YYYY') AS period,
        ROUND(AVG(
          (COALESCE(l.net_sell, 0) - COALESCE(l.net_buy, 0)) / NULLIF(l.loan_amount, 0) * 10000
        )) AS avg_bps
      FROM public.loans l
      WHERE l.funding_date >= '${daysAgo(365)}'
        AND l.loan_amount > 0
        AND (l.net_sell IS NOT NULL OR l.net_buy IS NOT NULL)
      GROUP BY sort_period, period
      ORDER BY sort_period`,
      vizConfig: {
        type: "line",
        title: "Gain-on-Sale Margin (BPS)",
        xKey: "period",
        yKey: "avg_bps",
        yKeys: ["avg_bps"],
        colors: ["#10b981"],
        showLegend: false,
      },
      explanation: "Average gain-on-sale margin per month in basis points.",
    },
  ];
}

// Default fallback
function defaultWidgets(meta: SourceInsightMeta, revenueExpr: string): DeepDiveWidget[] {
  return performanceWidgets(meta, revenueExpr);
}

// ============================================================================
// Public API
// ============================================================================

const TEMPLATE_MAP: Record<string, (meta: SourceInsightMeta, revenueExpr: string) => DeepDiveWidget[]> = {
  performance: performanceWidgets,
  comparisons: comparisonsWidgets,
  tiering: tieringWidgets,
  pipeline: pipelineWidgets as any,
  closing_risk: closingRiskWidgets as any,
  lock_expiration: lockExpirationWidgets as any,
  lost_opportunity: lostOpportunityWidgets,
  credit_risk: creditRiskWidgets as any,
  predictions: predictionsWidgets as any,
  margin: marginWidgets,
};

/**
 * Generate deep-dive widgets for a given insight.
 *
 * @returns An array of DeepDiveWidget specs ready to be converted to CanvasLayoutItems.
 */
export async function generateDeepDiveWidgets(
  tenantPool: pg.Pool,
  meta: SourceInsightMeta
): Promise<DeepDiveWidget[]> {
  const revenueExpr = await getTenantRevenueExpression(tenantPool);
  const generator = TEMPLATE_MAP[meta.source] || defaultWidgets;
  return generator(meta, revenueExpr);
}
