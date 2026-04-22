/**
 * Canonical data quality rule tests — shared by /api/data-quality routes and insight evaluation.
 * Keep in sync with metrics definitions (see dataQuality route file header for status rules).
 */

/**
 * Warning groups based on Qlik DataPilot patterns
 */
export type DataQualityWarningGroup =
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
export interface DataQualityTest {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "warning" | "info";
  group: DataQualityWarningGroup;
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
export const DATA_QUALITY_TESTS: DataQualityTest[] = [
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
const TEST_BY_ID = new Map(DATA_QUALITY_TESTS.map((t) => [t.id, t]));

export const DATA_QUALITY_TEST_ID_SET = new Set(DATA_QUALITY_TESTS.map((t) => t.id));

/** Bullet list of every automated test id for LLM prompts (matches Data Quality dashboard warnings). */
export function buildDataQualityReviewCatalogForPrompt(): string {
  const catalogLines = DATA_QUALITY_TESTS.map(
    (t) =>
      `- id "${t.id}" | ${t.name} | ${t.description} | requiredColumns: [${t.requiredColumns.join(", ")}]`
  );
  return [
    "DATA QUALITY DASHBOARD ALIGNMENT (same automated checks as /api/data-quality and the Data Quality page):",
    "When data_quality.flagged is true, choose a broad prefilter candidate set first. Prefer required-column overlap with the finding headline/summary/key metrics/evidence fields, then use name/description for semantic support.",
    "Include prefilter_candidate_test_ids as 1-10 ids from this catalog (high recall is preferred). Then include review_test_ids as your best 1-3 ids.",
    "Use ONLY catalog ids in review_test_ids. If no catalog id matches, do NOT set data_quality.flagged=true for that insight.",
    ...catalogLines,
  ].join("\n");
}

export function normalizeReviewTestIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const x of ids) {
    if (typeof x !== "string" || !DATA_QUALITY_TEST_ID_SET.has(x)) continue;
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

export function groupsForReviewTestIds(ids: string[]): DataQualityWarningGroup[] {
  const g = new Set<DataQualityWarningGroup>();
  for (const id of ids) {
    const t = TEST_BY_ID.get(id);
    if (t) g.add(t.group);
  }
  return [...g];
}

export function getDataQualityTestById(id: string): DataQualityTest | undefined {
  return TEST_BY_ID.get(id);
}
