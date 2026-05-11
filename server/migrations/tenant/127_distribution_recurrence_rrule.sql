-- =============================================================================
-- Migration 127: RFC 5545 recurrence (RRULE) for distribution schedules
-- =============================================================================
-- Adds recurrence_rule, recurrence_dtstart, recurrence_exdates, schedule_weekdays,
-- extends frequency CHECK for 'custom', and backfills from legacy columns.

ALTER TABLE public.distribution_schedules
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_dtstart TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurrence_exdates TIMESTAMPTZ[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule_weekdays INT[];

COMMENT ON COLUMN public.distribution_schedules.recurrence_rule IS
  'RFC 5545 RRULE body only (no DTSTART line), e.g. FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,FR';
COMMENT ON COLUMN public.distribution_schedules.recurrence_dtstart IS
  'Anchor instant (UTC) for recurrence; wall time matches schedule_time in timezone.';
COMMENT ON COLUMN public.distribution_schedules.recurrence_exdates IS
  'EXDATE equivalents — instants to skip when expanding the rule.';
COMMENT ON COLUMN public.distribution_schedules.schedule_weekdays IS
  'Optional 0–6 (Sun–Sat) weekdays for weekly/biweekly UI; canonical definition is recurrence_rule.';

ALTER TABLE public.distribution_schedules
  DROP CONSTRAINT IF EXISTS distribution_schedules_frequency_check;

ALTER TABLE public.distribution_schedules
  ADD CONSTRAINT distribution_schedules_frequency_check
  CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'one_time', 'custom'));

UPDATE public.distribution_schedules
SET schedule_weekdays = ARRAY[schedule_day]
WHERE schedule_day IS NOT NULL
  AND frequency IN ('weekly', 'biweekly')
  AND (schedule_weekdays IS NULL OR cardinality(schedule_weekdays) = 0);

UPDATE public.distribution_schedules
SET
  recurrence_dtstart = CASE
    WHEN frequency = 'one_time' THEN NULL
    ELSE COALESCE(next_run_at, created_at)
  END,
  recurrence_rule = CASE
    WHEN frequency = 'one_time' THEN NULL
    WHEN frequency = 'daily' THEN 'FREQ=DAILY;INTERVAL=1'
    WHEN frequency = 'weekly' AND schedule_day IS NOT NULL THEN
      'FREQ=WEEKLY;INTERVAL=1;BYDAY='
      || (ARRAY['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'])[schedule_day + 1]
    WHEN frequency = 'weekly' THEN 'FREQ=DAILY;INTERVAL=1'
    WHEN frequency = 'biweekly' AND schedule_day IS NOT NULL THEN
      'FREQ=WEEKLY;INTERVAL=2;BYDAY='
      || (ARRAY['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'])[schedule_day + 1]
    WHEN frequency = 'biweekly' THEN 'FREQ=DAILY;INTERVAL=1'
    WHEN frequency = 'monthly'
      AND (
        (schedule_days IS NOT NULL AND cardinality(schedule_days) > 0)
        OR schedule_day IS NOT NULL
      ) THEN
      'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY='
      || COALESCE(
        NULLIF(array_to_string(schedule_days, ','), ''),
        NULLIF(schedule_day::text, '')
      )
    WHEN frequency = 'monthly' THEN 'FREQ=DAILY;INTERVAL=1'
    ELSE 'FREQ=DAILY;INTERVAL=1'
  END
WHERE recurrence_rule IS NULL;
