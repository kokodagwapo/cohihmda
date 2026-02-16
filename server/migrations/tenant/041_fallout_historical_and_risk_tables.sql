-- Migration: Fallout historical aggregation, risk bands, turn-time baselines, human patterns (BRD Phase 1)
-- Database: tenant (no tenant_id - one DB per tenant)
-- Creates: historical_bucket_totals, historical_bucket_combos, risk_band_definitions, turn_time_baselines, human_pattern_stats
-- Extends: loan_predictions with as_of_date, projected_status, reason_codes, projected_funding_date, projected_close_window, confidence_score

-- =============================================================================
-- HISTORICAL_BUCKET_TOTALS - Year/status/bucket aggregations for pattern discovery
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.historical_bucket_totals (
  year INTEGER NOT NULL,
  status_type TEXT NOT NULL CHECK (status_type IN ('Denied', 'Withdrawn', 'ClosingLate')),
  bucket_type TEXT NOT NULL,
  bucket_value TEXT NOT NULL,
  loan_count INTEGER NOT NULL DEFAULT 0,
  averages_json JSONB DEFAULT '{}',
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (year, status_type, bucket_type, bucket_value)
);

CREATE INDEX IF NOT EXISTS idx_historical_bucket_totals_lookup
  ON public.historical_bucket_totals(year, status_type, bucket_type);
CREATE INDEX IF NOT EXISTS idx_historical_bucket_totals_calculated
  ON public.historical_bucket_totals(calculated_at DESC);

-- =============================================================================
-- HISTORICAL_BUCKET_COMBOS - Top N multi-dimensional patterns per status/year
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.historical_bucket_combos (
  year INTEGER NOT NULL,
  status_type TEXT NOT NULL CHECK (status_type IN ('Denied', 'Withdrawn', 'ClosingLate')),
  combo_key TEXT NOT NULL,
  dimensions_json JSONB DEFAULT '{}',
  loan_count INTEGER NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (year, status_type, combo_key)
);

CREATE INDEX IF NOT EXISTS idx_historical_bucket_combos_lookup
  ON public.historical_bucket_combos(year, status_type);
CREATE INDEX IF NOT EXISTS idx_historical_bucket_combos_rank
  ON public.historical_bucket_combos(year, status_type, rank);

-- =============================================================================
-- RISK_BAND_DEFINITIONS - Lender-specific status-specific bands per numeric bucket
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.risk_band_definitions (
  status_type TEXT NOT NULL CHECK (status_type IN ('Denied', 'Withdrawn', 'ClosingLate')),
  bucket_type TEXT NOT NULL,
  band_name TEXT NOT NULL CHECK (band_name IN ('Low', 'Medium', 'High', 'Critical')),
  band_min NUMERIC,
  band_max NUMERIC,
  risk_score NUMERIC NOT NULL DEFAULT 0,
  derived_from_years TEXT,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (status_type, bucket_type, band_name)
);

CREATE INDEX IF NOT EXISTS idx_risk_band_definitions_lookup
  ON public.risk_band_definitions(status_type, bucket_type);

-- =============================================================================
-- TURN_TIME_BASELINES - Milestone-to-funding baseline turn-times by segment
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.turn_time_baselines (
  segment_key TEXT NOT NULL,
  milestone_type TEXT NOT NULL CHECK (milestone_type IN ('Lock', 'CondAppr', 'Appr', 'CTC')),
  avg_days_to_fund NUMERIC NOT NULL DEFAULT 0,
  p50_days_to_fund NUMERIC,
  p75_days_to_fund NUMERIC,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (segment_key, milestone_type)
);

CREATE INDEX IF NOT EXISTS idx_turn_time_baselines_segment
  ON public.turn_time_baselines(segment_key);

-- =============================================================================
-- HUMAN_PATTERN_STATS - Role-based propensity and velocity for scoring
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.human_pattern_stats (
  role_type TEXT NOT NULL CHECK (role_type IN ('LO', 'Processor', 'Underwriter', 'Closer')),
  role_id TEXT NOT NULL,
  status_type TEXT NOT NULL CHECK (status_type IN ('Denied', 'Withdrawn', 'ClosingLate')),
  loan_count INTEGER NOT NULL DEFAULT 0,
  rate NUMERIC DEFAULT 0,
  avg_days_to_fund NUMERIC,
  risk_multiplier NUMERIC DEFAULT 1.0,
  window_days INTEGER,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (role_type, role_id, status_type)
);

CREATE INDEX IF NOT EXISTS idx_human_pattern_stats_role
  ON public.human_pattern_stats(role_type, role_id);
CREATE INDEX IF NOT EXISTS idx_human_pattern_stats_status
  ON public.human_pattern_stats(status_type);

-- =============================================================================
-- LOAN_PREDICTIONS - Add BRD columns (keep existing for backward compatibility)
-- =============================================================================
ALTER TABLE public.loan_predictions ADD COLUMN IF NOT EXISTS as_of_date DATE;
ALTER TABLE public.loan_predictions ADD COLUMN IF NOT EXISTS projected_status TEXT;
ALTER TABLE public.loan_predictions ADD COLUMN IF NOT EXISTS reason_codes JSONB;
ALTER TABLE public.loan_predictions ADD COLUMN IF NOT EXISTS projected_funding_date DATE;
ALTER TABLE public.loan_predictions ADD COLUMN IF NOT EXISTS projected_close_window TEXT;
ALTER TABLE public.loan_predictions ADD COLUMN IF NOT EXISTS confidence_score NUMERIC;

CREATE INDEX IF NOT EXISTS idx_loan_predictions_as_of_date
  ON public.loan_predictions(as_of_date) WHERE as_of_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loan_predictions_projected_status
  ON public.loan_predictions(projected_status) WHERE projected_status IS NOT NULL;
