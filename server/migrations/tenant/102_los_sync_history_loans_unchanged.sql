-- =============================================================================
-- Migration 102: Add loans_unchanged column to los_sync_history
-- =============================================================================
-- Tracks how many loans were processed during a sync but had no field changes
-- (i.e. the upsert WHERE IS DISTINCT FROM clause skipped the actual update).
-- This distinguishes truly changed loans from loans that were re-fetched but
-- already up-to-date, giving accurate sync metrics.

ALTER TABLE public.los_sync_history
  ADD COLUMN IF NOT EXISTS loans_unchanged INTEGER DEFAULT 0;

-- Back-fill existing rows: set loans_unchanged = 0 (unknown for historical runs)
UPDATE public.los_sync_history
SET loans_unchanged = 0
WHERE loans_unchanged IS NULL;
