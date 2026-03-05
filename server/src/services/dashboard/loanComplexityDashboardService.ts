/**
 * Loan Complexity Dashboard Service
 *
 * Returns average loan complexity per group (loan officer, branch, or current_loan_status)
 * for loans with application_date in [startDate, endDate], using tenant complexity config.
 * Bars sorted by group name alphabetically.
 */

import pg from "pg";
import { buildChannelWhereClause } from "../../utils/scorecard-utils.js";
import { LoanComplexityService } from "../scoring/loanComplexityService.js";

export type LoanComplexityGroupBy =
  | "loan_officer"
  | "processor"
  | "underwriter"
  | "closer"
  | "branch"
  | "current_loan_status";

export interface LoanComplexityDashboardOptions {
  startDate: string;
  endDate: string;
  groupBy: LoanComplexityGroupBy;
  channelGroup?: string;
  accessClause?: string;
  accessParams?: unknown[];
  /** Additional SQL WHERE fragment from dimension filters (includes leading AND per condition) */
  dimensionFilterClause?: string;
}

export interface LoanComplexityGroupLoansOptions extends LoanComplexityDashboardOptions {
  /** The bar's group value (e.g. loan officer name, branch name, or current_loan_status). */
  groupName: string;
}

export interface LoanComplexityBar {
  groupName: string;
  avgComplexity: number;
  loanCount: number;
}

export interface LoanComplexityDashboardResult {
  bars: LoanComplexityBar[];
}

export interface LoanComplexityStatusOptionsResult {
  statuses: string[];
  hasFallout: boolean;
}

/** Statuses that count as "Fallout" for the combined filter option. */
const FALLOUT_STATUS_PATTERN = /application\s+denied|application\s+withdrawn/i;

/** One loan row for the "loans by group" detail table (same filters as dashboard + groupName). */
export interface LoanComplexityGroupLoanRow {
  loan_id: string;
  loan_number: string | null;
  loan_amount: number | null;
  loan_type: string | null;
  loan_program: string | null;
  loan_purpose: string | null;
  application_date: string | null;
  current_loan_status: string | null;
  current_milestone: string | null;
  ltv_ratio: number | null;
  be_dti_ratio: number | null;
  fico_score: number | null;
  occupancy_type: string | null;
  borr_self_employed: boolean | string | null;
  complexity_score: number | null;
}

const GROUP_BY_COLUMN: Record<LoanComplexityGroupBy, string> = {
  loan_officer: "loan_officer",
  processor: "processor",
  underwriter: "underwriter",
  closer: "closer",
  branch: "branch",
  current_loan_status: "current_loan_status",
};

/** SQL expression for the grouping key: column value or 'Unknown' for null/empty (for current_loan_status). */
function groupBySelect(groupBy: LoanComplexityGroupBy, alias: string): string {
  const col = `${alias}.${GROUP_BY_COLUMN[groupBy]}`;
  return `COALESCE(NULLIF(TRIM(${col}), ''), 'Unknown')`;
}

export async function getLoanComplexityDashboardData(
  tenantPool: pg.Pool,
  options: LoanComplexityDashboardOptions
): Promise<LoanComplexityDashboardResult> {
  const {
    startDate,
    endDate,
    groupBy,
    channelGroup,
    accessClause = "",
    accessParams = [],
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
    conditions.push(accessClause.replace(/^AND\s+/i, "").trim());
    params.push(...accessParams);
  }

  const whereSql =
    conditions.join(" AND ") +
    (dimensionFilterClause ? ` ${dimensionFilterClause}` : "");

  const groupByExpr = groupBySelect(groupBy, "l");

  const complexityService = new LoanComplexityService(tenantPool);
  await complexityService.loadCustomWeights();

  const detailQuery = `
    SELECT ${groupByExpr} as group_name,
           l.loan_type, l.loan_purpose, l.loan_amount, l.fico_score, l.ltv_ratio, l.be_dti_ratio,
           l.occupancy_type, l.borr_self_employed
    FROM public.loans l
    WHERE ${whereSql}
  `;
  const result = await tenantPool.query(detailQuery, params);

  const byGroup = new Map<string, number[]>();
  for (const loan of result.rows) {
    const groupName = String(loan.group_name ?? "Unknown").trim() || "Unknown";
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
    if (!byGroup.has(groupName)) byGroup.set(groupName, []);
    byGroup.get(groupName)!.push(score);
  }

  const bars: LoanComplexityBar[] = [];
  for (const [groupName, scores] of byGroup.entries()) {
    const sum = scores.reduce((a, b) => a + b, 0);
    bars.push({
      groupName,
      avgComplexity: Math.round((sum / scores.length) * 10) / 10,
      loanCount: scores.length,
    });
  }

  bars.sort((a, b) => a.groupName.localeCompare(b.groupName, undefined, { sensitivity: "base" }));

  return { bars };
}

/**
 * Returns distinct current_loan_status values for loans in the given period (same base filters as dashboard).
 * Used to populate the Current loan status filter dropdown. Also returns whether any status matches "Fallout"
 * (Application Denied or Application Withdrawn) so the UI can show a combined "Fallout" option.
 */
export async function getLoanComplexityStatusOptions(
  tenantPool: pg.Pool,
  options: Omit<LoanComplexityDashboardOptions, "groupBy" | "dimensionFilterClause"> & {
    /** Optional: exclude current_loan_status from dimension filter when building the list (not used for status options). */
    dimensionFilterClause?: string;
  }
): Promise<LoanComplexityStatusOptionsResult> {
  const {
    startDate,
    endDate,
    channelGroup,
    accessClause = "",
    accessParams = [],
    dimensionFilterClause = "",
  } = options;

  const conditions: string[] = [
    "l.application_date IS NOT NULL",
    "l.application_date::date >= $1::date",
    "l.application_date::date <= $2::date",
    "l.current_loan_status IS NOT NULL",
    "TRIM(l.current_loan_status) != ''",
  ];
  const params: unknown[] = [startDate, endDate];

  const channelWhere = buildChannelWhereClause(channelGroup, "l");
  if (channelWhere) {
    conditions.push(channelWhere.replace(/^AND\s+/i, "").trim());
  }
  if (accessClause) {
    conditions.push(accessClause.replace(/^AND\s+/i, "").trim());
    params.push(...accessParams);
  }

  const whereSql =
    conditions.join(" AND ") +
    (dimensionFilterClause ? ` ${dimensionFilterClause}` : "");

  const query = `
    SELECT DISTINCT current_loan_status AS value
    FROM public.loans l
    WHERE ${whereSql}
    ORDER BY current_loan_status
  `;
  const result = await tenantPool.query(query, params);
  const statuses = result.rows.map((r) => String(r.value).trim()).filter(Boolean);
  const hasFallout = statuses.some((s) => FALLOUT_STATUS_PATTERN.test(s));

  return { statuses, hasFallout };
}

/**
 * Returns loan rows for a single group (one bar click): same filters as dashboard + groupName match.
 * Includes complexity_score computed per loan.
 */
export async function getLoanComplexityGroupLoans(
  tenantPool: pg.Pool,
  options: LoanComplexityGroupLoansOptions
): Promise<LoanComplexityGroupLoanRow[]> {
  const {
    startDate,
    endDate,
    groupBy,
    groupName,
    channelGroup,
    accessClause = "",
    accessParams = [],
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
    conditions.push(accessClause.replace(/^AND\s+/i, "").trim());
    params.push(...accessParams);
  }

  const groupByExpr = groupBySelect(groupBy, "l");
  conditions.push(`${groupByExpr} = $${params.length + 1}`);
  params.push(groupName.trim() || "Unknown");

  const whereSql =
    conditions.join(" AND ") +
    (dimensionFilterClause ? ` ${dimensionFilterClause}` : "");

  const loansQuery = `
    SELECT l.loan_id,
           COALESCE(l.loan_number, l.loan_id::text) AS loan_number,
           l.loan_amount, l.loan_type, l.loan_program, l.loan_purpose,
           l.application_date::text AS application_date,
           l.current_loan_status, l.current_milestone,
           l.ltv_ratio, l.be_dti_ratio, l.fico_score,
           l.occupancy_type, l.borr_self_employed
    FROM public.loans l
    WHERE ${whereSql}
    ORDER BY l.application_date DESC NULLS LAST, l.loan_number ASC NULLS LAST
  `;
  const result = await tenantPool.query(loansQuery, params);

  const complexityService = new LoanComplexityService(tenantPool);
  await complexityService.loadCustomWeights();

  const rows: LoanComplexityGroupLoanRow[] = result.rows.map((r) => {
    const loanData = {
      loan_type: r.loan_type,
      loan_purpose: r.loan_purpose,
      loan_amount: r.loan_amount != null ? parseFloat(r.loan_amount) : null,
      fico_score: r.fico_score != null ? parseInt(r.fico_score, 10) : null,
      ltv_ratio: r.ltv_ratio != null ? parseFloat(r.ltv_ratio) : null,
      be_dti_ratio: r.be_dti_ratio != null ? parseFloat(r.be_dti_ratio) : null,
      occupancy_type: r.occupancy_type,
      borr_self_employed: r.borr_self_employed,
    };
    const complexity = complexityService.calculateComplexity(loanData);
    return {
      loan_id: String(r.loan_id),
      loan_number: r.loan_number != null ? String(r.loan_number) : null,
      loan_amount: r.loan_amount != null ? parseFloat(r.loan_amount) : null,
      loan_type: r.loan_type != null ? String(r.loan_type) : null,
      loan_program: r.loan_program != null ? String(r.loan_program) : null,
      loan_purpose: r.loan_purpose != null ? String(r.loan_purpose) : null,
      application_date: r.application_date != null ? String(r.application_date) : null,
      current_loan_status: r.current_loan_status != null ? String(r.current_loan_status) : null,
      current_milestone: r.current_milestone != null ? String(r.current_milestone) : null,
      ltv_ratio: r.ltv_ratio != null ? parseFloat(r.ltv_ratio) : null,
      be_dti_ratio: r.be_dti_ratio != null ? parseFloat(r.be_dti_ratio) : null,
      fico_score: r.fico_score != null ? parseInt(r.fico_score, 10) : null,
      occupancy_type: r.occupancy_type != null ? String(r.occupancy_type) : null,
      borr_self_employed: r.borr_self_employed,
      complexity_score: complexity.totalScore,
    };
  });

  return rows;
}

/** Pivot row dimensions (exclude current_loan_status). */
const PIVOT_DIMENSION_KEYS: LoanComplexityGroupBy[] = ["loan_officer", "branch", "underwriter", "processor", "closer"];
const PIVOT_DIMENSION_LABELS: Record<LoanComplexityGroupBy, string> = {
  loan_officer: "Loan Officer",
  branch: "Branch",
  underwriter: "Underwriter",
  processor: "Processor",
  closer: "Closer",
  current_loan_status: "Current Loan Status",
};

function isActiveLoan(current_loan_status: string | null): boolean {
  const s = (current_loan_status ?? "").trim().toUpperCase();
  return s === "ACTIVE LOAN";
}

function isOriginated(current_loan_status: string | null, funding_date: unknown): boolean {
  if (funding_date != null) return true;
  const s = (current_loan_status ?? "").trim().toUpperCase();
  return (
    s === "LOAN ORIGINATED" ||
    s === "ORIGINATED" ||
    s === "FUNDED" ||
    s === "CLOSED" ||
    s === "PURCHASED" ||
    s.includes("ORIGINATED") ||
    s.includes("PURCHASED")
  );
}

function isDenied(current_loan_status: string | null): boolean {
  const s = (current_loan_status ?? "").trim().toUpperCase();
  return (
    s === "APPLICATION DENIED" ||
    s === "PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION" ||
    s === "DENIED" ||
    s.includes("DENIED")
  );
}

function isWithdrawn(current_loan_status: string | null): boolean {
  const s = (current_loan_status ?? "").trim().toUpperCase();
  return (
    s === "APPLICATION WITHDRAWN" ||
    s === "APPLICATION APPROVED BUT NOT ACCEPTED" ||
    s === "FILE CLOSED FOR INCOMPLETENESS" ||
    s === "PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED" ||
    s === "WITHDRAWN" ||
    s.includes("WITHDRAWN") ||
    s.includes("CANCELLED") ||
    s.includes("CANCELED")
  );
}

/** Time in motion: active = application to today; non-active = application to current_status_date (or closing_date or funding_date). */
function timeInMotionDays(
  application_date: string | null,
  current_loan_status: string | null,
  current_status_date: string | null,
  closing_date: string | null,
  funding_date: unknown
): number | null {
  if (!application_date) return null;
  const app = new Date(application_date);
  if (isNaN(app.getTime())) return null;
  const active = isActiveLoan(current_loan_status);
  let end: Date;
  if (active) {
    end = new Date();
  } else {
    const cs = current_status_date ? new Date(current_status_date) : null;
    const cl = closing_date ? new Date(closing_date) : null;
    const fd = funding_date != null ? new Date(funding_date as string) : null;
    if (cs && !isNaN(cs.getTime())) end = cs;
    else if (cl && !isNaN(cl.getTime())) end = cl;
    else if (fd && !isNaN(fd.getTime())) end = fd;
    else return null;
  }
  const days = Math.floor((end.getTime() - app.getTime()) / (1000 * 60 * 60 * 24));
  return days >= 0 && days < 365 * 2 ? days : null;
}

export interface LoanComplexityPivotOptions {
  startDate: string;
  endDate: string;
  channelGroup?: string;
  accessClause?: string;
  accessParams?: unknown[];
  dimensionFilterClause?: string;
}

export interface PivotRowMetrics {
  groupName: string;
  units: number;
  waComplexity: number | null;
  timeInMotionDays: number | null;
  pctByType: Record<string, number>;
  pctByPurpose: Record<string, number>;
  pctLocked: number;
  pctOriginated: number;
  pctDenied: number;
  pctWithdrawn: number;
}

export interface PivotDimensionResult {
  dimension: LoanComplexityGroupBy;
  label: string;
  total: PivotRowMetrics;
  rows: PivotRowMetrics[];
}

export interface LoanComplexityPivotResult {
  dimensions: PivotDimensionResult[];
  loanTypes: string[];
  purposes: string[];
}

export async function getLoanComplexityPivotData(
  tenantPool: pg.Pool,
  options: LoanComplexityPivotOptions
): Promise<LoanComplexityPivotResult> {
  const {
    startDate,
    endDate,
    channelGroup,
    accessClause = "",
    accessParams = [],
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
    conditions.push(accessClause.replace(/^AND\s+/i, "").trim());
    params.push(...accessParams);
  }

  const whereSql =
    conditions.join(" AND ") +
    (dimensionFilterClause ? ` ${dimensionFilterClause}` : "");

  const query = `
    SELECT
      l.loan_id,
      l.loan_amount,
      l.application_date::text AS application_date,
      l.current_status_date::text AS current_status_date,
      l.closing_date::text AS closing_date,
      l.funding_date,
      l.current_loan_status,
      l.lock_date,
      l.loan_type,
      l.loan_purpose,
      l.loan_officer,
      l.branch,
      l.underwriter,
      l.processor,
      l.closer,
      l.fico_score,
      l.ltv_ratio,
      l.be_dti_ratio,
      l.occupancy_type,
      l.borr_self_employed
    FROM public.loans l
    WHERE ${whereSql}
  `;
  const result = await tenantPool.query(query, params);

  const complexityService = new LoanComplexityService(tenantPool);
  await complexityService.loadCustomWeights();

  const loanTypesSet = new Set<string>();
  const purposesSet = new Set<string>();

  type Agg = {
    units: number;
    sumAmount: number;
    sumComplexityAmount: number;
    sumTimeInMotion: number;
    countTimeInMotion: number;
    byType: Record<string, number>;
    byPurpose: Record<string, number>;
    locked: number;
    nonActive: number;
    originated: number;
    denied: number;
    withdrawn: number;
  };

  function emptyAgg(): Agg {
    return {
      units: 0,
      sumAmount: 0,
      sumComplexityAmount: 0,
      sumTimeInMotion: 0,
      countTimeInMotion: 0,
      byType: {},
      byPurpose: {},
      locked: 0,
      nonActive: 0,
      originated: 0,
      denied: 0,
      withdrawn: 0,
    };
  }

  const dimensionMaps: Record<LoanComplexityGroupBy, Map<string, Agg>> = {
    loan_officer: new Map(),
    branch: new Map(),
    underwriter: new Map(),
    closer: new Map(),
    processor: new Map(),
    current_loan_status: new Map(),
  };

  for (const r of result.rows) {
    const loanData = {
      loan_type: r.loan_type,
      loan_purpose: r.loan_purpose,
      loan_amount: r.loan_amount != null ? parseFloat(r.loan_amount) : null,
      fico_score: r.fico_score != null ? parseInt(r.fico_score, 10) : null,
      ltv_ratio: r.ltv_ratio != null ? parseFloat(r.ltv_ratio) : null,
      be_dti_ratio: r.be_dti_ratio != null ? parseFloat(r.be_dti_ratio) : null,
      occupancy_type: r.occupancy_type,
      borr_self_employed: r.borr_self_employed,
    };
    const complexity = complexityService.calculateComplexity(loanData).totalScore;
    const amount = r.loan_amount != null ? parseFloat(r.loan_amount) : 0;
    const days = timeInMotionDays(
      r.application_date,
      r.current_loan_status,
      r.current_status_date,
      r.closing_date,
      r.funding_date
    );
    const locked = r.lock_date != null ? 1 : 0;
    const active = isActiveLoan(r.current_loan_status);
    const nonActive = active ? 0 : 1;
    let orig = 0,
      den = 0,
      wit = 0;
    if (!active) {
      if (isDenied(r.current_loan_status)) den = 1;
      else if (isWithdrawn(r.current_loan_status)) wit = 1;
      else if (isOriginated(r.current_loan_status, r.funding_date)) orig = 1;
    }
    const loanType = (r.loan_type ?? "").trim() || "Unknown";
    const purpose = (r.loan_purpose ?? "").trim() || "Unknown";
    loanTypesSet.add(loanType);
    purposesSet.add(purpose);

    for (const dim of PIVOT_DIMENSION_KEYS) {
      const col = GROUP_BY_COLUMN[dim];
      const groupName = (r[col] ?? "").trim() ? String(r[col]).trim() : "Unknown";
      const map = dimensionMaps[dim];
      if (!map.get(groupName)) map.set(groupName, emptyAgg());
      const agg = map.get(groupName)!;
      agg.units += 1;
      agg.sumAmount += amount;
      agg.sumComplexityAmount += complexity * amount;
      if (days != null) {
        agg.sumTimeInMotion += days;
        agg.countTimeInMotion += 1;
      }
      agg.byType[loanType] = (agg.byType[loanType] ?? 0) + 1;
      agg.byPurpose[purpose] = (agg.byPurpose[purpose] ?? 0) + 1;
      agg.locked += locked;
      agg.nonActive += nonActive;
      agg.originated += orig;
      agg.denied += den;
      agg.withdrawn += wit;
    }
  }

  const loanTypes = Array.from(loanTypesSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const purposes = Array.from(purposesSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  function toRowMetrics(agg: Agg, loanTypesList: string[], purposesList: string[]): PivotRowMetrics {
    const waComplexity =
      agg.sumAmount > 0 ? Math.round((agg.sumComplexityAmount / agg.sumAmount) * 10) / 10 : null;
    const timeInMotionDays =
      agg.countTimeInMotion > 0
        ? Math.round((agg.sumTimeInMotion / agg.countTimeInMotion) * 10) / 10
        : null;
    const pctByType: Record<string, number> = {};
    for (const t of loanTypesList) {
      const n = agg.byType[t] ?? 0;
      pctByType[t] = agg.units > 0 ? Math.round((n / agg.units) * 1000) / 10 : 0;
    }
    const pctByPurpose: Record<string, number> = {};
    for (const p of purposesList) {
      const n = agg.byPurpose[p] ?? 0;
      pctByPurpose[p] = agg.units > 0 ? Math.round((n / agg.units) * 1000) / 10 : 0;
    }
    const pctLocked = agg.units > 0 ? Math.round((agg.locked / agg.units) * 1000) / 10 : 0;
    const denom = agg.nonActive > 0 ? agg.nonActive : 1;
    const pctOriginated = Math.round((agg.originated / denom) * 1000) / 10;
    const pctDenied = Math.round((agg.denied / denom) * 1000) / 10;
    const pctWithdrawn = Math.round((agg.withdrawn / denom) * 1000) / 10;
    return {
      groupName: "",
      units: agg.units,
      waComplexity,
      timeInMotionDays,
      pctByType,
      pctByPurpose,
      pctLocked,
      pctOriginated,
      pctDenied,
      pctWithdrawn,
    };
  }

  const dimensions: PivotDimensionResult[] = [];

  for (const dim of PIVOT_DIMENSION_KEYS) {
    const map = dimensionMaps[dim];
    const totalAgg = emptyAgg();
    const rows: PivotRowMetrics[] = [];
    for (const [groupName, agg] of map.entries()) {
      totalAgg.units += agg.units;
      totalAgg.sumAmount += agg.sumAmount;
      totalAgg.sumComplexityAmount += agg.sumComplexityAmount;
      totalAgg.sumTimeInMotion += agg.sumTimeInMotion;
      totalAgg.countTimeInMotion += agg.countTimeInMotion;
      totalAgg.locked += agg.locked;
      totalAgg.nonActive += agg.nonActive;
      totalAgg.originated += agg.originated;
      totalAgg.denied += agg.denied;
      totalAgg.withdrawn += agg.withdrawn;
      for (const [k, v] of Object.entries(agg.byType)) {
        totalAgg.byType[k] = (totalAgg.byType[k] ?? 0) + v;
      }
      for (const [k, v] of Object.entries(agg.byPurpose)) {
        totalAgg.byPurpose[k] = (totalAgg.byPurpose[k] ?? 0) + v;
      }
      const row = toRowMetrics(agg, loanTypes, purposes);
      row.groupName = groupName;
      rows.push(row);
    }
    const total = toRowMetrics(totalAgg, loanTypes, purposes);
    total.groupName = PIVOT_DIMENSION_LABELS[dim];
    rows.sort((a, b) => a.groupName.localeCompare(b.groupName, undefined, { sensitivity: "base" }));
    dimensions.push({
      dimension: dim,
      label: PIVOT_DIMENSION_LABELS[dim],
      total,
      rows,
    });
  }

  return { dimensions, loanTypes, purposes };
}
