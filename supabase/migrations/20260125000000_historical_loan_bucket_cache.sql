-- Historical Loan Bucket Cache
-- Stores pre-computed signal-strength bucket values for historical (finalized) loans only.
-- Active loans are never cached so they are re-bucketed when loan data changes.
-- Data persists across server restarts; the database is separate from the Node process.
-- Migration Date: 2026-01-25

CREATE TABLE IF NOT EXISTS public.historical_loan_bucket_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL,
  bucket_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, loan_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_loan_bucket_cache_tenant_loan
  ON public.historical_loan_bucket_cache(tenant_id, loan_id);
CREATE INDEX IF NOT EXISTS idx_historical_loan_bucket_cache_tenant
  ON public.historical_loan_bucket_cache(tenant_id);

COMMENT ON TABLE public.historical_loan_bucket_cache IS 'Cached signal-strength bucket values for historical loans only. Avoids re-bucketing on every predict. Persists across server restarts.';
COMMENT ON COLUMN public.historical_loan_bucket_cache.bucket_snapshot IS 'JSON object of bucket/signal/reason-code fields produced by bucketLoanData (e.g. ficoScoreSignal, creditMetricsSignalStrength, *ReasonCodes, etc.)';
