-- Migration: 023_update_complexity_components.sql
-- Description: Update complexity_components to use standardized condition values
--              that match the frontend UI and backend calculation logic
-- 
-- The original seed data used mixed naming conventions. This migration standardizes
-- to use consistent condition_value keys that the code expects.

-- =============================================================================
-- STEP 1: Clear existing complexity_components and re-seed with standardized values
-- =============================================================================

-- Remove old data with inconsistent naming
DELETE FROM complexity_components;

-- Re-seed with standardized condition values that match the code
-- Note: weight is stored as decimal (0.10 = 10 points in the UI)
INSERT INTO complexity_components (component_name, condition_value, weight, description)
VALUES 
  -- Loan Type
  ('loan_type', 'government', 0.10, 'Government loans (FHA, VA, USDA) require more documentation and have stricter guidelines'),
  ('loan_type', 'conventional', 0.00, 'Standard conventional loans'),
  
  -- Loan Purpose
  ('loan_purpose', 'purchase', 0.05, 'Purchase transactions involve more parties and tighter timelines'),
  ('loan_purpose', 'refinance', 0.00, 'Standard refinance transactions'),
  
  -- FICO Score Ranges
  ('fico', 'poor', 0.10, 'Poor FICO (< 680) requires additional documentation and risk assessment'),
  ('fico', 'fair', 0.00, 'Fair FICO (680-719) - average credit range'),
  ('fico', 'good', 0.00, 'Good FICO (720-759) - good credit range'),
  ('fico', 'excellent', -0.05, 'Excellent FICO (760+) can simplify processing'),
  
  -- LTV Ratio
  ('ltv', 'high', 0.05, 'High LTV (> 80%) may require PMI and additional review'),
  ('ltv', 'standard', 0.00, 'Standard LTV (≤ 80%)'),
  
  -- DTI Ratio
  ('dti', 'high', 0.05, 'High DTI (> 43%) requires additional income verification'),
  ('dti', 'standard', 0.00, 'Standard DTI (≤ 43%)'),
  
  -- Occupancy Type
  ('occupancy', 'investment', 0.05, 'Investment properties have stricter requirements'),
  ('occupancy', 'second_home', 0.05, 'Second homes require additional documentation'),
  ('occupancy', 'primary', 0.00, 'Standard primary residence'),
  
  -- Employment Type
  ('employment', 'self_employed', 0.05, 'Self-employed borrowers require additional income documentation'),
  ('employment', 'w2', 0.00, 'Standard W-2 employment')

ON CONFLICT (component_name, condition_value) DO UPDATE SET
  weight = EXCLUDED.weight,
  description = EXCLUDED.description,
  updated_at = NOW();

-- =============================================================================
-- STEP 2: Log the migration
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 023: Updated complexity_components with standardized condition values';
END $$;
