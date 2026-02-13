-- Migration: Recency bucket for outcome numeric risk profiles (<=180 days vs >180 days)
-- Enables weighting more recent historical loans higher when blending profiles for active loans.

ALTER TABLE public.outcome_numeric_risk_profiles
  ADD COLUMN IF NOT EXISTS recency_bucket TEXT NOT NULL DEFAULT '>180 days'
    CHECK (recency_bucket IN ('<=180 days', '>180 days'));

-- Include recency_bucket in primary key (two rows per segment/feature: one per bucket)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'outcome_numeric_risk_profiles_pkey'
    AND conrelid = 'public.outcome_numeric_risk_profiles'::regclass
  ) THEN
    ALTER TABLE public.outcome_numeric_risk_profiles
      DROP CONSTRAINT outcome_numeric_risk_profiles_pkey;
    ALTER TABLE public.outcome_numeric_risk_profiles
      ADD PRIMARY KEY (year, status_type, loan_type, loan_purpose, occupancy, feature_name, recency_bucket);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_outcome_numeric_risk_profiles_recency
  ON public.outcome_numeric_risk_profiles(recency_bucket);
