-- ============================================
-- ANONYMIZATION INFRASTRUCTURE
-- Migration Date: 2026-01-28
-- Description: Creates tables and functions for personnel data anonymization
-- ============================================

-- Mapping table to store original -> pseudonym relationships
CREATE TABLE IF NOT EXISTS public.anonymization_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,           -- 'employee', 'user'
  original_id UUID NOT NULL,
  original_first_name TEXT,
  original_last_name TEXT,
  original_full_name TEXT,
  original_email TEXT,
  pseudonym TEXT NOT NULL,
  pseudonym_first_name TEXT,
  pseudonym_last_name TEXT,
  pseudonym_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_type, original_id)
);

-- Index for fast lookups during loan updates
CREATE INDEX IF NOT EXISTS idx_anon_mapping_lookup 
  ON public.anonymization_mapping(entity_type, original_id);
CREATE INDEX IF NOT EXISTS idx_anon_mapping_original_name 
  ON public.anonymization_mapping(original_first_name, original_last_name);
CREATE INDEX IF NOT EXISTS idx_anon_mapping_pseudonym
  ON public.anonymization_mapping(pseudonym);

-- Audit table to track anonymization operations
CREATE TABLE IF NOT EXISTS public.anonymization_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,              -- 'anonymize', 'restore'
  performed_at TIMESTAMPTZ DEFAULT NOW(),
  tables_affected TEXT[],
  employees_count INTEGER DEFAULT 0,
  users_count INTEGER DEFAULT 0,
  loans_count INTEGER DEFAULT 0,
  is_reversible BOOLEAN DEFAULT true,
  notes TEXT
);

-- Pool of realistic fake first names (50 names)
CREATE OR REPLACE FUNCTION get_fake_first_names() 
RETURNS TEXT[] AS $$
BEGIN
  RETURN ARRAY[
    'Michael', 'Sarah', 'David', 'Jennifer', 'Robert', 'Emily', 'James', 'Amanda',
    'William', 'Jessica', 'Richard', 'Ashley', 'Joseph', 'Stephanie', 'Thomas', 'Nicole',
    'Christopher', 'Elizabeth', 'Daniel', 'Melissa', 'Matthew', 'Michelle', 'Anthony', 'Laura',
    'Mark', 'Kimberly', 'Steven', 'Rebecca', 'Paul', 'Rachel', 'Andrew', 'Heather',
    'Joshua', 'Amy', 'Kenneth', 'Angela', 'Kevin', 'Megan', 'Brian', 'Christina',
    'George', 'Samantha', 'Timothy', 'Katherine', 'Ronald', 'Lisa', 'Edward', 'Nancy',
    'Jason', 'Karen'
  ];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Pool of realistic fake last names (50 names)
CREATE OR REPLACE FUNCTION get_fake_last_names() 
RETURNS TEXT[] AS $$
BEGIN
  RETURN ARRAY[
    'Johnson', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor',
    'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Garcia',
    'Martinez', 'Robinson', 'Clark', 'Rodriguez', 'Lewis', 'Lee', 'Walker', 'Hall',
    'Allen', 'Young', 'Hernandez', 'King', 'Wright', 'Lopez', 'Hill', 'Scott',
    'Green', 'Adams', 'Baker', 'Gonzalez', 'Nelson', 'Carter', 'Mitchell', 'Perez',
    'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins',
    'Stewart', 'Morris'
  ];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to generate realistic pseudonyms with sequential numbers
-- Output format: "Michael Johnson 1", "Sarah Williams 2", etc.
CREATE OR REPLACE FUNCTION generate_pseudonym(
  p_entity_type TEXT,
  p_entity_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_first_names TEXT[];
  v_last_names TEXT[];
  v_seq_num INTEGER;
  v_first_name TEXT;
  v_last_name TEXT;
  v_existing TEXT;
BEGIN
  -- Check if pseudonym already exists for this entity
  SELECT pseudonym INTO v_existing
  FROM public.anonymization_mapping
  WHERE entity_type = p_entity_type AND original_id = p_entity_id;
  
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Get name pools
  v_first_names := get_fake_first_names();
  v_last_names := get_fake_last_names();
  
  -- Get next sequence number for this entity type
  SELECT COALESCE(COUNT(*), 0) + 1
  INTO v_seq_num
  FROM public.anonymization_mapping
  WHERE entity_type = p_entity_type;
  
  -- Pick names from pools using modulo to cycle through
  -- This creates combinations like: Michael Johnson, Sarah Williams, David Brown, etc.
  v_first_name := v_first_names[((v_seq_num - 1) % array_length(v_first_names, 1)) + 1];
  v_last_name := v_last_names[((v_seq_num - 1) % array_length(v_last_names, 1)) + 1];
  
  -- Return full name with sequence number appended
  RETURN v_first_name || ' ' || v_last_name || ' ' || v_seq_num;
END;
$$ LANGUAGE plpgsql;

-- Helper function to extract first name from pseudonym
CREATE OR REPLACE FUNCTION get_pseudonym_first_name(p_pseudonym TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Extract first word (first name)
  RETURN split_part(p_pseudonym, ' ', 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper function to extract last name with number from pseudonym
CREATE OR REPLACE FUNCTION get_pseudonym_last_name(p_pseudonym TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Extract second word + number (e.g., "Johnson 1")
  RETURN split_part(p_pseudonym, ' ', 2) || ' ' || split_part(p_pseudonym, ' ', 3);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add comments for documentation
COMMENT ON TABLE public.anonymization_mapping IS 'Stores original PII to pseudonym mappings for reversible anonymization';
COMMENT ON COLUMN public.anonymization_mapping.entity_type IS 'Type of entity: employee or user';
COMMENT ON COLUMN public.anonymization_mapping.original_id IS 'UUID of the original record';
COMMENT ON COLUMN public.anonymization_mapping.pseudonym IS 'Full pseudonym (e.g., Michael Johnson 1)';
COMMENT ON COLUMN public.anonymization_mapping.pseudonym_first_name IS 'First name portion of pseudonym';
COMMENT ON COLUMN public.anonymization_mapping.pseudonym_last_name IS 'Last name + number portion of pseudonym';

COMMENT ON TABLE public.anonymization_audit IS 'Audit log for anonymization and restoration operations';
COMMENT ON COLUMN public.anonymization_audit.operation IS 'Type of operation: anonymize or restore';
COMMENT ON COLUMN public.anonymization_audit.is_reversible IS 'Whether the operation can be reversed (mapping table exists)';

COMMENT ON FUNCTION generate_pseudonym IS 'Generates a realistic fake name with sequential number (e.g., Michael Johnson 1)';
COMMENT ON FUNCTION get_fake_first_names IS 'Returns array of 50 common first names for pseudonymization';
COMMENT ON FUNCTION get_fake_last_names IS 'Returns array of 50 common last names for pseudonymization';
