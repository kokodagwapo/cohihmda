-- Polymorphic insight_feedback: tenant pipeline (generated_insights) vs My Insights (user_generated_insights).
-- Same table; insight_ref disambiguates insight_id (SERIAL ids can overlap across tables).

ALTER TABLE public.insight_feedback
  ADD COLUMN IF NOT EXISTS insight_ref TEXT NOT NULL DEFAULT 'generated_insights';

UPDATE public.insight_feedback
SET insight_ref = 'generated_insights'
WHERE insight_ref IS NULL OR trim(insight_ref) = '';

ALTER TABLE public.insight_feedback
  DROP CONSTRAINT IF EXISTS insight_feedback_insight_ref_check;

ALTER TABLE public.insight_feedback
  ADD CONSTRAINT insight_feedback_insight_ref_check
  CHECK (insight_ref IN ('generated_insights', 'user_generated_insights'));

COMMENT ON COLUMN public.insight_feedback.insight_ref IS
  'Which table insight_id refers to: generated_insights (tenant-wide) or user_generated_insights (My Insights).';

-- Dedupe legacy rows so a unique constraint on (insight_ref, insight_id, user_id) can be applied.
DELETE FROM public.insight_feedback a
  USING public.insight_feedback b
 WHERE a.insight_ref = 'generated_insights'
   AND b.insight_ref = 'generated_insights'
   AND a.insight_id = b.insight_id
   AND a.user_id = b.user_id
   AND a.id < b.id;

ALTER TABLE public.insight_feedback
  DROP CONSTRAINT IF EXISTS insight_feedback_insight_id_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS idx_insight_feedback_ref_insight_user
  ON public.insight_feedback (insight_ref, insight_id, user_id);

CREATE INDEX IF NOT EXISTS idx_insight_feedback_ref_insight
  ON public.insight_feedback (insight_ref, insight_id);
