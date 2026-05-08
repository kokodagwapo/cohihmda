-- =============================================================================
-- Migration 124: Multiple days-of-month for distribution schedules (monthly)
-- =============================================================================
-- Adds schedule_days INT[] for monthly recurrence; backfills from schedule_day.

ALTER TABLE public.distribution_schedules
  ADD COLUMN IF NOT EXISTS schedule_days INT[];

COMMENT ON COLUMN public.distribution_schedules.schedule_days IS
  'Days of month (1-31) for monthly frequency; invalid dates clamp to last day of month.';

UPDATE public.distribution_schedules
SET schedule_days = ARRAY[schedule_day]
WHERE frequency = 'monthly'
  AND schedule_day IS NOT NULL
  AND (schedule_days IS NULL OR cardinality(schedule_days) = 0);
