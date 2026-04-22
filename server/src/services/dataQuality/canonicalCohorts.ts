export const CANONICAL_COHORT_FILTERS = {
  active: `current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND (is_archived IS DISTINCT FROM TRUE)`,
  originated: `(current_loan_status ILIKE '%originated%' OR current_loan_status ILIKE '%funded%' OR current_loan_status ILIKE '%purchased%')`,
} as const;

export type CanonicalCohortKey = keyof typeof CANONICAL_COHORT_FILTERS;
