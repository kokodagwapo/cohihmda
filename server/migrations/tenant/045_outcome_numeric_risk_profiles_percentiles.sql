-- Migration: Add percentile columns for zone-based similarity (P10-P90)
-- Zone 1: P40-P60, Zone 2: P30-P40/P60-P70, Zone 3: P20-P30/P70-P80, Zone 4 (outliers): <P10 or >P90

ALTER TABLE public.outcome_numeric_risk_profiles
  ADD COLUMN IF NOT EXISTS p10_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p20_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p30_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p40_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p60_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p70_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p80_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p90_value NUMERIC;
