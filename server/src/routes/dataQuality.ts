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
const CRUCIAL_FIELDS = [
  { name: "Funding Date", column: "funding_date", priority: 1 },
  { name: "Branch", column: "branch", priority: 2 },
  { name: "Closing Date", column: "closing_date", priority: 3 },
  { name: "Started Date", column: "started_date", priority: 4 },
  { name: "Loan Officer", column: "loan_officer", priority: 5 },
  { name: "Processor", column: "processor", priority: 6 },
  { name: "Underwriter", column: "underwriter", priority: 7 },
  { name: "Closer", column: "closer", priority: 8 },
  { name: "Account Executive", column: "account_executive", priority: 9 },
  {
    name: "Conditional Approval Date",
    column: "conditional_approval_date",
    priority: 10,
  },
  { name: "Credit Pull Date", column: "credit_pull_date", priority: 11 },
  { name: "CTC Date", column: "ctc_date", priority: 12 },
  {
    name: "Estimated Closing Date",
    column: "estimated_closing_date",
    priority: 13,
  },
  {
    name: "Investor Purchase Date",
    column: "investor_purchase_date",
    priority: 14,
  },
  { name: "Resubmittal Date", column: "resubmittal_date", priority: 15 },
  { name: "Shipped Date", column: "shipped_date", priority: 16 },
  { name: "UW Approval Date", column: "uw_approval_date", priority: 17 },
  {
    name: "UW Final Approval Date",
    column: "uw_final_approval_date",
    priority: 18,
  },
  {
    name: "Submitted To Processing Date",
    column: "submitted_to_processing_date",
    priority: 19,
  },
  {
    name: "Submitted To Underwriting Date",
    column: "submitted_to_underwriting_date",
    priority: 20,
  },
  { name: "Loan Amount", column: "loan_amount", priority: 21 },
  { name: "Loan Number", column: "loan_number", priority: 22 },
  { name: "Current Status Date", column: "current_status_date", priority: 23 },
  { name: "UW Denied Date", column: "uw_denied_date", priority: 24 },
  { name: "Application Date", column: "application_date", priority: 25 },
  {
    name: "Loan Estimate Sent Date",
    column: "loan_estimate_sent_date",
    priority: 26,
  },
  {
    name: "Rate Lock Buy Side Base Price Rate",
    column: "rate_lock_buy_side_base_price_rate",
    priority: 27,
  },
  { name: "Loan Source", column: "loan_source", priority: 28 },
  { name: "Investor Status", column: "investor_status", priority: 29 },
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
      "Estimated property value is one of the 6 TRID trigger items required for application",
    severity: "warning",
    group: "Application Tests",
    field: "appraised_value",
    sqlCondition: `(appraised_value IS NULL OR appraised_value <= 0)
                   AND (sales_price IS NULL OR sales_price <= 0)
                   AND application_date IS NOT NULL`,
    requiredColumns: ["appraised_value", "application_date"],
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
 * Get population status for crucial fields
 */
router.get(
  "/crucial-fields-status",
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
          crucialFields: [],
          totalLoans: 0,
        });
      }

      // Check which columns actually exist in the loans table
      const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
      const existingColumns = new Set(
        columnsResult.rows.map((r) => r.column_name)
      );

      // Build queries for each crucial field that exists
      const crucialFieldsStatus = [];

      for (const field of CRUCIAL_FIELDS) {
        if (existingColumns.has(field.column)) {
          const populatedResult = await tenantPool.query(`
          SELECT COUNT(*) as populated 
          FROM loans 
          WHERE ${field.column} IS NOT NULL 
            AND TRIM(CAST(${field.column} AS TEXT)) != ''
            AND CAST(${field.column} AS TEXT) NOT IN ('99-Missing', 'No Data', 'No Branch Found')
        `);

          const populatedCount = parseInt(
            populatedResult.rows[0]?.populated || "0"
          );
          const populationRate =
            totalLoans > 0 ? (populatedCount / totalLoans) * 100 : 0;

          crucialFieldsStatus.push({
            name: field.name,
            column: field.column,
            priority: field.priority,
            populationRate: Math.round(populationRate * 10) / 10,
            populatedCount,
            totalCount: totalLoans,
            status:
              populationRate >= 80
                ? "good"
                : populationRate >= 50
                ? "warning"
                : "critical",
          });
        } else {
          // Column doesn't exist
          crucialFieldsStatus.push({
            name: field.name,
            column: field.column,
            priority: field.priority,
            populationRate: 0,
            populatedCount: 0,
            totalCount: totalLoans,
            status: "critical",
            missing: true,
          });
        }
      }

      res.json({
        success: true,
        crucialFields: crucialFieldsStatus,
        totalLoans,
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
          "cond_approval_date",
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
          "loan_amount"
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

export default router;
