-- Migration: Add Preapproval Columns
-- Created: 2026-02-05
-- Database: tenant
--
-- Adds new columns to support the 260 common field aliases:
-- - preapproval_flag BOOLEAN (maps to Fields.HMDA.X12)
-- - preapproval_req_dt DATE (maps to Fields.CX.PREAPP.REQ.DT)

-- =============================================================================
-- STEP 1: Add preapproval_flag column
-- =============================================================================
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS preapproval_flag BOOLEAN;

-- =============================================================================
-- STEP 2: Add preapproval_req_dt column
-- =============================================================================
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS preapproval_req_dt DATE;

-- =============================================================================
-- Log completion
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 022_add_preapproval_columns completed successfully';
END $$;
