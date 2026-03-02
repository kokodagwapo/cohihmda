/**
 * Pricing Dashboard Service
 * KPIs and report/detail tables for the Pricing Dashboard.
 * Uses lock_date (not investor_lock_date) for lock status. Applies lock status only when loan_status is 'active'.
 */

import pg from "pg";
import {
  getTenantRevenueExpression,
  buildChannelWhereClause,
  buildDimensionFilterWhereClause,
} from "../../utils/scorecard-utils.js";

export type PricingEntityType = "branch" | "broker_lender_name" | "channel" | "investor";
export type PricingActorType = "loan_officer" | "account_executive";
export type PricingDateRange = "all" | "mtd" | "lm" | "qtd" | "ytd" | "ly";
export type PricingLoanFunding = "funded" | "closed";
export type PricingLoanStatus = "all" | "active" | "funded";
export type PricingLockStatus = "locked" | "not_locked" | "total";

export interface PricingDashboardFilters {
  channel?: string | null;
  entityType: PricingEntityType;
  /** When set, entity filter is applied to this column instead of entityType (e.g. filter by Branch 1000 while grouping by Broker Lender Name) */
  entityFilterType?: PricingEntityType;
  entityValue: string;
  actorType: PricingActorType;
  /** When set, actor filter is applied to this column instead of actorType */
  actorFilterType?: PricingActorType;
  actorValue: string;
  dateRange: PricingDateRange;
  loanFunding: PricingLoanFunding;
  loanStatus: PricingLoanStatus;
  lockStatus: PricingLockStatus;
  /** Pre-built SQL fragment from buildDimensionFilterWhereClause (includes leading AND per condition) */
  dimensionFilterClause?: string;
}

export interface PricingKPIs {
  units: number;
  volume: number;
  pipelineMargin: number;
  pricingDollars: number;
  labelPrefix: string;
}

export interface PricingReportRow {
  entityName: string;
  actorName: string;
  units: number;
  volume: number;
  loanPricingDollars: number;
  pricingMargin: number;
  cdLenderCredits: number;
  purchaseAdviceSellAmount: number;
  line800TotalBorrowerPaidAmount: number;
  feesAppraisalFeeBorr: number;
  line800TotalSellerPaidAmount: number;
  feesInterestBorr: number;
  purchaseAdvExpectedIntPymtFromInvestor: number;
  purchaseAdviceExpctdPayout1Amt: number;
  purchaseAdviceExpctdPayout2Amt: number;
  purchaseAdviceExpctdPayout3Amt: number;
  lenderCredits: number;
}

export interface PricingDetailRow {
  entityName: string;
  actorName: string;
  loanNumber: string | null;
  applicationDate: string | null;
  lockExpirationDate: string | null;
  fundingDate: string | null;
  closingDate: string | null;
  currentLoanStatus: string | null;
  volume: number | null;
  loanPricingDollars: number;
  pricingMargin: number;
  cdLenderCredits: number | null;
  purchaseAdviceSellAmount: number | null;
  line800TotalBorrowerPaidAmount: number | null;
  feesAppraisalFeeBorr: number | null;
  line800TotalSellerPaidAmount: number | null;
  feesInterestBorr: number | null;
  purchaseAdvExpectedIntPymtFromInvestor: number | null;
  purchaseAdviceExpctdPayout1Amt: number | null;
  purchaseAdviceExpctdPayout2Amt: number | null;
  purchaseAdviceExpctdPayout3Amt: number | null;
  lenderCredits: number | null;
}

const ENTITY_COLUMN: Record<PricingEntityType, string> = {
  branch: "branch",
  broker_lender_name: "broker_lender_name",
  channel: "channel",
  investor: "investor",
};

const ACTOR_COLUMN: Record<PricingActorType, string> = {
  loan_officer: "loan_officer",
  account_executive: "account_executive",
};

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDateRangeForPricing(
  dateRange: PricingDateRange
): { start: string; end: string } | null {
  if (dateRange === "all") return null;
  const now = new Date();
  const targetYear = now.getFullYear();
  let start: Date;
  let end: Date;

  switch (dateRange) {
    case "mtd":
      // Same as getPeriodRange: [first of month, tomorrow) → application_date < end = through today
      start = new Date(targetYear, now.getMonth(), 1);
      end = new Date(targetYear, now.getMonth(), now.getDate() + 1);
      break;
    case "lm":
      // Last month: [first of last month, first of this month)
      start = new Date(targetYear, now.getMonth() - 1, 1);
      end = new Date(targetYear, now.getMonth(), 1);
      break;
    case "qtd": {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(targetYear, q * 3, 1);
      end = new Date(targetYear, now.getMonth(), now.getDate() + 1);
      break;
    }
    case "ytd":
      start = new Date(targetYear, 0, 1);
      end =
        targetYear === now.getFullYear()
          ? new Date(targetYear, now.getMonth(), now.getDate() + 1)
          : new Date(targetYear + 1, 0, 1);
      break;
    case "ly":
      start = new Date(targetYear - 1, 0, 1);
      end = new Date(targetYear, 0, 1);
      break;
    default:
      start = new Date(targetYear, now.getMonth(), 1);
      end = new Date(targetYear, now.getMonth(), now.getDate() + 1);
  }
  return { start: toLocalDateStr(start), end: toLocalDateStr(end) };
}

/** Lock status applies only when loan_status === 'active'. Uses lock_date (not investor_lock_date). */
function buildLockStatusClause(
  lockStatus: PricingLockStatus,
  tableAlias: string
): string {
  const l = tableAlias ? `${tableAlias}.` : "";
  const hasLock = `(${l}lock_date IS NOT NULL AND ${l}lock_expiration_date IS NOT NULL AND (${l}lock_expiration_date)::date > CURRENT_DATE)`;
  const notLocked = `((${l}lock_date IS NULL OR ${l}lock_expiration_date IS NULL) OR ((${l}lock_expiration_date)::date <= CURRENT_DATE))`;
  switch (lockStatus) {
    case "locked":
      return `AND ${hasLock}`;
    case "not_locked":
      return `AND ${notLocked}`;
    case "total":
      return "";
    default:
      return "";
  }
}

function buildBaseWhere(
  filters: PricingDashboardFilters,
  tableAlias: string,
  params: unknown[],
  startParamIndex: number
): { clause: string; nextIndex: number } {
  const l = tableAlias ? `${tableAlias}.` : "";
  const conditions: string[] = [];
  let idx = startParamIndex;

  const channelClause = buildChannelWhereClause(filters.channel ?? undefined, tableAlias);
  if (channelClause) {
    conditions.push(channelClause.replace(/^\s*AND\s+/i, ""));
  }

  const entityCol = ENTITY_COLUMN[filters.entityFilterType ?? filters.entityType];
  if (filters.entityValue != null && String(filters.entityValue).trim() !== "") {
    conditions.push(`(${l}${entityCol} = $${idx} OR ($${idx}::text = '' AND (${l}${entityCol} IS NULL OR TRIM(COALESCE(${l}${entityCol}, '')) = '')))`);
    params.push(filters.entityValue);
    idx++;
  }

  const actorCol = ACTOR_COLUMN[filters.actorFilterType ?? filters.actorType];
  if (filters.actorValue != null && String(filters.actorValue).trim() !== "") {
    conditions.push(`(${l}${actorCol} = $${idx} OR ($${idx}::text = '' AND (${l}${actorCol} IS NULL OR TRIM(COALESCE(${l}${actorCol}, '')) = '')))`);
    params.push(filters.actorValue);
    idx++;
  }

  // Loan funding filter only applies when loan status is "funded" (not for "active" or "all")
  if (filters.loanStatus === "funded") {
    if (filters.loanFunding === "funded") {
      conditions.push(`${l}funding_date IS NOT NULL`);
    } else {
      conditions.push(`${l}closing_date IS NOT NULL`);
    }
  }

  if (filters.loanStatus === "active") {
    // Match /api/loans/active-loans-count and home page Business Overview exactly
    conditions.push(`(${l}current_loan_status = 'Active Loan')`);
    conditions.push(`(${l}application_date IS NOT NULL AND ${l}application_date::text != '')`);
    conditions.push(`(${l}is_archived IS DISTINCT FROM TRUE)`);
    // Lock status only applies when loan status is active
    const lockClause = buildLockStatusClause(filters.lockStatus, tableAlias).replace(/^\s*AND\s+/, "");
    if (lockClause) conditions.push(lockClause);
  } else if (filters.loanStatus === "funded") {
    conditions.push(`(
      UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) IN ('LOAN ORIGINATED','ORIGINATED','FUNDED','CLOSED','PURCHASED')
      OR UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) LIKE '%ORIGINATED%'
      OR UPPER(TRIM(COALESCE(${l}current_loan_status, ''))) LIKE '%PURCHASED%'
      OR ${l}funding_date IS NOT NULL
    )`);
  }

  const dateRange = getDateRangeForPricing(filters.dateRange);
  if (dateRange && filters.dateRange !== "all") {
    // Use same convention as /api/loans/active-loans-count and getPeriodRange: [start, end) exclusive end
    // Active loans: no funding_date → always application_date.
    // All statuses: application_date so we include all statuses.
    // Funded only: use loan_funding — funding_date or closing_date.
    const dateCol =
      filters.loanStatus === "active" || filters.loanStatus === "all"
        ? "application_date"
        : filters.loanFunding === "funded"
          ? "funding_date"
          : "closing_date";
    conditions.push(`(${l}${dateCol})::date >= $${idx}::date`);
    params.push(dateRange.start);
    idx++;
    conditions.push(`(${l}${dateCol})::date < $${idx}::date`);
    params.push(dateRange.end);
    idx++;
  }

  const dimFilter = filters.dimensionFilterClause || '';
  let clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  if (dimFilter) {
    clause = clause
      ? `${clause} ${dimFilter}`
      : `WHERE ${dimFilter.replace(/^\s*AND\s+/i, '')}`;
  }
  return { clause, nextIndex: idx };
}

function getLabelPrefix(filters: PricingDashboardFilters): string {
  if (filters.loanStatus === "active") {
    switch (filters.lockStatus) {
      case "locked":
        return "Active Locked";
      case "not_locked":
        return "Active Not Locked";
      case "total":
        return "Active Total";
      default:
        return "Active Total";
    }
  }
  if (filters.loanStatus === "funded") return "Funded";
  return "All";
}

export async function getPricingKPIs(
  tenantPool: pg.Pool,
  filters: PricingDashboardFilters
): Promise<PricingKPIs> {
  const labelPrefix = getLabelPrefix(filters);
  const revenueExpr = await getTenantRevenueExpression(tenantPool, "l");
  const params: unknown[] = [];
  const { clause: whereClause } = buildBaseWhere(filters, "l", params, 1);

  const sql = `
    WITH base AS (
      SELECT
        l.loan_amount,
        (${revenueExpr}) AS revenue
      FROM public.loans l
      ${whereClause}
    )
    SELECT
      COUNT(*)::int AS units,
      COALESCE(SUM(loan_amount), 0)::double precision AS volume,
      (CASE WHEN SUM(loan_amount) IS NOT NULL AND SUM(loan_amount) <> 0
        THEN (SUM(revenue) / NULLIF(SUM(loan_amount), 0)) * 100
        ELSE NULL END)::double precision AS pipeline_margin,
      COALESCE(SUM(revenue), 0)::double precision AS pricing_dollars
    FROM base
  `;

  const result = await tenantPool.query(sql, params);
  const row = result.rows[0] || {};
  return {
    units: Number(row.units) || 0,
    volume: Number(row.volume) || 0,
    pipelineMargin: row.pipeline_margin != null ? Number(row.pipeline_margin) : 0,
    pricingDollars: Number(row.pricing_dollars) || 0,
    labelPrefix,
  };
}

export async function getPricingReport(
  tenantPool: pg.Pool,
  filters: PricingDashboardFilters,
  options: { isEntityDetail: boolean }
): Promise<{ rows: PricingReportRow[]; totals: Partial<PricingReportRow> }> {
  const revenueExpr = await getTenantRevenueExpression(tenantPool, "l");
  const entityCol = ENTITY_COLUMN[filters.entityType];
  const actorCol = ACTOR_COLUMN[filters.actorType];
  const params: unknown[] = [];
  const { clause: whereClause } = buildBaseWhere(filters, "l", params, 1);

  const isBranchReport = options.isEntityDetail && filters.entityType === "branch";
  const groupByCols = isBranchReport ? `l.${entityCol}` : `l.${entityCol}, l.${actorCol}`;
  const selectCols = isBranchReport
    ? `
    COALESCE(l.${entityCol}, '') AS entity_name,
    '' AS actor_name,
    COUNT(*)::int AS units,
    COALESCE(SUM(l.loan_amount), 0)::double precision AS volume,
    COALESCE(SUM((${revenueExpr})), 0)::double precision AS loan_pricing_dollars,
    (CASE WHEN SUM(l.loan_amount) IS NOT NULL AND SUM(l.loan_amount) <> 0
      THEN (SUM((${revenueExpr})) / NULLIF(SUM(l.loan_amount), 0)) * 100
      ELSE NULL END)::double precision AS pricing_margin,
    COALESCE(SUM(l.cd_lender_credits), 0)::double precision AS cd_lender_credits,
    COALESCE(SUM(l.pa_sell_amt), 0)::double precision AS purchase_advice_sell_amount,
    COALESCE(SUM(l.line_800_total_borrower_paid_amount), 0)::double precision AS line_800_total_borrower_paid_amount,
    COALESCE(SUM(l.fee_details_line_804_borrower_amount_appraisal_fee), 0)::double precision AS fees_appraisal_fee_borr,
    COALESCE(SUM(l.line_800_total_seller_paid_amount), 0)::double precision AS line_800_total_seller_paid_amount,
    COALESCE(SUM(l.fees_interest_borr), 0)::double precision AS fees_interest_borr,
    COALESCE(SUM(l.purchase_adv_expected_int_pymt_from_investor), 0)::double precision AS purchase_adv_expected_int_pymt_from_investor,
    COALESCE(SUM(l.pa_payout_1), 0)::double precision AS purchase_advice_expctd_payout_1_amt,
    COALESCE(SUM(l.pa_payout_2), 0)::double precision AS purchase_advice_expctd_payout_2_amt,
    COALESCE(SUM(l.pa_payout_3), 0)::double precision AS purchase_advice_expctd_payout_3_amt,
    COALESCE(SUM(l.lender_credits), 0)::double precision AS lender_credits
  `
    : `
    COALESCE(l.${entityCol}, '') AS entity_name,
    COALESCE(l.${actorCol}, '') AS actor_name,
    COUNT(*)::int AS units,
    COALESCE(SUM(l.loan_amount), 0)::double precision AS volume,
    COALESCE(SUM((${revenueExpr})), 0)::double precision AS loan_pricing_dollars,
    (CASE WHEN SUM(l.loan_amount) IS NOT NULL AND SUM(l.loan_amount) <> 0
      THEN (SUM((${revenueExpr})) / NULLIF(SUM(l.loan_amount), 0)) * 100
      ELSE NULL END)::double precision AS pricing_margin,
    COALESCE(SUM(l.cd_lender_credits), 0)::double precision AS cd_lender_credits,
    COALESCE(SUM(l.pa_sell_amt), 0)::double precision AS purchase_advice_sell_amount,
    COALESCE(SUM(l.line_800_total_borrower_paid_amount), 0)::double precision AS line_800_total_borrower_paid_amount,
    COALESCE(SUM(l.fee_details_line_804_borrower_amount_appraisal_fee), 0)::double precision AS fees_appraisal_fee_borr,
    COALESCE(SUM(l.line_800_total_seller_paid_amount), 0)::double precision AS line_800_total_seller_paid_amount,
    COALESCE(SUM(l.fees_interest_borr), 0)::double precision AS fees_interest_borr,
    COALESCE(SUM(l.purchase_adv_expected_int_pymt_from_investor), 0)::double precision AS purchase_adv_expected_int_pymt_from_investor,
    COALESCE(SUM(l.pa_payout_1), 0)::double precision AS purchase_advice_expctd_payout_1_amt,
    COALESCE(SUM(l.pa_payout_2), 0)::double precision AS purchase_advice_expctd_payout_2_amt,
    COALESCE(SUM(l.pa_payout_3), 0)::double precision AS purchase_advice_expctd_payout_3_amt,
    COALESCE(SUM(l.lender_credits), 0)::double precision AS lender_credits
  `;

  const orderBy = isBranchReport ? `entity_name` : `entity_name, actor_name`;
  const sql = `
    SELECT ${selectCols}
    FROM public.loans l
    ${whereClause}
    GROUP BY ${groupByCols}
    ORDER BY ${orderBy}
  `;

  const result = await tenantPool.query(sql, params);
  const rows: PricingReportRow[] = (result.rows || []).map((r: Record<string, unknown>) => ({
    entityName: String(r.entity_name ?? ""),
    actorName: String(r.actor_name ?? ""),
    units: Number(r.units) ?? 0,
    volume: Number(r.volume) ?? 0,
    loanPricingDollars: Number(r.loan_pricing_dollars) ?? 0,
    pricingMargin: Number(r.pricing_margin) ?? 0,
    cdLenderCredits: Number(r.cd_lender_credits) ?? 0,
    purchaseAdviceSellAmount: Number(r.purchase_advice_sell_amount) ?? 0,
    line800TotalBorrowerPaidAmount: Number(r.line_800_total_borrower_paid_amount) ?? 0,
    feesAppraisalFeeBorr: Number(r.fees_appraisal_fee_borr) ?? 0,
    line800TotalSellerPaidAmount: Number(r.line_800_total_seller_paid_amount) ?? 0,
    feesInterestBorr: Number(r.fees_interest_borr) ?? 0,
    purchaseAdvExpectedIntPymtFromInvestor: Number(r.purchase_adv_expected_int_pymt_from_investor) ?? 0,
    purchaseAdviceExpctdPayout1Amt: Number(r.purchase_advice_expctd_payout_1_amt) ?? 0,
    purchaseAdviceExpctdPayout2Amt: Number(r.purchase_advice_expctd_payout_2_amt) ?? 0,
    purchaseAdviceExpctdPayout3Amt: Number(r.purchase_advice_expctd_payout_3_amt) ?? 0,
    lenderCredits: Number(r.lender_credits) ?? 0,
  }));

  const totals: Partial<PricingReportRow> = rows.length
    ? {
        units: rows.reduce((s, r) => s + r.units, 0),
        volume: rows.reduce((s, r) => s + r.volume, 0),
        loanPricingDollars: rows.reduce((s, r) => s + r.loanPricingDollars, 0),
        pricingMargin:
          rows.reduce((s, r) => s + r.volume, 0) > 0
            ? (rows.reduce((s, r) => s + r.loanPricingDollars, 0) / rows.reduce((s, r) => s + r.volume, 0)) * 100
            : 0,
        cdLenderCredits: rows.reduce((s, r) => s + r.cdLenderCredits, 0),
        purchaseAdviceSellAmount: rows.reduce((s, r) => s + r.purchaseAdviceSellAmount, 0),
        line800TotalBorrowerPaidAmount: rows.reduce((s, r) => s + r.line800TotalBorrowerPaidAmount, 0),
        feesAppraisalFeeBorr: rows.reduce((s, r) => s + r.feesAppraisalFeeBorr, 0),
        line800TotalSellerPaidAmount: rows.reduce((s, r) => s + r.line800TotalSellerPaidAmount, 0),
        feesInterestBorr: rows.reduce((s, r) => s + r.feesInterestBorr, 0),
        purchaseAdvExpectedIntPymtFromInvestor: rows.reduce((s, r) => s + r.purchaseAdvExpectedIntPymtFromInvestor, 0),
        purchaseAdviceExpctdPayout1Amt: rows.reduce((s, r) => s + r.purchaseAdviceExpctdPayout1Amt, 0),
        purchaseAdviceExpctdPayout2Amt: rows.reduce((s, r) => s + r.purchaseAdviceExpctdPayout2Amt, 0),
        purchaseAdviceExpctdPayout3Amt: rows.reduce((s, r) => s + r.purchaseAdviceExpctdPayout3Amt, 0),
        lenderCredits: rows.reduce((s, r) => s + r.lenderCredits, 0),
      }
    : {};

  return { rows, totals };
}

export async function getPricingDetail(
  tenantPool: pg.Pool,
  filters: PricingDashboardFilters,
  options: { isEntityDetail: boolean }
): Promise<{ rows: PricingDetailRow[]; totals: Partial<PricingDetailRow> }> {
  const revenueExpr = await getTenantRevenueExpression(tenantPool, "l");
  const entityCol = ENTITY_COLUMN[filters.entityType];
  const actorCol = ACTOR_COLUMN[filters.actorType];
  const params: unknown[] = [];
  const { clause: whereClause } = buildBaseWhere(filters, "l", params, 1);

  const includeActor = !options.isEntityDetail;

  const sql = `
    SELECT
      COALESCE(l.${entityCol}, '') AS entity_name,
      ${includeActor ? `COALESCE(l.${actorCol}, '') AS actor_name,` : `'' AS actor_name,`}
      l.loan_number,
      l.application_date::text,
      l.lock_expiration_date::text,
      l.funding_date::text AS funding_date,
      l.closing_date::text AS closing_date,
      l.current_loan_status::text AS current_loan_status,
      l.loan_amount AS volume,
      (${revenueExpr}) AS loan_pricing_dollars,
      (CASE WHEN l.loan_amount IS NOT NULL AND l.loan_amount <> 0
        THEN ((${revenueExpr}) / NULLIF(l.loan_amount, 0)) * 100
        ELSE NULL END)::double precision AS pricing_margin,
      l.cd_lender_credits,
      l.pa_sell_amt,
      l.line_800_total_borrower_paid_amount,
      l.fee_details_line_804_borrower_amount_appraisal_fee AS fees_appraisal_fee_borr,
      l.line_800_total_seller_paid_amount,
      l.fees_interest_borr,
      l.purchase_adv_expected_int_pymt_from_investor,
      l.pa_payout_1,
      l.pa_payout_2,
      l.pa_payout_3,
      l.lender_credits
    FROM public.loans l
    ${whereClause}
    ORDER BY l.${entityCol}, ${includeActor ? `l.${actorCol},` : ""} l.loan_id
  `;

  const result = await tenantPool.query(sql, params);
  const rows: PricingDetailRow[] = (result.rows || []).map((r: Record<string, unknown>) => ({
    entityName: String(r.entity_name ?? ""),
    actorName: String(r.actor_name ?? ""),
    loanNumber: r.loan_number != null ? String(r.loan_number) : null,
    applicationDate: r.application_date != null ? String(r.application_date) : null,
    lockExpirationDate: r.lock_expiration_date != null ? String(r.lock_expiration_date) : null,
    fundingDate: r.funding_date != null ? String(r.funding_date) : null,
    closingDate: r.closing_date != null ? String(r.closing_date) : null,
    currentLoanStatus: r.current_loan_status != null ? String(r.current_loan_status) : null,
    volume: r.volume != null ? Number(r.volume) : null,
    loanPricingDollars: Number(r.loan_pricing_dollars) ?? 0,
    pricingMargin: Number(r.pricing_margin) ?? 0,
    cdLenderCredits: r.cd_lender_credits != null ? Number(r.cd_lender_credits) : null,
    purchaseAdviceSellAmount: r.pa_sell_amt != null ? Number(r.pa_sell_amt) : null,
    line800TotalBorrowerPaidAmount: r.line_800_total_borrower_paid_amount != null ? Number(r.line_800_total_borrower_paid_amount) : null,
    feesAppraisalFeeBorr: r.fees_appraisal_fee_borr != null ? Number(r.fees_appraisal_fee_borr) : null,
    line800TotalSellerPaidAmount: r.line_800_total_seller_paid_amount != null ? Number(r.line_800_total_seller_paid_amount) : null,
    feesInterestBorr: r.fees_interest_borr != null ? Number(r.fees_interest_borr) : null,
    purchaseAdvExpectedIntPymtFromInvestor: r.purchase_adv_expected_int_pymt_from_investor != null ? Number(r.purchase_adv_expected_int_pymt_from_investor) : null,
    purchaseAdviceExpctdPayout1Amt: r.pa_payout_1 != null ? Number(r.pa_payout_1) : null,
    purchaseAdviceExpctdPayout2Amt: r.pa_payout_2 != null ? Number(r.pa_payout_2) : null,
    purchaseAdviceExpctdPayout3Amt: r.pa_payout_3 != null ? Number(r.pa_payout_3) : null,
    lenderCredits: r.lender_credits != null ? Number(r.lender_credits) : null,
  }));

  const sumVolume = rows.reduce((s, r) => s + (r.volume ?? 0), 0);
  const sumPricing = rows.reduce((s, r) => s + r.loanPricingDollars, 0);
  const totals: Partial<PricingDetailRow> = {
    volume: sumVolume,
    loanPricingDollars: sumPricing,
    pricingMargin: sumVolume > 0 ? (sumPricing / sumVolume) * 100 : 0,
    cdLenderCredits: rows.reduce((s, r) => s + (r.cdLenderCredits ?? 0), 0),
    purchaseAdviceSellAmount: rows.reduce((s, r) => s + (r.purchaseAdviceSellAmount ?? 0), 0),
    line800TotalBorrowerPaidAmount: rows.reduce((s, r) => s + (r.line800TotalBorrowerPaidAmount ?? 0), 0),
    feesAppraisalFeeBorr: rows.reduce((s, r) => s + (r.feesAppraisalFeeBorr ?? 0), 0),
    line800TotalSellerPaidAmount: rows.reduce((s, r) => s + (r.line800TotalSellerPaidAmount ?? 0), 0),
    feesInterestBorr: rows.reduce((s, r) => s + (r.feesInterestBorr ?? 0), 0),
    purchaseAdvExpectedIntPymtFromInvestor: rows.reduce((s, r) => s + (r.purchaseAdvExpectedIntPymtFromInvestor ?? 0), 0),
    purchaseAdviceExpctdPayout1Amt: rows.reduce((s, r) => s + (r.purchaseAdviceExpctdPayout1Amt ?? 0), 0),
    purchaseAdviceExpctdPayout2Amt: rows.reduce((s, r) => s + (r.purchaseAdviceExpctdPayout2Amt ?? 0), 0),
    purchaseAdviceExpctdPayout3Amt: rows.reduce((s, r) => s + (r.purchaseAdviceExpctdPayout3Amt ?? 0), 0),
    lenderCredits: rows.reduce((s, r) => s + (r.lenderCredits ?? 0), 0),
  };

  return { rows, totals };
}

export async function getPricingEntityOptions(
  tenantPool: pg.Pool,
  entityType: PricingEntityType,
  channel: string | null | undefined
): Promise<{ value: string; label: string }[]> {
  const col = ENTITY_COLUMN[entityType];
  const channelClause = buildChannelWhereClause(channel ?? undefined, "l");
  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (channelClause) {
    whereParts.push(channelClause.replace(/^\s*AND\s+/i, ""));
  }
  whereParts.push(`(${col} IS NOT NULL AND TRIM(COALESCE(${col}, '')) != '')`);
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const sql = `
    SELECT DISTINCT ${col} AS value
    FROM public.loans l
    ${whereSql}
    ORDER BY value
  `;
  const result = await tenantPool.query(sql, params);
  return (result.rows || []).map((r: Record<string, unknown>) => ({
    value: String(r.value ?? ""),
    label: String(r.value ?? ""),
  }));
}

export async function getPricingActorOptions(
  tenantPool: pg.Pool,
  actorType: PricingActorType,
  channel: string | null | undefined
): Promise<{ value: string; label: string }[]> {
  const col = ACTOR_COLUMN[actorType];
  const channelClause = buildChannelWhereClause(channel ?? undefined, "l");
  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (channelClause) {
    whereParts.push(channelClause.replace(/^\s*AND\s+/i, ""));
  }
  whereParts.push(`(${col} IS NOT NULL AND TRIM(COALESCE(${col}, '')) != '')`);
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const sql = `
    SELECT DISTINCT ${col} AS value
    FROM public.loans l
    ${whereSql}
    ORDER BY value
  `;
  const result = await tenantPool.query(sql, params);
  return (result.rows || []).map((r: Record<string, unknown>) => ({
    value: String(r.value ?? ""),
    label: String(r.value ?? ""),
  }));
}
