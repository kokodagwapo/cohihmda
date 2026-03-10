-- Migration: Track backfill status for field swaps
-- Adds metadata so targeted field backfill jobs can run after a swap.

ALTER TABLE IF EXISTS public.encompass_field_swaps
  ADD COLUMN IF NOT EXISTS backfill_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS previous_field_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS backfill_completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'encompass_field_swaps'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'encompass_field_swaps'
        AND constraint_name = 'chk_encompass_field_swaps_backfill_status'
    ) THEN
      ALTER TABLE public.encompass_field_swaps
        ADD CONSTRAINT chk_encompass_field_swaps_backfill_status
        CHECK (backfill_status IN ('pending', 'in_progress', 'completed', 'skipped'));
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_encompass_field_swaps_backfill_status
  ON public.encompass_field_swaps(los_connection_id, backfill_status)
  WHERE is_active = TRUE;
