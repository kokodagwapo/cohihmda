-- Fix Loans Table Schema Alignment
-- Migration Date: 2025-12-31
-- Description: Aligns loans table schema with backend code expectations

-- Add borrower_name column if missing
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'loans' 
    AND column_name = 'borrower_name'
  ) THEN
    ALTER TABLE public.loans ADD COLUMN borrower_name TEXT;
  END IF;
END $$;

-- Make loan_id NOT NULL if it's currently nullable
DO $$ 
BEGIN
  -- Check if loan_id can be null
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'loans' 
    AND column_name = 'loan_id'
    AND is_nullable = 'YES'
  ) THEN
    -- First, set any NULL loan_ids to a default value
    UPDATE public.loans 
    SET loan_id = 'LOAN-' || id::text 
    WHERE loan_id IS NULL;
    
    -- Then make it NOT NULL
    ALTER TABLE public.loans ALTER COLUMN loan_id SET NOT NULL;
  END IF;
END $$;

-- Add UNIQUE constraint on (tenant_id, loan_id) if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_loan_per_tenant'
  ) THEN
    ALTER TABLE public.loans 
    ADD CONSTRAINT unique_loan_per_tenant 
    UNIQUE(tenant_id, loan_id);
  END IF;
END $$;

-- Add index on borrower_name for search performance
CREATE INDEX IF NOT EXISTS idx_loans_borrower_name 
ON public.loans(borrower_name) 
WHERE borrower_name IS NOT NULL;

COMMENT ON COLUMN public.loans.borrower_name IS 'Borrower full name';
COMMENT ON CONSTRAINT unique_loan_per_tenant ON public.loans IS 'Ensures each loan_id is unique per tenant';
