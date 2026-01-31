-- Migration: Remove raw_data column from loans table
-- Created: 2026-01-30
-- Database: tenant
--
-- The raw_data JSONB column was used to store unmapped Encompass fields.
-- With the introduction of the additional_field_definitions system, clients can now
-- explicitly define which additional fields they want to track.
-- 
-- This migration removes the raw_data column to:
-- 1. Reduce storage overhead
-- 2. Improve query performance (no JSONB parsing needed)
-- 3. Encourage use of the structured additional_fields system

-- =============================================================================
-- OPTIONAL: Archive raw_data before dropping (for safety)
-- Uncomment this section if you want to preserve the data
-- =============================================================================
-- CREATE TABLE IF NOT EXISTS loan_raw_data_archive (
--   loan_id VARCHAR(255) NOT NULL,
--   raw_data JSONB,
--   archived_at TIMESTAMPTZ DEFAULT NOW(),
--   PRIMARY KEY (loan_id)
-- );

-- INSERT INTO loan_raw_data_archive (loan_id, raw_data)
-- SELECT loan_id, raw_data 
-- FROM loans 
-- WHERE raw_data IS NOT NULL AND raw_data != '{}'::jsonb
-- ON CONFLICT (loan_id) DO UPDATE SET 
--   raw_data = EXCLUDED.raw_data,
--   archived_at = NOW();

-- =============================================================================
-- DROP THE RAW_DATA COLUMN
-- =============================================================================
-- Note: In PostgreSQL, DROP COLUMN marks the column as invisible but doesn't
-- immediately reclaim space. A VACUUM FULL would be needed for that.
-- For large tables, this operation should be done during maintenance windows.

DO $$
BEGIN
  -- Check if column exists before dropping
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'loans' 
      AND column_name = 'raw_data'
  ) THEN
    ALTER TABLE public.loans DROP COLUMN raw_data;
    RAISE NOTICE 'Successfully dropped raw_data column from loans table';
  ELSE
    RAISE NOTICE 'raw_data column does not exist - nothing to drop';
  END IF;
END $$;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
