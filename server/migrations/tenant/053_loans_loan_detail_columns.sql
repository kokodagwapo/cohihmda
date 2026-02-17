-- Migration: Loan Detail table columns
-- Adds columns used by GET /api/loans/detail-list for Loan Detail view.

ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS subject_property_type_fannie_mae TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS fees_va_fund_fee_borr DECIMAL(12,2);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS fha_lender_id TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS fees_loan_discount_fee DECIMAL(12,4);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS fees_loan_discount_fee_borr DECIMAL(12,2);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS rush_closing_on_file TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS scrub_rating_of_file TEXT;
