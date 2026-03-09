-- Migration: Add missing pricing dashboard lender_credits column
-- pricingDashboardService always selects l.lender_credits. Some tenant schemas
-- don't have this column yet, which causes report/detail 500s.

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS lender_credits DECIMAL(12,2);
