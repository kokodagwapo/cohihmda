-- Backfill: normalize bare numeric field IDs to include the "Fields." prefix.
-- The Encompass RDB API returns IDs like "1994" but our canonical format is "Fields.1994".
-- This ensures consistency with DEFAULT_ENCOMPASS_FIELD_MAPPINGS.

UPDATE public.encompass_field_swaps
SET encompass_field_id = 'Fields.' || encompass_field_id,
    updated_at = NOW()
WHERE encompass_field_id ~ '^\d'
  AND encompass_field_id NOT LIKE 'Fields.%';
