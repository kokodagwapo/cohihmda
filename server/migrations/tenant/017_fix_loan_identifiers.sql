-- Migration: Fix Loan Identifiers
-- Created: 2026-01-31
-- Database: tenant
--
-- Fixes the loan identifier columns:
-- - guid: Encompass GUID (unique system identifier) - becomes the primary unique key
-- - loan_number: Human-readable loan number (Fields.364)
-- - loan_id: DEPRECATED - will be dropped after data migration

-- =============================================================================
-- STEP 1: Normalize existing guid column (remove braces, lowercase)
-- =============================================================================
-- CRITICAL: The guid column may have curly braces from Encompass API
-- e.g., "{cf5693d4-b30b-49ed-b6f4-0b0d8ec0124d}" -> "cf5693d4-b30b-49ed-b6f4-0b0d8ec0124d"

-- Normalize existing guid values (remove braces, lowercase)
UPDATE loans 
SET guid = LOWER(REPLACE(REPLACE(guid, '{', ''), '}', ''))
WHERE guid IS NOT NULL 
  AND (guid LIKE '{%' OR guid LIKE '%}' OR guid ~ '[A-F]');

-- =============================================================================
-- STEP 1b: Populate guid from loan_id where guid is null
-- =============================================================================
-- The guid column should contain the Encompass GUID
-- If loan_id currently has GUIDs, we need to migrate them

-- First, populate guid from loan_id where guid is null but loan_id looks like a GUID (with braces)
UPDATE loans 
SET guid = LOWER(REPLACE(REPLACE(loan_id, '{', ''), '}', ''))
WHERE guid IS NULL 
  AND loan_id IS NOT NULL 
  AND loan_id ~ '^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$';

-- Also handle GUIDs without dashes (Encompass sometimes returns them this way)
UPDATE loans 
SET guid = LOWER(loan_id)
WHERE guid IS NULL 
  AND loan_id IS NOT NULL 
  AND LENGTH(loan_id) = 32
  AND loan_id ~ '^[0-9a-fA-F]{32}$';

-- =============================================================================
-- STEP 2: Populate loan_number from loan_id where it looks like a loan number (not GUID)
-- =============================================================================
UPDATE loans 
SET loan_number = loan_id 
WHERE loan_number IS NULL 
  AND loan_id IS NOT NULL 
  AND loan_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND loan_id !~ '^[0-9a-fA-F]{32}$';

-- =============================================================================
-- STEP 3: Make guid the unique identifier
-- =============================================================================
-- Drop the old unique constraint on loan_id if it exists
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_loan_id_key;

-- Create unique constraint on guid (allow nulls initially for migration)
-- We'll make it NOT NULL after ensuring data is migrated
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loans_guid_unique'
  ) THEN
    -- First, handle any duplicate guids by keeping the most recent
    WITH duplicates AS (
      SELECT id, guid, ROW_NUMBER() OVER (PARTITION BY guid ORDER BY updated_at DESC, created_at DESC) as rn
      FROM loans
      WHERE guid IS NOT NULL
    )
    DELETE FROM loans WHERE id IN (
      SELECT id FROM duplicates WHERE rn > 1
    );
    
    -- Now create the unique constraint
    ALTER TABLE loans ADD CONSTRAINT loans_guid_unique UNIQUE (guid);
  END IF;
END $$;

-- =============================================================================
-- STEP 4: Create index on guid for fast lookups
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_loans_guid ON loans(guid) WHERE guid IS NOT NULL;

-- Create index on loan_number for lookups by human-readable number
CREATE INDEX IF NOT EXISTS idx_loans_loan_number ON loans(loan_number) WHERE loan_number IS NOT NULL;

-- =============================================================================
-- STEP 5: Drop the loan_id column (deprecated)
-- =============================================================================
-- Note: We keep loan_id for now to avoid breaking existing queries
-- A future migration can remove it after code is updated

-- For now, make it nullable and remove the NOT NULL constraint
ALTER TABLE loans ALTER COLUMN loan_id DROP NOT NULL;

-- Add a comment indicating deprecation
COMMENT ON COLUMN loans.loan_id IS 'DEPRECATED: Use guid for unique identifier, loan_number for display. Will be removed in future migration.';

-- =============================================================================
-- STEP 6: Update user_loan_access filter index
-- =============================================================================
-- The access filter joins on guid, so ensure that index exists
DROP INDEX IF EXISTS idx_loans_loan_id_access;
CREATE INDEX IF NOT EXISTS idx_loans_guid_access ON loans(guid) WHERE guid IS NOT NULL;

-- =============================================================================
-- STEP 7: Normalize existing user_loan_access GUIDs
-- =============================================================================
-- Ensure loan_guid values match the format in loans.guid (lowercase, no braces)
UPDATE user_loan_access 
SET loan_guid = LOWER(REPLACE(REPLACE(loan_guid, '{', ''), '}', ''))
WHERE loan_guid ~ '[{}A-F]';

-- =============================================================================
-- SUMMARY
-- =============================================================================
-- After this migration:
-- - guid: Unique Encompass GUID (primary identifier for joins/access)
-- - loan_number: Human-readable loan number for display
-- - loan_id: Deprecated, nullable, will be removed later
-- - user_loan_access.loan_guid: Normalized to match loans.guid format
