-- Migration: Bucket thresholds cache for dynamic FICO/LTV/DTI bucketing by loan type (Conventional vs Government)
-- Database: tenant

CREATE TABLE IF NOT EXISTS bucket_thresholds_cache (
  feature_name TEXT NOT NULL,
  loan_type TEXT NOT NULL CHECK (loan_type IN ('Conventional', 'Government')),
  threshold_data JSONB NOT NULL,
  sample_size INTEGER NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (feature_name, loan_type)
);
