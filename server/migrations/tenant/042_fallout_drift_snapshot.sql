-- Store previous risk band snapshot for month-over-month drift detection (BRD 2.12)
-- Database: tenant

CREATE TABLE IF NOT EXISTS public.fallout_drift_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type TEXT NOT NULL DEFAULT 'risk_bands',
  snapshot_json JSONB NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fallout_drift_snapshot_type_calc
  ON public.fallout_drift_snapshot(snapshot_type, calculated_at DESC);
