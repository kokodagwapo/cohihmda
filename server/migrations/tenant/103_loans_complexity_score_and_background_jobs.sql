-- Persisted loan complexity + durable background job rows (per-tenant database)
-- See: Persist Loan Complexity plan

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS complexity_score DECIMAL(5,2);

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS non_qm BOOLEAN;

COMMENT ON COLUMN public.loans.complexity_score IS
  'Tenant-config-aware loan complexity score (100 baseline). Computed at ingest and via bulk recompute when weights change.';

CREATE TABLE IF NOT EXISTS public.background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  cursor_state JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_type_status
  ON public.background_jobs (job_type, status, created_at);

-- At most one active loan complexity recompute per tenant DB
CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_one_active_loan_complexity_recompute
  ON public.background_jobs (job_type)
  WHERE job_type = 'loan_complexity_recompute'
    AND status IN ('pending', 'processing');
