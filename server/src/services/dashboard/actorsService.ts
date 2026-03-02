/**
 * Actors Dashboard Service
 *
 * Base loan set: loans with application_date in range, tenant/channel/access filters.
 * Optional actor filter: restrict to loans where selected actor column = name.
 *
 * Status logic (historical %): non-active = all loans where current_loan_status != 'ACTIVE LOAN'.
 * Approval % = originated / total_non_active * 100, Denied % = denied / total_non_active * 100,
 * Withdrawn % = withdrawn / total_non_active * 100.
 * Definitions match predictionService (originated, denied, withdrawn buckets).
 */

import pg from "pg";
import { buildChannelWhereClause } from "../../utils/scorecard-utils.js";
import { LoanComplexityService } from "../scoring/loanComplexityService.js";

export type ActorsCalculation = "average" | "median";
export type ActorsTurnTimeType = "app_to_fund_days" | "app_to_closing_days";
export type ActorsDateRangeType = "calendar_days" | "business_days";
export type ActorsMeasure = "volume" | "units";

export type ActorDimension =
  | "channel"
  | "processor"
  | "closer"
  | "underwriter"
  | "loan_officer"
  | "branch"
  | "investor"
  | "warehouse_co_name";

const ACTOR_DIMENSION_COLUMN: Record<ActorDimension, string> = {
  channel: "channel",
  processor: "processor",
  closer: "closer",
  underwriter: "underwriter",
  loan_officer: "loan_officer",
  branch: "branch",
  investor: "investor",
  warehouse_co_name: "warehouse_co_name",
};

/** SQL expressions for status buckets (current_loan_status normalized to upper; originated uses funding_date in SQL). */
const STATUS_NON_ACTIVE_SQL = `(l.current_loan_status IS NOT NULL AND TRIM(l.current_loan_status) != '' AND UPPER(TRIM(l.current_loan_status)) != 'ACTIVE LOAN')`;
const STATUS_ORIGINATED_SQL = `(
  UPPER(TRIM(l.current_loan_status)) IN ('LOAN ORIGINATED','ORIGINATED','FUNDED','CLOSED','PURCHASED')
  OR UPPER(TRIM(l.current_loan_status)) LIKE '%ORIGINATED%'
  OR UPPER(TRIM(l.current_loan_status)) LIKE '%PURCHASED%'
  OR l.funding_date IS NOT NULL
)`;
const STATUS_DENIED_SQL = `(
  UPPER(TRIM(l.current_loan_status)) = 'APPLICATION DENIED'
  OR UPPER(TRIM(l.current_loan_status)) = 'PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION'
  OR UPPER(TRIM(l.current_loan_status)) = 'DENIED'
  OR UPPER(TRIM(l.current_loan_status)) LIKE '%DENIED%'
)`;
const STATUS_WITHDRAWN_SQL = `(
  UPPER(TRIM(l.current_loan_status)) = 'APPLICATION WITHDRAWN'
  OR UPPER(TRIM(l.current_loan_status)) = 'APPLICATION APPROVED BUT NOT ACCEPTED'
  OR UPPER(TRIM(l.current_loan_status)) = 'FILE CLOSED FOR INCOMPLETENESS'
  OR UPPER(TRIM(l.current_loan_status)) = 'PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED'
  OR UPPER(TRIM(l.current_loan_status)) = 'WITHDRAWN'
  OR UPPER(TRIM(l.current_loan_status)) LIKE '%WITHDRAWN%'
  OR UPPER(TRIM(l.current_loan_status)) LIKE '%CANCELLED%'
  OR UPPER(TRIM(l.current_loan_status)) LIKE '%CANCELED%'
)`;

export interface ActorsDashboardOptions {
  startDate: string;
  endDate: string;
  calculation: ActorsCalculation;
  turnTimeType: ActorsTurnTimeType;
  dateRangeType: ActorsDateRangeType;
  measure: ActorsMeasure;
  channelGroup?: string;
  accessClause?: string;
  accessParams?: unknown[];
  /** When set, restrict base loan set to loans where this actor's column = name */
  selectedActor?: { type: ActorDimension; name: string };
  /** When set, restrict base loan set to loans with this current_loan_status (raw value; use 'Unknown' for null/empty) */
  statusFilter?: string;
  /** Which dimension each of the 4 table slots shows (default: loan_officer, processor, underwriter, closer) */
  tableDimensions?: [ActorDimension, ActorDimension, ActorDimension, ActorDimension];
  /** Additional SQL WHERE fragment from dimension filters (includes leading AND per condition) */
  dimensionFilterClause?: string;
}

export interface StatusCount {
  status: string;
  count: number;
  /** Sum of loan_amount for this status (for bar chart when measure=volume) */
  volume: number;
}

export interface ActorsKPIs {
  units: number;
  volume: number;
  averageBalance: number;
  /** Weighted average coupon (interest rate): Sum(loan_amount * interest_rate) / Sum(loan_amount), rate in 0–15% range */
  wac: number | null;
  /** Weighted average maturity: Sum(loan_amount * loan_term) / Sum(loan_amount) */
  wam: number | null;
  /** Weighted average FICO: Sum(loan_amount * fico_score) / Sum(loan_amount) */
  waFico: number | null;
  /** Weighted average LTV: Sum(loan_amount * ltv_ratio) / Sum(loan_amount) */
  waLtv: number | null;
  /** Weighted average DTI: Sum(loan_amount * be_dti_ratio) / Sum(loan_amount) */
  waDti: number | null;
}

export interface ActorRow {
  name: string;
  units: number;
  volume: number;
  avgAppToFund: number | null;
  approvalPct: number;
  deniedPct: number;
  withdrawnPct: number;
  loanComplexity: number | null;
}

export interface ActorsTableResult {
  rows: ActorRow[];
  totals: Omit<ActorRow, "name"> & { name: "Totals" };
}

export interface ActorsDashboardResult {
  statusCounts: StatusCount[];
  kpis: ActorsKPIs;
  tables: [ActorsTableResult, ActorsTableResult, ActorsTableResult, ActorsTableResult];
}

/**
 * Compute turn time in days (calendar or business).
 * Calendar: raw date difference (end - start). Only includes rows where both dates exist and end >= start (excludes bad data that would dilute the average).
 * Business: count of weekdays (Mon–Fri) in [start, end] using generate_series (excludes weekends).
 */
function turnTimeDaysSql(
  turnTimeType: ActorsTurnTimeType,
  dateRangeType: ActorsDateRangeType,
  alias: string
): string {
  const startCol = "application_date";
  const endCol =
    turnTimeType === "app_to_fund_days" ? "funding_date" : "closing_date";
  const startDate = `DATE(${alias}.${startCol})`;
  const endDate = `DATE(${alias}.${endCol})`;

  if (dateRangeType === "calendar_days") {
    // Only count rows with both dates and end >= start so AVG is not diluted by zeros from bad data.
    return `(CASE
      WHEN ${alias}.${startCol} IS NOT NULL AND ${alias}.${endCol} IS NOT NULL AND ${endDate} >= ${startDate}
      THEN (${endDate} - ${startDate})::int
      ELSE NULL
    END)`;
  }

  // Business days: count weekdays (ISODOW 1=Mon .. 5=Fri) between start and end inclusive.
  // Only when both dates are non-null; otherwise NULL so AVG/PERCENTILE ignore the row.
  return `(CASE
    WHEN ${alias}.${startCol} IS NOT NULL AND ${alias}.${endCol} IS NOT NULL THEN (
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

export async function getActorsDashboardData(
  tenantPool: pg.Pool,
  options: ActorsDashboardOptions
): Promise<ActorsDashboardResult> {
  const {
    startDate,
    endDate,
    calculation,
    turnTimeType,
    dateRangeType,
    measure,
    channelGroup,
    accessClause = "",
    accessParams = [],
    selectedActor,
    statusFilter,
    tableDimensions = ["loan_officer", "processor", "underwriter", "closer"],
    dimensionFilterClause = "",
  } = options;

  const conditions: string[] = [
    "l.application_date IS NOT NULL",
    "l.application_date::date >= $1::date",
    "l.application_date::date <= $2::date",
  ];
  const params: unknown[] = [startDate, endDate];

  const channelWhere = buildChannelWhereClause(channelGroup, "l");
  if (channelWhere) {
    conditions.push(channelWhere.replace(/^AND\s+/i, "").trim());
  }
  if (accessClause) {
    conditions.push(accessClause);
    params.push(...accessParams);
  }
  if (selectedActor?.type && selectedActor?.name != null) {
    const col = ACTOR_DIMENSION_COLUMN[selectedActor.type];
    const nameTrim = selectedActor.name.trim();
    const isMissing = /^99\-missing$/i.test(nameTrim);
    if (isMissing) {
      conditions.push(`(l.${col} IS NULL OR TRIM(COALESCE(l.${col}, '')) = '')`);
    } else {
      const paramIndex = params.length + 1;
      conditions.push(`TRIM(l.${col}) = $${paramIndex}`);
      params.push(nameTrim);
    }
  }
  if (statusFilter != null && statusFilter !== "") {
    if (statusFilter === "Unknown") {
      conditions.push("(l.current_loan_status IS NULL OR TRIM(COALESCE(l.current_loan_status, '')) = '')");
    } else {
      const paramIndex = params.length + 1;
      conditions.push(`TRIM(l.current_loan_status) = $${paramIndex}`);
      params.push(statusFilter.trim());
    }
  }

  const whereSql = conditions.join(" AND ") + (dimensionFilterClause ? ` ${dimensionFilterClause}` : "");

  // ---- Status counts (bar chart): count and volume per status ----
  const statusResult = await tenantPool.query(
    `SELECT COALESCE(current_loan_status, 'Unknown') as status,
            COUNT(*)::int as count,
            COALESCE(SUM(l.loan_amount), 0)::float as volume
     FROM public.loans l
     WHERE ${whereSql}
     GROUP BY current_loan_status
     ORDER BY count DESC`,
    params
  );
  const statusCounts: StatusCount[] = statusResult.rows.map((r) => ({
    status: String(r.status),
    count: parseInt(r.count, 10) || 0,
    volume: parseFloat(r.volume) || 0,
  }));

  // ---- KPIs ----
  const turnDaysExpr = turnTimeDaysSql(turnTimeType, dateRangeType, "l");
  const kpiResult = await tenantPool.query(
    `SELECT
       COUNT(*)::int as units,
       COALESCE(SUM(l.loan_amount), 0)::float as volume,
       COALESCE(AVG(l.loan_amount), 0)::float as average_balance,
       AVG(CASE WHEN l.funding_date IS NOT NULL AND l.application_date IS NOT NULL THEN ${turnDaysExpr} END)::float as avg_turn_days,
       SUM(CASE WHEN l.interest_rate IS NOT NULL AND l.interest_rate > 0 AND l.interest_rate <= 15 THEN l.loan_amount * l.interest_rate ELSE NULL END)::float / NULLIF(SUM(CASE WHEN l.interest_rate IS NOT NULL AND l.interest_rate > 0 AND l.interest_rate <= 15 THEN l.loan_amount ELSE 0 END), 0) as wac,
       SUM(CASE WHEN l.loan_term IS NOT NULL THEN l.loan_amount * l.loan_term ELSE NULL END)::float / NULLIF(SUM(CASE WHEN l.loan_term IS NOT NULL THEN l.loan_amount ELSE 0 END), 0) as wam,
       SUM(CASE WHEN l.fico_score IS NOT NULL THEN l.loan_amount * l.fico_score ELSE NULL END)::float / NULLIF(SUM(CASE WHEN l.fico_score IS NOT NULL THEN l.loan_amount ELSE 0 END), 0) as wa_fico,
       SUM(CASE WHEN l.ltv_ratio IS NOT NULL THEN l.loan_amount * l.ltv_ratio ELSE NULL END)::float / NULLIF(SUM(CASE WHEN l.ltv_ratio IS NOT NULL THEN l.loan_amount ELSE 0 END), 0) as wa_ltv,
       SUM(CASE WHEN l.be_dti_ratio IS NOT NULL THEN l.loan_amount * l.be_dti_ratio ELSE NULL END)::float / NULLIF(SUM(CASE WHEN l.be_dti_ratio IS NOT NULL THEN l.loan_amount ELSE 0 END), 0) as wa_dti
     FROM public.loans l
     WHERE ${whereSql}`,
    params
  );
  const kpiRow = kpiResult.rows[0];
  const units = parseInt(kpiRow?.units, 10) || 0;
  const volume = parseFloat(kpiRow?.volume) || 0;
  const kpis: ActorsKPIs = {
    units,
    volume,
    averageBalance: units > 0 ? (parseFloat(kpiRow?.average_balance) || 0) : 0,
    wac: kpiRow?.wac != null ? parseFloat(kpiRow.wac) : null,
    wam: kpiRow?.wam != null ? parseFloat(kpiRow.wam) : null,
    waFico: kpiRow?.wa_fico != null ? parseFloat(kpiRow.wa_fico) : null,
    waLtv: kpiRow?.wa_ltv != null ? parseFloat(kpiRow.wa_ltv) : null,
    waDti: kpiRow?.wa_dti != null ? parseFloat(kpiRow.wa_dti) : null,
  };

  // ---- Per-dimension tables ----
  const aggTurnTime =
    calculation === "median"
      ? `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (${turnDaysExpr}))`
      : `AVG(${turnDaysExpr})`;

  const complexityService = new LoanComplexityService(tenantPool);
  await complexityService.loadCustomWeights();

  const tables: [
    ActorsTableResult,
    ActorsTableResult,
    ActorsTableResult,
    ActorsTableResult,
  ] = [
    await buildTableForDimension(
      tenantPool,
      tableDimensions[0],
      whereSql,
      params,
      aggTurnTime,
      turnTimeType,
      dateRangeType,
      complexityService
    ),
    await buildTableForDimension(
      tenantPool,
      tableDimensions[1],
      whereSql,
      params,
      aggTurnTime,
      turnTimeType,
      dateRangeType,
      complexityService
    ),
    await buildTableForDimension(
      tenantPool,
      tableDimensions[2],
      whereSql,
      params,
      aggTurnTime,
      turnTimeType,
      dateRangeType,
      complexityService
    ),
    await buildTableForDimension(
      tenantPool,
      tableDimensions[3],
      whereSql,
      params,
      aggTurnTime,
      turnTimeType,
      dateRangeType,
      complexityService
    ),
  ];

  return { statusCounts, kpis, tables };
}

async function buildTableForDimension(
  pool: pg.Pool,
  dimension: ActorDimension,
  whereSql: string,
  baseParams: unknown[],
  aggTurnTimeSql: string,
  turnTimeType: ActorsTurnTimeType,
  dateRangeType: ActorsDateRangeType,
  complexityService: LoanComplexityService
): Promise<ActorsTableResult> {
  const col = ACTOR_DIMENSION_COLUMN[dimension];
  const turnDaysExpr = turnTimeDaysSql(turnTimeType, dateRangeType, "l");

  const query = `
    SELECT
      COALESCE(TRIM(l.${col}), '99-Missing') as name,
      COUNT(*)::int as units,
      COALESCE(SUM(l.loan_amount), 0)::float as volume,
      ${aggTurnTimeSql} as avg_turn_days,
      COUNT(*) FILTER (WHERE ${STATUS_NON_ACTIVE_SQL})::int as non_active_count,
      COUNT(*) FILTER (WHERE ${STATUS_NON_ACTIVE_SQL} AND ${STATUS_ORIGINATED_SQL})::int as originated_count,
      COUNT(*) FILTER (WHERE ${STATUS_NON_ACTIVE_SQL} AND ${STATUS_DENIED_SQL})::int as denied_count,
      COUNT(*) FILTER (WHERE ${STATUS_NON_ACTIVE_SQL} AND ${STATUS_WITHDRAWN_SQL})::int as withdrawn_count
    FROM public.loans l
    WHERE ${whereSql}
    GROUP BY TRIM(l.${col})
    HAVING COUNT(*) > 0
    ORDER BY units DESC, volume DESC
  `;
  const result = await pool.query(query, baseParams);
  const rows: ActorRow[] = result.rows.map((r) => {
    const nonActive = parseInt(r.non_active_count, 10) || 0;
    const originated = parseInt(r.originated_count, 10) || 0;
    const denied = parseInt(r.denied_count, 10) || 0;
    const withdrawn = parseInt(r.withdrawn_count, 10) || 0;
    return {
      name: String(r.name),
      units: parseInt(r.units, 10) || 0,
      volume: parseFloat(r.volume) || 0,
      avgAppToFund:
        r.avg_turn_days != null ? parseFloat(r.avg_turn_days) : null,
      approvalPct: nonActive > 0 ? (originated / nonActive) * 100 : 0,
      deniedPct: nonActive > 0 ? (denied / nonActive) * 100 : 0,
      withdrawnPct: nonActive > 0 ? (withdrawn / nonActive) * 100 : 0,
      loanComplexity: null, // filled below per-actor from loans
    };
  });

  // Load complexity config and compute average complexity per actor (from loans in this dimension)
  const loanIdsByActor = new Map<string, string[]>();
  for (const row of result.rows) {
    const name = String(row.name);
    if (!loanIdsByActor.has(name)) loanIdsByActor.set(name, []);
  }
  // Fetch loan fields needed for complexity (omit non_qm - not all tenant schemas have it)
  const detailQuery = `
    SELECT l.loan_id, TRIM(l.${col}) as actor_name,
           l.loan_type, l.loan_purpose, l.loan_amount, l.fico_score, l.ltv_ratio, l.be_dti_ratio,
           l.occupancy_type, l.borr_self_employed
    FROM public.loans l
    WHERE ${whereSql}
  `;
  const detailResult = await pool.query(detailQuery, baseParams);
  const complexityByActor = new Map<string, number[]>();
  for (const loan of detailResult.rows) {
    const actorName = String(loan.actor_name ?? "99-Missing").trim() || "99-Missing";
    const loanData = {
      loan_type: loan.loan_type,
      loan_purpose: loan.loan_purpose,
      loan_amount: loan.loan_amount != null ? parseFloat(loan.loan_amount) : null,
      fico_score: loan.fico_score != null ? parseInt(loan.fico_score, 10) : null,
      ltv_ratio: loan.ltv_ratio != null ? parseFloat(loan.ltv_ratio) : null,
      be_dti_ratio: loan.be_dti_ratio != null ? parseFloat(loan.be_dti_ratio) : null,
      occupancy_type: loan.occupancy_type,
      borr_self_employed: loan.borr_self_employed,
    };
    const score = complexityService.calculateComplexity(loanData).totalScore;
    if (!complexityByActor.has(actorName)) complexityByActor.set(actorName, []);
    complexityByActor.get(actorName)!.push(score);
  }
  for (const row of rows) {
    const scores = complexityByActor.get(row.name) || [];
    row.loanComplexity =
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : null;
  }

  // Totals row: sum units/volume, average for the rest
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const totalVolume = rows.reduce((s, r) => s + r.volume, 0);
  const turnTimes = rows
    .map((r) => r.avgAppToFund)
    .filter((t): t is number => t != null);
  const avgTurn =
    turnTimes.length > 0
      ? turnTimes.reduce((a, b) => a + b, 0) / turnTimes.length
      : null;
  const approvalAvg =
    rows.length > 0
      ? rows.reduce((s, r) => s + r.approvalPct, 0) / rows.length
      : 0;
  const deniedAvg =
    rows.length > 0
      ? rows.reduce((s, r) => s + r.deniedPct, 0) / rows.length
      : 0;
  const withdrawnAvg =
    rows.length > 0
      ? rows.reduce((s, r) => s + r.withdrawnPct, 0) / rows.length
      : 0;
  const complexityVals = rows
    .map((r) => r.loanComplexity)
    .filter((c): c is number => c != null);
  const complexityAvg =
    complexityVals.length > 0
      ? Math.round(
          (complexityVals.reduce((a, b) => a + b, 0) / complexityVals.length) *
            10
        ) / 10
      : null;

  const totals: ActorsTableResult["totals"] = {
    name: "Totals",
    units: totalUnits,
    volume: totalVolume,
    avgAppToFund: avgTurn,
    approvalPct: Math.round(approvalAvg * 10) / 10,
    deniedPct: Math.round(deniedAvg * 10) / 10,
    withdrawnPct: Math.round(withdrawnAvg * 10) / 10,
    loanComplexity: complexityAvg,
  };

  return { rows, totals };
}
