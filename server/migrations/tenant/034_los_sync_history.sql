-- =============================================================================
-- Migration 034: Align los_sync_history with application code
-- =============================================================================
-- Migration 003 created los_sync_history with columns: loans_processed,
-- loans_created, details, created_at and CHECK constraints that don't match
-- the ETL service output. This migration aligns the table schema and constraints.

-- Add columns the application expects
ALTER TABLE public.los_sync_history ADD COLUMN IF NOT EXISTS loans_added INTEGER DEFAULT 0;
ALTER TABLE public.los_sync_history ADD COLUMN IF NOT EXISTS total_loans_after INTEGER DEFAULT 0;
ALTER TABLE public.los_sync_history ADD COLUMN IF NOT EXISTS modified_from TIMESTAMPTZ;
ALTER TABLE public.los_sync_history ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

-- Drop columns the application does not use
ALTER TABLE public.los_sync_history DROP COLUMN IF EXISTS loans_processed;
ALTER TABLE public.los_sync_history DROP COLUMN IF EXISTS loans_created;
ALTER TABLE public.los_sync_history DROP COLUMN IF EXISTS details;

-- Drop the redundant created_at column (started_at serves the same purpose)
ALTER TABLE public.los_sync_history DROP COLUMN IF EXISTS created_at;

-- Update CHECK constraints to match ETL service output values
-- status: ETL writes 'success', 'partial', 'failed'
-- sync_type: ETL writes 'incremental', 'full'
ALTER TABLE public.los_sync_history DROP CONSTRAINT IF EXISTS los_sync_history_status_check;
ALTER TABLE public.los_sync_history ADD CONSTRAINT los_sync_history_status_check
  CHECK (status IN ('success', 'partial', 'failed'));

ALTER TABLE public.los_sync_history DROP CONSTRAINT IF EXISTS los_sync_history_sync_type_check;
ALTER TABLE public.los_sync_history ADD CONSTRAINT los_sync_history_sync_type_check
  CHECK (sync_type IN ('full', 'incremental'));

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_sync_history_connection
  ON public.los_sync_history(los_connection_id, started_at DESC);
