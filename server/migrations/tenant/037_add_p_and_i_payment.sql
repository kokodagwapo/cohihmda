-- =============================================================================
-- Migration 037: Add p_and_i_payment column to loans table
-- =============================================================================
-- Principal & Interest payment column was missing from the original loans table
-- migration (002). Previously only added by tenantDatabaseSchema.ts at runtime.

ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS p_and_i_payment DECIMAL(12,2);
