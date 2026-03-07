/**
 * Lock Stratification Dashboard Service
 * KPIs, interest rate distribution, milestone breakdown, days-to-expiration,
 * and pull-through analysis for the Lock Stratification dashboard.
 * All active-loan queries use lock_date (not investor_lock_date).
 */

import pg from "pg";
import { buildChannelWhereClause } from "../../utils/scorecard-utils.js";

export type LockedFilter = "active_locked" | "active_not_locked" | "all_active";
export type MeasureFilter = "volume" | "units" | "wac" | "wa_fico";
export type MilestoneGroupBy = "current_milestone" | "investor" | "branch" | "broker_lender" | "lo" | "ae";
export type PullThroughPeriod = "30" | "60" | "90" | "120" | "ytd";

export interface LockStratFilters {
  channel?: string | null;
  locked: LockedFilter;
  measure: MeasureFilter;
  rateMin?: number;
  rateMax?: number;
}

export interface LockStratKPIs {
  units: number;
  volume: number;
  avgBalance: number;
  avgDaysActive: number;
  wac: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  labelPrefix: string;
}

export interface InterestRateBucket {
  bucket: string;
  value: number;
}

/** Drill level: 1 = 1% buckets, 0.125 = 0.125% within a 1% range, rate = individual rates within 0.125% */
export interface InterestRateDrillOptions {
  drillMin: number;
  drillMax: number;
  increment: 1 | 0.125 | "rate";
}

export interface MilestoneChartRow {
  group: string;
  expirationBucket: string;
  value: number;
}

export interface MilestonePivotRow {
  group: string;
  units: number;
  volume: number;
  pct: number;
  children: { bucket: string; units: number; volume: number; pct: number }[];
}

export interface DaysToExpirationRow {
  bucket: string;
  units: number;
  volume: number;
  wac: number;
  avgDaysActive: number;
}

export interface PullThroughMonthBar {
  month: string;
  monthNum: number;
  lockedOriginated: number;
  lockedWithdrawn: number;
  lockedDenied: number;
}

export interface PullThroughData {
  originatedPct: number;
  withdrawnPct: number;
  deniedPct: number;
  bars: PullThroughMonthBar[];
}

function getLabelPrefix(locked: LockedFilter): string {
  switch (locked) {
    case "active_locked":
      return "Active LOCKED";
    case "active_not_locked":
      return "Active NOT LOCKED";
    case "all_active":
      return "All Active";
    default:
      return "All Active";
  }
}

function buildLockedClause(locked: LockedFilter, alias: string): string {
  const l = alias ? `${alias}.` : "";
  switch (locked) {
    case "active_locked":
      return `AND (${l}lock_date IS NOT NULL AND ${l}lock_expiration_date IS NOT NULL AND (${l}lock_expiration_date)::date > CURRENT_DATE)`;
    case "active_not_locked":
      return `AND ((${l}lock_date IS NULL OR ${l}lock_expiration_date IS NULL) OR ((${l}lock_expiration_date)::date <= CURRENT_DATE))`;
    case "all_active":
      return "";
    default:
      return "";
  }
}

function buildBaseWhere(
  filters: LockStratFilters,
  alias: string
): string {
  const l = alias ? `${alias}.` : "";
  const conditions: string[] = [
    `(${l}current_loan_status = 'Active Loan')`,
    `(${l}application_date IS NOT NULL AND ${l}application_date::text != '')`,
    `(${l}is_archived IS DISTINCT FROM TRUE)`,
  ];

  const channelClause = buildChannelWhereClause(filters.channel ?? undefined, alias);
  if (channelClause) {
    conditions.push(channelClause.replace(/^\s*AND\s+/i, ""));
  }

  const lockClause = buildLockedClause(filters.locked, alias).replace(/^\s*AND\s+/, "");
  if (lockClause) conditions.push(lockClause);

  if (filters.rateMin != null && filters.rateMax != null) {
    conditions.push(`(${l}interest_rate IS NOT NULL AND ${l}interest_rate >= ${Number(filters.rateMin)} AND ${l}interest_rate < ${Number(filters.rateMax)})`);
  }

  return `WHERE ${conditions.join(" AND ")}`;
}

const EXPIRATION_BUCKET_CASE = (alias: string) => {
  const l = alias ? `${alias}.` : "";
  return `CASE
    WHEN ${l}lock_expiration_date IS NULL THEN 'Lock Expiration Date Blank'
    WHEN (${l}lock_expiration_date)::date <= CURRENT_DATE THEN 'Expired'
    WHEN (${l}lock_expiration_date)::date - CURRENT_DATE BETWEEN 1 AND 7 THEN '1-7 Days'
    WHEN (${l}lock_expiration_date)::date - CURRENT_DATE BETWEEN 8 AND 14 THEN '8-14 Days'
    WHEN (${l}lock_expiration_date)::date - CURRENT_DATE BETWEEN 15 AND 21 THEN '15-21 Days'
    WHEN (${l}lock_expiration_date)::date - CURRENT_DATE BETWEEN 22 AND 30 THEN '22-30 Days'
    ELSE '>30 Days'
  END`;
};

const EXPIRATION_BUCKET_ORDER = (alias: string) => {
  const l = alias ? `${alias}.` : "";
  return `CASE
    WHEN ${l}lock_expiration_date IS NULL THEN 8
    WHEN (${l}lock_expiration_date)::date <= CURRENT_DATE THEN 7
    WHEN (${l}lock_expiration_date)::date - CURRENT_DATE BETWEEN 1 AND 7 THEN 1
    WHEN (${l}lock_expiration_date)::date - CURRENT_DATE BETWEEN 8 AND 14 THEN 2
    WHEN (${l}lock_expiration_date)::date - CURRENT_DATE BETWEEN 15 AND 21 THEN 3
    WHEN (${l}lock_expiration_date)::date - CURRENT_DATE BETWEEN 22 AND 30 THEN 4
    ELSE 5
  END`;
};

function getGroupByColumn(groupBy: MilestoneGroupBy): string {
  switch (groupBy) {
    case "current_milestone":
      return "current_milestone";
    case "investor":
      return "investor";
    case "branch":
      return "branch";
    case "broker_lender":
      return "broker_lender_name";
    case "lo":
      return "loan_officer";
    case "ae":
      return "account_executive";
    default:
      return "current_milestone";
  }
}

function getMeasureExpression(measure: MeasureFilter, alias: string): string {
  const l = alias ? `${alias}.` : "";
  switch (measure) {
    case "volume":
      return `COALESCE(SUM(${l}loan_amount), 0)::double precision`;
    case "units":
      return `COUNT(*)::double precision`;
    case "wac":
      return `CASE WHEN SUM(CASE WHEN ${l}interest_rate IS NOT NULL AND ${l}interest_rate > 0 AND ${l}interest_rate < 15 THEN ${l}loan_amount ELSE 0 END) > 0
        THEN SUM(CASE WHEN ${l}interest_rate IS NOT NULL AND ${l}interest_rate > 0 AND ${l}interest_rate < 15 THEN ${l}interest_rate * ${l}loan_amount ELSE 0 END)
             / SUM(CASE WHEN ${l}interest_rate IS NOT NULL AND ${l}interest_rate > 0 AND ${l}interest_rate < 15 THEN ${l}loan_amount ELSE 0 END)
        ELSE 0 END::double precision`;
    case "wa_fico":
      return `CASE WHEN SUM(CASE WHEN ${l}fico_score IS NOT NULL AND ${l}fico_score > 0 AND ${l}fico_score < 900 THEN ${l}loan_amount ELSE 0 END) > 0
        THEN SUM(CASE WHEN ${l}fico_score IS NOT NULL AND ${l}fico_score > 0 AND ${l}fico_score < 900 THEN ${l}fico_score * ${l}loan_amount ELSE 0 END)
             / SUM(CASE WHEN ${l}fico_score IS NOT NULL AND ${l}fico_score > 0 AND ${l}fico_score < 900 THEN ${l}loan_amount ELSE 0 END)
        ELSE 0 END::double precision`;
    default:
      return `COUNT(*)::double precision`;
  }
}

export async function getLockStratKPIs(
  tenantPool: pg.Pool,
  filters: LockStratFilters
): Promise<LockStratKPIs> {
  const labelPrefix = getLabelPrefix(filters.locked);
  const whereClause = buildBaseWhere(filters, "l");

  const sql = `
    SELECT
      COUNT(*)::int AS units,
      COALESCE(SUM(l.loan_amount), 0)::double precision AS volume,
      COALESCE(AVG(l.loan_amount), 0)::double precision AS avg_balance,
      COALESCE(AVG(CURRENT_DATE - (l.application_date)::date), 0)::double precision AS avg_days_active,
      CASE WHEN SUM(CASE WHEN l.interest_rate IS NOT NULL AND l.interest_rate > 0 AND l.interest_rate < 15 THEN l.loan_amount ELSE 0 END) > 0
        THEN SUM(CASE WHEN l.interest_rate IS NOT NULL AND l.interest_rate > 0 AND l.interest_rate < 15 THEN l.interest_rate * l.loan_amount ELSE 0 END)
             / SUM(CASE WHEN l.interest_rate IS NOT NULL AND l.interest_rate > 0 AND l.interest_rate < 15 THEN l.loan_amount ELSE 0 END)
        ELSE 0 END::double precision AS wac,
      CASE WHEN SUM(CASE WHEN l.fico_score IS NOT NULL AND l.fico_score > 0 AND l.fico_score < 900 THEN l.loan_amount ELSE 0 END) > 0
        THEN SUM(CASE WHEN l.fico_score IS NOT NULL AND l.fico_score > 0 AND l.fico_score < 900 THEN l.fico_score * l.loan_amount ELSE 0 END)
             / SUM(CASE WHEN l.fico_score IS NOT NULL AND l.fico_score > 0 AND l.fico_score < 900 THEN l.loan_amount ELSE 0 END)
        ELSE 0 END::double precision AS wa_fico,
      CASE WHEN SUM(CASE WHEN l.ltv_ratio IS NOT NULL AND l.ltv_ratio > 0 AND l.ltv_ratio < 110 THEN l.loan_amount ELSE 0 END) > 0
        THEN SUM(CASE WHEN l.ltv_ratio IS NOT NULL AND l.ltv_ratio > 0 AND l.ltv_ratio < 110 THEN l.ltv_ratio * l.loan_amount ELSE 0 END)
             / SUM(CASE WHEN l.ltv_ratio IS NOT NULL AND l.ltv_ratio > 0 AND l.ltv_ratio < 110 THEN l.loan_amount ELSE 0 END)
        ELSE 0 END::double precision AS wa_ltv,
      CASE WHEN SUM(CASE WHEN l.be_dti_ratio IS NOT NULL AND l.be_dti_ratio > 0 AND l.be_dti_ratio < 78 THEN l.loan_amount ELSE 0 END) > 0
        THEN SUM(CASE WHEN l.be_dti_ratio IS NOT NULL AND l.be_dti_ratio > 0 AND l.be_dti_ratio < 78 THEN l.be_dti_ratio * l.loan_amount ELSE 0 END)
             / SUM(CASE WHEN l.be_dti_ratio IS NOT NULL AND l.be_dti_ratio > 0 AND l.be_dti_ratio < 78 THEN l.loan_amount ELSE 0 END)
        ELSE 0 END::double precision AS wa_dti
    FROM public.loans l
    ${whereClause}
  `;

  const result = await tenantPool.query(sql);
  const row = result.rows[0] || {};
  return {
    units: Number(row.units) || 0,
    volume: Number(row.volume) || 0,
    avgBalance: Number(row.avg_balance) || 0,
    avgDaysActive: Number(row.avg_days_active) || 0,
    wac: Number(row.wac) || 0,
    waFico: Number(row.wa_fico) || 0,
    waLtv: Number(row.wa_ltv) || 0,
    waDti: Number(row.wa_dti) || 0,
    labelPrefix,
  };
}

export async function getInterestRateDistribution(
  tenantPool: pg.Pool,
  filters: LockStratFilters,
  drill?: InterestRateDrillOptions | null
): Promise<InterestRateBucket[]> {
  const whereClause = buildBaseWhere(filters, "l");
  const measureExpr = getMeasureExpression(filters.measure, "l");

  // Level 0: 1.00% buckets (default)
  if (!drill || drill.increment === 1) {
    const sql = `
      SELECT
        FLOOR(l.interest_rate) AS rate_floor,
        ${measureExpr} AS value
      FROM public.loans l
      ${whereClause}
        AND l.interest_rate IS NOT NULL
        AND l.interest_rate > 0
        AND l.interest_rate < 15
      GROUP BY FLOOR(l.interest_rate)
      ORDER BY rate_floor
    `;
    const result = await tenantPool.query(sql);
    return (result.rows || []).map((r: Record<string, unknown>) => {
      const floor = Number(r.rate_floor);
      return {
        bucket: `${floor.toFixed(3)} - ${(floor + 1).toFixed(3)}`,
        value: Number(r.value) || 0,
      };
    });
  }

  // Level 1: 0.125% buckets within [drillMin, drillMax)
  if (drill.increment === 0.125) {
    const sql = `
      SELECT
        (FLOOR((l.interest_rate - $1) / 0.125) * 0.125 + $1) AS bucket_start,
        ${measureExpr} AS value
      FROM public.loans l
      ${whereClause}
        AND l.interest_rate IS NOT NULL
        AND l.interest_rate > 0
        AND l.interest_rate < 15
        AND l.interest_rate >= $1
        AND l.interest_rate < $2
      GROUP BY bucket_start
      ORDER BY bucket_start
    `;
    const result = await tenantPool.query(sql, [drill.drillMin, drill.drillMax]);
    return (result.rows || []).map((r: Record<string, unknown>) => {
      const start = Number(r.bucket_start);
      const end = Math.round((start + 0.125) * 1000) / 1000;
      return {
        bucket: `${start.toFixed(3)} - ${end.toFixed(3)}`,
        value: Number(r.value) || 0,
      };
    });
  }

  // Level 2: individual rates (distinct rate values) within [drillMin, drillMax)
  if (drill.increment === "rate") {
    const sql = `
      SELECT
        ROUND(l.interest_rate::numeric, 4) AS rate_val,
        ${measureExpr} AS value
      FROM public.loans l
      ${whereClause}
        AND l.interest_rate IS NOT NULL
        AND l.interest_rate > 0
        AND l.interest_rate < 15
        AND l.interest_rate >= $1
        AND l.interest_rate < $2
      GROUP BY rate_val
      ORDER BY rate_val
    `;
    const result = await tenantPool.query(sql, [drill.drillMin, drill.drillMax]);
    return (result.rows || []).map((r: Record<string, unknown>) => {
      const rate = Number(r.rate_val);
      return {
        bucket: String(rate.toFixed(4)),
        value: Number(r.value) || 0,
      };
    });
  }

  return [];
}

export async function getMilestoneChart(
  tenantPool: pg.Pool,
  filters: LockStratFilters,
  groupBy: MilestoneGroupBy
): Promise<MilestoneChartRow[]> {
  const whereClause = buildBaseWhere(filters, "l");
  const measureExpr = getMeasureExpression(filters.measure, "l");
  const bucketCase = EXPIRATION_BUCKET_CASE("l");
  const bucketOrder = EXPIRATION_BUCKET_ORDER("l");

  const groupCol = getGroupByColumn(groupBy);
  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(l.${groupCol}), ''), '(Blank)') AS group_name,
      (${bucketCase}) AS expiration_bucket,
      ${measureExpr} AS value
    FROM public.loans l
    ${whereClause}
    GROUP BY 1, 2, (${bucketOrder})
    ORDER BY 1, (${bucketOrder})
  `;

  const result = await tenantPool.query(sql);
  return (result.rows || []).map((r: Record<string, unknown>) => ({
    group: String(r.group_name ?? "(Blank)"),
    expirationBucket: String(r.expiration_bucket ?? ""),
    value: Number(r.value) || 0,
  }));
}

export async function getMilestonePivot(
  tenantPool: pg.Pool,
  filters: LockStratFilters,
  groupBy: MilestoneGroupBy
): Promise<{ rows: MilestonePivotRow[]; totals: { units: number; volume: number } }> {
  const whereClause = buildBaseWhere(filters, "l");
  const bucketCase = EXPIRATION_BUCKET_CASE("l");
  const bucketOrder = EXPIRATION_BUCKET_ORDER("l");

  const groupCol = getGroupByColumn(groupBy);
  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(l.${groupCol}), ''), '(Blank)') AS group_name,
      (${bucketCase}) AS expiration_bucket,
      COUNT(*)::int AS units,
      COALESCE(SUM(l.loan_amount), 0)::double precision AS volume
    FROM public.loans l
    ${whereClause}
    GROUP BY 1, 2, (${bucketOrder})
    ORDER BY 1, (${bucketOrder})
  `;

  const result = await tenantPool.query(sql);

  const totalUnits = (result.rows || []).reduce((s: number, r: Record<string, unknown>) => s + (Number(r.units) || 0), 0);
  const totalVolume = (result.rows || []).reduce((s: number, r: Record<string, unknown>) => s + (Number(r.volume) || 0), 0);

  const groupMap = new Map<string, MilestonePivotRow>();
  for (const r of result.rows || []) {
    const name = String((r as Record<string, unknown>).group_name ?? "(Blank)");
    const bucket = String((r as Record<string, unknown>).expiration_bucket ?? "");
    const units = Number((r as Record<string, unknown>).units) || 0;
    const volume = Number((r as Record<string, unknown>).volume) || 0;

    if (!groupMap.has(name)) {
      groupMap.set(name, { group: name, units: 0, volume: 0, pct: 0, children: [] });
    }
    const grp = groupMap.get(name)!;
    grp.units += units;
    grp.volume += volume;
    grp.children.push({
      bucket,
      units,
      volume,
      pct: totalUnits > 0 ? (units / totalUnits) * 100 : 0,
    });
  }

  const rows = Array.from(groupMap.values());
  for (const row of rows) {
    row.pct = totalUnits > 0 ? (row.units / totalUnits) * 100 : 0;
  }

  return { rows, totals: { units: totalUnits, volume: totalVolume } };
}

export async function getDaysToExpiration(
  tenantPool: pg.Pool,
  filters: LockStratFilters
): Promise<DaysToExpirationRow[]> {
  const whereClause = buildBaseWhere(filters, "l");
  const bucketCase = EXPIRATION_BUCKET_CASE("l");
  const bucketOrder = EXPIRATION_BUCKET_ORDER("l");

  const sql = `
    SELECT
      (${bucketCase}) AS bucket,
      COUNT(*)::int AS units,
      COALESCE(SUM(l.loan_amount), 0)::double precision AS volume,
      CASE WHEN SUM(CASE WHEN l.interest_rate IS NOT NULL AND l.interest_rate > 0 AND l.interest_rate < 15 THEN l.loan_amount ELSE 0 END) > 0
        THEN SUM(CASE WHEN l.interest_rate IS NOT NULL AND l.interest_rate > 0 AND l.interest_rate < 15 THEN l.interest_rate * l.loan_amount ELSE 0 END)
             / SUM(CASE WHEN l.interest_rate IS NOT NULL AND l.interest_rate > 0 AND l.interest_rate < 15 THEN l.loan_amount ELSE 0 END)
        ELSE 0 END::double precision AS wac,
      COALESCE(AVG(CURRENT_DATE - (l.application_date)::date), 0)::double precision AS avg_days_active
    FROM public.loans l
    ${whereClause}
    GROUP BY (${bucketCase}), (${bucketOrder})
    ORDER BY (${bucketOrder})
  `;

  const result = await tenantPool.query(sql);
  return (result.rows || []).map((r: Record<string, unknown>) => ({
    bucket: String(r.bucket ?? ""),
    units: Number(r.units) || 0,
    volume: Number(r.volume) || 0,
    wac: Number(r.wac) || 0,
    avgDaysActive: Number(r.avg_days_active) || 0,
  }));
}

export async function getPullThrough(
  tenantPool: pg.Pool,
  filters: LockStratFilters,
  period: PullThroughPeriod
): Promise<PullThroughData> {
  const l = "l.";
  const conditions: string[] = [
    `(${l}current_loan_status != 'Active Loan')`,
    `(${l}lock_date IS NOT NULL)`,
    `(${l}current_status_date IS NOT NULL)`,
    `(${l}is_archived IS DISTINCT FROM TRUE)`,
  ];

  const channelClause = buildChannelWhereClause(filters.channel ?? undefined, "l");
  if (channelClause) {
    conditions.push(channelClause.replace(/^\s*AND\s+/i, ""));
  }

  if (period === "ytd") {
    conditions.push(`(${l}current_status_date)::date >= DATE_TRUNC('year', CURRENT_DATE)`);
  } else {
    const days = Number(period);
    conditions.push(`((${l}current_status_date)::date >= CURRENT_DATE - INTERVAL '${days} days')`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const dispositionCase = `CASE
    WHEN UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) IN ('LOAN ORIGINATED','ORIGINATED','FUNDED','CLOSED','PURCHASED')
         OR UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) LIKE '%ORIGINATED%'
         OR UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) LIKE '%PURCHASED%'
         OR ${l}funding_date IS NOT NULL
    THEN 'originated'
    WHEN UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) LIKE '%WITHDRAWN%'
         OR UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) LIKE '%WITHDRAW%'
    THEN 'withdrawn'
    WHEN UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) LIKE '%DENIED%'
         OR UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) LIKE '%DENY%'
         OR UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) LIKE '%DENIAL%'
    THEN 'denied'
    ELSE 'other'
  END`;

  const summarySQL = `
    SELECT
      (${dispositionCase}) AS disposition,
      COUNT(*)::int AS cnt
    FROM public.loans l
    ${whereClause}
    GROUP BY (${dispositionCase})
  `;

  const summaryResult = await tenantPool.query(summarySQL);
  let originated = 0, withdrawn = 0, denied = 0, total = 0;
  for (const r of summaryResult.rows || []) {
    const cnt = Number((r as Record<string, unknown>).cnt) || 0;
    const disp = String((r as Record<string, unknown>).disposition);
    total += cnt;
    if (disp === "originated") originated = cnt;
    else if (disp === "withdrawn") withdrawn = cnt;
    else if (disp === "denied") denied = cnt;
  }

  const barsSQL = `
    SELECT
      TO_CHAR((${l}current_status_date)::date, 'Mon') AS month_label,
      EXTRACT(MONTH FROM (${l}current_status_date)::date)::int AS month_num,
      EXTRACT(YEAR FROM (${l}current_status_date)::date)::int AS year_num,
      SUM(CASE WHEN (${dispositionCase}) = 'originated' THEN 1 ELSE 0 END)::int AS locked_originated,
      SUM(CASE WHEN (${dispositionCase}) = 'withdrawn' THEN 1 ELSE 0 END)::int AS locked_withdrawn,
      SUM(CASE WHEN (${dispositionCase}) = 'denied' THEN 1 ELSE 0 END)::int AS locked_denied
    FROM public.loans l
    ${whereClause}
    GROUP BY TO_CHAR((${l}current_status_date)::date, 'Mon'),
             EXTRACT(MONTH FROM (${l}current_status_date)::date),
             EXTRACT(YEAR FROM (${l}current_status_date)::date)
    ORDER BY year_num, month_num
  `;

  const barsResult = await tenantPool.query(barsSQL);
  const bars: PullThroughMonthBar[] = (barsResult.rows || []).map((r: Record<string, unknown>) => ({
    month: String(r.month_label ?? ""),
    monthNum: Number(r.month_num) || 0,
    lockedOriginated: Number(r.locked_originated) || 0,
    lockedWithdrawn: Number(r.locked_withdrawn) || 0,
    lockedDenied: Number(r.locked_denied) || 0,
  }));

  return {
    originatedPct: total > 0 ? (originated / total) * 100 : 0,
    withdrawnPct: total > 0 ? (withdrawn / total) * 100 : 0,
    deniedPct: total > 0 ? (denied / total) * 100 : 0,
    bars,
  };
}
