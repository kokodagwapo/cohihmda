-- ============================================
-- EXECUTE PERSONNEL ANONYMIZATION
-- Migration Date: 2026-01-28
-- Description: Anonymizes personnel data in employees, users, profiles, and loans tables
-- 
-- IMPORTANT: This migration should only be run on a specific tenant database
-- that requires anonymization. Do NOT run on production databases without backup.
--
-- Prerequisites: 
--   - Run 20260128000001_anonymization_infrastructure.sql first
--   - Create a database backup before running
-- ============================================

BEGIN;

-- Variables to track counts
DO $$
DECLARE
  v_emp_count INTEGER := 0;
  v_user_count INTEGER := 0;
  v_loan_count INTEGER := 0;
  v_loan_name_count INTEGER := 0;
  v_pseudonym TEXT;
  v_name_record RECORD;
  v_seq INTEGER := 0;
  v_first_names TEXT[];
  v_last_names TEXT[];
  v_first_idx INTEGER;
  v_last_idx INTEGER;
BEGIN
  -- Load name arrays once at the start
  v_first_names := get_fake_first_names();
  v_last_names := get_fake_last_names();

  -- ==========================================
  -- STEP 1: Anonymize EMPLOYEES table
  -- ==========================================
  
  -- Check if employees table exists and has data
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employees') THEN
    
    -- Insert mappings for all employees
    INSERT INTO public.anonymization_mapping (
      entity_type, original_id, original_first_name, original_last_name, 
      original_email, pseudonym, pseudonym_first_name, pseudonym_last_name, pseudonym_email
    )
    SELECT 
      'employee',
      id,
      first_name,
      last_name,
      email,
      generate_pseudonym('employee', id),
      get_pseudonym_first_name(generate_pseudonym('employee', id)),
      get_pseudonym_last_name(generate_pseudonym('employee', id)),
      LOWER(REPLACE(generate_pseudonym('employee', id), ' ', '.')) || '@anon.local'
    FROM public.employees
    ON CONFLICT (entity_type, original_id) DO NOTHING;
    
    -- Update employees with pseudonyms (split into first_name and last_name)
    UPDATE public.employees e
    SET 
      first_name = m.pseudonym_first_name,
      last_name = m.pseudonym_last_name,
      email = m.pseudonym_email
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'employee' 
      AND m.original_id = e.id;
    
    GET DIAGNOSTICS v_emp_count = ROW_COUNT;
    RAISE NOTICE 'Anonymized % employees', v_emp_count;
    
  ELSE
    RAISE NOTICE 'employees table does not exist, skipping';
  END IF;

  -- ==========================================
  -- STEP 2: Anonymize USERS table
  -- ==========================================
  
  -- Check if users table exists
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    
    -- Insert mappings for all users
    INSERT INTO public.anonymization_mapping (
      entity_type, original_id, original_full_name, 
      original_email, pseudonym, pseudonym_email
    )
    SELECT 
      'user',
      id,
      full_name,
      email,
      generate_pseudonym('user', id),
      LOWER(REPLACE(generate_pseudonym('user', id), ' ', '.')) || '@anon.local'
    FROM public.users
    ON CONFLICT (entity_type, original_id) DO NOTHING;
    
    -- Update users with pseudonyms
    UPDATE public.users u
    SET 
      full_name = m.pseudonym,
      email = m.pseudonym_email
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'user' 
      AND m.original_id = u.id;
    
    GET DIAGNOSTICS v_user_count = ROW_COUNT;
    RAISE NOTICE 'Anonymized % users', v_user_count;
    
  ELSE
    RAISE NOTICE 'users table does not exist, skipping';
  END IF;

  -- ==========================================
  -- STEP 3: Anonymize PROFILES table
  -- ==========================================
  
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    
    UPDATE public.profiles p
    SET 
      full_name = m.pseudonym,
      avatar_url = NULL  -- Remove avatar URLs
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'user' 
      AND m.original_id = p.user_id;
    
    RAISE NOTICE 'Updated profiles table';
    
  ELSE
    RAISE NOTICE 'profiles table does not exist, skipping';
  END IF;

  -- ==========================================
  -- STEP 4: Anonymize LOANS table name fields
  -- This handles names directly in loans even if employees table is empty
  -- ==========================================
  
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'loans') THEN
    
    -- First, try to match against employees mapping (if any exist)
    IF EXISTS (SELECT 1 FROM public.anonymization_mapping WHERE entity_type = 'employee' LIMIT 1) THEN
      
      -- Update loan_officer field using employee mapping
      UPDATE public.loans l
      SET loan_officer = m.pseudonym
      FROM public.anonymization_mapping m
      WHERE m.entity_type = 'employee'
        AND (
          l.loan_officer = m.original_first_name || ' ' || m.original_last_name
          OR l.loan_officer = m.original_last_name || ', ' || m.original_first_name
          OR l.loan_officer_id = m.original_id::TEXT
        );

      -- Update processor field
      UPDATE public.loans l
      SET processor = m.pseudonym
      FROM public.anonymization_mapping m
      WHERE m.entity_type = 'employee'
        AND (
          l.processor = m.original_first_name || ' ' || m.original_last_name
          OR l.processor = m.original_last_name || ', ' || m.original_first_name
          OR l.loan_processor_id = m.original_id::TEXT
        );

      -- Update underwriter field
      UPDATE public.loans l
      SET underwriter = m.pseudonym
      FROM public.anonymization_mapping m
      WHERE m.entity_type = 'employee'
        AND (
          l.underwriter = m.original_first_name || ' ' || m.original_last_name
          OR l.underwriter = m.original_last_name || ', ' || m.original_first_name
          OR l.underwriter_id = m.original_id::TEXT
        );

      -- Update closer field
      UPDATE public.loans l
      SET closer = m.pseudonym
      FROM public.anonymization_mapping m
      WHERE m.entity_type = 'employee'
        AND (
          l.closer = m.original_first_name || ' ' || m.original_last_name
          OR l.closer = m.original_last_name || ', ' || m.original_first_name
          OR l.closer_id = m.original_id::TEXT
        );

      -- Update account_executive field
      UPDATE public.loans l
      SET account_executive = m.pseudonym
      FROM public.anonymization_mapping m
      WHERE m.entity_type = 'employee'
        AND (
          l.account_executive = m.original_first_name || ' ' || m.original_last_name
          OR l.account_executive = m.original_last_name || ', ' || m.original_first_name
        );

      -- Update loan_interviewer field
      UPDATE public.loans l
      SET loan_interviewer = m.pseudonym
      FROM public.anonymization_mapping m
      WHERE m.entity_type = 'employee'
        AND (
          l.loan_interviewer = m.original_first_name || ' ' || m.original_last_name
          OR l.loan_interviewer = m.original_last_name || ', ' || m.original_first_name
        );
        
      RAISE NOTICE 'Attempted to match loan names against employee mappings';
    END IF;

    -- ==========================================
    -- STEP 4b: Create mappings for DISTINCT names in loans that weren't matched
    -- This handles the case where employees table is empty
    -- ==========================================
    
    RAISE NOTICE 'Creating mappings for unique names found directly in loans table...';
    
    -- Create a temp table with all unique names from loans
    CREATE TEMP TABLE temp_loan_names AS
    SELECT DISTINCT name, 'loan_officer' as source_field
    FROM (
      SELECT loan_officer as name FROM public.loans 
      WHERE loan_officer IS NOT NULL AND loan_officer != '' AND loan_officer !~ ' [0-9]+$'
      UNION
      SELECT processor as name FROM public.loans 
      WHERE processor IS NOT NULL AND processor != '' AND processor !~ ' [0-9]+$'
      UNION
      SELECT underwriter as name FROM public.loans 
      WHERE underwriter IS NOT NULL AND underwriter != '' AND underwriter !~ ' [0-9]+$'
      UNION
      SELECT closer as name FROM public.loans 
      WHERE closer IS NOT NULL AND closer != '' AND closer !~ ' [0-9]+$'
      UNION
      SELECT account_executive as name FROM public.loans 
      WHERE account_executive IS NOT NULL AND account_executive != '' AND account_executive !~ ' [0-9]+$'
      UNION
      SELECT loan_interviewer as name FROM public.loans 
      WHERE loan_interviewer IS NOT NULL AND loan_interviewer != '' AND loan_interviewer !~ ' [0-9]+$'
    ) all_names;
    
    -- Get count of unique names
    SELECT COUNT(*) INTO v_loan_name_count FROM temp_loan_names;
    RAISE NOTICE 'Found % unique names in loans to anonymize', v_loan_name_count;
    
    -- Create mappings for each unique name (using 'loan_name' entity type)
    v_seq := COALESCE((SELECT COUNT(*) FROM public.anonymization_mapping WHERE entity_type = 'loan_name'), 0);
    
    FOR v_name_record IN SELECT name FROM temp_loan_names LOOP
      v_seq := v_seq + 1;
      
      -- Calculate array indices (1-based, cycling through 50 names)
      v_first_idx := ((v_seq - 1) % 50) + 1;
      v_last_idx := ((v_seq - 1) % 50) + 1;
      
      -- Generate pseudonym using the name pool
      v_pseudonym := v_first_names[v_first_idx] || ' ' || v_last_names[v_last_idx] || ' ' || v_seq;
      
      -- Insert mapping for this name
      INSERT INTO public.anonymization_mapping (
        entity_type, 
        original_id,
        original_full_name, 
        pseudonym
      )
      VALUES (
        'loan_name',
        gen_random_uuid(),  -- Generate a UUID since we don't have a real ID
        v_name_record.name,
        v_pseudonym
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    
    DROP TABLE temp_loan_names;
    
    RAISE NOTICE 'Created % name mappings from loans', v_seq;
    
    -- Now update all loan name fields using the loan_name mappings
    UPDATE public.loans l
    SET loan_officer = m.pseudonym
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.loan_officer = m.original_full_name;
      
    UPDATE public.loans l
    SET processor = m.pseudonym
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.processor = m.original_full_name;

    UPDATE public.loans l
    SET underwriter = m.pseudonym
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.underwriter = m.original_full_name;

    UPDATE public.loans l
    SET closer = m.pseudonym
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.closer = m.original_full_name;

    UPDATE public.loans l
    SET account_executive = m.pseudonym
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.account_executive = m.original_full_name;

    UPDATE public.loans l
    SET loan_interviewer = m.pseudonym
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.loan_interviewer = m.original_full_name;

    -- Count affected loans (check for names ending with numbers, indicating anonymized)
    SELECT COUNT(*) INTO v_loan_count
    FROM public.loans
    WHERE loan_officer ~ ' [0-9]+$'
       OR processor ~ ' [0-9]+$'
       OR underwriter ~ ' [0-9]+$'
       OR closer ~ ' [0-9]+$';
    
    RAISE NOTICE 'Updated % loans with anonymized names', v_loan_count;
    
  ELSE
    RAISE NOTICE 'loans table does not exist, skipping';
  END IF;

  -- ==========================================
  -- STEP 5: Log to audit table
  -- ==========================================
  
  INSERT INTO public.anonymization_audit (
    operation, tables_affected, employees_count, users_count, loans_count, notes
  ) VALUES (
    'anonymize',
    ARRAY['employees', 'users', 'profiles', 'loans'],
    v_emp_count,
    v_user_count,
    v_loan_count,
    'Full tenant anonymization via migration - using realistic fake names. Created ' || v_loan_name_count || ' name mappings from loans table.'
  );

  RAISE NOTICE '===========================================';
  RAISE NOTICE 'ANONYMIZATION COMPLETE';
  RAISE NOTICE 'Employees: %', v_emp_count;
  RAISE NOTICE 'Users: %', v_user_count;
  RAISE NOTICE 'Unique names mapped from loans: %', v_loan_name_count;
  RAISE NOTICE 'Total loans with anonymized names: %', v_loan_count;
  RAISE NOTICE '===========================================';

END $$;

COMMIT;
