/**
 * Fetches paginated loan detail list for the Loan Detail table.
 * No filtering - all loans (subject to user loan access).
 */

import { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";

export interface LoanDetailRow {
  loan_id: string;
  loan_number: string | null;
  loan_amount: number | null;
  interest_rate: number | null;
  fico_score: number | null;
  ltv_ratio: number | null;
  be_dti_ratio: number | null;
  channel: string | null;
  branch: string | null;
  loan_officer: string | null;
  processor: string | null;
  underwriter: string | null;
  closer: string | null;
  investor: string | null;
  property_street: string | null;
  property_city: string | null;
  property_state: string | null;
  property_county: string | null;
  property_zip: string | null;
  loan_term: number | null;
  current_loan_status: string | null;
  current_milestone: string | null;
  loan_folder: string | null;
  loan_type: string | null;
  loan_program: string | null;
  loan_purpose: string | null;
  occupancy_type: string | null;
  property_type: string | null;
  lien_position: string | null;
  started_date: string | null;
  credit_pull_date: string | null;
  application_date: string | null;
  loan_estimate_sent_date: string | null;
  loan_estimate_received_date: string | null;
  uw_final_approval_date: string | null;
  uw_suspended_date: string | null;
  uw_denied_date: string | null;
  denial_date: string | null;
  investor_lock_date: string | null;
  lock_expiration_date: string | null;
  lock_days: number | null;
  estimated_closing_date: string | null;
  ctc_date: string | null;
  closing_disclosure_sent_date: string | null;
  closing_disclosure_received_date: string | null;
  closing_date: string | null;
  funding_date: string | null;
  investor_purchase_date: string | null;
  shipped_date: string | null;
  mers_min: string | null;
  number_of_months_interest_only_payments: number | null;
  income_total_mo_income: number | null;
  origination_points: number | null;
  orig_fee_borr_pd: number | null;
  subject_property_type_fannie_mae: string | null;
  fees_va_fund_fee_borr: number | null;
  fha_lender_id: string | null;
  fees_loan_discount_fee: number | null;
  fees_loan_discount_fee_borr: number | null;
  rush_closing_on_file: string | null;
  scrub_rating_of_file: string | null;
}

export interface LoanDetailListResponse {
  loans: LoanDetailRow[];
  total: number;
  limit: number;
  offset: number;
  page: number;
  totalPages: number;
}

/** Request all loans in one call (no pagination). Backend max is 50000. */
const ALL_LOANS_LIMIT = 50000;

export interface LoanDetailFilters {
  dateField?: string;
  dateRange?: { start: string; end: string };
  branch?: string;
  loanOfficer?: string;
  /** Additional dimension filters (e.g. loan_purpose, channel) from workbench "ADD FILTER DIMENSION" */
  dimensionFilters?: Array<{ column: string; value: string }>;
}

export function useLoanDetailData(
  tenantId?: string | null,
  filters?: LoanDetailFilters | null,
) {
  const [data, setData] = useState<LoanDetailListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(ALL_LOANS_LIMIT));
      params.set("offset", "0");
      if (tenantId) params.set("tenant_id", tenantId);
      if (filters?.dateField) params.set("date_field", filters.dateField);
      // Only send date range when explicitly set (avoid sending when "All" is selected)
      const hasDateRange =
        filters?.dateRange &&
        typeof filters.dateRange.start === "string" &&
        filters.dateRange.start.length > 0 &&
        typeof filters.dateRange.end === "string" &&
        filters.dateRange.end.length > 0;
      if (hasDateRange) {
        params.set("date_from", filters!.dateRange!.start);
        params.set("date_to", filters!.dateRange!.end);
      }
      if (filters?.branch && filters.branch !== "all") params.set("branch", filters.branch);
      if (filters?.loanOfficer && filters.loanOfficer !== "all") params.set("loan_officer", filters.loanOfficer);
      if (filters?.dimensionFilters?.length) {
        for (const df of filters.dimensionFilters) {
          if (df.column && df.value) params.set(df.column, df.value);
        }
      }
      const url = `/api/loans/detail-list?${params.toString()}`;
      const res = await api.request<LoanDetailListResponse>(url);
      setData(res);
      return res;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch loan detail list";
      setError(message);
      setData(null);
      return null;
    } finally {
      setLoading(false);
    }
  // Serialize dimensionFilters to a stable string so a new array ref doesn't cause a fetch loop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, filters?.dateField, filters?.dateRange?.start, filters?.dateRange?.end, filters?.branch, filters?.loanOfficer, JSON.stringify(filters?.dimensionFilters)]);

  useEffect(() => {
    // Backend returns 400 when tenant_id is missing (e.g. super_admin with no tenant selected)
    if (!tenantId) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }
    fetchAll();
  }, [tenantId, fetchAll]);

  return { data, loading, error, fetchAll };
}
