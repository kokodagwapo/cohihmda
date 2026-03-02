-- Deduplicate additional field columns that overlap with built-in _date columns.
-- When additional_field_definitions has column_name = 'disclosure_prep' but public.loans
-- already has disclosure_prep_date, we merge data into the built-in column, drop the
-- duplicate, and remove the definition.

DO $$
DECLARE
  rec RECORD;
  builtin_col TEXT;
  dup_col TEXT;
BEGIN
  FOR rec IN
    SELECT afd.id, afd.column_name
    FROM additional_field_definitions afd
    INNER JOIN information_schema.columns isc_dup
      ON isc_dup.table_schema = 'public'
      AND isc_dup.table_name = 'loans'
      AND isc_dup.column_name = afd.column_name
    INNER JOIN information_schema.columns isc_builtin
      ON isc_builtin.table_schema = 'public'
      AND isc_builtin.table_name = 'loans'
      AND isc_builtin.column_name = afd.column_name || '_date'
    WHERE afd.column_created = TRUE
  LOOP
    dup_col := rec.column_name;
    builtin_col := rec.column_name || '_date';

    -- Merge: fill built-in column from duplicate where built-in is NULL
    EXECUTE format(
      'UPDATE public.loans SET %I = COALESCE(%I, %I) WHERE %I IS NULL AND %I IS NOT NULL',
      builtin_col, builtin_col, dup_col, builtin_col, dup_col
    );

    -- Drop the duplicate column
    EXECUTE format('ALTER TABLE public.loans DROP COLUMN IF EXISTS %I', dup_col);

    -- Remove the additional field definition
    DELETE FROM additional_field_definitions WHERE id = rec.id;

    RAISE NOTICE 'Deduplicated: % -> % (merged data, dropped column, removed definition)', dup_col, builtin_col;
  END LOOP;
END $$;
