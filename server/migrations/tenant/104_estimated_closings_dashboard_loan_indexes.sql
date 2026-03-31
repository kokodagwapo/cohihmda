-- Indexes to support Estimated Closings and Risk dashboard queries (per-tenant database).
-- Review with DBA before production; consider CREATE INDEX CONCURRENTLY in manual rollout.

CREATE INDEX IF NOT EXISTS idx_loans_est_closings_pipeline_dates
  ON public.loans (current_loan_status, funding_date, estimated_closing_date)
  WHERE application_date IS NOT NULL
    AND (is_archived IS DISTINCT FROM TRUE);

CREATE INDEX IF NOT EXISTS idx_loans_est_closings_complexity
  ON public.loans (complexity_score)
  WHERE application_date IS NOT NULL
    AND (is_archived IS DISTINCT FROM TRUE);
