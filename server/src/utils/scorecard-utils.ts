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
  mode: ActorMissingMode = "extended",
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
  mode: ActorMissingMode = "extended",
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
    outputDateField: "submitted_to_underwriting_date",
    // Turn Time: processing_date → submitted_to_underwriting_date
    turnTimeStartField: "processing_date",
    turnTimeEndField: "submitted_to_underwriting_date",
  },
  underwriter: {
    actorColumn: "underwriter",
    outputDateField: "closing_date",
    // Turn Time: submitted_to_underwriting_date → closing_date
    turnTimeStartField: "submitted_to_underwriting_date",
    turnTimeEndField: "closing_date",
  },
  closer: {
    actorColumn: "closer",
    // NOTE: Using funding_date instead of disbursement_date since disbursement_date
    // is not mapped in defaultEncompassFieldMappings (no Encompass field for it)
    outputDateField: "funding_date",
    // Turn Time: closing_date → funding_date
    turnTimeStartField: "closing_date",
    turnTimeEndField: "funding_date",
  },
};

/**
 * Load Operations Scorecard actor config from tenant DB.
 * Falls back to OPERATIONS_ACTOR_CONFIGS when no override exists.
 */
export async function loadOpsActorConfig(
  tenantPool: pg.Pool,
  actorType: string,
): Promise<ActorConfig> {
  const defaultConfig = OPERATIONS_ACTOR_CONFIGS[actorType];
  if (!defaultConfig) {
    throw new Error(`Unknown operations actor type: ${actorType}`);
  }
  try {
    const result = await tenantPool.query(
      `SELECT output_date_field, turn_time_start_field, turn_time_end_field
       FROM public.operational_scorecard_config
       WHERE actor_type = $1 AND is_active = true
       LIMIT 1`,
      [actorType],
    );
    if (result.rows.length === 0) {
      return defaultConfig;
    }
    const row = result.rows[0];
    return {
      actorColumn: actorType,
      outputDateField: row.output_date_field,
      turnTimeStartField: row.turn_time_start_field,
      turnTimeEndField: row.turn_time_end_field,
    };
  } catch {
    return defaultConfig;
  }
}

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

// Helper: does this channel string match any TPO-pattern keyword?
const hasTPOChannelPattern = (chLower: string): boolean =>
  chLower.includes("broker") ||
  chLower.includes("brok") ||
  chLower.includes("whole") ||
  chLower.includes("corresp") ||
  chLower.includes("tpo");

/**
 * Filter a channel value by channel group (for JavaScript filtering).
 *
 * TPO classification requires BOTH a TPO channel pattern AND a populated
 * account_executive. Loans with a TPO channel pattern but no AE are
 * classified as Retail (brokered-retail — closed in lender's name).
 *
 * @param channel - The channel value from the loan
 * @param channelGroup - The channel group to filter by
 * @param accountExecutive - The account_executive value from the loan (needed for TPO/Retail distinction)
 * @returns true if the channel matches the group
 */
export const filterByChannel = (
  channel: string | null | undefined,
  channelGroup: string | undefined,
  accountExecutive?: string | null,
): boolean => {
  if (!channelGroup || channelGroup === "All") return true;
  const ch = (channel || "").toLowerCase();
  const hasAE = !!(accountExecutive && accountExecutive.trim());
  const tpoPattern = hasTPOChannelPattern(ch);

  switch (channelGroup) {
    case "Retail":
      // Retail = channel says "retail" OR (TPO channel pattern but no account_executive)
      return ch.includes("retail") || (tpoPattern && !hasAE);
    case "TPO":
      // TPO = TPO channel pattern AND account_executive populated
      return tpoPattern && hasAE;
    case "99-Missing":
      return !ch || ch.trim() === "";
    case "Other":
      return (
        ch.trim() !== "" &&
        !ch.includes("retail") &&
        !tpoPattern
      );
    default:
      return true;
  }
};

// SQL fragment for the TPO channel pattern (reused across multiple functions)
const tpoChannelPatternSql = (col: string): string =>
  `(${col} ILIKE '%broker%' OR ${col} ILIKE '%brokered%' OR ${col} ILIKE '%wholesale%' OR ${col} ILIKE '%correspondent%' OR ${col} ILIKE '%corresp%' OR ${col} ILIKE '%tpo%')`;

/**
 * Build SQL WHERE clause fragment for channel filtering.
 * Use this for efficient database-level filtering.
 *
 * TPO classification requires BOTH a TPO channel pattern AND a populated
 * account_executive. Loans with a TPO channel but no AE are Retail.
 *
 * @param channelGroup - The channel group to filter by
 * @param tableAlias - Optional table alias (e.g. "l")
 * @returns SQL fragment to add to WHERE clause (includes leading AND)
 */
export const buildChannelWhereClause = (
  channelGroup: string | undefined,
  tableAlias: string = "",
): string => {
  if (!channelGroup || channelGroup === "All") return "";

  // Normalize to canonical form so "99-missing", "99-MISSING" etc. all work
  const normalized =
    typeof channelGroup === "string"
      ? (channelGroup.trim().length === 0
          ? undefined
          : (() => {
              const lower = channelGroup.trim().toLowerCase();
              if (lower === "99-missing") return "99-Missing";
              if (lower === "retail") return "Retail";
              if (lower === "tpo") return "TPO";
              if (lower === "other") return "Other";
              return channelGroup.trim();
            })())
      : undefined;
  if (!normalized) return "";

  const col = tableAlias ? `${tableAlias}.channel` : "channel";
  const aeCol = tableAlias ? `${tableAlias}.account_executive` : "account_executive";
  const tpoPat = tpoChannelPatternSql(col);

  switch (normalized) {
    case "Retail":
      // Retail = Direct origination OR brokered-retail (TPO channel pattern but no account_executive)
      return `AND ((${col} ILIKE '%retail%') OR (${tpoPat} AND (${aeCol} IS NULL OR TRIM(${aeCol}) = '')))`;
    case "TPO":
      // TPO = TPO channel pattern AND account_executive populated
      return `AND (${tpoPat} AND ${aeCol} IS NOT NULL AND TRIM(${aeCol}) != '')`;
    case "99-Missing":
      return `AND (${col} IS NULL OR TRIM(${col}) = '')`;
    case "Other":
      return `AND ${col} IS NOT NULL AND TRIM(${col}) != '' AND ${col} NOT ILIKE '%retail%' AND NOT ${tpoPat}`;
    default:
      // Individual channel value (exact match)
      return `AND LOWER(TRIM(${col})) = LOWER('${normalized.replace(
        /'/g,
        "''",
      )}')`;
  }
};

/**
 * Map of frontend dimension filter param names to actual DB column names on the loans table.
 * Used by buildDimensionFilterWhereClause to translate query params into SQL filters.
 */
const DIMENSION_FILTER_COLUMNS: Record<string, string> = {
  branch: 'branch',
  loan_officer: 'loan_officer',
  loan_type: 'loan_type',
  loan_purpose: 'loan_purpose',
  property_state: 'property_state',
  property_county: 'property_county',
  property_type: 'property_type',
  current_loan_status: 'current_loan_status',
  investor_name: 'investor',
};

/**
 * Build a SQL WHERE clause fragment from workbench dimension filter query params.
 * Inspects `query` for known dimension filter keys and produces AND clauses.
 * Uses ILIKE for case-insensitive matching.
 *
 * @param query - Express req.query (or plain object with string values)
 * @param tableAlias - Table alias used in the query (e.g. "l"). Empty string for no alias.
 * @param skip - Optional set of param keys to skip (when the route already handles them).
 * @returns SQL fragment to append to WHERE clause (includes leading AND per condition, or empty string).
 */
export const buildDimensionFilterWhereClause = (
  query: Record<string, any>,
  tableAlias: string = 'l',
  skip?: Set<string>,
): string => {
  const parts: string[] = [];
  const prefix = tableAlias ? `${tableAlias}.` : '';

  for (const [param, dbCol] of Object.entries(DIMENSION_FILTER_COLUMNS)) {
    if (skip?.has(param)) continue;
    const v = query[param];
    if (v && typeof v === 'string' && v.toLowerCase() !== 'all' && v.trim() !== '') {
      const escaped = v.replace(/'/g, "''");
      parts.push(`AND ${prefix}${dbCol} ILIKE '${escaped}'`);
    }
  }

  return parts.join(' ');
};

/**
 * Build a SQL CASE expression that classifies a loan into a channel group.
 * TPO requires BOTH a TPO channel pattern AND a populated account_executive.
 * Loans with a TPO channel but no AE are classified as Retail.
 *
 * NOTE: TPO check comes FIRST so that channel+AE → TPO takes precedence
 * over the Retail catch-all for TPO-pattern channels without AE.
 *
 * @param tableAlias - Optional table alias (e.g. "l")
 * @returns SQL CASE expression that evaluates to 'Retail', 'TPO', '99-Missing', or 'Other'
 */
export const buildChannelGroupCaseExpr = (tableAlias = ""): string => {
  const col = tableAlias ? `${tableAlias}.channel` : "channel";
  const ae = tableAlias ? `${tableAlias}.account_executive` : "account_executive";
  const tpoPat = tpoChannelPatternSql(col);
  return `CASE
    WHEN ${tpoPat} AND ${ae} IS NOT NULL AND TRIM(${ae}) != '' THEN 'TPO'
    WHEN ${col} ILIKE '%retail%' OR (${tpoPat} AND (${ae} IS NULL OR TRIM(${ae}) = '')) THEN 'Retail'
    WHEN ${col} IS NULL OR TRIM(${col}) = '' THEN '99-Missing'
    ELSE 'Other'
  END`;
};

// ============================================================================
// Channel-Aware Actor Selection
// ============================================================================

/**
 * Get the appropriate actor column for a given channel group.
 *
 * TPO (Third Party Origination) channels use Account Executive as the primary
 * sales contact, while Retail channels use Loan Officer.
 *
 * @param channelGroup - The channel group ('Retail', 'TPO', etc.)
 * @returns The database column name for the actor ('loan_officer' or 'account_executive')
 */
export const getActorColumnForChannel = (channelGroup?: string): string => {
  const cg = (channelGroup || "").toLowerCase();
  if (cg === "tpo") {
    return "account_executive";
  }
  return "loan_officer";
};

/**
 * Get the display label for the actor type based on channel.
 *
 * @param channelGroup - The channel group ('Retail', 'TPO', etc.)
 * @returns Display label ('Loan Officer' or 'Account Executive')
 */
export const getActorLabelForChannel = (channelGroup?: string): string => {
  const cg = (channelGroup || "").toLowerCase();
  if (cg === "tpo") {
    return "Account Executive";
  }
  return "Loan Officer";
};

/**
 * SQL COALESCE expression to get actor with 'Unassigned' fallback.
 * Use this in SELECT clauses for database-level computation.
 *
 * @param channelGroup - The channel group ('Retail', 'TPO', etc.)
 * @param tableAlias - Optional table alias (default: 'l')
 * @returns SQL expression that returns actor name or 'Unassigned'
 */
export const getActorSqlExpression = (
  channelGroup?: string,
  tableAlias: string = "l",
): string => {
  const column = getActorColumnForChannel(channelGroup);
  return `COALESCE(NULLIF(TRIM(${tableAlias}.${column}), ''), 'Unassigned')`;
};

/**
 * SQL WHERE clause fragment for non-missing actor filtering with channel awareness.
 * Excludes records where the actor is NULL, empty, or 'Unassigned'.
 *
 * @param channelGroup - The channel group ('Retail', 'TPO', etc.)
 * @param tableAlias - Optional table alias (default: 'l')
 * @param includeUnassigned - Whether to include 'Unassigned' actors (default: true)
 * @returns SQL WHERE clause fragment
 */
export const buildActorNotMissingClauseForChannel = (
  channelGroup?: string,
  tableAlias: string = "l",
  includeUnassigned: boolean = true,
): string => {
  const column = getActorColumnForChannel(channelGroup);
  if (includeUnassigned) {
    // Include all records, just transform empty to 'Unassigned' in SELECT
    return `(${tableAlias}.${column} IS NOT NULL OR 1=1)`;
  }
  // Exclude records with missing actor values
  return `${tableAlias}.${column} IS NOT NULL AND TRIM(${tableAlias}.${column}) != ''`;
};

/**
 * Check if a channel group is TPO.
 *
 * @param channelGroup - The channel group to check
 * @returns true if the channel is TPO
 */
export const isTPOChannel = (channelGroup?: string): boolean => {
  return (channelGroup || "").toLowerCase() === "tpo";
};

/**
 * Build the SQL condition for "funded loan" that is channel-aware.
 *
 * Qlik uses separate apps per channel (Retail vs TPO). The Retail app's
 * TopTiering sheet applies `[Rate Lock Buy Side Base Price Rate] = {">0"}`
 * because all Retail loans carry buy-side pricing. TPO/brokered loans do NOT
 * have buy-side rate lock pricing, so the rate_lock filter would exclude them.
 *
 * Rules:
 *  - Retail:  funding_date IS NOT NULL AND rate_lock > 0
 *  - TPO:     funding_date IS NOT NULL  (no rate_lock — brokered loans lack it)
 *  - All/other: funding_date IS NOT NULL  (otherwise TPO loans silently disappear)
 *
 * @param channelGroup - "Retail", "TPO", "All", or undefined
 * @param tableAlias   - Table alias prefix (e.g. "l") — will be prepended with dot
 * @returns SQL fragment like "l.funding_date IS NOT NULL AND ..."
 */
export const buildFundedFilter = (
  channelGroup?: string,
  tableAlias = "",
): string => {
  const col = tableAlias ? `${tableAlias}.` : "";
  const base = `${col}funding_date IS NOT NULL`;
  // Rate lock filter only for Retail (matches Qlik TopTiering behavior)
  if (channelGroup?.toLowerCase() === "retail") {
    return `${base} AND COALESCE(${col}rate_lock_buy_side_base_price_rate, 0) > 0`;
  }
  return base;
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
    String(loan.rate_lock_buy_side_base_price_rate ?? ""),
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
 * Default SQL expression for revenue calculation.
 * Use in SELECT clauses for database-level computation.
 *
 * Note: Tenants can define custom revenue formulas via the admin panel.
 * Use getTenantRevenueExpression() to get the tenant-specific formula,
 * falling back to this default if none is configured.
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

/**
 * Cache for tenant revenue expressions to avoid repeated DB queries.
 * Key must be unique per tenant (tenantDbManager sets pool._connectionKey = tenantId).
 * Using "default" for all pools would mix formulas across tenants.
 */
const tenantRevenueExpressionCache = new Map<
  string,
  { expression: string; cachedAt: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the tenant-specific revenue SQL expression.
 *
 * Tenants can configure custom revenue formulas through the admin panel.
 * This function returns the tenant's custom formula if one is configured,
 * otherwise falls back to the default REVENUE_SQL_EXPRESSION.
 *
 * @param pool - Tenant database connection pool
 * @param tableAlias - Optional table alias to prefix field names (e.g., 'l' for 'l.loan_amount')
 * @returns SQL expression for revenue calculation
 */
export const getTenantRevenueExpression = async (
  pool: pg.Pool,
  tableAlias?: string,
): Promise<string> => {
  try {
    // Try to get from cache first (must be per-tenant: pool._connectionKey set by tenantDbManager)
    const poolId =
      (pool as pg.Pool & { _connectionKey?: string })._connectionKey ??
      "default";
    const cached = tenantRevenueExpressionCache.get(poolId);

    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return applyTableAlias(cached.expression, tableAlias);
    }

    // Check if tenant_calculations table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'tenant_calculations'
      ) as exists
    `);

    if (!tableCheck.rows[0].exists) {
      // Table doesn't exist - use default
      return applyTableAlias(REVENUE_SQL_EXPRESSION, tableAlias);
    }

    // Query for the active revenue formula
    const result = await pool.query(`
      SELECT sql_expression
      FROM public.tenant_calculations
      WHERE calculation_type = 'revenue' AND is_active = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    let expression = REVENUE_SQL_EXPRESSION;

    if (result.rows[0]?.sql_expression) {
      expression = result.rows[0].sql_expression;
    }

    // Cache the result
    tenantRevenueExpressionCache.set(poolId, {
      expression,
      cachedAt: Date.now(),
    });

    return applyTableAlias(expression, tableAlias);
  } catch (error) {
    // On any error, fall back to default
    console.warn(
      "[scorecard-utils] Error fetching tenant revenue expression, using default:",
      error,
    );
    return applyTableAlias(REVENUE_SQL_EXPRESSION, tableAlias);
  }
};

/**
 * Apply table alias to field names in a SQL expression.
 * This allows the expression to work in JOIN queries where field names need to be qualified.
 *
 * @param expression - SQL expression with unqualified field names
 * @param tableAlias - Table alias to prepend (e.g., 'l' becomes 'l.field_name')
 * @returns SQL expression with qualified field names
 */
const applyTableAlias = (expression: string, tableAlias?: string): string => {
  if (!tableAlias) return expression;

  // List of field names that could appear in revenue expressions
  const fieldNames = [
    "rate_lock_buy_side_base_price_rate",
    "loan_amount",
    "orig_fee_borr_pd",
    "orig_fees_seller",
    "cd_lender_credits",
    "cd_applied_cure",
    "origination_points",
    "pa_sell_amt",
    "pa_srp_amt",
    "pa_payout_1",
    "pa_payout_2",
    "pa_payout_3",
    "pa_payout_4",
    "pa_payout_5",
    "line_800_borr",
    "line_800_seller",
    "warehouse_line_fee",
    "warehouse_line_interest",
    "fees_interest_borr",
    "pa_expected_int_pymt",
    "fees_appraisal_borr",
  ];

  let result = expression;
  for (const field of fieldNames) {
    // Use word boundary to avoid replacing partial matches
    // Replace field_name with alias.field_name, but not if it's already aliased
    const regex = new RegExp(`(?<!\\.)\\b${field}\\b`, "g");
    result = result.replace(regex, `${tableAlias}.${field}`);
  }

  return result;
};

/**
 * Clear the tenant revenue expression cache.
 * Call this when a tenant updates their revenue formula.
 */
export const clearTenantRevenueExpressionCache = (poolId?: string): void => {
  if (poolId) {
    tenantRevenueExpressionCache.delete(poolId);
  } else {
    tenantRevenueExpressionCache.clear();
  }
};

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
  monthsBack: number,
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
 * TTS (Top Tier Score) tier thresholds (legacy score-based approach).
 * From Qlik Dimensions.csv "13 Month TVI Score Tiers":
 *   If(Avg(TVI_Score) >= 120, 'Top Tier',
 *   If(Avg(TVI_Score) >= 80, 'Second Tier', 'Bottom Tier'))
 */
export const TTS_TIER_THRESHOLDS = {
  TOP: 120,
  SECOND: 80,
} as const;

/**
 * TTS Tier percentiles for Pareto-based distribution.
 * Reflects the 20/30/50 rule:
 * - Top 20% of producers produce ~50% of value
 * - Middle 30% of producers produce ~30% of value
 * - Bottom 50% of producers produce ~20% of value
 */
export const TTS_TIER_PERCENTILES = {
  TOP: 20, // Top 20% of actors by count
  SECOND: 50, // Next 30% (20-50%) of actors by count
  // Bottom: Remaining 50% (50-100%)
} as const;

export type TTSTier = "top" | "second" | "bottom";

/**
 * Assign a tier based on TTS score (legacy threshold-based).
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
 * Assign tiers to a sorted array of actors based on percentile distribution.
 * This implements the Pareto principle: 20/30/50 split by producer count.
 *
 * Assumes actors are already sorted by performance (e.g., TTS score descending).
 *
 * Special handling for small populations (< 5 actors):
 * - Strict percentiles don't work well with few people
 * - Guarantees relative tiering: #1 is always "top", meaningful distribution
 *
 * @param totalCount - Total number of actors
 * @param actorIndex - 0-based index of the actor in the sorted list
 * @returns The tier assignment based on position in the distribution
 */
export const assignTTSTierByPercentile = (
  totalCount: number,
  actorIndex: number,
): TTSTier => {
  if (totalCount === 0) return "bottom";

  // Special case: Very small populations (< 5 actors)
  // Use relative tiering to ensure meaningful distribution
  if (totalCount < 5) {
    // 1 actor: top
    // 2 actors: top, bottom
    // 3 actors: top, second, bottom
    // 4 actors: top, second, bottom, bottom
    if (actorIndex === 0) return "top";
    if (totalCount >= 3 && actorIndex === 1) return "second";
    return "bottom";
  }

  // Standard percentile-based assignment for larger populations
  const percentilePosition = ((actorIndex + 1) / totalCount) * 100;

  if (percentilePosition <= TTS_TIER_PERCENTILES.TOP) {
    return "top";
  }
  if (percentilePosition <= TTS_TIER_PERCENTILES.SECOND) {
    return "second";
  }
  return "bottom";
};

/**
 * Assign tiers to an array of actors based on percentile distribution.
 * Mutates the input array by adding/updating the 'tier' property.
 *
 * @param actors - Array of actors sorted by performance (descending)
 * @param tierKey - Property name for the tier (default: 'tier')
 * @returns The same array with tiers assigned
 */
export const assignTiersByPercentile = <T extends { tier?: TTSTier }>(
  actors: T[],
): T[] => {
  const totalCount = actors.length;
  return actors.map((actor, index) => ({
    ...actor,
    tier: assignTTSTierByPercentile(totalCount, index),
  }));
};

/**
 * Assign tiers by CUMULATIVE VALUE (Pareto): top tier ≈ 50% of units, second ≈ 30%, bottom ≈ 20%.
 * Actors must be sorted by units (value) descending.
 * getUnits(actor) defaults to actor.units; pass (a) => a.totalUnits for trends-style actors.
 */
export const assignTiersByCumulativeValue = <T>(
  actorsSortedByUnits: T[],
  totalUnits: number,
  getUnits: (a: T) => number = (a: T) => (a as { units: number }).units,
): (T & { tier: TTSTier })[] => {
  if (actorsSortedByUnits.length === 0 || totalUnits <= 0) {
    return actorsSortedByUnits.map((a) => ({
      ...a,
      tier: "bottom" as TTSTier,
    }));
  }
  const topThreshold = totalUnits * 0.5;
  const secondThreshold = totalUnits * 0.8;
  let running = 0;
  return actorsSortedByUnits.map((actor) => {
    // Assign tier from cumulative BEFORE adding this actor so the person who pushes us over 50% is still "top"
    let tier: TTSTier;
    if (running < topThreshold) tier = "top";
    else if (running < secondThreshold) tier = "second";
    else tier = "bottom";
    running += getUnits(actor);
    return { ...actor, tier };
  });
};

/**
 * Operations Scorecard TTS weights (units / turn time / complexity).
 * Tier assignment is by value (units) rank so top 20% of people ≈ 50% of value (Pareto).
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
  loan_amount?: number | null;
  fico_score?: number | null;
  ltv_ratio?: number | null;
  be_dti_ratio?: number | null;
  occupancy_type?: string | null;
  borr_self_employed?: boolean | string | null;
  non_qm?: boolean | string | null;
}

/**
 * Complexity configuration loaded from database.
 * Maps component_condition to weight (in points, not decimal).
 * Example: { "loan_type_government": 10, "fico_poor": 10, "fico_excellent": -5 }
 */
export interface ComplexityConfig {
  loan_type_government?: number;
  loan_type_conventional?: number;
  loan_purpose_purchase?: number;
  loan_purpose_refinance?: number;
  fico_poor?: number;
  fico_fair?: number;
  fico_good?: number;
  fico_excellent?: number;
  ltv_high?: number;
  ltv_standard?: number;
  dti_high?: number;
  dti_standard?: number;
  occupancy_investment?: number;
  occupancy_second_home?: number;
  occupancy_primary?: number;
  employment_self_employed?: number;
  employment_w2?: number;
}

/**
 * Single rule for complexity (categorical or range-based).
 * For range-based components, range_min <= value < range_max.
 * Weight is in points (same as stored * 100 from DB decimal).
 */
export interface ComplexityRangeRule {
  condition_value: string;
  weight: number;
  range_min?: number | null;
  range_max?: number | null;
}

/**
 * V2 complexity config: per-component arrays of rules.
 * Categorical: loan_type, loan_purpose, occupancy, employment, non_qm.
 * Range-based: loan_amount, fico, ltv, dti.
 */
export type ComplexityConfigV2 = Record<string, ComplexityRangeRule[]>;

/**
 * Default complexity weights (in points).
 * These are used when no database configuration exists.
 */
export const DEFAULT_COMPLEXITY_WEIGHTS: ComplexityConfig = {
  loan_type_government: 10,
  loan_type_conventional: 0,
  loan_purpose_purchase: 5,
  loan_purpose_refinance: 0,
  fico_poor: 10,
  fico_fair: 0,
  fico_good: 0,
  fico_excellent: -5,
  ltv_high: 5,
  ltv_standard: 0,
  dti_high: 5,
  dti_standard: 0,
  occupancy_investment: 5,
  occupancy_second_home: 5,
  occupancy_primary: 0,
  employment_self_employed: 5,
  employment_w2: 0,
};

/** Type guard: config is V2 (per-component arrays). */
function isComplexityConfigV2(
  c: ComplexityConfigV2 | ComplexityConfig | undefined,
): c is ComplexityConfigV2 {
  if (!c || typeof c !== "object") return false;
  const k = Object.keys(c)[0];
  if (!k) return false;
  const val = (c as Record<string, unknown>)[k];
  return Array.isArray(val);
}

/** Normalize string for categorical matching (trim, single space, uppercase). */
function norm(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Find weight for a numeric value from range rules (range_min <= value < range_max). */
function weightForRange(
  value: number,
  rules: ComplexityRangeRule[],
): number {
  for (const r of rules) {
    const min = r.range_min ?? -Infinity;
    const max = r.range_max ?? Infinity;
    if (value >= min && value < max) return r.weight;
  }
  return 0;
}

/** Find weight for a categorical value (exact or normalized match). */
function weightForCategorical(
  value: string | boolean | null | undefined,
  rules: ComplexityRangeRule[],
): number {
  const normalized =
    typeof value === "string"
      ? norm(value)
      : value === true
        ? "Y"
        : "N";
  let otherWeight: number | null = null;
  for (const r of rules) {
    const cond = norm(r.condition_value);
    if (cond === "OTHER") {
      otherWeight = r.weight;
      continue;
    }
    if (cond === normalized) return r.weight;
    if (
      typeof value === "string" &&
      (norm(value).includes(cond) || cond.includes(norm(value)))
    )
      return r.weight;
  }
  return otherWeight ?? 0;
}

/**
 * Calculate loan complexity score using V2 config (dynamic ranges and categorical rules).
 */
function calcLoanComplexityV2(
  loan: LoanComplexityData,
  config: ComplexityConfigV2,
): number {
  let complexity = 100; // Baseline

  // Loan Type (categorical)
  const loanTypeRules = config.loan_type;
  if (loanTypeRules?.length && loan.loan_type != null) {
    const loanType = String(loan.loan_type);
    complexity += weightForCategorical(loanType, loanTypeRules);
  }

  // Loan Purpose (categorical)
  const loanPurposeRules = config.loan_purpose;
  if (loanPurposeRules?.length && loan.loan_purpose != null) {
    complexity += weightForCategorical(loan.loan_purpose, loanPurposeRules);
  }

  // Loan Amount (range)
  const loanAmountRules = config.loan_amount;
  if (loanAmountRules?.length && loan.loan_amount != null && loan.loan_amount > 0) {
    complexity += weightForRange(loan.loan_amount, loanAmountRules);
  }

  // FICO (range)
  const ficoRules = config.fico;
  if (ficoRules?.length && loan.fico_score != null && loan.fico_score > 0) {
    complexity += weightForRange(loan.fico_score, ficoRules);
  }

  // LTV (range)
  const ltvRules = config.ltv;
  if (ltvRules?.length && loan.ltv_ratio != null && loan.ltv_ratio >= 0) {
    complexity += weightForRange(loan.ltv_ratio, ltvRules);
  }

  // DTI (range)
  const dtiRules = config.dti;
  if (dtiRules?.length && loan.be_dti_ratio != null && loan.be_dti_ratio >= 0) {
    complexity += weightForRange(loan.be_dti_ratio, dtiRules);
  }

  // Occupancy (categorical)
  const occupancyRules = config.occupancy;
  if (occupancyRules?.length && loan.occupancy_type != null) {
    complexity += weightForCategorical(loan.occupancy_type, occupancyRules);
  }

  // Employment (categorical: self_employed / w2)
  const employmentRules = config.employment;
  if (employmentRules?.length) {
    const selfEmployed = loan.borr_self_employed;
    const isSelfEmployed =
      selfEmployed === true ||
      selfEmployed === "Y" ||
      selfEmployed === "Yes" ||
      selfEmployed === "1" ||
      selfEmployed === "y";
    complexity += weightForCategorical(
      isSelfEmployed ? "self_employed" : "w2",
      employmentRules,
    );
  }

  // Non-QM (categorical: Y/N)
  const nonQmRules = config.non_qm;
  if (nonQmRules?.length) {
    const isNonQm =
      loan.non_qm === true ||
      loan.non_qm === "Y" ||
      loan.non_qm === "Yes" ||
      loan.non_qm === "1";
    complexity += weightForCategorical(isNonQm ? "Y" : "N", nonQmRules);
  }

  return complexity;
}

/** Component breakdown item for complexity (name, condition, weight in points, applied). */
export interface ComplexityBreakdownItem {
  name: string;
  condition: string;
  weight: number;
  applied: boolean;
}

/**
 * Calculate loan complexity with per-component breakdown using V2 config.
 * Used by LoanComplexityService for detailed score display.
 */
export function calcLoanComplexityWithBreakdown(
  loan: LoanComplexityData,
  config: ComplexityConfigV2,
): { totalScore: number; components: ComplexityBreakdownItem[] } {
  const components: ComplexityBreakdownItem[] = [];
  let totalScore = 100;

  const add = (
    name: string,
    condition: string,
    weight: number,
  ) => {
    components.push({
      name,
      condition,
      weight,
      applied: weight !== 0,
    });
    totalScore += weight;
  };

  const loanTypeRules = config.loan_type;
  if (loanTypeRules?.length && loan.loan_type != null) {
    const w = weightForCategorical(loan.loan_type, loanTypeRules);
    add("Loan Type", String(loan.loan_type), w);
  }

  const loanPurposeRules = config.loan_purpose;
  if (loanPurposeRules?.length && loan.loan_purpose != null) {
    const w = weightForCategorical(loan.loan_purpose, loanPurposeRules);
    add("Loan Purpose", loan.loan_purpose, w);
  }

  const loanAmountRules = config.loan_amount;
  if (loanAmountRules?.length && loan.loan_amount != null && loan.loan_amount > 0) {
    const w = weightForRange(loan.loan_amount, loanAmountRules);
    const label = loanAmountRules.find(
      (r) =>
        (r.range_min ?? -Infinity) <= loan.loan_amount! &&
        loan.loan_amount! < (r.range_max ?? Infinity),
    )?.condition_value ?? String(loan.loan_amount);
    add("Loan Amount", label, w);
  }

  const ficoRules = config.fico;
  if (ficoRules?.length && loan.fico_score != null && loan.fico_score > 0) {
    const w = weightForRange(loan.fico_score, ficoRules);
    add("FICO Score", `${loan.fico_score}`, w);
  }

  const ltvRules = config.ltv;
  if (ltvRules?.length && loan.ltv_ratio != null && loan.ltv_ratio >= 0) {
    const w = weightForRange(loan.ltv_ratio, ltvRules);
    add("LTV", `${loan.ltv_ratio.toFixed(1)}%`, w);
  }

  const dtiRules = config.dti;
  if (dtiRules?.length && loan.be_dti_ratio != null && loan.be_dti_ratio >= 0) {
    const w = weightForRange(loan.be_dti_ratio, dtiRules);
    add("DTI", `${loan.be_dti_ratio.toFixed(1)}%`, w);
  }

  const occupancyRules = config.occupancy;
  if (occupancyRules?.length && loan.occupancy_type != null) {
    const w = weightForCategorical(loan.occupancy_type, occupancyRules);
    add("Occupancy", loan.occupancy_type, w);
  }

  const employmentRules = config.employment;
  if (employmentRules?.length) {
    const selfEmployed = loan.borr_self_employed;
    const isSelfEmployed =
      selfEmployed === true ||
      selfEmployed === "Y" ||
      selfEmployed === "Yes" ||
      selfEmployed === "1" ||
      selfEmployed === "y";
    const w = weightForCategorical(
      isSelfEmployed ? "self_employed" : "w2",
      employmentRules,
    );
    add("Employment", isSelfEmployed ? "self_employed" : "w2", w);
  }

  const nonQmRules = config.non_qm;
  if (nonQmRules?.length) {
    const isNonQm =
      loan.non_qm === true ||
      loan.non_qm === "Y" ||
      loan.non_qm === "Yes" ||
      loan.non_qm === "1";
    const w = weightForCategorical(isNonQm ? "Y" : "N", nonQmRules);
    add("Non-QM", isNonQm ? "Y" : "N", w);
  }

  return {
    totalScore: Math.round(totalScore * 100) / 100,
    components,
  };
}

/**
 * Calculate loan complexity score.
 * Supports both legacy ComplexityConfig and ComplexityConfigV2 (from DB).
 *
 * @param loan - Loan data for complexity calculation
 * @param config - Optional complexity config (V2 preferred; legacy supported)
 * @returns Complexity score (100 = baseline, >100 = higher complexity)
 */
export const calcLoanComplexity = (
  loan: LoanComplexityData,
  config?: ComplexityConfigV2 | ComplexityConfig,
): number => {
  if (isComplexityConfigV2(config)) {
    return calcLoanComplexityV2(loan, config);
  }

  // Legacy ComplexityConfig path
  const weights = config || DEFAULT_COMPLEXITY_WEIGHTS;
  let complexity = 100; // Baseline

  const loanType = (loan.loan_type || "").toUpperCase();
  if (
    ["FHA", "VA", "USDA", "FARMERSHOMEA", "FARMERSHOMEADMINISTRATION"].includes(
      loanType,
    )
  ) {
    complexity += weights.loan_type_government ?? 10;
  } else {
    complexity += weights.loan_type_conventional ?? 0;
  }

  const loanPurpose = (loan.loan_purpose || "").toUpperCase();
  if (loanPurpose === "PURCHASE") {
    complexity += weights.loan_purpose_purchase ?? 5;
  } else {
    complexity += weights.loan_purpose_refinance ?? 0;
  }

  const fico = loan.fico_score || 0;
  if (fico > 0) {
    if (fico >= 760) {
      complexity += weights.fico_excellent ?? -5;
    } else if (fico >= 720) {
      complexity += weights.fico_good ?? 0;
    } else if (fico >= 680) {
      complexity += weights.fico_fair ?? 0;
    } else {
      complexity += weights.fico_poor ?? 10;
    }
  }

  const ltv = loan.ltv_ratio || 0;
  if (ltv > 80) {
    complexity += weights.ltv_high ?? 5;
  } else {
    complexity += weights.ltv_standard ?? 0;
  }

  const dti = loan.be_dti_ratio || 0;
  if (dti > 43) {
    complexity += weights.dti_high ?? 5;
  } else {
    complexity += weights.dti_standard ?? 0;
  }

  const occupancy = (loan.occupancy_type || "").toUpperCase();
  if (occupancy.includes("INVEST")) {
    complexity += weights.occupancy_investment ?? 5;
  } else if (occupancy.includes("SECOND") || occupancy.includes("2ND")) {
    complexity += weights.occupancy_second_home ?? 5;
  } else if (
    occupancy.includes("PRIMARY") ||
    occupancy.includes("OWNER") ||
    !occupancy
  ) {
    complexity += weights.occupancy_primary ?? 0;
  } else {
    complexity += weights.occupancy_investment ?? 5;
  }

  const selfEmployed = loan.borr_self_employed;
  if (
    selfEmployed === true ||
    selfEmployed === "Y" ||
    selfEmployed === "Yes" ||
    selfEmployed === "1"
  ) {
    complexity += weights.employment_self_employed ?? 5;
  } else {
    complexity += weights.employment_w2 ?? 0;
  }

  return complexity;
};

/** DB row shape for complexity_components (with optional range columns). */
export interface ComplexityComponentRow {
  component_name: string;
  condition_value: string;
  weight: number;
  range_min?: number | null;
  range_max?: number | null;
}

/**
 * Convert database complexity_components rows to ComplexityConfig.
 * Database stores weights as decimals (0.10 = 10%), this converts to points.
 */
export const parseComplexityConfig = (
  rows: Array<{
    component_name: string;
    condition_value: string;
    weight: number;
  }>,
): ComplexityConfig => {
  const config: ComplexityConfig = { ...DEFAULT_COMPLEXITY_WEIGHTS };

  for (const row of rows) {
    const key =
      `${row.component_name}_${row.condition_value}` as keyof ComplexityConfig;
    config[key] = Math.round(row.weight * 100);
  }

  return config;
};

/**
 * Convert database complexity_components rows (with range_min/range_max) to ComplexityConfigV2.
 * Database weight is decimal (0.10 = 10 points); converted to points.
 */
export const parseComplexityConfigV2 = (
  rows: ComplexityComponentRow[],
): ComplexityConfigV2 => {
  const config: ComplexityConfigV2 = {};

  for (const row of rows) {
    const name = row.component_name;
    if (!config[name]) config[name] = [];
    config[name].push({
      condition_value: row.condition_value,
      weight: Math.round(Number(row.weight) * 100),
      range_min: row.range_min != null ? Number(row.range_min) : undefined,
      range_max: row.range_max != null ? Number(row.range_max) : undefined,
    });
  }

  // Sort range-based rules by range_min so first match wins
  const rangeComponents = ["loan_amount", "fico", "ltv", "dti"];
  for (const name of rangeComponents) {
    if (config[name]) {
      config[name] = [...config[name]].sort(
        (a, b) => (a.range_min ?? 0) - (b.range_min ?? 0),
      );
    }
  }

  return config;
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
  type: keyof typeof WA_THRESHOLDS,
): boolean => {
  if (value == null) return false;
  const { min, max } = WA_THRESHOLDS[type];
  return value >= min && value <= max;
};
