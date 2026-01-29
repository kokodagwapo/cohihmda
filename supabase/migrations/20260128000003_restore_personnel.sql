-- ============================================
-- RESTORE ORIGINAL PERSONNEL DATA
-- Migration Date: 2026-01-28
-- Description: Restores original personnel data from the anonymization_mapping table
-- 
-- IMPORTANT: Only run this migration if you need to reverse anonymization.
-- This will restore all original names from the mapping table.
--
-- Prerequisites:
--   - anonymization_mapping table must exist with original data
--   - Run this ONLY if you need to undo anonymization
-- ============================================

BEGIN;

DO $$
DECLARE
  v_emp_count INTEGER := 0;
  v_user_count INTEGER := 0;
  v_loan_count INTEGER := 0;
  v_mapping_exists BOOLEAN;
BEGIN

  -- Check if mapping table exists and has data
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'anonymization_mapping'
  ) INTO v_mapping_exists;
  
  IF NOT v_mapping_exists THEN
    RAISE EXCEPTION 'anonymization_mapping table does not exist. Cannot restore data.';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM public.anonymization_mapping LIMIT 1) THEN
    RAISE EXCEPTION 'anonymization_mapping table is empty. No data to restore.';
  END IF;

  RAISE NOTICE 'Starting data restoration from mapping table...';

  -- ==========================================
  -- STEP 1: Restore EMPLOYEES table
  -- ==========================================
  
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employees') THEN
    
    UPDATE public.employees e
    SET 
      first_name = m.original_first_name,
      last_name = m.original_last_name,
      email = m.original_email
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'employee' 
      AND m.original_id = e.id
      AND m.original_first_name IS NOT NULL;
    
    GET DIAGNOSTICS v_emp_count = ROW_COUNT;
    RAISE NOTICE 'Restored % employees', v_emp_count;
    
  ELSE
    RAISE NOTICE 'employees table does not exist, skipping';
  END IF;

  -- ==========================================
  -- STEP 2: Restore USERS table
  -- ==========================================
  
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    
    UPDATE public.users u
    SET 
      full_name = m.original_full_name,
      email = m.original_email
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'user' 
      AND m.original_id = u.id
      AND m.original_email IS NOT NULL;
    
    GET DIAGNOSTICS v_user_count = ROW_COUNT;
    RAISE NOTICE 'Restored % users', v_user_count;
    
  ELSE
    RAISE NOTICE 'users table does not exist, skipping';
  END IF;

  -- ==========================================
  -- STEP 3: Restore PROFILES table
  -- ==========================================
  
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    
    UPDATE public.profiles p
    SET full_name = m.original_full_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'user' 
      AND m.original_id = p.user_id
      AND m.original_full_name IS NOT NULL;
    
    RAISE NOTICE 'Restored profiles table';
    
  ELSE
    RAISE NOTICE 'profiles table does not exist, skipping';
  END IF;

  -- ==========================================
  -- STEP 4: Restore LOANS table name fields
  -- ==========================================
  
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'loans') THEN
    
    -- First, restore from employee mappings (if any)
    -- Restore loan_officer field
    UPDATE public.loans l
    SET loan_officer = m.original_first_name || ' ' || m.original_last_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'employee'
      AND l.loan_officer = m.pseudonym
      AND m.original_first_name IS NOT NULL;

    -- Restore processor field
    UPDATE public.loans l
    SET processor = m.original_first_name || ' ' || m.original_last_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'employee'
      AND l.processor = m.pseudonym
      AND m.original_first_name IS NOT NULL;

    -- Restore underwriter field
    UPDATE public.loans l
    SET underwriter = m.original_first_name || ' ' || m.original_last_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'employee'
      AND l.underwriter = m.pseudonym
      AND m.original_first_name IS NOT NULL;

    -- Restore closer field
    UPDATE public.loans l
    SET closer = m.original_first_name || ' ' || m.original_last_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'employee'
      AND l.closer = m.pseudonym
      AND m.original_first_name IS NOT NULL;

    -- Restore account_executive field
    UPDATE public.loans l
    SET account_executive = m.original_first_name || ' ' || m.original_last_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'employee'
      AND l.account_executive = m.pseudonym
      AND m.original_first_name IS NOT NULL;

    -- Restore loan_interviewer field
    UPDATE public.loans l
    SET loan_interviewer = m.original_first_name || ' ' || m.original_last_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'employee'
      AND l.loan_interviewer = m.pseudonym
      AND m.original_first_name IS NOT NULL;

    -- Now restore from loan_name mappings (names extracted directly from loans)
    UPDATE public.loans l
    SET loan_officer = m.original_full_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.loan_officer = m.pseudonym
      AND m.original_full_name IS NOT NULL;

    UPDATE public.loans l
    SET processor = m.original_full_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.processor = m.pseudonym
      AND m.original_full_name IS NOT NULL;

    UPDATE public.loans l
    SET underwriter = m.original_full_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.underwriter = m.pseudonym
      AND m.original_full_name IS NOT NULL;

    UPDATE public.loans l
    SET closer = m.original_full_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.closer = m.pseudonym
      AND m.original_full_name IS NOT NULL;

    UPDATE public.loans l
    SET account_executive = m.original_full_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.account_executive = m.pseudonym
      AND m.original_full_name IS NOT NULL;

    UPDATE public.loans l
    SET loan_interviewer = m.original_full_name
    FROM public.anonymization_mapping m
    WHERE m.entity_type = 'loan_name'
      AND l.loan_interviewer = m.pseudonym
      AND m.original_full_name IS NOT NULL;

    -- Count restored loans (names not ending with numbers)
    SELECT COUNT(*) INTO v_loan_count
    FROM public.loans
    WHERE loan_officer IS NOT NULL
      AND loan_officer !~ ' [0-9]+$';
    
    RAISE NOTICE 'Restored loan name fields (% loans now have original names)', v_loan_count;
    
  ELSE
    RAISE NOTICE 'loans table does not exist, skipping';
  END IF;

  -- ==========================================
  -- STEP 5: Log restoration to audit table
  -- ==========================================
  
  INSERT INTO public.anonymization_audit (
    operation, tables_affected, employees_count, users_count, loans_count, notes
  ) VALUES (
    'restore',
    ARRAY['employees', 'users', 'profiles', 'loans'],
    v_emp_count,
    v_user_count,
    v_loan_count,
    'Data restored from mapping table via migration'
  );

  RAISE NOTICE '===========================================';
  RAISE NOTICE 'RESTORATION COMPLETE';
  RAISE NOTICE 'Employees restored: %', v_emp_count;
  RAISE NOTICE 'Users restored: %', v_user_count;
  RAISE NOTICE 'Loans with original names: %', v_loan_count;
  RAISE NOTICE '===========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'NOTE: The anonymization_mapping table still contains the mapping data.';
  RAISE NOTICE 'To permanently delete the mapping (making restoration impossible), run:';
  RAISE NOTICE '  DROP TABLE public.anonymization_mapping;';

END $$;

COMMIT;
