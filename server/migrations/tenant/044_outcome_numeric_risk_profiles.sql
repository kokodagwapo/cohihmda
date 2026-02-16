-- Migration: Outcome numeric risk profiles (COHI Numeric Segmented Risk Range Engine)
-- Database: tenant (no tenant_id - one DB per tenant)
-- Stores yearly per-segment (loan_type, loan_purpose, occupancy) feature stats (mean, Q1, Q3, IQR)
-- for Denied/Withdrawn. Years older than (current - 1) can be persisted and reused; only current
-- and prior year are recalculated when older years exist.

CREATE TABLE IF NOT EXISTS public.outcome_numeric_risk_profiles (
  year INTEGER NOT NULL,
  status_type TEXT NOT NULL CHECK (status_type IN ('Denied', 'Withdrawn', 'ClosingLate')),
  loan_type TEXT NOT NULL,
  loan_purpose TEXT NOT NULL,
  occupancy TEXT NOT NULL,
  feature_name TEXT NOT NULL,
  mean_value NUMERIC,
  q1_value NUMERIC,
  q3_value NUMERIC,
  iqr_value NUMERIC,
  sample_size INTEGER NOT NULL DEFAULT 0,
  low_confidence BOOLEAN NOT NULL DEFAULT false,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (year, status_type, loan_type, loan_purpose, occupancy, feature_name)
);

CREATE INDEX IF NOT EXISTS idx_outcome_numeric_risk_profiles_lookup
  ON public.outcome_numeric_risk_profiles(year, status_type, loan_type, loan_purpose, occupancy);
CREATE INDEX IF NOT EXISTS idx_outcome_numeric_risk_profiles_calculated
  ON public.outcome_numeric_risk_profiles(calculated_at DESC);
