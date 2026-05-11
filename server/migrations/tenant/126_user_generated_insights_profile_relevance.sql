-- My Insights: optional explanation tying each row to the user's interest profile

ALTER TABLE public.user_generated_insights
  ADD COLUMN IF NOT EXISTS profile_relevance TEXT;

COMMENT ON COLUMN public.user_generated_insights.profile_relevance IS
  'Why this insight was surfaced for this user, grounded in their interest profile (My Insights).';
