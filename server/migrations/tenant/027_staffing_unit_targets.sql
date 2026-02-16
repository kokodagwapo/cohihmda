-- Migration: 027_staffing_unit_targets.sql
-- Description: Add staffing unit targets for Financial Modeling and Operations/Scorecard pages
-- Used by: Financial Modeling Sandbox (default target sliders), Operations Scorecard Trends (vs target)

CREATE TABLE IF NOT EXISTS public.staffing_unit_targets (
  role_key VARCHAR(50) PRIMARY KEY,
  units_per_month INT NOT NULL CHECK (units_per_month > 0),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.staffing_unit_targets (role_key, units_per_month)
VALUES
  ('processor', 25),
  ('underwriter', 45),
  ('closer', 85),
  ('other', 85)
ON CONFLICT (role_key) DO NOTHING;
