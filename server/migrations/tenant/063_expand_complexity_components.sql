-- Migration: 063_expand_complexity_components.sql
-- Description: Add range_min/range_max to complexity_components for dynamic
--              FICO, DTI, LTV, and Loan Amount ranges. Seed expanded loan types,
--              Encompass-aligned loan purposes, loan amount ranges, and Non-QM.

-- =============================================================================
-- STEP 1: Add range columns
-- =============================================================================
ALTER TABLE complexity_components
  ADD COLUMN IF NOT EXISTS range_min DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS range_max DECIMAL(12,2);

-- =============================================================================
-- STEP 2: Clear existing and seed expanded complexity data
-- =============================================================================
DELETE FROM complexity_components;

-- Weight convention: stored as decimal (0.10 = 10 points in UI). Negative for complexity reduction.
INSERT INTO complexity_components (component_name, condition_value, weight, description, range_min, range_max)
VALUES
  -- Loan Type (individual weights per type)
  ('loan_type', 'FHA', 0.10, 'FHA loans', NULL, NULL),
  ('loan_type', 'VA', 0.05, 'VA loans', NULL, NULL),
  ('loan_type', 'USDA', 0.05, 'USDA loans', NULL, NULL),
  ('loan_type', 'Conventional', 0.00, 'Conventional loans', NULL, NULL),
  ('loan_type', 'Jumbo', 0.15, 'Jumbo loans', NULL, NULL),
  ('loan_type', 'Other', 0.00, 'Other loan types', NULL, NULL),

  -- Loan Purpose (Encompass Field 19 aligned)
  ('loan_purpose', 'Purchase', 0.05, 'Purchase', NULL, NULL),
  ('loan_purpose', 'NoCash-Out Refinance', 0.00, 'Rate/term refinance', NULL, NULL),
  ('loan_purpose', 'Cash-Out Refinance', 0.10, 'Cash-out refinance', NULL, NULL),
  ('loan_purpose', 'Construction-Perm', 0.30, 'Construction-to-permanent', NULL, NULL),
  ('loan_purpose', 'Construction', 0.20, 'Construction only', NULL, NULL),
  ('loan_purpose', 'Other', 0.00, 'Other purpose', NULL, NULL),

  -- Loan Amount (dynamic ranges: range_min <= value < range_max)
  ('loan_amount', '0-100000', 0.00, 'Up to $100K', 0, 100000),
  ('loan_amount', '100000-250000', 0.00, '$100K-$250K', 100000, 250000),
  ('loan_amount', '250000-500000', 0.00, '$250K-$500K', 250000, 500000),
  ('loan_amount', '500000-726200', 0.00, '$500K-conforming limit', 500000, 726200),
  ('loan_amount', '726200-1000000', 0.05, 'High balance', 726200, 1000000),
  ('loan_amount', '1000000+', 0.10, 'Jumbo $1M+', 1000000, 999999999.99),

  -- FICO (dynamic ranges, legacy defaults)
  ('fico', 'excellent', -0.10, 'FICO 760-850', 760, 850),
  ('fico', 'good', 0.00, 'FICO 681-759', 681, 759),
  ('fico', 'fair', 0.05, 'FICO 620-680', 620, 680),
  ('fico', 'poor', 0.15, 'FICO 300-619', 300, 619),

  -- LTV (dynamic ranges)
  ('ltv', 'standard', 0.00, 'LTV 0-80%', 0, 80),
  ('ltv', 'high', 0.05, 'LTV 80-95%', 80, 95),
  ('ltv', 'very_high', 0.10, 'LTV 95%+', 95, 999),

  -- DTI (dynamic ranges)
  ('dti', 'standard', 0.00, 'DTI 0-43%', 0, 43),
  ('dti', 'high', 0.05, 'DTI 43-50%', 43, 50),
  ('dti', 'very_high', 0.10, 'DTI 50%+', 50, 999),

  -- Occupancy (categorical)
  ('occupancy', 'Second Home', 0.10, 'Second home', NULL, NULL),
  ('occupancy', 'SecondHome', 0.10, 'Second home (alt)', NULL, NULL),
  ('occupancy', 'Investor', 0.10, 'Investment property', NULL, NULL),
  ('occupancy', 'Investment', 0.10, 'Investment (alt)', NULL, NULL),
  ('occupancy', 'Primary', 0.00, 'Primary residence', NULL, NULL),
  ('occupancy', 'PrimaryResidence', 0.00, 'Primary (alt)', NULL, NULL),
  ('occupancy', 'Owner Occupied', 0.00, 'Owner occupied', NULL, NULL),

  -- Employment (categorical)
  ('employment', 'self_employed', 0.20, 'Self-employed borrower', NULL, NULL),
  ('employment', 'w2', 0.00, 'W-2 employee', NULL, NULL),

  -- Non-QM Loan (from legacy XML)
  ('non_qm', 'Y', 0.10, 'Non-QM loan', NULL, NULL),
  ('non_qm', 'N', 0.00, 'QM loan', NULL, NULL)
ON CONFLICT (component_name, condition_value) DO UPDATE SET
  weight = EXCLUDED.weight,
  description = EXCLUDED.description,
  range_min = EXCLUDED.range_min,
  range_max = EXCLUDED.range_max,
  updated_at = NOW();

-- =============================================================================
-- STEP 3: Log the migration
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 063: Expanded complexity_components with range_min/range_max and new seed data';
END $$;
