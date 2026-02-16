-- Migration: Migrate Duplicate Field Aliases
-- Created: 2026-02-04
-- Database: tenant
--
-- Migrates field swaps from short aliases to full "Date" aliases to prevent conflicts:
-- - "Started" → "Started Date" (both map to Fields.Log.MS.Date.Started)
-- - "Funding" → "Funding Date" (different fields: Fields.Log.MS.Date.Funding vs Fields.MS.FUN)
--
-- This migration ensures field swaps use the canonical aliases and prevents
-- data conflicts where different Encompass field IDs map to the same column.

-- =============================================================================
-- STEP 1: Migrate "Started" → "Started Date"
-- =============================================================================
-- Both aliases map to Fields.Log.MS.Date.Started, so migrate swaps to use "Started Date"

DO $$
DECLARE
  swap_record RECORD;
  conflict_count INTEGER;
BEGIN
  -- Check if table exists
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'encompass_field_swaps'
  ) THEN
    -- Find swaps using "Started" alias
    FOR swap_record IN
      SELECT id, los_connection_id, coheus_alias, encompass_field_id, swap_type
      FROM public.encompass_field_swaps
      WHERE coheus_alias = 'Started'
        AND is_active = TRUE
    LOOP
      -- Check if a swap already exists for "Started Date"
      SELECT COUNT(*) INTO conflict_count
      FROM public.encompass_field_swaps
      WHERE los_connection_id = swap_record.los_connection_id
        AND coheus_alias = 'Started Date'
        AND swap_type = swap_record.swap_type
        AND is_active = TRUE;

      IF conflict_count > 0 THEN
        -- Conflict: Check if they map to the same field ID
        IF EXISTS (
          SELECT 1
          FROM public.encompass_field_swaps
          WHERE los_connection_id = swap_record.los_connection_id
            AND coheus_alias = 'Started Date'
            AND swap_type = swap_record.swap_type
            AND encompass_field_id = swap_record.encompass_field_id
            AND is_active = TRUE
        ) THEN
          -- Same field ID, safe to deactivate the duplicate
          UPDATE public.encompass_field_swaps
          SET is_active = FALSE, updated_at = NOW()
          WHERE id = swap_record.id;
          
          RAISE NOTICE 'Deactivated duplicate swap: "Started" (same field ID as "Started Date") for connection %', swap_record.los_connection_id;
        ELSE
          -- Different field IDs - log warning but keep both active for manual review
          RAISE WARNING 'Conflict: "Started" maps to % but "Started Date" maps to different field for connection %. Manual review needed.', 
            swap_record.encompass_field_id, swap_record.los_connection_id;
        END IF;
      ELSE
        -- No conflict, migrate the swap
        UPDATE public.encompass_field_swaps
        SET coheus_alias = 'Started Date', updated_at = NOW()
        WHERE id = swap_record.id;
        
        RAISE NOTICE 'Migrated swap: "Started" → "Started Date" for connection %', swap_record.los_connection_id;
      END IF;
    END LOOP;
  END IF;
END $$;

-- =============================================================================
-- STEP 2: Migrate "Funding" → "Funding Date"
-- =============================================================================
-- CRITICAL: These map to DIFFERENT Encompass fields:
-- - "Funding" → Fields.Log.MS.Date.Funding
-- - "Funding Date" → Fields.MS.FUN
-- Both resolve to funding_date column, causing conflicts!

DO $$
DECLARE
  swap_record RECORD;
  conflict_count INTEGER;
  existing_field_id TEXT;
BEGIN
  -- Check if table exists
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'encompass_field_swaps'
  ) THEN
    -- Find swaps using "Funding" alias
    FOR swap_record IN
      SELECT id, los_connection_id, coheus_alias, encompass_field_id, swap_type
      FROM public.encompass_field_swaps
      WHERE coheus_alias = 'Funding'
        AND is_active = TRUE
    LOOP
      -- Check if a swap already exists for "Funding Date"
      SELECT COUNT(*), MAX(encompass_field_id) INTO conflict_count, existing_field_id
      FROM public.encompass_field_swaps
      WHERE los_connection_id = swap_record.los_connection_id
        AND coheus_alias = 'Funding Date'
        AND swap_type = swap_record.swap_type
        AND is_active = TRUE;

      IF conflict_count > 0 THEN
        -- Conflict: Different field IDs mapping to same column
        -- Log warning - these need manual review
        RAISE WARNING 'CONFLICT: "Funding" (Field: %) and "Funding Date" (Field: %) both map to funding_date column for connection %. Manual review required!', 
          swap_record.encompass_field_id, existing_field_id, swap_record.los_connection_id;
        
        -- Keep both active but add a note in description
        UPDATE public.encompass_field_swaps
        SET description = COALESCE(description || ' ', '') || '[MIGRATION WARNING: Conflicts with "Funding Date" - review needed]',
            updated_at = NOW()
        WHERE id = swap_record.id;
      ELSE
        -- No conflict, migrate the swap
        -- BUT: Check if the field ID matches what "Funding Date" should map to
        IF swap_record.encompass_field_id = 'Fields.MS.FUN' THEN
          -- Field ID matches "Funding Date" default, migrate it
          UPDATE public.encompass_field_swaps
          SET coheus_alias = 'Funding Date', updated_at = NOW()
          WHERE id = swap_record.id;
          
          RAISE NOTICE 'Migrated swap: "Funding" → "Funding Date" (Fields.MS.FUN) for connection %', swap_record.los_connection_id;
        ELSE
          -- Field ID is Fields.Log.MS.Date.Funding - this is a different field!
          -- Keep it but warn that it conflicts with Funding Date
          UPDATE public.encompass_field_swaps
          SET description = COALESCE(description || ' ', '') || '[MIGRATION WARNING: "Funding" maps to Fields.Log.MS.Date.Funding, different from "Funding Date" (Fields.MS.FUN) - both resolve to funding_date column]',
              updated_at = NOW()
          WHERE id = swap_record.id;
          
          RAISE WARNING 'Field ID mismatch: "Funding" swap uses % (should be Fields.MS.FUN for "Funding Date"). Keeping active but needs review for connection %', 
            swap_record.encompass_field_id, swap_record.los_connection_id;
        END IF;
      END IF;
    END LOOP;
  END IF;
END $$;

-- =============================================================================
-- STEP 3: Summary and verification
-- =============================================================================
-- Log summary of remaining swaps using short aliases (should be none after migration)

DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'encompass_field_swaps'
  ) THEN
    SELECT COUNT(*) INTO remaining_count
    FROM public.encompass_field_swaps
    WHERE coheus_alias IN ('Started', 'Funding')
      AND is_active = TRUE;

    IF remaining_count > 0 THEN
      RAISE NOTICE 'Migration complete. % active swap(s) still using short aliases (may need manual review).', remaining_count;
    ELSE
      RAISE NOTICE 'Migration complete. All swaps migrated to full "Date" aliases.';
    END IF;
  END IF;
END $$;

-- =============================================================================
-- SUMMARY
-- =============================================================================
-- After this migration:
-- - Field swaps using "Started" are migrated to "Started Date"
-- - Field swaps using "Funding" are migrated to "Funding Date" (if field ID matches)
-- - Conflicts are logged as warnings for manual review
-- - The duplicate aliases have been removed from defaultEncompassFieldMappings.ts
--   to prevent future conflicts
