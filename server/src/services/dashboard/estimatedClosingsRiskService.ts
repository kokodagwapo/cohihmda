import pg from "pg";
import { buildChannelWhereClause, sanitizeAndSqlClause } from "../../utils/scorecard-utils.js";

export type EstimatedClosingsDateRangeType = "calendar_days" | "business_days";

export interface EstimatedClosingsRiskOptions {
  dateRangeType: EstimatedClosingsDateRangeType;
  channelGroup?: string;
  accessClause?: string;
  accessParams?: unknown[];
  dimensionFilterClause?: string;
  detailLimit?: number;
  detailOffset?: number;
}

export interface EstimatedClosingsRiskKpis {
  totalActivePipeline: number;
  ecdEmptyOrAfterThisMonth: number;
  remainingToFund: number;
  fundedThisMonth: number;
  maxPossibleFunding: number;
  fundingYtdUnits: number;
  prevMonthActualUnits: number;
  prevMonthActualVolume: number;
  unitsLastMonthVsPriorPct: number | null;
  volumeLastMonthVsPriorPct: number | null;
}

export interface ActivePipelineEcdSlice {
  key: "empty_ecd" | "past_ecd" | "remaining_to_fund" | "after_this_month";
  label: string;
  count: number;
}

export interface MaxPossibleFundingComplexityBar {
  bucketKey: "gte_130" | "gte_120" | "gte_110" | "all_rest";
  bucketLabel: string;
  funded: number;
  notFunded: number;
  total: number;
}

export interface RemainingToFundComplexityRow {
  complexityGroup: string;
  sortOrder: number;
  unitsRemainingToFund: number;
  historicalFalloutLast13Months: number | null;
}

export interface RemainingToFundProcessingStageRow {
  processingStage: string;
  sortOrder: number;
  unitsRemainingToFund: number;
  historicalFallout: number | null;
  historicalStatusToFundDays: number | null;
}

export interface EstimatedClosingsRiskDetailRow {
  loanNumber: string | null;
  complexityGroup: string;
  complexity: number | null;
  closingProjectionGroup: string | null;
  units: number;
  volume: number | null;
  occupancyType: string | null;
  fico: number | null;
  ltv: number | null;
  beDti: number | null;
  borrowerSelfEmployed: boolean | string | null;
  qmLoanType: string | null;
  propertyType: string | null;
  loanProgram: string | null;
  appToDispositionDays: number | null;
  currentLoanStatus: string | null;
  currentStatusDate: string | null;
  lastCompletedMilestone: string | null;
  loanFolder: string | null;
  applicationDate: string | null;
  fundingDate: string | null;
  lockDate: string | null;
  investorLockDate: string | null;
  estimatedClosingDate: string | null;
  ctcDate: string | null;
  uwFinalApprovalDate: string | null;
  deniedDate: string | null;
  conditionalApprovalDate: string | null;
  branch: string | null;
  loanOfficer: string | null;
  processor: string | null;
  underwriter: string | null;
}

export interface EstimatedClosingsRiskResult {
  kpis: EstimatedClosingsRiskKpis;
  activePipelineEcdSlices: ActivePipelineEcdSlice[];
  maxPossibleFundingByComplexity: MaxPossibleFundingComplexityBar[];
  remainingToFundByComplexity: RemainingToFundComplexityRow[];
  /** Pooled 13M historical fallout (same formula as per-row complexity, all loans): 1 − originated÷non-active, as percent 0–100. */
  historicalFalloutPooled13Months: number | null;
  remainingToFundByProcessingStage: RemainingToFundProcessingStageRow[];
  detail: {
    total: number;
    limit: number;
    offset: number;
    rows: EstimatedClosingsRiskDetailRow[];
  };
}

const ACTIVE_SQL = `
  l.current_loan_status = 'Active Loan'
  AND l.application_date IS NOT NULL
  AND l.application_date::text != ''
  AND (l.is_archived IS DISTINCT FROM TRUE)
`;

function complexityBucketExpr(alias: string): string {
  return `(CASE
    WHEN ${alias}.complexity_score >= 130 THEN 'gte_130'
    WHEN ${alias}.complexity_score >= 120 THEN 'gte_120'
    WHEN ${alias}.complexity_score >= 110 THEN 'gte_110'
    ELSE 'all_rest'
  END)`;
}

function complexityGroupExpr(alias: string): string {
  return `(CASE
    WHEN ${alias}.complexity_score >= 131 THEN '1 - GT 131'
    WHEN ${alias}.complexity_score BETWEEN 121 AND 130 THEN '2 - 121 to 130'
    WHEN ${alias}.complexity_score BETWEEN 111 AND 120 THEN '3 - 111 to 120'
    WHEN ${alias}.complexity_score BETWEEN 101 AND 110 THEN '4 - 101 to 110'
    WHEN ${alias}.complexity_score BETWEEN 91 AND 100 THEN '5 - 91 to 100'
    WHEN ${alias}.complexity_score < 90 THEN '6 - Less than 90'
    ELSE 'Other'
  END)`;
}

function complexityGroupSortExpr(alias: string): string {
  return `(CASE
    WHEN ${alias}.complexity_score >= 131 THEN 1
    WHEN ${alias}.complexity_score BETWEEN 121 AND 130 THEN 2
    WHEN ${alias}.complexity_score BETWEEN 111 AND 120 THEN 3
    WHEN ${alias}.complexity_score BETWEEN 101 AND 110 THEN 4
    WHEN ${alias}.complexity_score BETWEEN 91 AND 100 THEN 5
    WHEN ${alias}.complexity_score < 90 THEN 6
    ELSE 99
  END)`;
}

function processingStageExpr(alias: string): string {
  const lockExistsExpr = `(${alias}.lock_date IS NOT NULL OR ${alias}.investor_lock_date IS NOT NULL)`;
  return `(CASE
    WHEN ${alias}.ctc_date IS NOT NULL THEN '1-CTC'
    WHEN ${alias}.approval_date IS NOT NULL THEN '2-Approved'
    WHEN ${alias}.conditional_approval_date IS NOT NULL THEN '3-Conditional Approval'
    WHEN ${lockExistsExpr} THEN '4-Locked'
    ELSE '5-All Other'
  END)`;
}

function processingStageSortExpr(alias: string): string {
  const lockExistsExpr = `(${alias}.lock_date IS NOT NULL OR ${alias}.investor_lock_date IS NOT NULL)`;
  return `(CASE
    WHEN ${alias}.ctc_date IS NOT NULL THEN 1
    WHEN ${alias}.approval_date IS NOT NULL THEN 2
    WHEN ${alias}.conditional_approval_date IS NOT NULL THEN 3
    WHEN ${lockExistsExpr} THEN 4
    ELSE 5
  END)`;
}

function appToDispositionDaysExpr(dateRangeType: EstimatedClosingsDateRangeType, alias: string): string {
  const startDate = `DATE(${alias}.application_date)`;
  const endDate = `DATE(${alias}.funding_date)`;
  if (dateRangeType === "calendar_days") {
    return `(CASE
      WHEN ${alias}.application_date IS NOT NULL
        AND ${alias}.funding_date IS NOT NULL
        AND ${endDate} >= ${startDate}
      THEN (${endDate} - ${startDate})::int
      ELSE NULL
    END)`;
  }
  return `(CASE
    WHEN ${alias}.application_date IS NOT NULL AND ${alias}.funding_date IS NOT NULL THEN (
      SELECT count(*)::int
      FROM generate_series(
        LEAST(${startDate}, ${endDate}),
        GREATEST(${startDate}, ${endDate}),
        '1 day'::interval
      ) AS d
      WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5
    )
    ELSE NULL
  END)`;
}

function stageToFundDaysExpr(dateRangeType: EstimatedClosingsDateRangeType, stageDateExpr: string): string {
  const endDate = "DATE(l.funding_date)";
  if (dateRangeType === "calendar_days") {
    return `(CASE
      WHEN ${stageDateExpr} IS NOT NULL AND l.funding_date IS NOT NULL AND ${endDate} >= DATE(${stageDateExpr})
      THEN (${endDate} - DATE(${stageDateExpr}))::int
      ELSE NULL
    END)`;
  }
  return `(CASE
    WHEN ${stageDateExpr} IS NOT NULL AND l.funding_date IS NOT NULL THEN (
      SELECT count(*)::int
      FROM generate_series(
        LEAST(DATE(${stageDateExpr}), ${endDate}),
        GREATEST(DATE(${stageDateExpr}), ${endDate}),
        '1 day'::interval
      ) AS d
      WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5
    )
    ELSE NULL
  END)`;
}

export async function getEstimatedClosingsRiskData(
  tenantPool: pg.Pool,
  options: EstimatedClosingsRiskOptions
): Promise<EstimatedClosingsRiskResult> {
  const {
    dateRangeType,
    channelGroup,
    accessClause = "",
    accessParams = [],
    dimensionFilterClause = "",
    detailLimit,
    detailOffset = 0,
  } = options;

  const channelWhere = buildChannelWhereClause(channelGroup, "l");
  const accessCondition = sanitizeAndSqlClause(accessClause, "accessClause");
  const dimensionCondition = sanitizeAndSqlClause(dimensionFilterClause, "dimensionFilterClause");
  const params: unknown[] = [];
  if (accessParams.length > 0) params.push(...accessParams);

  const extraClauses = [
    channelWhere || "",
    accessCondition ? ` AND ${accessCondition}` : "",
    dimensionCondition ? ` AND ${dimensionCondition}` : "",
  ].join("");

  const baseCte = `
    WITH bounds AS (
      SELECT
        CURRENT_DATE::date AS today,
        date_trunc('month', CURRENT_DATE)::date AS month_start,
        (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date AS month_end,
        date_trunc('year', CURRENT_DATE)::date AS year_start,
        date_trunc('month', CURRENT_DATE - interval '1 month')::date AS prev_month_start,
        (date_trunc('month', CURRENT_DATE) - interval '1 day')::date AS prev_month_end,
        date_trunc('month', CURRENT_DATE - interval '2 month')::date AS prior_month_start,
        (date_trunc('month', CURRENT_DATE - interval '1 month') - interval '1 day')::date AS prior_month_end,
        (CURRENT_DATE - interval '13 months')::date AS hist_start
    )
  `;

  const fundedThisMonthExpr = `l.funding_date::date BETWEEN b.month_start AND b.month_end`;
  const remainingToFundExpr = `
    l.current_loan_status = 'Active Loan'
    AND l.funding_date IS NULL
    AND l.estimated_closing_date IS NOT NULL
    AND l.estimated_closing_date::date BETWEEN b.month_start AND b.month_end
  `;

  const kpisQuery = `
    ${baseCte}
    SELECT
      COUNT(*) FILTER (WHERE ${ACTIVE_SQL})::int AS total_active_pipeline,
      COUNT(*) FILTER (
        WHERE ${ACTIVE_SQL}
          AND l.funding_date IS NULL
          AND (
            l.estimated_closing_date IS NULL
            OR l.estimated_closing_date::date > b.month_end
          )
      )::int AS ecd_empty_or_after_this_month,
      COUNT(*) FILTER (
        WHERE ${remainingToFundExpr}
      )::int AS remaining_to_fund,
      COUNT(*) FILTER (WHERE ${fundedThisMonthExpr})::int AS funded_this_month,
      COUNT(*) FILTER (WHERE l.funding_date::date BETWEEN b.year_start AND b.today)::int AS funding_ytd_units,
      COUNT(*) FILTER (WHERE l.funding_date::date BETWEEN b.prev_month_start AND b.prev_month_end)::int AS prev_month_actual_units,
      COALESCE(SUM(l.loan_amount) FILTER (WHERE l.funding_date::date BETWEEN b.prev_month_start AND b.prev_month_end), 0)::float AS prev_month_actual_volume,
      COUNT(*) FILTER (WHERE l.funding_date::date BETWEEN b.prior_month_start AND b.prior_month_end)::int AS prior_month_units,
      COALESCE(SUM(l.loan_amount) FILTER (WHERE l.funding_date::date BETWEEN b.prior_month_start AND b.prior_month_end), 0)::float AS prior_month_volume
    FROM public.loans l
    CROSS JOIN bounds b
    WHERE TRUE
    ${extraClauses}
  `;
  const kpiResult = await tenantPool.query(kpisQuery, params);
  const kpiRow = kpiResult.rows[0] || {};
  const totalActivePipeline = parseInt(kpiRow.total_active_pipeline ?? "0", 10) || 0;
  const remainingToFund = parseInt(kpiRow.remaining_to_fund ?? "0", 10) || 0;
  const fundedThisMonth = parseInt(kpiRow.funded_this_month ?? "0", 10) || 0;
  const priorMonthUnits = parseInt(kpiRow.prior_month_units ?? "0", 10) || 0;
  const priorMonthVolume = Number(kpiRow.prior_month_volume ?? 0);
  const prevMonthActualUnits = parseInt(kpiRow.prev_month_actual_units ?? "0", 10) || 0;
  const prevMonthActualVolume = Number(kpiRow.prev_month_actual_volume ?? 0);
  const unitsLastMonthVsPriorPct = priorMonthUnits > 0
    ? ((prevMonthActualUnits - priorMonthUnits) / priorMonthUnits) * 100
    : null;
  const volumeLastMonthVsPriorPct = priorMonthVolume > 0
    ? ((prevMonthActualVolume - priorMonthVolume) / priorMonthVolume) * 100
    : null;

  const pieQuery = `
    ${baseCte}
    SELECT
      COUNT(*) FILTER (
        WHERE ${ACTIVE_SQL}
          AND l.funding_date IS NULL
          AND l.estimated_closing_date IS NULL
      )::int AS empty_ecd,
      COUNT(*) FILTER (
        WHERE ${ACTIVE_SQL}
          AND l.funding_date IS NULL
          AND l.estimated_closing_date IS NOT NULL
          AND l.estimated_closing_date::date < b.today
      )::int AS past_ecd,
      COUNT(*) FILTER (
        WHERE ${ACTIVE_SQL}
          AND l.funding_date IS NULL
          AND l.estimated_closing_date IS NOT NULL
          AND l.estimated_closing_date::date BETWEEN b.month_start AND b.month_end
          AND l.estimated_closing_date::date >= b.today
      )::int AS remaining_to_fund,
      COUNT(*) FILTER (
        WHERE ${ACTIVE_SQL}
          AND l.funding_date IS NULL
          AND l.estimated_closing_date IS NOT NULL
          AND l.estimated_closing_date::date > b.month_end
      )::int AS after_this_month
    FROM public.loans l
    CROSS JOIN bounds b
    WHERE TRUE
    ${extraClauses}
  `;
  const pieResult = await tenantPool.query(pieQuery, params);
  const pieRow = pieResult.rows[0] || {};
  const activePipelineEcdSlices: ActivePipelineEcdSlice[] = [
    { key: "empty_ecd", label: "Empty ECD", count: parseInt(pieRow.empty_ecd ?? "0", 10) || 0 },
    { key: "past_ecd", label: "Past ECD", count: parseInt(pieRow.past_ecd ?? "0", 10) || 0 },
    { key: "remaining_to_fund", label: "Remaining to Fund", count: parseInt(pieRow.remaining_to_fund ?? "0", 10) || 0 },
    { key: "after_this_month", label: "After This Month", count: parseInt(pieRow.after_this_month ?? "0", 10) || 0 },
  ];

  const complexityBarQuery = `
    ${baseCte}
    SELECT
      ${complexityBucketExpr("l")} AS bucket_key,
      COUNT(*) FILTER (WHERE ${fundedThisMonthExpr})::int AS funded,
      COUNT(*) FILTER (
        WHERE ${remainingToFundExpr}
      )::int AS not_funded
    FROM public.loans l
    CROSS JOIN bounds b
    WHERE
      ${fundedThisMonthExpr}
      OR (${remainingToFundExpr})
    ${channelWhere}
    ${accessCondition ? ` AND ${accessCondition}` : ""}
    ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
    GROUP BY ${complexityBucketExpr("l")}
  `;
  const complexityBarResult = await tenantPool.query(complexityBarQuery, params);
  const barDefaults: Record<string, MaxPossibleFundingComplexityBar> = {
    gte_130: { bucketKey: "gte_130", bucketLabel: ">= 130", funded: 0, notFunded: 0, total: 0 },
    gte_120: { bucketKey: "gte_120", bucketLabel: ">= 120", funded: 0, notFunded: 0, total: 0 },
    gte_110: { bucketKey: "gte_110", bucketLabel: ">= 110", funded: 0, notFunded: 0, total: 0 },
    all_rest: { bucketKey: "all_rest", bucketLabel: "All the Rest", funded: 0, notFunded: 0, total: 0 },
  };
  for (const row of complexityBarResult.rows) {
    const key = String(row.bucket_key || "all_rest");
    if (!barDefaults[key]) continue;
    barDefaults[key].funded = parseInt(row.funded ?? "0", 10) || 0;
    barDefaults[key].notFunded = parseInt(row.not_funded ?? "0", 10) || 0;
    barDefaults[key].total = barDefaults[key].funded + barDefaults[key].notFunded;
  }
  const maxPossibleFundingByComplexity = [
    barDefaults.gte_130,
    barDefaults.gte_120,
    barDefaults.gte_110,
    barDefaults.all_rest,
  ];

  const remainingComplexityQuery = `
    ${baseCte}
    , complexity_defs AS (
      SELECT 1::int AS sort_order, '1 - GT 131'::text AS complexity_group
      UNION ALL SELECT 2, '2 - 121 to 130'
      UNION ALL SELECT 3, '3 - 111 to 120'
      UNION ALL SELECT 4, '4 - 101 to 110'
      UNION ALL SELECT 5, '5 - 91 to 100'
      UNION ALL SELECT 6, '6 - Less than 90'
    )
    SELECT
      d.complexity_group,
      d.sort_order,
      (
        SELECT COUNT(*)::int
        FROM public.loans l
        CROSS JOIN bounds b
        WHERE ${remainingToFundExpr}
          AND ${complexityGroupSortExpr("l")} = d.sort_order
        ${channelWhere}
        ${accessCondition ? ` AND ${accessCondition}` : ""}
        ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
      ) AS units_remaining_to_fund,
      (
        SELECT (
          1 - (
            COUNT(*) FILTER (
              WHERE l.application_date::date >= b3.hist_start
                AND TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                AND TRIM(COALESCE(l.current_loan_status, '')) = 'Loan Originated'
            )::float / NULLIF(
              COUNT(*) FILTER (
                WHERE l.application_date::date >= b3.hist_start
                  AND TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
              ),
              0
            )
          )
        )::float
        FROM public.loans l
        CROSS JOIN bounds b3
        WHERE ${complexityGroupSortExpr("l")} = d.sort_order
        ${channelWhere}
        ${accessCondition ? ` AND ${accessCondition}` : ""}
        ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
      ) AS historical_fallout_last_13_months
    FROM complexity_defs d
    ORDER BY d.sort_order
  `;
  const remainingComplexityResult = await tenantPool.query(remainingComplexityQuery, params);
  const remainingToFundByComplexity = remainingComplexityResult.rows.map((r) => ({
    complexityGroup: String(r.complexity_group),
    sortOrder: parseInt(r.sort_order ?? "99", 10) || 99,
    unitsRemainingToFund: parseInt(r.units_remaining_to_fund ?? "0", 10) || 0,
    historicalFalloutLast13Months:
      r.historical_fallout_last_13_months != null ? Number(r.historical_fallout_last_13_months) * 100 : null,
  }));

  const complexityHistoricalPooledQuery = `
    ${baseCte}
    SELECT
      (
        1 - (
          COUNT(*) FILTER (
            WHERE l.application_date::date >= b.hist_start
              AND TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
              AND TRIM(COALESCE(l.current_loan_status, '')) = 'Loan Originated'
          )::float / NULLIF(
            COUNT(*) FILTER (
              WHERE l.application_date::date >= b.hist_start
                AND TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
            ),
            0
          )
        )
      )::float AS historical_fallout_pooled
    FROM public.loans l
    CROSS JOIN bounds b
    WHERE TRUE
    ${extraClauses}
  `;
  const pooledResult = await tenantPool.query(complexityHistoricalPooledQuery, params);
  const pooledRow = pooledResult.rows?.[0];
  const historicalFalloutPooled13Months =
    pooledRow?.historical_fallout_pooled != null ? Number(pooledRow.historical_fallout_pooled) * 100 : null;

  const remainingStageQuery = `
    ${baseCte}
    , stage_defs AS (
      SELECT '1-CTC'::text AS processing_stage, 1::int AS sort_order
      UNION ALL SELECT '2-Approved'::text, 2
      UNION ALL SELECT '3-Conditional Approval'::text, 3
      UNION ALL SELECT '4-Locked'::text, 4
      UNION ALL SELECT '5-All Other'::text, 5
    )
    SELECT
      s.processing_stage,
      s.sort_order,
      (
        SELECT COUNT(*)::int
        FROM public.loans l
        CROSS JOIN bounds b2
        WHERE ${remainingToFundExpr}
          AND ${processingStageExpr("l")} = s.processing_stage
        ${channelWhere}
        ${accessCondition ? ` AND ${accessCondition}` : ""}
        ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
      ) AS units_remaining_to_fund,
      (
        CASE
          WHEN s.processing_stage = '1-CTC' THEN (
            1 - (
              (
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND TRIM(COALESCE(l.current_loan_status, '')) = 'Loan Originated'
                  AND l.application_date::date >= b.hist_start
                  AND l.ctc_date IS NOT NULL
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ) / NULLIF((
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND l.application_date::date >= b.hist_start
                  AND l.ctc_date IS NOT NULL
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ), 0)
            )
          )
          WHEN s.processing_stage = '2-Approved' THEN (
            1 - (
              (
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND TRIM(COALESCE(l.current_loan_status, '')) = 'Loan Originated'
                  AND l.application_date::date >= b.hist_start
                  AND l.approval_date IS NOT NULL
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ) / NULLIF((
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND l.application_date::date >= b.hist_start
                  AND l.approval_date IS NOT NULL
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ), 0)
            )
          )
          WHEN s.processing_stage = '3-Conditional Approval' THEN (
            1 - (
              (
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND TRIM(COALESCE(l.current_loan_status, '')) = 'Loan Originated'
                  AND l.application_date::date >= b.hist_start
                  AND l.conditional_approval_date IS NOT NULL
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ) / NULLIF((
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND l.application_date::date >= b.hist_start
                  AND l.conditional_approval_date IS NOT NULL
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ), 0)
            )
          )
          WHEN s.processing_stage = '4-Locked' THEN (
            1 - (
              (
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND TRIM(COALESCE(l.current_loan_status, '')) = 'Loan Originated'
                  AND l.application_date::date >= b.hist_start
                  AND (l.lock_date IS NOT NULL OR l.investor_lock_date IS NOT NULL)
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ) / NULLIF((
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND l.application_date::date >= b.hist_start
                  AND (l.lock_date IS NOT NULL OR l.investor_lock_date IS NOT NULL)
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ), 0)
            )
          )
          WHEN s.processing_stage = '5-All Other' THEN (
            1 - (
              (
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND TRIM(COALESCE(l.current_loan_status, '')) = 'Loan Originated'
                  AND l.application_date::date >= b.hist_start
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ) / NULLIF((
                SELECT COUNT(*)::float
                FROM public.loans l
                WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
                  AND l.application_date::date >= b.hist_start
                ${channelWhere}
                ${accessCondition ? ` AND ${accessCondition}` : ""}
                ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
              ), 0)
            )
          )
          ELSE NULL
        END
      )::float AS historical_fallout,
      (
        CASE
          WHEN s.processing_stage = '1-CTC' THEN (
            SELECT AVG(${stageToFundDaysExpr(dateRangeType, "l.ctc_date")})::float
            FROM public.loans l
            WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
              AND l.application_date::date >= b.hist_start
              AND l.funding_date IS NOT NULL
              AND l.ctc_date IS NOT NULL
            ${channelWhere}
            ${accessCondition ? ` AND ${accessCondition}` : ""}
            ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
          )
          WHEN s.processing_stage = '2-Approved' THEN (
            SELECT AVG(${stageToFundDaysExpr(dateRangeType, "l.approval_date")})::float
            FROM public.loans l
            WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
              AND l.application_date::date >= b.hist_start
              AND l.funding_date IS NOT NULL
              AND l.approval_date IS NOT NULL
            ${channelWhere}
            ${accessCondition ? ` AND ${accessCondition}` : ""}
            ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
          )
          WHEN s.processing_stage = '3-Conditional Approval' THEN (
            SELECT AVG(${stageToFundDaysExpr(dateRangeType, "l.conditional_approval_date")})::float
            FROM public.loans l
            WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
              AND l.application_date::date >= b.hist_start
              AND l.funding_date IS NOT NULL
              AND l.conditional_approval_date IS NOT NULL
            ${channelWhere}
            ${accessCondition ? ` AND ${accessCondition}` : ""}
            ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
          )
          WHEN s.processing_stage = '4-Locked' THEN (
            SELECT AVG(${stageToFundDaysExpr(dateRangeType, "COALESCE(l.lock_date, l.investor_lock_date)")})::float
            FROM public.loans l
            WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
              AND l.application_date::date >= b.hist_start
              AND l.funding_date IS NOT NULL
              AND (l.lock_date IS NOT NULL OR l.investor_lock_date IS NOT NULL)
            ${channelWhere}
            ${accessCondition ? ` AND ${accessCondition}` : ""}
            ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
          )
          WHEN s.processing_stage = '5-All Other' THEN (
            SELECT AVG(${stageToFundDaysExpr(dateRangeType, "l.application_date")})::float
            FROM public.loans l
            WHERE TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan'
              AND l.application_date::date >= b.hist_start
              AND l.funding_date IS NOT NULL
              AND l.application_date IS NOT NULL
            ${channelWhere}
            ${accessCondition ? ` AND ${accessCondition}` : ""}
            ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
          )
          ELSE NULL
        END
      ) AS historical_status_to_fund_days
    FROM stage_defs s
    CROSS JOIN bounds b
    ORDER BY s.sort_order
  `;
  const remainingStageResult = await tenantPool.query(remainingStageQuery, params);
  const remainingToFundByProcessingStage = remainingStageResult.rows.map((r) => ({
    processingStage: String(r.processing_stage),
    sortOrder: parseInt(r.sort_order ?? "5", 10) || 5,
    unitsRemainingToFund: parseInt(r.units_remaining_to_fund ?? "0", 10) || 0,
    historicalFallout: r.historical_fallout != null ? Number(r.historical_fallout) * 100 : null,
    historicalStatusToFundDays:
      r.historical_status_to_fund_days != null ? Number(r.historical_status_to_fund_days) : null,
  }));

  const detailBaseWhere = `
    (
      ${fundedThisMonthExpr}
      OR ${remainingToFundExpr}
    )
  `;
  const projectionExpr = `
    (CASE
      WHEN l.funding_date::date BETWEEN b.month_start AND b.today THEN 'Funded'
      WHEN l.current_loan_status = 'Active Loan'
        AND l.ctc_date IS NOT NULL
        AND l.funding_date IS NULL THEN 'CTC'
      WHEN l.current_loan_status = 'Active Loan'
        AND l.approval_date IS NOT NULL
        AND l.ctc_date IS NULL
        AND l.funding_date IS NULL THEN 'Approved'
      WHEN l.current_loan_status = 'Active Loan'
        AND l.conditional_approval_date IS NOT NULL
        AND l.approval_date IS NULL
        AND l.ctc_date IS NULL
        AND l.funding_date IS NULL THEN 'Conditional Approved'
      WHEN l.current_loan_status = 'Active Loan'
        AND (l.lock_date IS NOT NULL OR l.investor_lock_date IS NOT NULL)
        AND l.conditional_approval_date IS NULL
        AND l.approval_date IS NULL
        AND l.ctc_date IS NULL
        AND l.funding_date IS NULL THEN 'Locked'
      WHEN l.current_loan_status = 'Active Loan'
        AND l.submitted_to_processing_date IS NOT NULL
        AND l.lock_date IS NULL
        AND l.investor_lock_date IS NULL
        AND l.conditional_approval_date IS NULL
        AND l.approval_date IS NULL
        AND l.ctc_date IS NULL
        AND l.funding_date IS NULL THEN 'In Processing'
      WHEN l.current_loan_status = 'Active Loan'
        AND l.submitted_to_processing_date IS NULL
        AND l.lock_date IS NULL
        AND l.investor_lock_date IS NULL
        AND l.conditional_approval_date IS NULL
        AND l.approval_date IS NULL
        AND l.ctc_date IS NULL
        AND l.funding_date IS NULL THEN 'Not Yet In Processing'
      ELSE NULL
    END)
  `;
  const appToDispExpr = appToDispositionDaysExpr(dateRangeType, "l");

  const detailCountQuery = `
    ${baseCte}
    SELECT COUNT(*)::int AS total
    FROM public.loans l
    CROSS JOIN bounds b
    WHERE ${detailBaseWhere}
    ${channelWhere}
    ${accessCondition ? ` AND ${accessCondition}` : ""}
    ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
  `;
  const detailCountResult = await tenantPool.query(detailCountQuery, params);
  const detailTotal = parseInt(detailCountResult.rows?.[0]?.total ?? "0", 10) || 0;

  const usePagination = typeof detailLimit === "number";
  const safeLimit = usePagination ? Math.max(1, detailLimit as number) : null;
  const safeOffset = Math.max(0, detailOffset);
  const detailParams = usePagination ? [...params, safeLimit as number, safeOffset] : [...params];
  const detailQuery = `
    ${baseCte}
    SELECT
      l.loan_number,
      ${complexityGroupExpr("l")} AS complexity_group,
      l.complexity_score AS complexity,
      ${projectionExpr} AS closing_projection_group,
      1::int AS units,
      l.loan_amount AS volume,
      l.occupancy_type,
      l.fico_score AS fico,
      l.ltv_ratio AS ltv,
      l.be_dti_ratio AS be_dti,
      l.borr_self_employed AS borrower_self_employed,
      l.qm_loan_type,
      l.property_type,
      l.loan_program,
      ${appToDispExpr} AS app_to_disposition_days,
      l.current_loan_status,
      l.current_status_date::text,
      l.current_milestone AS last_completed_milestone,
      l.loan_folder,
      l.application_date::text,
      l.funding_date::text,
      l.lock_date::text,
      l.investor_lock_date::text,
      l.estimated_closing_date::text,
      l.ctc_date::text,
      l.uw_final_approval_date::text,
      COALESCE(l.uw_denied_date::text, l.denial_date::text) AS denied_date,
      l.conditional_approval_date::text,
      l.branch,
      l.loan_officer,
      l.processor,
      l.underwriter
    FROM public.loans l
    CROSS JOIN bounds b
    WHERE ${detailBaseWhere}
    ${channelWhere}
    ${accessCondition ? ` AND ${accessCondition}` : ""}
    ${dimensionCondition ? ` AND ${dimensionCondition}` : ""}
    ORDER BY l.loan_number NULLS LAST
    ${usePagination ? `LIMIT $${params.length + 1}` : ""}
    ${usePagination ? `OFFSET $${params.length + 2}` : ""}
  `;
  const detailResult = await tenantPool.query(detailQuery, detailParams);
  const detailRows: EstimatedClosingsRiskDetailRow[] = (detailResult.rows || []).map((r) => ({
    loanNumber: r.loan_number != null ? String(r.loan_number) : null,
    complexityGroup: String(r.complexity_group || "Other"),
    complexity: r.complexity != null ? Number(r.complexity) : null,
    closingProjectionGroup: r.closing_projection_group != null ? String(r.closing_projection_group) : null,
    units: 1,
    volume: r.volume != null ? Number(r.volume) : null,
    occupancyType: r.occupancy_type != null ? String(r.occupancy_type) : null,
    fico: r.fico != null ? Number(r.fico) : null,
    ltv: r.ltv != null ? Number(r.ltv) : null,
    beDti: r.be_dti != null ? Number(r.be_dti) : null,
    borrowerSelfEmployed: r.borrower_self_employed ?? null,
    qmLoanType: r.qm_loan_type != null ? String(r.qm_loan_type) : null,
    propertyType: r.property_type != null ? String(r.property_type) : null,
    loanProgram: r.loan_program != null ? String(r.loan_program) : null,
    appToDispositionDays: r.app_to_disposition_days != null ? Number(r.app_to_disposition_days) : null,
    currentLoanStatus: r.current_loan_status != null ? String(r.current_loan_status) : null,
    currentStatusDate: r.current_status_date != null ? String(r.current_status_date) : null,
    lastCompletedMilestone: r.last_completed_milestone != null ? String(r.last_completed_milestone) : null,
    loanFolder: r.loan_folder != null ? String(r.loan_folder) : null,
    applicationDate: r.application_date != null ? String(r.application_date) : null,
    fundingDate: r.funding_date != null ? String(r.funding_date) : null,
    lockDate: r.lock_date != null ? String(r.lock_date) : null,
    investorLockDate: r.investor_lock_date != null ? String(r.investor_lock_date) : null,
    estimatedClosingDate: r.estimated_closing_date != null ? String(r.estimated_closing_date) : null,
    ctcDate: r.ctc_date != null ? String(r.ctc_date) : null,
    uwFinalApprovalDate: r.uw_final_approval_date != null ? String(r.uw_final_approval_date) : null,
    deniedDate: r.denied_date != null ? String(r.denied_date) : null,
    conditionalApprovalDate: r.conditional_approval_date != null ? String(r.conditional_approval_date) : null,
    branch: r.branch != null ? String(r.branch) : null,
    loanOfficer: r.loan_officer != null ? String(r.loan_officer) : null,
    processor: r.processor != null ? String(r.processor) : null,
    underwriter: r.underwriter != null ? String(r.underwriter) : null,
  }));

  const kpis: EstimatedClosingsRiskKpis = {
    totalActivePipeline,
    ecdEmptyOrAfterThisMonth: parseInt(kpiRow.ecd_empty_or_after_this_month ?? "0", 10) || 0,
    remainingToFund,
    fundedThisMonth,
    maxPossibleFunding: fundedThisMonth + remainingToFund,
    fundingYtdUnits: parseInt(kpiRow.funding_ytd_units ?? "0", 10) || 0,
    prevMonthActualUnits,
    prevMonthActualVolume,
    unitsLastMonthVsPriorPct,
    volumeLastMonthVsPriorPct,
  };

  return {
    kpis,
    activePipelineEcdSlices,
    maxPossibleFundingByComplexity,
    remainingToFundByComplexity,
    historicalFalloutPooled13Months,
    remainingToFundByProcessingStage,
    detail: {
      total: detailTotal,
      limit: usePagination ? (safeLimit as number) : detailRows.length,
      offset: usePagination ? safeOffset : 0,
      rows: detailRows,
    },
  };
}

