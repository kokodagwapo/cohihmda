-- Research session sharing (in-app user picker)
-- Follows workbench canvas pattern: visibility + shared_with_user_ids

ALTER TABLE public.research_sessions
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS shared_with_user_ids UUID[] DEFAULT '{}';

COMMENT ON COLUMN public.research_sessions.visibility IS
  'private = owner only, shared = specific users (see shared_with_user_ids), global = all tenant users';
COMMENT ON COLUMN public.research_sessions.shared_with_user_ids IS
  'User IDs who can view the session when visibility = shared';

CREATE INDEX IF NOT EXISTS idx_research_sessions_visibility
  ON public.research_sessions(visibility);
