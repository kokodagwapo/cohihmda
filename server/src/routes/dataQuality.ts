/**
 * Data Quality API Routes
 * Provides endpoints for data quality monitoring and analysis
 * Inspired by Qlik Data Pilot features
 *
 * ⚠️ IMPORTANT: Loan Status Definitions
 * =====================================
 * The canonical source of truth for loan status definitions is:
 *   server/src/services/metrics/metricsService.ts
 *
 * Key definitions from metricsService.ts:
 * - "Active Loan": EXACT MATCH to current_loan_status = 'Active Loan'
 *   AND application_date IS NOT NULL AND application_date::text != ''
 * - "Originated/Funded": current_loan_status ILIKE '%Originated%' OR '%purchased%'
 * - "Funded": funding_date IS NOT NULL AND funding_date <= CURRENT_DATE
 *
 * DO NOT use loose ILIKE '%active%' patterns - this will match many non-active statuses!
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { logError, logWarn, logInfo } from "../services/logger.js";

const router = Router();

/**
 * Crucial fields list from Qlik Data Pilot
 * These are priority fields that should always be populated
 */
/**
 * Stage groups define which subset of loans each field should be measured against.
 *
 * - universal:   every loan in the portfolio
 * - originated:  loans that successfully closed/funded (originated, funded, purchased)
 * - processing:  loans that progressed past the initial Active Loan stage
 *
 * The `applicableFilter` override is used for fields whose denominator is more
 * specific than the stage group default (e.g. uw_denied_date → denied loans only).
 */
type CrucialFieldStage = "universal" | "originated" | "processing";

interface CrucialFieldDef {
  name: string;
  column: string;
  priority: number;
  stage: CrucialFieldStage;
  /** Optional SQL WHERE clause fragment that overrides the stage-group default denominator */
  applicableFilter?: string;
}

// SQL WHERE fragments for each stage group
// SQL WHERE fragments for each stage group.
// "File Closed for incompleteness" loans are excluded from universal and processing —
// they are abandoned before application and structurally lack fields like
// application_date, processor, and submitted-to-UW dates.
const STAGE_FILTERS: Record<CrucialFieldStage, string> = {
  universal:  `current_loan_status IS NOT NULL
               AND current_loan_status NOT ILIKE '%closed for incompleteness%'`,
  originated: `(current_loan_status ILIKE '%originated%'
                OR current_loan_status ILIKE '%funded%'
                OR current_loan_status ILIKE '%purchased%')`,
  processing: `current_loan_status IS NOT NULL
               AND current_loan_status != 'Active Loan'
               AND current_loan_status NOT ILIKE '%closed for incompleteness%'`,
};

const CRUCIAL_FIELDS: CrucialFieldDef[] = [
  // ── Universal: expected on every loan ──────────────────────────────────────
  { name: "Loan Number",        column: "loan_number",        priority: 1,  stage: "universal" },
  { name: "Loan Officer",       column: "loan_officer",       priority: 2,  stage: "universal" },
  { name: "Branch",             column: "branch",             priority: 3,  stage: "universal" },
  { name: "Loan Amount",        column: "loan_amount",        priority: 4,  stage: "universal" },
  { name: "Loan Source",        column: "loan_source",        priority: 5,  stage: "universal" },
  { name: "Current Status Date",column: "current_status_date",priority: 6,  stage: "universal" },
  // application_date / started_date: exclude "File Closed for incompleteness" —
  // these loans were closed before a formal application was ever submitted.
  { name: "Application Date",   column: "application_date",   priority: 7,  stage: "universal",
    applicableFilter: `current_loan_status IS NOT NULL AND current_loan_status NOT ILIKE '%closed for incompleteness%'` },
  { name: "Started Date",       column: "started_date",       priority: 8,  stage: "universal",
    applicableFilter: `current_loan_status IS NOT NULL AND current_loan_status NOT ILIKE '%closed for incompleteness%'` },

  // ── Originated / Funded: only meaningful once a loan closes ────────────────
  { name: "Closing Date",          column: "closing_date",          priority: 10, stage: "originated" },
  { name: "Funding Date",          column: "funding_date",          priority: 11, stage: "originated" },
  { name: "CTC Date",              column: "ctc_date",              priority: 12, stage: "originated" },
  { name: "Shipped Date",          column: "shipped_date",          priority: 13, stage: "originated" },
  { name: "Investor Purchase Date",column: "investor_purchase_date",priority: 14, stage: "originated",
    applicableFilter: `(current_loan_status ILIKE '%purchased%')` },
  { name: "Investor Status",       column: "investor_status",       priority: 15, stage: "originated" },

  // ── Processing / Underwriting: expected after a loan progresses past Active ─
  // processor: scoped to non-active, non-incomplete loans — loans that are
  // actually being worked. A withdrawn app or closed-for-incompleteness loan
  // never needed a processor assigned.
  { name: "Processor",                     column: "processor",                     priority: 16, stage: "processing",
    applicableFilter: `current_loan_status IS NOT NULL
                       AND current_loan_status != 'Active Loan'
                       AND current_loan_status NOT ILIKE '%closed for incompleteness%'` },
  { name: "Underwriter",                   column: "underwriter",                   priority: 17, stage: "processing",
    applicableFilter: `(current_loan_status ILIKE '%originated%'
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%'
                        OR current_loan_status ILIKE '%approved%'
                        OR current_loan_status ILIKE '%denied%'
                        OR current_loan_status ILIKE '%withdrawn%')` },
  // closer: only check on loans that actually reached the approval/closing stage
  { name: "Closer",                        column: "closer",                        priority: 18, stage: "processing",
    applicableFilter: `(current_loan_status ILIKE '%originated%'
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%'
                        OR current_loan_status ILIKE '%approved%')` },
  { name: "Account Executive",             column: "account_executive",             priority: 19, stage: "processing" },
  { name: "Credit Pull Date",              column: "credit_pull_date",              priority: 20, stage: "processing" },
  { name: "Submitted To Processing Date",  column: "submitted_to_processing_date",  priority: 21, stage: "processing",
    applicableFilter: `current_loan_status IS NOT NULL
                       AND current_loan_status != 'Active Loan'
                       AND current_loan_status NOT ILIKE '%closed for incompleteness%'` },
  { name: "Submitted To Underwriting Date",column: "submitted_to_underwriting_date",priority: 22, stage: "processing",
    applicableFilter: `(current_loan_status ILIKE '%originated%'
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%'
                        OR current_loan_status ILIKE '%approved%'
                        OR current_loan_status ILIKE '%denied%'
                        OR current_loan_status ILIKE '%withdrawn%')` },
  { name: "Conditional Approval Date",     column: "conditional_approval_date",     priority: 22, stage: "processing",
    applicableFilter: `(current_loan_status ILIKE '%approved%'
                        OR current_loan_status ILIKE '%originated%'
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')` },
  { name: "UW Approval Date",              column: "uw_approval_date",              priority: 23, stage: "processing",
    applicableFilter: `(current_loan_status ILIKE '%approved%'
                        OR current_loan_status ILIKE '%originated%'
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')` },
  { name: "UW Final Approval Date",        column: "uw_final_approval_date",        priority: 24, stage: "processing",
    applicableFilter: `(current_loan_status ILIKE '%approved%'
                        OR current_loan_status ILIKE '%originated%'
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')` },
  { name: "UW Denied Date",                column: "uw_denied_date",                priority: 25, stage: "processing",
    applicableFilter: `(current_loan_status ILIKE '%denied%' OR current_loan_status ILIKE '%declined%')` },
  { name: "Loan Estimate Sent Date",        column: "loan_estimate_sent_date",       priority: 26, stage: "processing" },
  { name: "Estimated Closing Date",         column: "estimated_closing_date",        priority: 27, stage: "processing",
    applicableFilter: `current_loan_status = 'Active Loan'` },
  { name: "Resubmittal Date",               column: "resubmittal_date",              priority: 28, stage: "processing" },
  { name: "Rate Lock Buy Side Base Price Rate", column: "rate_lock_buy_side_base_price_rate", priority: 29, stage: "processing" },
];

/**
 * Range configuration for key loan metrics
 */
const RANGE_CONFIG = {
  fico: { min: 300, max: 850, label: "FICO Score", column: "fico_score" },
  ltv: { min: 0, max: 100, label: "LTV Ratio", column: "ltv_ratio" },
  dti: { min: 0, max: 100, label: "DTI Ratio", column: "dti_ratio" },
  interestRate: {
    min: 0,
    max: 15,
    label: "Interest Rate",
    column: "interest_rate",
  },
};

/**
 * Warning groups based on Qlik DataPilot patterns
 */
type WarningGroup =
  | "Status Tests"
  | "Application Tests"
  | "Credit Tests"
  | "UW Tests"
  | "Mortgage Tests"
  | "Personnel Tests"
  | "Date Tests";

/**
 * Data quality test definition
 */
interface DataQualityTest {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "warning" | "info";
  group: WarningGroup;
  field: string;
  // SQL condition to find matching loans (will be used in WHERE clause)
  sqlCondition: string;
  // Required columns that must exist for this test to run
  requiredColumns: string[];
}

/**
 * Comprehensive data quality tests based on Qlik DataPilot patterns
 * These detect status inconsistencies, date sequence issues, and data anomalies
 */
const DATA_QUALITY_TESTS: DataQualityTest[] = [
  // ============ STATUS TESTS ============
  // These detect when loan status doesn't match the data (e.g., active loan with funding date)
  // IMPORTANT: "Active Loan" is an EXACT status value match per metricsService.ts
  // Active loans are: current_loan_status = 'Active Loan' AND application_date IS NOT NULL
  {
    id: "active_with_funding_date",
    name: "Active Loan with Funding Date",
    description:
      "Loan marked as 'Active Loan' but has a funding date - status should be Originated/Funded",
    severity: "critical",
    group: "Status Tests",
    field: "current_loan_status",
    sqlCondition: `current_loan_status = 'Active Loan' 
                   AND application_date IS NOT NULL 
                   AND funding_date IS NOT NULL`,
    requiredColumns: [
      "current_loan_status",
      "application_date",
      "funding_date",
    ],
  },
  {
    id: "active_with_closing_date",
    name: "Active Loan with Closing Date",
    description:
      "Loan marked as 'Active Loan' but has a past closing date - verify if status is correct",
    severity: "warning",
    group: "Status Tests",
    field: "current_loan_status",
    sqlCondition: `current_loan_status = 'Active Loan' 
                   AND application_date IS NOT NULL 
                   AND closing_date IS NOT NULL 
                   AND closing_date <= CURRENT_DATE`,
    requiredColumns: [
      "current_loan_status",
      "application_date",
      "closing_date",
    ],
  },
  {
    id: "funded_no_funding_date",
    name: "Funded Status Missing Funding Date",
    description: "Loan marked as Funded/Originated but missing funding date",
    severity: "warning",
    group: "Status Tests",
    field: "current_loan_status",
    sqlCondition: `(current_loan_status ILIKE '%funded%' 
                   OR current_loan_status ILIKE '%originated%' 
                   OR current_loan_status ILIKE '%purchased%')
                   AND funding_date IS NULL`,
    requiredColumns: ["current_loan_status", "funding_date"],
  },
  {
    id: "closed_no_closing_date",
    name: "Originated/Funded Missing Closing Date",
    description: "Loan is Originated/Funded/Purchased but has no closing date",
    severity: "warning",
    group: "Status Tests",
    field: "current_loan_status",
    // Only check for actual success statuses (Originated, Funded, Purchased)
    // Do NOT use ILIKE '%closed%' - that matches adverse statuses like "File Closed for incompleteness"
    sqlCondition: `(current_loan_status ILIKE '%originated%' 
                   OR current_loan_status ILIKE '%funded%'
                   OR current_loan_status ILIKE '%purchased%')
                   AND closing_date IS NULL`,
    requiredColumns: ["current_loan_status", "closing_date"],
  },
  // Stale Active Loans - loans that have been "Active" for too long
  // These likely need status updates or represent stuck/abandoned applications
  // IMPORTANT: Ranges are mutually exclusive (4-6mo, 6-12mo, 1yr+) to avoid double counting
  {
    id: "stale_active_4_to_6_months",
    name: "Stale Active Loan (4-6 Months)",
    description:
      "Active Loan with application date 4-6 months ago - may need status review",
    severity: "warning",
    group: "Status Tests",
    field: "current_loan_status",
    sqlCondition: `current_loan_status = 'Active Loan' 
                   AND application_date IS NOT NULL 
                   AND application_date < CURRENT_DATE - INTERVAL '120 days'
                   AND application_date >= CURRENT_DATE - INTERVAL '180 days'`,
    requiredColumns: ["current_loan_status", "application_date"],
  },
  {
    id: "stale_active_6_to_12_months",
    name: "Stale Active Loan (6-12 Months)",
    description:
      "Active Loan with application date 6-12 months ago - likely requires attention",
    severity: "critical",
    group: "Status Tests",
    field: "current_loan_status",
    sqlCondition: `current_loan_status = 'Active Loan' 
                   AND application_date IS NOT NULL 
                   AND application_date < CURRENT_DATE - INTERVAL '180 days'
                   AND application_date >= CURRENT_DATE - INTERVAL '365 days'`,
    requiredColumns: ["current_loan_status", "application_date"],
  },
  {
    id: "stale_active_over_1_year",
    name: "Stale Active Loan (1+ Year)",
    description:
      "Active Loan with application date more than 1 year ago - urgently needs status update",
    severity: "critical",
    group: "Status Tests",
    field: "current_loan_status",
    sqlCondition: `current_loan_status = 'Active Loan' 
                   AND application_date IS NOT NULL 
                   AND application_date < CURRENT_DATE - INTERVAL '365 days'`,
    requiredColumns: ["current_loan_status", "application_date"],
  },
  {
    id: "denied_no_uw_denied_date",
    name: "Denied Loans with No UW Denied Date",
    description:
      "UW Denied Date is not populated; reporting and analytics use Current Status Date as fallback where applicable.",
    severity: "info",
    group: "Status Tests",
    field: "uw_denied_date",
    sqlCondition: `(current_loan_status ILIKE '%denied%' OR current_loan_status ILIKE '%declined%')
                   AND uw_denied_date IS NULL`,
    requiredColumns: ["current_loan_status", "uw_denied_date"],
  },

  // ============ DATE TESTS ============
  // These detect illogical date sequences
  {
    id: "funding_before_closing",
    name: "Funding Before Closing",
    description: "Funding date is before closing date - dates may be swapped",
    severity: "warning",
    group: "Date Tests",
    field: "funding_date",
    sqlCondition: `funding_date IS NOT NULL 
                   AND closing_date IS NOT NULL 
                   AND funding_date < closing_date`,
    requiredColumns: ["funding_date", "closing_date"],
  },
  {
    id: "closing_before_application",
    name: "Closing Before Application",
    description:
      "Closing date is before application date - impossible sequence",
    severity: "critical",
    group: "Date Tests",
    field: "closing_date",
    sqlCondition: `closing_date IS NOT NULL 
                   AND application_date IS NOT NULL 
                   AND closing_date < application_date`,
    requiredColumns: ["closing_date", "application_date"],
  },
  {
    id: "approval_before_submission",
    name: "UW Approval Before Submission",
    description:
      "UW approval date is before submission to underwriting - impossible sequence",
    severity: "critical",
    group: "Date Tests",
    field: "uw_approval_date",
    sqlCondition: `uw_approval_date IS NOT NULL 
                   AND submitted_to_underwriting_date IS NOT NULL 
                   AND uw_approval_date < submitted_to_underwriting_date`,
    requiredColumns: ["uw_approval_date", "submitted_to_underwriting_date"],
  },
  {
    id: "future_funding_date",
    name: "Future Funding Date",
    description:
      "Funding date is in the future - data entry error or placeholder",
    severity: "warning",
    group: "Date Tests",
    field: "funding_date",
    sqlCondition: `funding_date IS NOT NULL AND funding_date > CURRENT_DATE`,
    requiredColumns: ["funding_date"],
  },
  {
    id: "future_closing_date",
    name: "Future Closing Date (Past Expected)",
    description:
      "Closing date is in the future - verify this is expected or if it's a data entry error",
    severity: "info",
    group: "Date Tests",
    field: "closing_date",
    sqlCondition: `closing_date IS NOT NULL AND closing_date > CURRENT_DATE`,
    requiredColumns: ["closing_date"],
  },
  {
    id: "future_closing_date_far",
    name: "Closing Date Far in Future",
    description:
      "Closing date is more than 6 months in the future - likely a data entry error",
    severity: "warning",
    group: "Date Tests",
    field: "closing_date",
    sqlCondition: `closing_date IS NOT NULL AND closing_date > CURRENT_DATE + INTERVAL '6 months'`,
    requiredColumns: ["closing_date"],
  },
  // ============ HMDA COMPLIANCE TESTS ============
  // Based on FFIEC HMDA LAR requirements under Regulation C (12 CFR 1003)
  // Reference: https://ffiec.cfpb.gov/documentation/publications/loan-level-datasets/lar-data-fields
  // HMDA-reportable: Originated, Approved not accepted, Denied, Withdrawn, Closed incomplete, Purchased
  // Tests focus on originated/funded loans since they MUST be reported
  {
    id: "hmda_missing_loan_type",
    name: "HMDA: Missing Loan Type",
    description:
      "Loan type (Conventional/FHA/VA/USDA-RHS) required per 12 CFR 1003.4(a)(2)",
    severity: "critical",
    group: "Application Tests",
    field: "loan_type",
    sqlCondition: `(loan_type IS NULL OR TRIM(loan_type) = '')
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["loan_type", "current_loan_status"],
  },
  {
    id: "hmda_missing_loan_purpose",
    name: "HMDA: Missing Loan Purpose",
    description:
      "Loan purpose (Purchase/Refinance/Home Improvement) required per 12 CFR 1003.4(a)(3)",
    severity: "critical",
    group: "Application Tests",
    field: "loan_purpose",
    sqlCondition: `(loan_purpose IS NULL OR TRIM(loan_purpose) = '')
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["loan_purpose", "current_loan_status"],
  },
  {
    id: "hmda_missing_lien_status",
    name: "HMDA: Missing Lien Status",
    description:
      "Lien status (First/Subordinate lien) required per 12 CFR 1003.4(a)(14)",
    severity: "critical",
    group: "Application Tests",
    field: "lien_position",
    sqlCondition: `(lien_position IS NULL OR TRIM(lien_position) = '')
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["lien_position", "current_loan_status"],
  },
  {
    id: "hmda_missing_occupancy_type",
    name: "HMDA: Missing Occupancy Type",
    description:
      "Occupancy (Principal/Second/Investment) required per 12 CFR 1003.4(a)(29)",
    severity: "critical",
    group: "Application Tests",
    field: "occupancy_type",
    sqlCondition: `(occupancy_type IS NULL OR TRIM(occupancy_type) = '')
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["occupancy_type", "current_loan_status"],
  },
  {
    id: "hmda_missing_property_state",
    name: "HMDA: Missing Property State",
    description:
      "Property state required for HMDA geographic reporting per 12 CFR 1003.4(a)(9)(i)",
    severity: "critical",
    group: "Application Tests",
    field: "property_state",
    sqlCondition: `(property_state IS NULL OR TRIM(property_state) = '')
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["property_state", "current_loan_status"],
  },
  {
    id: "hmda_missing_county_fips",
    name: "HMDA: Missing County FIPS Code",
    description:
      "County FIPS code required for HMDA geographic reporting per 12 CFR 1003.4(a)(9)(ii)",
    severity: "warning",
    group: "Application Tests",
    field: "county_fips_code",
    sqlCondition: `(county_fips_code IS NULL OR TRIM(county_fips_code) = '')
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["county_fips_code", "current_loan_status"],
  },
  {
    id: "hmda_missing_loan_amount",
    name: "HMDA: Missing/Invalid Loan Amount",
    description: "Loan amount required for HMDA LAR per 12 CFR 1003.4(a)(7)",
    severity: "critical",
    group: "Application Tests",
    field: "loan_amount",
    sqlCondition: `(loan_amount IS NULL OR loan_amount <= 0)
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["loan_amount", "current_loan_status"],
  },
  {
    id: "hmda_missing_interest_rate",
    name: "HMDA: Missing Interest Rate",
    description:
      "Interest rate required for originated loans per 12 CFR 1003.4(a)(21)",
    severity: "warning",
    group: "Application Tests",
    field: "interest_rate",
    sqlCondition: `interest_rate IS NULL
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["interest_rate", "current_loan_status"],
  },
  {
    id: "hmda_missing_loan_term",
    name: "HMDA: Missing Loan Term",
    description:
      "Loan term (months) required for HMDA per 12 CFR 1003.4(a)(25)",
    severity: "warning",
    group: "Application Tests",
    field: "loan_term",
    sqlCondition: `(loan_term IS NULL OR loan_term <= 0)
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["loan_term", "current_loan_status"],
  },
  {
    id: "hmda_missing_property_value",
    name: "HMDA: Missing Property Value",
    description:
      "Property value (appraised or sales price) required per 12 CFR 1003.4(a)(28)",
    severity: "warning",
    group: "Application Tests",
    field: "appraised_value",
    sqlCondition: `(appraised_value IS NULL OR appraised_value <= 0)
                   AND (sales_price IS NULL OR sales_price <= 0)
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["appraised_value", "current_loan_status"],
  },
  {
    id: "hmda_missing_cltv",
    name: "HMDA: Missing Combined LTV",
    description:
      "Combined loan-to-value ratio required per 12 CFR 1003.4(a)(23)",
    severity: "info",
    group: "Application Tests",
    field: "cltv",
    sqlCondition: `cltv IS NULL
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["cltv", "current_loan_status"],
  },
  {
    id: "hmda_missing_total_units",
    name: "HMDA: Missing Number of Units",
    description: "Total dwelling units required per 12 CFR 1003.4(a)(30)",
    severity: "info",
    group: "Application Tests",
    field: "number_of_units",
    sqlCondition: `(number_of_units IS NULL OR number_of_units <= 0)
                   AND (current_loan_status ILIKE '%originated%' 
                        OR current_loan_status ILIKE '%funded%'
                        OR current_loan_status ILIKE '%purchased%')`,
    requiredColumns: ["number_of_units", "current_loan_status"],
  },
  // ============ TRID COMPLIANCE TESTS ============
  // TRID is triggered when lender receives all 6 pieces of information:
  // 1. Name, 2. Income, 3. SSN, 4. Property Address, 5. Estimated Property Value, 6. Loan Amount
  // These tests verify the 6 TRID trigger items are present when application date is set
  {
    id: "trid_missing_borrower_name",
    name: "TRID: Missing Borrower Name",
    description:
      "Borrower name is one of the 6 TRID trigger items required for application",
    severity: "warning",
    group: "Application Tests",
    field: "borrower_name",
    sqlCondition: `(borrower_name IS NULL OR TRIM(borrower_name) = '')
                   AND application_date IS NOT NULL`,
    requiredColumns: ["borrower_name", "application_date"],
  },
  {
    id: "trid_missing_income",
    name: "TRID: Missing Income",
    description:
      "Income is one of the 6 TRID trigger items required for application",
    severity: "warning",
    group: "Application Tests",
    field: "income_total_mo_income",
    sqlCondition: `income_total_mo_income IS NULL
                   AND application_date IS NOT NULL`,
    requiredColumns: ["income_total_mo_income", "application_date"],
  },
  {
    id: "trid_missing_property_address",
    name: "TRID: Missing Property Address",
    description:
      "Property address is one of the 6 TRID trigger items required for application",
    severity: "warning",
    group: "Application Tests",
    field: "property_street",
    sqlCondition: `(property_street IS NULL OR TRIM(property_street) = '')
                   AND application_date IS NOT NULL`,
    requiredColumns: ["property_street", "application_date"],
  },
  {
    id: "trid_missing_estimated_value",
    name: "TRID: Missing Estimated Property Value",
    description:
      "Both appraised value and sales price are missing — at least one is required as the TRID 'estimated property value' trigger item",
    severity: "warning",
    group: "Application Tests",
    field: "appraised_value",
    sqlCondition: `(appraised_value IS NULL OR appraised_value <= 0)
                   AND (sales_price IS NULL OR sales_price <= 0)
                   AND application_date IS NOT NULL`,
    requiredColumns: ["appraised_value", "sales_price", "application_date"],
  },
  {
    id: "trid_missing_loan_amount",
    name: "TRID: Missing Loan Amount Sought",
    description:
      "Mortgage loan amount sought is one of the 6 TRID trigger items required for application",
    severity: "warning",
    group: "Application Tests",
    field: "loan_amount",
    sqlCondition: `(loan_amount IS NULL OR loan_amount <= 0)
                   AND application_date IS NOT NULL`,
    requiredColumns: ["loan_amount", "application_date"],
  },

  // ============ CREDIT TESTS ============
  {
    id: "fico_out_of_range",
    name: "FICO Score Out of Range",
    description: "FICO score is outside valid range (300-850)",
    severity: "critical",
    group: "Credit Tests",
    field: "fico_score",
    sqlCondition: `fico_score IS NOT NULL AND (fico_score < 300 OR fico_score > 850)`,
    requiredColumns: ["fico_score"],
  },
  {
    id: "dti_over_100",
    name: "DTI Ratio Over 100%",
    description: "DTI ratio exceeds 100% - mathematically unusual",
    severity: "warning",
    group: "Credit Tests",
    field: "dti_ratio",
    sqlCondition: `dti_ratio IS NOT NULL AND dti_ratio > 100`,
    requiredColumns: ["dti_ratio"],
  },
  {
    id: "ltv_over_100",
    name: "LTV Ratio Over 100%",
    description:
      "LTV ratio exceeds 100% - verify property value and loan amount",
    severity: "warning",
    group: "Credit Tests",
    field: "ltv_ratio",
    sqlCondition: `ltv_ratio IS NOT NULL AND ltv_ratio > 100`,
    requiredColumns: ["ltv_ratio"],
  },
  {
    id: "missing_credit_pull",
    name: "Missing Credit Pull Date",
    description: "Credit pull date is missing for loans past application stage",
    severity: "info",
    group: "Credit Tests",
    field: "credit_pull_date",
    sqlCondition: `credit_pull_date IS NULL 
                   AND (submitted_to_processing_date IS NOT NULL 
                        OR submitted_to_underwriting_date IS NOT NULL)`,
    requiredColumns: ["credit_pull_date", "submitted_to_processing_date"],
  },

  // ============ UW TESTS ============
  {
    id: "missing_underwriter",
    name: "Missing Underwriter",
    description: "Underwriter is not assigned for loans in underwriting",
    severity: "warning",
    group: "UW Tests",
    field: "underwriter",
    sqlCondition: `(underwriter IS NULL OR TRIM(underwriter) = '' OR underwriter IN ('99-Missing', 'No Data'))
                   AND submitted_to_underwriting_date IS NOT NULL`,
    requiredColumns: ["underwriter", "submitted_to_underwriting_date"],
  },
  {
    id: "approved_no_approval_date",
    name: "Approved Without Approval Date",
    description: "Loan appears approved but has no UW approval date",
    severity: "warning",
    group: "UW Tests",
    field: "uw_approval_date",
    sqlCondition: `uw_approval_date IS NULL 
                   AND (current_loan_status ILIKE '%approved%' 
                        OR current_loan_status ILIKE '%clear to close%'
                        OR current_loan_status ILIKE '%ctc%')`,
    requiredColumns: ["uw_approval_date", "current_loan_status"],
  },

  // ============ MORTGAGE TESTS ============
  {
    id: "missing_loan_amount",
    name: "Missing Loan Amount",
    description: "Loan amount is missing or zero",
    severity: "critical",
    group: "Mortgage Tests",
    field: "loan_amount",
    sqlCondition: `loan_amount IS NULL OR loan_amount <= 0`,
    requiredColumns: ["loan_amount"],
  },
  {
    id: "interest_rate_out_of_range",
    name: "Interest Rate Out of Range",
    description: "Interest rate is outside expected range (0-15%)",
    severity: "critical",
    group: "Mortgage Tests",
    field: "interest_rate",
    sqlCondition: `interest_rate IS NOT NULL AND (interest_rate < 0 OR interest_rate > 15)`,
    requiredColumns: ["interest_rate"],
  },
  {
    id: "missing_loan_number",
    name: "Missing Loan Number",
    description: "Loan number is missing",
    severity: "critical",
    group: "Mortgage Tests",
    field: "loan_number",
    sqlCondition: `loan_number IS NULL OR TRIM(loan_number) = ''`,
    requiredColumns: ["loan_number"],
  },

  // ============ PERSONNEL TESTS ============
  {
    id: "missing_loan_officer",
    name: "Missing Loan Officer",
    description: "Loan officer is not assigned",
    severity: "warning",
    group: "Personnel Tests",
    field: "loan_officer",
    sqlCondition: `loan_officer IS NULL OR TRIM(loan_officer) = '' OR loan_officer IN ('99-Missing', 'No Data')`,
    requiredColumns: ["loan_officer"],
  },
  {
    id: "missing_processor",
    name: "Missing Processor",
    description: "Processor is not assigned for loans in processing",
    severity: "warning",
    group: "Personnel Tests",
    field: "processor",
    sqlCondition: `(processor IS NULL OR TRIM(processor) = '' OR processor IN ('99-Missing', 'No Data'))
                   AND submitted_to_processing_date IS NOT NULL`,
    requiredColumns: ["processor", "submitted_to_processing_date"],
  },
  {
    id: "missing_branch",
    name: "Missing Branch",
    description: "Branch is not assigned",
    severity: "warning",
    group: "Personnel Tests",
    field: "branch",
    sqlCondition: `branch IS NULL OR TRIM(branch) = '' OR branch IN ('99-Missing', 'No Data', 'No Branch Found')`,
    requiredColumns: ["branch"],
  },
  {
    id: "missing_closer",
    name: "Missing Closer",
    description: "Closer is not assigned for loans approaching closing",
    severity: "info",
    group: "Personnel Tests",
    field: "closer",
    sqlCondition: `(closer IS NULL OR TRIM(closer) = '' OR closer IN ('99-Missing', 'No Data'))
                   AND (ctc_date IS NOT NULL OR closing_date IS NOT NULL)`,
    requiredColumns: ["closer", "ctc_date"],
  },
];

/**
 * GET /api/data-quality/crucial-fields-status
 * Returns field population health grouped by lifecycle stage.
 * Each field is measured against its applicable loan subset (not the whole portfolio),
 * so stage-gated fields like funding_date are only checked on originated/funded loans.
 */
router.get(
  "/crucial-fields-status",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Check which columns exist in the loans table
      const columnsResult = await tenantPool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'loans'
      `);
      const existingColumns = new Set(
        columnsResult.rows.map((r: { column_name: string }) => r.column_name)
      );

      // Get applicable loan counts for each stage group denominator
      const stageCountResults = await tenantPool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE ${STAGE_FILTERS.originated}) AS originated,
          COUNT(*) FILTER (WHERE ${STAGE_FILTERS.processing}) AS processing
        FROM loans
        WHERE current_loan_status IS NOT NULL
      `);
      const row = stageCountResults.rows[0] || {};
      const stageCounts: Record<CrucialFieldStage, number> = {
        universal:  parseInt(row.total      || "0"),
        originated: parseInt(row.originated || "0"),
        processing: parseInt(row.processing || "0"),
      };

      if (stageCounts.universal === 0) {
        return res.json({
          success: true,
          stageGroups: {
            universal:  { label: "Universal Fields",             applicableLoanCount: 0, fields: [] },
            originated: { label: "Originated / Funded Fields",   applicableLoanCount: 0, fields: [] },
            processing: { label: "Processing / Underwriting Fields", applicableLoanCount: 0, fields: [] },
          },
          totalLoans: 0,
        });
      }

      // Build per-field results grouped by stage
      const groupedFields: Record<CrucialFieldStage, object[]> = {
        universal:  [],
        originated: [],
        processing: [],
      };

      for (const field of CRUCIAL_FIELDS) {
        const whereFilter = field.applicableFilter ?? STAGE_FILTERS[field.stage];
        const applicableLoanCount = field.applicableFilter
          ? (() => {
              // Will be filled by a per-field query below
              return -1;
            })()
          : stageCounts[field.stage];

        if (!existingColumns.has(field.column)) {
          // Column missing from schema entirely
          const applicableCount = field.applicableFilter
            ? 0
            : stageCounts[field.stage];
          groupedFields[field.stage].push({
            name: field.name,
            column: field.column,
            priority: field.priority,
            applicableLoanCount: applicableCount,
            populatedCount: 0,
            missingCount: applicableCount,
            populationRate: 0,
            status: "critical",
            columnMissing: true,
          });
          continue;
        }

        // Query: applicable count + populated count in a single pass
        const result = await tenantPool.query(`
          SELECT
            COUNT(*) AS applicable,
            COUNT(*) FILTER (
              WHERE ${field.column} IS NOT NULL
                AND TRIM(CAST(${field.column} AS TEXT)) != ''
                AND CAST(${field.column} AS TEXT) NOT IN ('99-Missing', 'No Data', 'No Branch Found')
            ) AS populated
          FROM loans
          WHERE ${whereFilter}
        `);

        const applicable  = parseInt(result.rows[0]?.applicable || "0");
        const populated   = parseInt(result.rows[0]?.populated  || "0");
        const missing     = applicable - populated;
        const rate        = applicable > 0 ? (populated / applicable) * 100 : 0;

        groupedFields[field.stage].push({
          name: field.name,
          column: field.column,
          priority: field.priority,
          applicableLoanCount: applicable,
          populatedCount: populated,
          missingCount: missing,
          populationRate: Math.round(rate * 10) / 10,
          status: rate >= 95 ? "good" : rate >= 70 ? "warning" : "critical",
        });
      }

      res.json({
        success: true,
        stageGroups: {
          universal: {
            label: "Universal Fields",
            description: "Required on every loan regardless of status or outcome",
            applicableLoanCount: stageCounts.universal,
            fields: groupedFields.universal,
          },
          originated: {
            label: "Originated / Funded Fields",
            description: "Only expected once a loan successfully closes or funds",
            applicableLoanCount: stageCounts.originated,
            fields: groupedFields.originated,
          },
          processing: {
            label: "Processing & Underwriting Fields",
            description: "Expected as loans progress beyond the initial active stage",
            applicableLoanCount: stageCounts.processing,
            fields: groupedFields.processing,
          },
        },
        totalLoans: stageCounts.universal,
      });
    } catch (error: unknown) {
      logError("Error fetching crucial fields status", { error });
      res.status(500).json({ error: "Failed to fetch crucial fields status" });
    }
  }
);

/**
 * GET /api/data-quality/range-analysis
 * Get distribution data for key metrics (FICO, LTV, DTI, Interest Rate)
 */
router.get(
  "/range-analysis",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Check which columns exist
      const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
      const existingColumns = new Set(
        columnsResult.rows.map((r) => r.column_name)
      );

      const rangeAnalysis: Record<
        string,
        {
          inRange: number;
          outOfRange: number;
          distribution: { range: string; count: number }[];
        }
      > = {};

      // FICO Score Analysis (300-850)
      if (existingColumns.has("fico_score")) {
        const ficoResult = await tenantPool.query(`
        SELECT 
          SUM(CASE WHEN fico_score >= 300 AND fico_score <= 850 THEN 1 ELSE 0 END) as in_range,
          SUM(CASE WHEN fico_score < 300 OR fico_score > 850 THEN 1 ELSE 0 END) as out_of_range,
          SUM(CASE WHEN fico_score >= 300 AND fico_score <= 579 THEN 1 ELSE 0 END) as range_300_579,
          SUM(CASE WHEN fico_score >= 580 AND fico_score <= 669 THEN 1 ELSE 0 END) as range_580_669,
          SUM(CASE WHEN fico_score >= 670 AND fico_score <= 739 THEN 1 ELSE 0 END) as range_670_739,
          SUM(CASE WHEN fico_score >= 740 AND fico_score <= 799 THEN 1 ELSE 0 END) as range_740_799,
          SUM(CASE WHEN fico_score >= 800 AND fico_score <= 850 THEN 1 ELSE 0 END) as range_800_850
        FROM loans
        WHERE fico_score IS NOT NULL
      `);

        const r = ficoResult.rows[0] || {};
        rangeAnalysis.fico = {
          inRange: parseInt(r.in_range || "0"),
          outOfRange: parseInt(r.out_of_range || "0"),
          distribution: [
            { range: "300-579", count: parseInt(r.range_300_579 || "0") },
            { range: "580-669", count: parseInt(r.range_580_669 || "0") },
            { range: "670-739", count: parseInt(r.range_670_739 || "0") },
            { range: "740-799", count: parseInt(r.range_740_799 || "0") },
            { range: "800-850", count: parseInt(r.range_800_850 || "0") },
            { range: "Out of Range", count: parseInt(r.out_of_range || "0") },
          ],
        };
      }

      // LTV Ratio Analysis (0-100%)
      if (existingColumns.has("ltv_ratio")) {
        const ltvResult = await tenantPool.query(`
        SELECT 
          SUM(CASE WHEN ltv_ratio >= 0 AND ltv_ratio <= 100 THEN 1 ELSE 0 END) as in_range,
          SUM(CASE WHEN ltv_ratio < 0 OR ltv_ratio > 100 THEN 1 ELSE 0 END) as out_of_range,
          SUM(CASE WHEN ltv_ratio >= 0 AND ltv_ratio <= 60 THEN 1 ELSE 0 END) as range_0_60,
          SUM(CASE WHEN ltv_ratio > 60 AND ltv_ratio <= 70 THEN 1 ELSE 0 END) as range_61_70,
          SUM(CASE WHEN ltv_ratio > 70 AND ltv_ratio <= 80 THEN 1 ELSE 0 END) as range_71_80,
          SUM(CASE WHEN ltv_ratio > 80 AND ltv_ratio <= 90 THEN 1 ELSE 0 END) as range_81_90,
          SUM(CASE WHEN ltv_ratio > 90 AND ltv_ratio <= 100 THEN 1 ELSE 0 END) as range_91_100
        FROM loans
        WHERE ltv_ratio IS NOT NULL
      `);

        const r = ltvResult.rows[0] || {};
        rangeAnalysis.ltv = {
          inRange: parseInt(r.in_range || "0"),
          outOfRange: parseInt(r.out_of_range || "0"),
          distribution: [
            { range: "0-60%", count: parseInt(r.range_0_60 || "0") },
            { range: "61-70%", count: parseInt(r.range_61_70 || "0") },
            { range: "71-80%", count: parseInt(r.range_71_80 || "0") },
            { range: "81-90%", count: parseInt(r.range_81_90 || "0") },
            { range: "91-100%", count: parseInt(r.range_91_100 || "0") },
            { range: "Over 100%", count: parseInt(r.out_of_range || "0") },
          ],
        };
      }

      // DTI Ratio Analysis (0-100%)
      if (existingColumns.has("dti_ratio")) {
        const dtiResult = await tenantPool.query(`
        SELECT 
          SUM(CASE WHEN dti_ratio >= 0 AND dti_ratio <= 100 THEN 1 ELSE 0 END) as in_range,
          SUM(CASE WHEN dti_ratio < 0 OR dti_ratio > 100 THEN 1 ELSE 0 END) as out_of_range,
          SUM(CASE WHEN dti_ratio >= 0 AND dti_ratio <= 20 THEN 1 ELSE 0 END) as range_0_20,
          SUM(CASE WHEN dti_ratio > 20 AND dti_ratio <= 35 THEN 1 ELSE 0 END) as range_21_35,
          SUM(CASE WHEN dti_ratio > 35 AND dti_ratio <= 43 THEN 1 ELSE 0 END) as range_36_43,
          SUM(CASE WHEN dti_ratio > 43 AND dti_ratio <= 50 THEN 1 ELSE 0 END) as range_44_50,
          SUM(CASE WHEN dti_ratio > 50 AND dti_ratio <= 100 THEN 1 ELSE 0 END) as range_51_100
        FROM loans
        WHERE dti_ratio IS NOT NULL
      `);

        const r = dtiResult.rows[0] || {};
        rangeAnalysis.dti = {
          inRange: parseInt(r.in_range || "0"),
          outOfRange: parseInt(r.out_of_range || "0"),
          distribution: [
            { range: "0-20%", count: parseInt(r.range_0_20 || "0") },
            { range: "21-35%", count: parseInt(r.range_21_35 || "0") },
            { range: "36-43%", count: parseInt(r.range_36_43 || "0") },
            { range: "44-50%", count: parseInt(r.range_44_50 || "0") },
            { range: "51-100%", count: parseInt(r.range_51_100 || "0") },
            { range: "Over 100%", count: parseInt(r.out_of_range || "0") },
          ],
        };
      }

      // Interest Rate Analysis (0-15%)
      if (existingColumns.has("interest_rate")) {
        const rateResult = await tenantPool.query(`
        SELECT 
          SUM(CASE WHEN interest_rate >= 0 AND interest_rate <= 15 THEN 1 ELSE 0 END) as in_range,
          SUM(CASE WHEN interest_rate < 0 OR interest_rate > 15 THEN 1 ELSE 0 END) as out_of_range,
          SUM(CASE WHEN interest_rate >= 0 AND interest_rate <= 3 THEN 1 ELSE 0 END) as range_0_3,
          SUM(CASE WHEN interest_rate > 3 AND interest_rate <= 5 THEN 1 ELSE 0 END) as range_3_5,
          SUM(CASE WHEN interest_rate > 5 AND interest_rate <= 7 THEN 1 ELSE 0 END) as range_5_7,
          SUM(CASE WHEN interest_rate > 7 AND interest_rate <= 10 THEN 1 ELSE 0 END) as range_7_10,
          SUM(CASE WHEN interest_rate > 10 AND interest_rate <= 15 THEN 1 ELSE 0 END) as range_10_15
        FROM loans
        WHERE interest_rate IS NOT NULL
      `);

        const r = rateResult.rows[0] || {};
        rangeAnalysis.interestRate = {
          inRange: parseInt(r.in_range || "0"),
          outOfRange: parseInt(r.out_of_range || "0"),
          distribution: [
            { range: "0-3%", count: parseInt(r.range_0_3 || "0") },
            { range: "3-5%", count: parseInt(r.range_3_5 || "0") },
            { range: "5-7%", count: parseInt(r.range_5_7 || "0") },
            { range: "7-10%", count: parseInt(r.range_7_10 || "0") },
            { range: "10-15%", count: parseInt(r.range_10_15 || "0") },
            { range: "Over 15%", count: parseInt(r.out_of_range || "0") },
          ],
        };
      }

      res.json({
        success: true,
        rangeAnalysis,
      });
    } catch (error: unknown) {
      logError("Error fetching range analysis", { error });
      res.status(500).json({ error: "Failed to fetch range analysis" });
    }
  }
);

/**
 * Helper function to run a data quality test
 */
async function runDataQualityTest(
  tenantPool: any,
  test: DataQualityTest,
  existingColumns: Set<string>
): Promise<{
  id: string;
  name: string;
  type: string;
  group: WarningGroup;
  severity: string;
  field: string;
  description: string;
  count: number;
  sample_loans: Array<{
    loan_id: string;
    loan_number: string | null;
    field_value?: any;
  }>;
} | null> {
  // Check if all required columns exist
  const missingColumns = test.requiredColumns.filter(
    (col) => !existingColumns.has(col)
  );
  if (missingColumns.length > 0) {
    return null; // Skip this test - required columns don't exist
  }

  try {
    // Get sample loans that match the condition
    const sampleResult = await tenantPool.query(`
      SELECT loan_id, loan_number, ${test.field} as field_value
      FROM loans
      WHERE ${test.sqlCondition}
      LIMIT 5
    `);

    if (sampleResult.rows.length === 0) {
      return null; // No issues found for this test
    }

    // Count total matches
    const countResult = await tenantPool.query(`
      SELECT COUNT(*) as count FROM loans WHERE ${test.sqlCondition}
    `);

    return {
      id: test.id,
      name: test.name,
      type: test.id,
      group: test.group,
      severity: test.severity,
      field: test.field,
      description: test.description,
      count: parseInt(countResult.rows[0]?.count || "0"),
      sample_loans: sampleResult.rows.map((r: any) => ({
        loan_id: r.loan_id,
        loan_number: r.loan_number,
        field_value: r.field_value,
      })),
    };
  } catch (error) {
    logWarn(`Data quality test ${test.id} failed`, { error, test: test.id });
    return null;
  }
}

/**
 * GET /api/data-quality/warnings-grouped
 * Get data quality warnings grouped by type (Qlik DataPilot style)
 */
router.get(
  "/warnings-grouped",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;
      const { group } = req.query; // Optional filter by warning group

      // Check which columns exist
      const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
      const existingColumns = new Set(
        columnsResult.rows.map((r: any) => r.column_name)
      );

      // Filter tests by group if specified
      const testsToRun = group
        ? DATA_QUALITY_TESTS.filter((t) => t.group === group)
        : DATA_QUALITY_TESTS;

      // Run all applicable tests in parallel
      const testResults = await Promise.all(
        testsToRun.map((test) =>
          runDataQualityTest(tenantPool, test, existingColumns)
        )
      );

      // Filter out null results (tests that didn't run or found no issues)
      const warnings = testResults.filter(
        (r): r is NonNullable<typeof r> => r !== null
      );

      // Group warnings by group for summary
      const groupedSummary: Record<
        string,
        {
          count: number;
          criticalCount: number;
          warningCount: number;
          infoCount: number;
        }
      > = {};

      for (const warning of warnings) {
        if (!groupedSummary[warning.group]) {
          groupedSummary[warning.group] = {
            count: 0,
            criticalCount: 0,
            warningCount: 0,
            infoCount: 0,
          };
        }
        groupedSummary[warning.group].count += warning.count;
        if (warning.severity === "critical")
          groupedSummary[warning.group].criticalCount += warning.count;
        if (warning.severity === "warning")
          groupedSummary[warning.group].warningCount += warning.count;
        if (warning.severity === "info")
          groupedSummary[warning.group].infoCount += warning.count;
      }

      // Calculate totals by severity
      const totalsBySeverity = {
        critical: warnings
          .filter((w) => w.severity === "critical")
          .reduce((sum, w) => sum + w.count, 0),
        warning: warnings
          .filter((w) => w.severity === "warning")
          .reduce((sum, w) => sum + w.count, 0),
        info: warnings
          .filter((w) => w.severity === "info")
          .reduce((sum, w) => sum + w.count, 0),
      };

      res.json({
        success: true,
        warnings,
        groupedSummary,
        totalsBySeverity,
        totalWarnings: warnings.reduce((sum, w) => sum + w.count, 0),
        availableGroups: [...new Set(DATA_QUALITY_TESTS.map((t) => t.group))],
      });
    } catch (error: unknown) {
      logError("Error fetching grouped warnings", { error });
      res.status(500).json({ error: "Failed to fetch grouped warnings" });
    }
  }
);

/**
 * GET /api/data-quality/status-inconsistencies
 * Get status inconsistency warnings specifically (active loans with funding dates, etc.)
 * This is a focused endpoint for the most critical data quality issues
 */
router.get(
  "/status-inconsistencies",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Check which columns exist
      const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
      const existingColumns = new Set(
        columnsResult.rows.map((r: any) => r.column_name)
      );

      // Run only Status Tests
      const statusTests = DATA_QUALITY_TESTS.filter(
        (t) => t.group === "Status Tests"
      );
      const testResults = await Promise.all(
        statusTests.map((test) =>
          runDataQualityTest(tenantPool, test, existingColumns)
        )
      );

      const inconsistencies = testResults.filter(
        (r): r is NonNullable<typeof r> => r !== null
      );

      // Get status distribution for context
      // IMPORTANT: "Active Loan" per metricsService.ts definition requires:
      // - current_loan_status = 'Active Loan' (exact match)
      // - application_date IS NOT NULL AND application_date::text != ''
      let statusDistribution: Array<{
        status: string;
        count: number;
        status_group: string;
      }> = [];

      // Calculate status group totals using the EXACT same logic as metricsService.ts
      const statusGroupTotals: Record<string, number> = {
        Active: 0,
        Originated: 0,
        Adverse: 0,
      };

      if (existingColumns.has("current_loan_status")) {
        // Get Active count - EXACT match to metricsService.ts active_loans definition
        const activeResult = await tenantPool.query(`
          SELECT COUNT(*) as count
          FROM loans
          WHERE current_loan_status = 'Active Loan'
            AND application_date IS NOT NULL
            AND application_date::text != ''
        `);
        statusGroupTotals.Active = parseInt(activeResult.rows[0]?.count || "0");

        // Get Originated count - loans with funding date
        const originatedResult = await tenantPool.query(`
          SELECT COUNT(*) as count
          FROM loans
          WHERE (current_loan_status ILIKE '%funded%' 
                 OR current_loan_status ILIKE '%originated%' 
                 OR current_loan_status ILIKE '%purchased%')
        `);
        statusGroupTotals.Originated = parseInt(
          originatedResult.rows[0]?.count || "0"
        );

        // Get Adverse count - everything else that's not Active or Originated
        const adverseResult = await tenantPool.query(`
          SELECT COUNT(*) as count
          FROM loans
          WHERE current_loan_status IS NOT NULL
            AND current_loan_status != 'Active Loan'
            AND current_loan_status NOT ILIKE '%funded%'
            AND current_loan_status NOT ILIKE '%originated%'
            AND current_loan_status NOT ILIKE '%purchased%'
        `);
        statusGroupTotals.Adverse = parseInt(
          adverseResult.rows[0]?.count || "0"
        );

        // Also get top statuses for display (informational only)
        const statusResult = await tenantPool.query(`
          SELECT 
            current_loan_status as status,
            COUNT(*) as count,
            CASE 
              WHEN current_loan_status = 'Active Loan' THEN 'Active'
              WHEN current_loan_status ILIKE '%funded%' OR current_loan_status ILIKE '%originated%' OR current_loan_status ILIKE '%purchased%' THEN 'Originated'
              ELSE 'Adverse'
            END as status_group
          FROM loans
          WHERE current_loan_status IS NOT NULL
          GROUP BY current_loan_status
          ORDER BY count DESC
          LIMIT 20
        `);
        statusDistribution = statusResult.rows.map((r: any) => ({
          status: r.status,
          count: parseInt(r.count),
          status_group: r.status_group,
        }));
      }

      res.json({
        success: true,
        inconsistencies,
        totalInconsistencies: inconsistencies.reduce(
          (sum, i) => sum + i.count,
          0
        ),
        statusDistribution,
        statusGroupTotals,
      });
    } catch (error: unknown) {
      logError("Error fetching status inconsistencies", { error });
      res.status(500).json({ error: "Failed to fetch status inconsistencies" });
    }
  }
);

/**
 * GET /api/data-quality/date-sequence-issues
 * Get date sequence validation issues (dates out of logical order)
 */
router.get(
  "/date-sequence-issues",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Check which columns exist
      const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
      const existingColumns = new Set(
        columnsResult.rows.map((r: any) => r.column_name)
      );

      // Run only Date Tests
      const dateTests = DATA_QUALITY_TESTS.filter(
        (t) => t.group === "Date Tests"
      );
      const testResults = await Promise.all(
        dateTests.map((test) =>
          runDataQualityTest(tenantPool, test, existingColumns)
        )
      );

      const dateIssues = testResults.filter(
        (r): r is NonNullable<typeof r> => r !== null
      );

      res.json({
        success: true,
        dateIssues,
        totalDateIssues: dateIssues.reduce((sum, i) => sum + i.count, 0),
      });
    } catch (error: unknown) {
      logError("Error fetching date sequence issues", { error });
      res.status(500).json({ error: "Failed to fetch date sequence issues" });
    }
  }
);

/**
 * GET /api/data-quality/warning-loans/:testId
 * Get detailed loan information for a specific data quality test
 * Includes relevant fields to help verify and investigate the issue
 */
router.get(
  "/warning-loans/:testId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { testId } = req.params;
      const { limit = "50", offset = "0" } = req.query;
      const tenantPool = getTenantContext(req).tenantPool;

      // Find the test definition
      const test = DATA_QUALITY_TESTS.find((t) => t.id === testId);
      if (!test) {
        return res.status(404).json({ error: "Test not found", testId });
      }

      // Check which columns exist
      const columnsResult = await tenantPool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'loans'
      `);
      const existingColumns = new Set(
        columnsResult.rows.map((r: any) => r.column_name)
      );

      // Check if required columns exist
      const missingColumns = test.requiredColumns.filter(
        (col) => !existingColumns.has(col)
      );
      if (missingColumns.length > 0) {
        return res.json({
          success: true,
          test: {
            id: test.id,
            name: test.name,
            description: test.description,
            group: test.group,
            severity: test.severity,
          },
          loans: [],
          totalCount: 0,
          missingColumns,
        });
      }

      // Get search query if provided
      const { search = "" } = req.query;
      const searchTerm = (search as string).trim().toLowerCase();

      // Determine which fields to select based on the test type
      // Base fields always included for identification
      const baseFields = ["loan_id", "loan_number"];

      // Core personnel fields - always useful for context
      const personnelFields = [
        "loan_officer",
        "processor",
        "underwriter",
        "closer",
        "branch",
      ];

      // Core date fields - always useful for timeline context
      const coreDateFields = [
        "application_date",
        "started_date",
        "closing_date",
        "funding_date",
      ];

      // Group-specific additional fields
      const relevantFields: string[] = [];

      // Add test-specific fields
      if (test.group === "Status Tests") {
        relevantFields.push(
          "current_loan_status",
          "current_status_date",
          "loan_amount",
          // Additional dates for status context
          "submitted_to_processing_date",
          "submitted_to_underwriting_date",
          "uw_approval_date",
          "ctc_date"
        );
      } else if (test.group === "Date Tests") {
        relevantFields.push(
          "current_loan_status",
          "uw_approval_date",
          "submitted_to_underwriting_date",
          "submitted_to_processing_date",
          "ctc_date",
          "docs_out_date",
          "loan_amount"
        );
      } else if (test.group === "Credit Tests") {
        relevantFields.push(
          "fico_score",
          "ltv_ratio",
          "dti_ratio",
          "cltv",
          "credit_pull_date",
          "current_loan_status",
          "loan_amount"
        );
      } else if (test.group === "UW Tests") {
        relevantFields.push(
          "uw_approval_date",
          "uw_final_approval_date",
          "submitted_to_underwriting_date",
          "conditional_approval_date",
          "uw_denied_date",
          "current_loan_status",
          "loan_amount"
        );
      } else if (test.group === "Mortgage Tests") {
        relevantFields.push(
          "loan_amount",
          "interest_rate",
          "loan_type",
          "loan_purpose",
          "property_type",
          "occupancy_type",
          "current_loan_status"
        );
      } else if (test.group === "Personnel Tests") {
        // Personnel tests already have personnel fields in base, add more context
        relevantFields.push(
          "account_executive",
          "current_loan_status",
          "loan_amount"
        );
      } else if (test.group === "Application Tests") {
        relevantFields.push(
          "loan_estimate_sent_date",
          "loan_estimate_received_date",
          "closing_disclosure_sent_date",
          "loan_type",
          "loan_purpose",
          "property_type",
          "occupancy_type",
          "lien_position",
          "current_loan_status",
          "loan_amount",
          // Include both value fields so the TRID estimated-value check is self-explanatory:
          // the warning fires when BOTH appraised_value AND sales_price are NULL/zero.
          "appraised_value",
          "sales_price"
        );
      }

      // Always include the primary field being tested
      if (!relevantFields.includes(test.field)) {
        relevantFields.push(test.field);
      }

      // Combine all fields: base + personnel + dates + relevant (avoiding duplicates)
      const allRequestedFields = [
        ...baseFields,
        ...personnelFields,
        ...coreDateFields,
        ...relevantFields,
      ];

      // Filter to only include columns that exist and deduplicate
      const uniqueFields = [...new Set(allRequestedFields)].filter((f) =>
        existingColumns.has(f)
      );

      // Build search condition if search term provided
      let searchCondition = "";
      const searchParams: string[] = [];
      let paramIndex = 1;

      if (searchTerm) {
        // Search across multiple fields
        const searchableFields = [
          "loan_id",
          "loan_number",
          "loan_officer",
          "processor",
          "underwriter",
          "closer",
          "branch",
        ].filter((f) => existingColumns.has(f));

        if (searchableFields.length > 0) {
          const searchClauses = searchableFields.map((f) => {
            searchParams.push(`%${searchTerm}%`);
            return `LOWER(CAST(${f} AS TEXT)) LIKE $${paramIndex++}`;
          });
          searchCondition = ` AND (${searchClauses.join(" OR ")})`;
        }
      }

      // Get total count (without search for full count)
      const totalCountResult = await tenantPool.query(`
        SELECT COUNT(*) as count FROM loans WHERE ${test.sqlCondition}
      `);
      const totalCount = parseInt(totalCountResult.rows[0]?.count || "0");

      // Get filtered count (with search)
      let filteredCount = totalCount;
      if (searchTerm && searchCondition) {
        const filteredCountResult = await tenantPool.query(
          `SELECT COUNT(*) as count FROM loans WHERE ${test.sqlCondition}${searchCondition}`,
          searchParams
        );
        filteredCount = parseInt(filteredCountResult.rows[0]?.count || "0");
      }

      // Get loan details with search and pagination
      const queryParams = [
        ...searchParams,
        parseInt(limit as string),
        parseInt(offset as string),
      ];
      const loansResult = await tenantPool.query(
        `
        SELECT ${uniqueFields.join(", ")}
        FROM loans
        WHERE ${test.sqlCondition}${searchCondition}
        ORDER BY application_date DESC NULLS LAST, loan_number ASC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
        queryParams
      );

      // Format dates for display
      const loans = loansResult.rows.map((loan: any) => {
        const formatted: any = {};
        for (const [key, value] of Object.entries(loan)) {
          if (value instanceof Date) {
            formatted[key] = value.toISOString().split("T")[0];
          } else {
            formatted[key] = value;
          }
        }
        return formatted;
      });

      res.json({
        success: true,
        test: {
          id: test.id,
          name: test.name,
          description: test.description,
          group: test.group,
          severity: test.severity,
          field: test.field,
        },
        loans,
        totalCount,
        filteredCount,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        fields: uniqueFields,
        searchApplied: !!searchTerm,
      });
    } catch (error: unknown) {
      logError("Error fetching warning loans", { error });
      res.status(500).json({ error: "Failed to fetch warning loans" });
    }
  }
);

/**
 * GET /api/data-quality/metrics
 * Get overall data quality metrics summary using comprehensive tests
 */
router.get(
  "/metrics",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Get total loan count
      const countResult = await tenantPool.query(
        "SELECT COUNT(*) as total FROM loans"
      );
      const totalLoans = parseInt(countResult.rows[0]?.total || "0");

      if (totalLoans === 0) {
        return res.json({
          success: true,
          metrics: {
            total_loans: 0,
            loans_with_issues: 0,
            total_issues: 0,
            quality_score: 100,
            critical_issues: 0,
            warning_issues: 0,
            info_issues: 0,
            status_inconsistencies: 0,
            date_sequence_issues: 0,
          },
        });
      }

      // Get existing columns
      const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
      const existingColumns = new Set(
        columnsResult.rows.map((r: any) => r.column_name)
      );

      // Run all tests and aggregate by severity
      const testResults = await Promise.all(
        DATA_QUALITY_TESTS.map((test) =>
          runDataQualityTest(tenantPool, test, existingColumns)
        )
      );

      const validResults = testResults.filter(
        (r): r is NonNullable<typeof r> => r !== null
      );

      // Count by severity
      let criticalIssues = 0;
      let warningIssues = 0;
      let infoIssues = 0;
      let statusInconsistencies = 0;
      let dateSequenceIssues = 0;

      for (const result of validResults) {
        if (result.severity === "critical") criticalIssues += result.count;
        else if (result.severity === "warning") warningIssues += result.count;
        else if (result.severity === "info") infoIssues += result.count;

        if (result.group === "Status Tests")
          statusInconsistencies += result.count;
        if (result.group === "Date Tests") dateSequenceIssues += result.count;
      }

      const totalIssues = criticalIssues + warningIssues + infoIssues;

      // Get unique loans with issues (approximate by using a UNION of key issue types)
      let loansWithIssuesCount = 0;
      try {
        // Build a query to count unique loans with any critical issue
        const criticalTests = DATA_QUALITY_TESTS.filter(
          (t) => t.severity === "critical"
        );
        const applicableTests = criticalTests.filter((t) =>
          t.requiredColumns.every((col) => existingColumns.has(col))
        );

        if (applicableTests.length > 0) {
          const unionQuery = applicableTests
            .map(
              (t) =>
                `SELECT DISTINCT loan_id FROM loans WHERE ${t.sqlCondition}`
            )
            .join(" UNION ");

          const uniqueLoansResult = await tenantPool.query(`
          SELECT COUNT(*) as count FROM (${unionQuery}) as unique_loans
        `);
          loansWithIssuesCount = parseInt(
            uniqueLoansResult.rows[0]?.count || "0"
          );
        }
      } catch (error) {
        // Fallback to estimate
        loansWithIssuesCount = Math.min(totalIssues, totalLoans);
      }

      // Calculate quality score (100 - percentage of loans with issues, weighted by severity)
      const weightedIssueScore =
        (criticalIssues * 3 + warningIssues * 2 + infoIssues * 1) / totalLoans;
      const qualityScore = Math.max(
        0,
        Math.min(100, Math.round(100 - weightedIssueScore * 10))
      );

      // Issues by group
      const issuesByGroup: Record<string, number> = {};
      for (const result of validResults) {
        issuesByGroup[result.group] =
          (issuesByGroup[result.group] || 0) + result.count;
      }

      res.json({
        success: true,
        metrics: {
          total_loans: totalLoans,
          loans_with_issues: loansWithIssuesCount,
          total_issues: totalIssues,
          quality_score: qualityScore,
          critical_issues: criticalIssues,
          warning_issues: warningIssues,
          info_issues: infoIssues,
          status_inconsistencies: statusInconsistencies,
          date_sequence_issues: dateSequenceIssues,
          issues_by_group: issuesByGroup,
        },
      });
    } catch (error: unknown) {
      logError("Error fetching data quality metrics", { error });
      res.status(500).json({ error: "Failed to fetch data quality metrics" });
    }
  }
);

/**
 * GET /api/data-quality/field-missing-loans
 * Returns loans where a given crucial field is NULL or blank.
 * Only loans within the field's applicable stage filter are included.
 * Supports search, sort (by column name), and pagination.
 */
router.get(
  "/field-missing-loans",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const {
        field: fieldColumn,
        search = "",
        limit = "100",
        offset = "0",
        sort = "application_date",
        sortDir = "desc",
      } = req.query as Record<string, string>;

      if (!fieldColumn) {
        return res.status(400).json({ error: "field query parameter is required" });
      }

      const tenantPool = getTenantContext(req).tenantPool;

      // Validate the column actually exists to prevent SQL injection
      const colCheckResult = await tenantPool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = $1`,
        [fieldColumn]
      );
      if (colCheckResult.rows.length === 0) {
        return res.status(400).json({ error: `Unknown column: ${fieldColumn}` });
      }

      // Look up CRUCIAL_FIELDS definition if available (provides stage filter context)
      const fieldDef = CRUCIAL_FIELDS.find((f) => f.column === fieldColumn);

      // Allowed columns for both display and sort — prevents SQL injection
      const CONTEXT_COLUMNS = [
        "loan_id",
        "loan_number",
        "current_loan_status",
        "loan_officer",
        "processor",
        "underwriter",
        "closer",
        "branch",
        "loan_amount",
        "application_date",
        "started_date",
        "closing_date",
        "funding_date",
        "current_status_date",
      ];

      // Check which context columns actually exist
      const columnsResult = await tenantPool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'loans'
      `);
      const existingColumns = new Set(
        columnsResult.rows.map((r: { column_name: string }) => r.column_name)
      );

      // Include the target field in the output so the user can see its raw value (should be NULL)
      const displayColumns = [
        ...CONTEXT_COLUMNS,
        ...(CONTEXT_COLUMNS.includes(fieldColumn) ? [] : [fieldColumn]),
      ].filter((c) => existingColumns.has(c));

      // WHERE: only applicable loans, AND the field is missing
      // If the field is not in CRUCIAL_FIELDS, default to all loans (no stage filter)
      const stageFilter = fieldDef
        ? (fieldDef.applicableFilter ?? STAGE_FILTERS[fieldDef.stage])
        : "TRUE";
      const missingCondition = `(
        ${fieldColumn} IS NULL
        OR TRIM(CAST(${fieldColumn} AS TEXT)) = ''
        OR CAST(${fieldColumn} AS TEXT) IN ('99-Missing', 'No Data', 'No Branch Found')
      )`;

      // Search condition
      const searchTerm = (search as string).trim().toLowerCase();
      const searchableFields = [
        "loan_number", "loan_officer", "processor", "underwriter", "closer", "branch",
      ].filter((c) => existingColumns.has(c));

      let searchCondition = "";
      const searchParams: string[] = [];
      let paramIndex = 1;

      if (searchTerm && searchableFields.length > 0) {
        const clauses = searchableFields.map((f) => {
          searchParams.push(`%${searchTerm}%`);
          return `LOWER(CAST(${f} AS TEXT)) LIKE $${paramIndex++}`;
        });
        searchCondition = ` AND (${clauses.join(" OR ")})`;
      }

      // Validate sort column
      const safeSort = displayColumns.includes(sort) ? sort : "application_date";
      const safeSortDir = sortDir === "asc" ? "ASC" : "DESC";

      const baseWhere = `(${stageFilter}) AND ${missingCondition}`;

      // Total applicable + missing (ignoring search)
      const totalResult = await tenantPool.query(
        `SELECT COUNT(*) AS cnt FROM loans WHERE ${baseWhere}`
      );
      const totalCount = parseInt(totalResult.rows[0]?.cnt || "0");

      // Filtered count (with search)
      let filteredCount = totalCount;
      if (searchTerm && searchCondition) {
        const filteredResult = await tenantPool.query(
          `SELECT COUNT(*) AS cnt FROM loans WHERE ${baseWhere}${searchCondition}`,
          searchParams
        );
        filteredCount = parseInt(filteredResult.rows[0]?.cnt || "0");
      }

      // Paginated rows
      const queryParams = [
        ...searchParams,
        parseInt(limit),
        parseInt(offset),
      ];
      const loansResult = await tenantPool.query(
        `SELECT ${displayColumns.join(", ")}
         FROM loans
         WHERE ${baseWhere}${searchCondition}
         ORDER BY ${safeSort} ${safeSortDir} NULLS LAST, loan_number ASC NULLS LAST
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        queryParams
      );

      const loans = loansResult.rows.map((loan: Record<string, unknown>) => {
        const formatted: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(loan)) {
          formatted[key] = value instanceof Date
            ? value.toISOString().split("T")[0]
            : value;
        }
        return formatted;
      });

      res.json({
        success: true,
        fieldName: fieldDef?.name ?? fieldColumn.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        fieldColumn,
        stage: fieldDef?.stage ?? "universal",
        totalCount,
        filteredCount,
        fields: displayColumns,
        highlightField: fieldColumn,
        loans,
      });
    } catch (error: unknown) {
      logError("Error fetching field missing loans", { error });
      res.status(500).json({ error: "Failed to fetch field missing loans" });
    }
  }
);

/**
 * GET /api/data-quality/all-fields-coverage
 *
 * Returns population stats for EVERY column in the loans table in a single
 * aggregate query (no loop of 296 individual queries).
 * Response shape:
 *   { totalLoans, fields: [{ column, populatedCount, missingCount }] }
 */
router.get(
  "/all-fields-coverage",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // 1. Discover every column in the loans table
      const colResult = await tenantPool.query<{ column_name: string; data_type: string }>(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'loans'
        ORDER BY column_name
      `);

      if (colResult.rows.length === 0) {
        return res.json({ success: true, totalLoans: 0, fields: [] });
      }

      const totalResult = await tenantPool.query<{ total: string }>(
        "SELECT COUNT(*) AS total FROM loans"
      );
      const totalLoans = parseInt(totalResult.rows[0]?.total ?? "0");

      if (totalLoans === 0) {
        return res.json({ success: true, totalLoans: 0, fields: [] });
      }

      // 2. Build a single aggregate SELECT:
      //    COUNT(*) FILTER (WHERE col IS NOT NULL AND …) AS "col"
      //    for every column, in one round-trip.
      const BLANK_VALUES = `('', '99-Missing', 'No Data', 'No Branch Found', 'N/A', 'NA')`;
      const textCols = new Set(["text", "character varying", "varchar", "char", "bpchar"]);

      const selectParts = colResult.rows.map((r) => {
        const col = `"${r.column_name}"`;
        if (textCols.has(r.data_type)) {
          // For text columns also strip blank / sentinel values
          return `COUNT(*) FILTER (
            WHERE ${col} IS NOT NULL
              AND TRIM(${col}) != ''
              AND TRIM(${col}) NOT IN ${BLANK_VALUES}
          ) AS "${r.column_name}"`;
        }
        // For numeric / date / boolean columns NULL is the only missing signal
        return `COUNT(*) FILTER (WHERE ${col} IS NOT NULL) AS "${r.column_name}"`;
      });

      const aggQuery = `SELECT ${selectParts.join(",\n")} FROM loans`;
      const aggResult = await tenantPool.query(aggQuery);
      const counts = aggResult.rows[0] ?? {};

      const fields = colResult.rows.map((r) => {
        const populated = parseInt(String(counts[r.column_name] ?? "0"));
        return {
          column: r.column_name,
          dataType: r.data_type,
          populatedCount: populated,
          missingCount: totalLoans - populated,
        };
      });

      res.json({ success: true, totalLoans, fields });
    } catch (error: unknown) {
      logError("Error fetching all-fields coverage", { error });
      res.status(500).json({ error: "Failed to fetch all-fields coverage" });
    }
  }
);

export default router;
