-- Migration: Persist market change delta on loans for display and fallout
-- market_change_delta = lock market rate - current market rate (from FRED).
-- Positive = rates dropped since lock (withdrawal risk); negative = rates rose (favorable).

ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS market_change_delta DECIMAL(8,4);

COMMENT ON COLUMN public.loans.market_change_delta IS
  'Lock market rate minus current market rate (%). Positive = rates dropped since lock. Computed from market_rates (FRED) and persisted when running predictions.';
