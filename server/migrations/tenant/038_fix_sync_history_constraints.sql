-- =============================================================================
-- Migration 038: Fix los_sync_history CHECK constraints
-- =============================================================================
-- The original status constraint from migration 003 only allowed
-- 'started', 'in_progress', 'completed', 'failed', 'cancelled'.
-- The ETL service writes 'success' and 'partial'. Fix both constraints.

ALTER TABLE public.los_sync_history DROP CONSTRAINT IF EXISTS los_sync_history_status_check;
ALTER TABLE public.los_sync_history ADD CONSTRAINT los_sync_history_status_check
  CHECK (status IN ('success', 'partial', 'failed'));

ALTER TABLE public.los_sync_history DROP CONSTRAINT IF EXISTS los_sync_history_sync_type_check;
ALTER TABLE public.los_sync_history ADD CONSTRAINT los_sync_history_sync_type_check
  CHECK (sync_type IN ('full', 'incremental'));
