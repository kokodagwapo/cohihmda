-- Add missing date fields to loans table for dashboard calculations
-- Migration Date: 2025-12-27
-- Description: Add application_date, closing_date, borrower_name, and interest_rate fields

-- Add application_date (when loan application was started)
ALTER TABLE public.loans 
  ADD COLUMN IF NOT EXISTS application_date TIMESTAMPTZ;

-- Add closing_date (when loan was closed/funded)
ALTER TABLE public.loans 
  ADD COLUMN IF NOT EXISTS closing_date TIMESTAMPTZ;

-- Add borrower_name (for display purposes)
ALTER TABLE public.loans 
  ADD COLUMN IF NOT EXISTS borrower_name TEXT;

-- Add interest_rate (for calculations)
ALTER TABLE public.loans 
  ADD COLUMN IF NOT EXISTS interest_rate DECIMAL(5,3);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_loans_application_date ON public.loans(application_date) WHERE application_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_closing_date ON public.loans(closing_date) WHERE closing_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_loan_type ON public.loans(loan_type) WHERE loan_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_loan_purpose ON public.loans(loan_purpose) WHERE loan_purpose IS NOT NULL;

COMMENT ON COLUMN public.loans.application_date IS 'Date when loan application was started';
COMMENT ON COLUMN public.loans.closing_date IS 'Date when loan was closed/funded';
COMMENT ON COLUMN public.loans.borrower_name IS 'Name of the borrower';
COMMENT ON COLUMN public.loans.interest_rate IS 'Interest rate for the loan';
