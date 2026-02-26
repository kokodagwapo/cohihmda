-- Reconcile additional_field_definitions with public.loans
-- For any definition with column_created = TRUE but no actual column on loans,
-- create the column so schema and metadata stay in sync.

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT afd.column_name, afd.db_column_type
    FROM additional_field_definitions afd
    LEFT JOIN information_schema.columns isc
      ON isc.table_schema = 'public'
      AND isc.table_name = 'loans'
      AND isc.column_name = afd.column_name
    WHERE afd.column_created = TRUE
      AND isc.column_name IS NULL
  LOOP
    EXECUTE format(
      'ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS %I %s',
      rec.column_name, rec.db_column_type
    );
    RAISE NOTICE 'Reconciled missing column: %', rec.column_name;
  END LOOP;
END $$;
