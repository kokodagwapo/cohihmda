/**
 * Scorecard Utilities
 * Shared helper functions and configurations for TopTiering, Sales Scorecard,
 * and Operations Scorecard endpoints.
 *
 * Extracted from loans.ts to reduce duplication and ensure consistency.
 */

import pg from "pg";

// ============================================================================
// Actor Missing Detection
// ============================================================================

/**
 * Mode for actor missing detection:
 * - 'strict': Only matches '99-Missing' (used by Operations Scorecard per Qlik)
 * - 'extended': Matches all placeholder values (used by Sales Scorecard, TopTiering)
 */
export type ActorMissingMode = "strict" | "extended";

/**
 * Check if an actor name represents a missing/placeholder value.
 *
 * Qlik Logic References:
 * - Operations: If([Processor] = '99-Missing',1,0) as [Processor Missing]
 * - Sales: [Loan Officer Missing] = If([Loan Officer] = '99-Missing' OR IsNull([Loan Officer]) Or [Loan Officer]='No LO Found',1,0)
 *
 * @param name - The actor name to check
 * @param mode - Detection mode ('strict' for ops, 'extended' for sales)
 * @returns true if the actor name represents a missing/placeholder value
 */
export const isActorMissing = (
  name: string | null | undefined,
  mode: ActorMissingMode = "extended"
): boolean => {
  if (!name || name.trim() === "") return true;
  const normalized = name.toUpperCase().trim();

  // Strict mode: Only '99-Missing' (Qlik Operations Scorecard)
  if (mode === "strict") {
    return normalized === "99-MISSING";
  }

  // Extended mode: All placeholder values (Sales Scorecard, TopTiering)
  return (
    normalized === "99-MISSING" ||
    normalized === "MISSING" ||
    normalized === "NO LO FOUND" ||
    normalized === "NO LOAN OFFICER" ||
    normalized === "NO BRANCH FOUND" ||
    normalized === "UNKNOWN" ||
    normalized.startsWith("99-")
  );
};

/**
 * SQL WHERE clause fragment to exclude missing actors.
 * Use in queries to filter out placeholder values at the database level.
 *
 * @param actorColumn - The column name (e.g., 'processor', 'loan_officer')
 * @param mode - Detection mode
 * @returns SQL fragment for WHERE clause
 */
export const buildActorNotMissingClause = (
  actorColumn: string,
  mode: ActorMissingMode = "extended"
): string => {
  const baseClause = `${actorColumn} IS NOT NULL AND TRIM(${actorColumn}) != ''`;

  if (mode === "strict") {
    return `${baseClause} AND UPPER(TRIM(${actorColumn})) != '99-MISSING'`;
  }

  // Extended mode - exclude all placeholder values
  return `${baseClause} 
    AND UPPER(TRIM(${actorColumn})) NOT IN ('99-MISSING', 'MISSING', 'NO LO FOUND', 'NO LOAN OFFICER', 'NO BRANCH FOUND', 'UNKNOWN')
    AND UPPER(TRIM(${actorColumn})) NOT LIKE '99-%'`;
};

// ============================================================================
// Actor Configuration
// ============================================================================

/**
 * Configuration for actor-based scorecard calculations.
 * Defines which columns to use for output dates and turn time calculations.
 */
export interface ActorConfig {
  /** Column name for the actor (e.g., 'processor', 'underwriter', 'loan_officer') */
  actorColumn: string;
  /** Date field used for output/unit counting */
  outputDateField: string;
  /** Date field marking the start of the actor's work */
  turnTimeStartField: string;
  /** Date field marking the end of the actor's work (usually same as outputDateField) */
  turnTimeEndField: string;
}

/**
 * Operations Scorecard actor configurations.
 */
export const OPERATIONS_ACTOR_CONFIGS: Record<string, ActorConfig> = {
  processor: {
    actorColumn: "processor",
    outputDateField: "approval_date",
    // Turn Time: Try processing_date → approval_date (if submitted_to_processing_date is empty)
    turnTimeStartField: "processing_date",
    turnTimeEndField: "approval_date",
  },
  underwriter: {
    actorColumn: "underwriter",
    outputDateField: "closing_date",
    // ORIGINAL CONFIG - was working before
    turnTimeStartField: "approval_date",
    turnTimeEndField: "closing_date",
  },
  closer: {
    actorColumn: "closer",
    outputDateField: "disbursement_date",
    turnTimeStartField: "closing_date",
    turnTimeEndField: "disbursement_date",
  },
};

/**
 * Sales Scorecard actor configurations.
 */
export const SALES_ACTOR_CONFIGS: Record<
  string,
  { actorColumn: string; idColumn?: string }
> = {
  branch: { actorColumn: "branch" },
  loan_officer: { actorColumn: "loan_officer", idColumn: "loan_officer_id" },
};

// ============================================================================
// Channel Filtering
// ============================================================================

/**
 * Consolidated channel groups matching Qlik's [Consolidated Channels] field.
 */
export type ChannelGroup = "Retail" | "TPO" | "99-Missing" | "Other" | "All";

/**
 * Filter a channel value by channel group (for JavaScript filtering).
 *
 * @param channel - The channel value from the loan
 * @param channelGroup - The channel group to filter by
 * @returns true if the channel matches the group
 */
export const filterByChannel = (
  channel: string | null | undefined,
  channelGroup: string | undefined
): boolean => {
  if (!channelGroup || channelGroup === "All") return true;
  const ch = (channel || "").toLowerCase();

  switch (channelGroup) {
    case "Retail":
      return ch.includes("retail") || ch.includes("brok");
    case "TPO":
      return ch.includes("whole") || ch.includes("corresp");
    case "99-Missing":
      return !ch || ch.trim() === "";
    case "Other":
      return (
        ch.trim() !== "" &&
        !ch.includes("retail") &&
        !ch.includes("brok") &&
        !ch.includes("whole") &&
        !ch.includes("corresp")
      );
    default:
      return true;
  }
};

/**
 * Build SQL WHERE clause fragment for channel filtering.
 * Use this for efficient database-level filtering.
 *
 * @param channelGroup - The channel group to filter by
 * @returns SQL fragment to add to WHERE clause (includes leading AND)
 */
export const buildChannelWhereClause = (
  channelGroup: string | undefined
): string => {
  if (!channelGroup || channelGroup === "All") return "";

  switch (channelGroup) {
    case "Retail":
      return `AND (channel ILIKE '%retail%' OR channel ILIKE '%brokered%' OR channel ILIKE '%brok%')`;
    case "TPO":
      return `AND (channel ILIKE '%wholesale%' OR channel ILIKE '%correspondent%' OR channel ILIKE '%corresp%')`;
    case "99-Missing":
      return `AND (channel IS NULL OR TRIM(channel) = '')`;
    case "Other":
      return `AND channel IS NOT NULL AND TRIM(channel) != '' 
              AND channel NOT ILIKE '%retail%' AND channel NOT ILIKE '%brok%'
              AND channel NOT ILIKE '%wholesale%' AND channel NOT ILIKE '%corresp%'`;
    default:
      return "";
  }
};

// ============================================================================
// Revenue Calculation
// ============================================================================

/**
 * Loan data required for revenue calculation.
 */
export interface LoanRevenueData {
  rate_lock_buy_side_base_price_rate?: number | null;
  loan_amount?: number | null;
  orig_fee_borr_pd?: number | null;
  orig_fees_seller?: number | null;
  cd_lender_credits?: number | null;
}

/**
 * Calculate loan revenue using Qlik's formula.
 *
 * Qlik Formula (Transform.qvs line 549):
 *   Revenue = [Base Buy ($)] + [Orig Fee Borr Pd] + [Orig Fees Seller] - [CD Lender Credits]
 *   [Base Buy ($)] = ((Base Buy - 100) / 100) * Loan Amount
 *
 * Where Base Buy is rate_lock_buy_side_base_price_rate stored as basis points
 * (100 = par/0%, 101 = 1% premium, 99 = 1% discount)
 *
 * @param loan - Loan data with revenue-related fields
 * @returns Calculated revenue in dollars
 */
export const calcLoanRevenue = (loan: LoanRevenueData): number => {
  // Parse values to numbers - PostgreSQL can return strings for NUMERIC types
  const baseBuyRate = parseFloat(
    String(loan.rate_lock_buy_side_base_price_rate ?? "")
  );
  const loanAmount = parseFloat(String(loan.loan_amount ?? "")) || 0;

  // Base Buy calculation: ((rate - 100) / 100) * loan_amount
  // baseBuyRate is stored as percentage (e.g., 101 = 1% premium over par)
  const baseBuy =
    !isNaN(baseBuyRate) && baseBuyRate !== 0 && loanAmount > 0
      ? ((baseBuyRate - 100) / 100) * loanAmount
      : 0;

  // Parse fee fields - ensure we get valid numbers
  const origFeeBorr = parseFloat(String(loan.orig_fee_borr_pd ?? "")) || 0;
  const origFeesSeller = parseFloat(String(loan.orig_fees_seller ?? "")) || 0;
  const lenderCredits = parseFloat(String(loan.cd_lender_credits ?? "")) || 0;

  const revenue = baseBuy + origFeeBorr + origFeesSeller - lenderCredits;

  // Guard against NaN - return 0 if calculation resulted in NaN
  return isNaN(revenue) ? 0 : revenue;
};

/**
 * SQL expression for revenue calculation.
 * Use in SELECT clauses for database-level computation.
 */
export const REVENUE_SQL_EXPRESSION = `
  COALESCE(
    CASE 
      WHEN rate_lock_buy_side_base_price_rate IS NOT NULL AND rate_lock_buy_side_base_price_rate != 0 
      THEN ROUND(((rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * loan_amount, 2)
      ELSE 0 
    END, 0) +
  COALESCE(orig_fee_borr_pd, 0) + 
  COALESCE(orig_fees_seller, 0) - 
  COALESCE(cd_lender_credits, 0)
`;

// ============================================================================
// Date Range Utilities
// ============================================================================

/**
 * Get the vMaxDate (maximum data date) from the database.
 * This matches Qlik's Max("Last Modified Date") calculation.
 *
 * @param pool - Database connection pool
 * @returns The maximum date in the data
 */
export const getVMaxDate = async (pool: pg.Pool): Promise<Date> => {
  const result = await pool.query(`
    SELECT COALESCE(
      MAX(last_modified_date),
      MAX(funding_date),
      MAX(application_date),
      CURRENT_DATE
    ) as max_date
    FROM public.loans
    WHERE funding_date IS NOT NULL OR last_modified_date IS NOT NULL
  `);
  return result.rows[0]?.max_date
    ? new Date(result.rows[0].max_date)
    : new Date();
};

/**
 * Calculate the start date for a rolling month window.
 * Matches Qlik's Rolling13MonthFlag calculation.
 *
 * @param maxDate - The end date (vMaxDate)
 * @param monthsBack - Number of months to go back
 * @returns Start date for the rolling window
 */
export const calculateRollingStartDate = (
  maxDate: Date,
  monthsBack: number
): Date => {
  const startDate = new Date(maxDate);
  // Go back to first day of month, then subtract months
  startDate.setDate(1);
  startDate.setMonth(startDate.getMonth() - monthsBack + 1);
  return startDate;
};

/**
 * Format a date as YYYY-MM-DD for SQL queries.
 */
export const formatDateForSQL = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

/**
 * Format a date as YYYY-MM for monthly grouping.
 */
export const formatMonthKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

// ============================================================================
// TTS Score Calculation
// ============================================================================

/**
 * TTS (Top Tier Score) tier thresholds.
 * From Qlik Dimensions.csv "13 Month TVI Score Tiers":
 *   If(Avg(TVI_Score) >= 120, 'Top Tier',
 *   If(Avg(TVI_Score) >= 80, 'Second Tier', 'Bottom Tier'))
 */
export const TTS_TIER_THRESHOLDS = {
  TOP: 120,
  SECOND: 80,
} as const;

export type TTSTier = "top" | "second" | "bottom";

/**
 * Assign a tier based on TTS score.
 *
 * @param ttsScore - The calculated TTS score
 * @returns The tier assignment
 */
export const assignTTSTier = (ttsScore: number): TTSTier => {
  if (ttsScore >= TTS_TIER_THRESHOLDS.TOP) return "top";
  if (ttsScore >= TTS_TIER_THRESHOLDS.SECOND) return "second";
  return "bottom";
};

/**
 * Operations Scorecard TTS weights.
 * From Qlik Script.csv lines 2314-2316.
 */
export const OPS_TTS_WEIGHTS = {
  units: 0.7,
  turnTime: 0.15,
  complexity: 0.15,
} as const;

/**
 * Sales Scorecard TTS weights.
 * All components weighted equally at 20% each (6 components = 120% total, normalized).
 */
export const SALES_TTS_WEIGHTS = {
  volume: 0.2,
  margin: 0.2,
  unit: 0.2,
  pullThrough: 0.2,
  turnTime: 0.2,
  concession: 0.2,
} as const;

// ============================================================================
// Loan Complexity Calculation
// ============================================================================

/**
 * Loan data required for complexity calculation.
 */
export interface LoanComplexityData {
  loan_type?: string | null;
  loan_purpose?: string | null;
  fico_score?: number | null;
  ltv_ratio?: number | null;
  be_dti_ratio?: number | null;
  occupancy_type?: string | null;
  borr_self_employed?: boolean | string | null;
}

/**
 * Calculate loan complexity score.
 * Based on Qlik's Transform.qvs Loan Complexity Score calculation.
 *
 * Factors:
 * - Government loans (FHA, VA, USDA) = more complex
 * - Purchase transactions = more complex than refinance
 * - Low FICO, High LTV, High DTI = more complex
 * - Non-owner occupied = more complex
 * - Self-employed borrower = more complex
 *
 * @param loan - Loan data for complexity calculation
 * @returns Complexity score (100 = baseline, >100 = higher complexity)
 */
export const calcLoanComplexity = (loan: LoanComplexityData): number => {
  let complexity = 100; // Baseline

  // Government loan: +10
  const loanType = (loan.loan_type || "").toUpperCase();
  if (
    ["FHA", "VA", "USDA", "FARMERSHOMEA", "FARMERSHOMEADMINISTRATION"].includes(
      loanType
    )
  ) {
    complexity += 10;
  }

  // Purchase: +5
  const loanPurpose = (loan.loan_purpose || "").toUpperCase();
  if (loanPurpose === "PURCHASE") {
    complexity += 5;
  }

  // Low FICO (< 680): +10
  if (loan.fico_score && loan.fico_score < 680) {
    complexity += 10;
  }

  // High LTV (> 80): +5
  if (loan.ltv_ratio && loan.ltv_ratio > 80) {
    complexity += 5;
  }

  // High DTI (> 43): +5
  if (loan.be_dti_ratio && loan.be_dti_ratio > 43) {
    complexity += 5;
  }

  // Non-owner occupied: +5
  const occupancy = (loan.occupancy_type || "").toUpperCase();
  if (
    occupancy &&
    !occupancy.includes("PRIMARY") &&
    !occupancy.includes("OWNER")
  ) {
    complexity += 5;
  }

  // Self-employed: +5
  const selfEmployed = loan.borr_self_employed;
  if (
    selfEmployed === true ||
    selfEmployed === "Y" ||
    selfEmployed === "Yes" ||
    selfEmployed === "1"
  ) {
    complexity += 5;
  }

  return complexity;
};

// ============================================================================
// Weighted Average Calculations
// ============================================================================

/**
 * Out-of-range thresholds for weighted average calculations.
 * From Qlik Script Additions Ranges.qvs.
 */
export const WA_THRESHOLDS = {
  fico: { min: 350, max: 900 },
  ltv: { min: 0, max: 110 },
  dti: { min: 0, max: 70 },
  interestRate: { min: 0, max: 15 },
} as const;

/**
 * Check if a value is within valid range for weighted average.
 */
export const isValidForWA = (
  value: number | null | undefined,
  type: keyof typeof WA_THRESHOLDS
): boolean => {
  if (value == null) return false;
  const { min, max } = WA_THRESHOLDS[type];
  return value >= min && value <= max;
};
