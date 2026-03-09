-- Migration: Reconcile additional field columns (db_column_type fallback fix)
-- This is a re-versioned copy of the former duplicate-version 066 migration.
-- Some tenants may have skipped the old file due duplicate version numbers.

DO $$
DECLARE
  rec RECORD;
  resolved_type TEXT;
BEGIN
  FOR rec IN
    SELECT afd.id, afd.column_name, afd.db_column_type, afd.data_type
    FROM additional_field_definitions afd
    LEFT JOIN information_schema.columns isc
      ON isc.table_schema = 'public'
      AND isc.table_name = 'loans'
      AND isc.column_name = afd.column_name
    WHERE afd.column_created = TRUE
      AND isc.column_name IS NULL
  LOOP
    resolved_type := COALESCE(NULLIF(TRIM(rec.db_column_type), ''), CASE rec.data_type
      WHEN 'string'     THEN 'TEXT'
      WHEN 'number'     THEN 'DECIMAL(15,4)'
      WHEN 'date'       THEN 'DATE'
      WHEN 'boolean'    THEN 'BOOLEAN'
      WHEN 'currency'   THEN 'DECIMAL(15,2)'
      WHEN 'percentage' THEN 'DECIMAL(8,4)'
      ELSE NULL
    END);

    IF resolved_type IS NULL THEN
      RAISE WARNING 'Cannot resolve column type for %. Skipping.', rec.column_name;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS %I %s',
      rec.column_name, resolved_type
    );

    IF rec.db_column_type IS NULL OR TRIM(rec.db_column_type) = '' THEN
      UPDATE additional_field_definitions
        SET db_column_type = resolved_type
        WHERE id = rec.id;
    END IF;

    RAISE NOTICE 'Reconciled missing column: % (%)', rec.column_name, resolved_type;
  END LOOP;
END $$;
