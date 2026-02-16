-- Categorical risk definitions (volume-driven tiers for LoanType, Purpose, Occupancy, etc.)
-- Persistent top patterns (multi-year pattern_score)
-- Optional: market_rate columns on loans for historical aggregation (if not present)
-- Database: tenant (no tenant_id)

-- =============================================================================
-- CATEGORICAL_RISK_DEFINITIONS - Volume-driven risk tier per category value
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.categorical_risk_definitions (
  status_type TEXT NOT NULL CHECK (status_type IN ('Denied', 'Withdrawn', 'ClosingLate')),
  bucket_type TEXT NOT NULL,
  bucket_value TEXT NOT NULL,
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('Low', 'Medium', 'High', 'Critical')),
  risk_score NUMERIC NOT NULL DEFAULT 0,
  loan_count INTEGER NOT NULL DEFAULT 0,
  share_of_status NUMERIC DEFAULT 0,
  years_present INTEGER DEFAULT 1,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (status_type, bucket_type, bucket_value)
);

CREATE INDEX IF NOT EXISTS idx_categorical_risk_definitions_lookup
  ON public.categorical_risk_definitions(status_type, bucket_type);

-- =============================================================================
-- PERSISTENT_TOP_PATTERNS - Cross-year top patterns with pattern_score
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.persistent_top_patterns (
  status_type TEXT NOT NULL CHECK (status_type IN ('Denied', 'Withdrawn', 'ClosingLate')),
  combo_key TEXT NOT NULL,
  dimensions_json JSONB DEFAULT '{}',
  pattern_score NUMERIC NOT NULL DEFAULT 0,
  years_present INTEGER NOT NULL DEFAULT 0,
  avg_rank NUMERIC,
  total_loan_count INTEGER NOT NULL DEFAULT 0,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (status_type, combo_key)
);

CREATE INDEX IF NOT EXISTS idx_persistent_top_patterns_status
  ON public.persistent_top_patterns(status_type);

-- Optional: allow market rate at lock for historical aggregation (skip if column exists)
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS market_rate DECIMAL(8,4);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS market_rate_at_lock DECIMAL(8,4);
