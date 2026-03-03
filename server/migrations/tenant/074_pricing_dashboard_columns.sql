-- Migration: Add missing pricing dashboard columns
-- These columns are referenced by pricingDashboardService but were never added to the loans table.
-- Without them, tenants that don't have these as additional_field_definitions get
-- "column does not exist" errors on the pricing dashboard.

ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS line_800_total_borrower_paid_amount DECIMAL(12,2);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS line_800_total_seller_paid_amount DECIMAL(12,2);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS fees_interest_borr DECIMAL(12,2);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS purchase_adv_expected_int_pymt_from_investor DECIMAL(12,2);
