-- Migration: Allow 'Originated' status_type and add P15/P35/P55/P75 for originate zones (UI colors)
-- Originate zones: Zone1 P0-P15, Zone2 P15-P35, Zone3 P35-P55, Zone4 P55-P75, Zone5 P75-P90, Zone6 P90-P100

-- Allow Originated in status_type (drop existing check and re-add; default constraint name from CREATE TABLE)
ALTER TABLE public.outcome_numeric_risk_profiles
  DROP CONSTRAINT IF EXISTS outcome_numeric_risk_profiles_status_type_check;
ALTER TABLE public.outcome_numeric_risk_profiles
  ADD CONSTRAINT outcome_numeric_risk_profiles_status_type_check
  CHECK (status_type IN ('Denied', 'Withdrawn', 'ClosingLate', 'Originated'));

-- Originate zone percentiles
ALTER TABLE public.outcome_numeric_risk_profiles
  ADD COLUMN IF NOT EXISTS p15_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p35_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p55_value NUMERIC,
  ADD COLUMN IF NOT EXISTS p75_value NUMERIC;
