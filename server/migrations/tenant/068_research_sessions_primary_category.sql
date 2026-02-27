-- Add primary_category to research_sessions for sidebar badges (from plan's first question category)
ALTER TABLE public.research_sessions
  ADD COLUMN IF NOT EXISTS primary_category TEXT;

COMMENT ON COLUMN public.research_sessions.primary_category IS
  'Category from planner (e.g. performance, risk, pipeline) for session list badges.';
