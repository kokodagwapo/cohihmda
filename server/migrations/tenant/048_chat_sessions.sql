-- =============================================================================
-- Migration 048: Chat Sessions
-- Adds a chat_sessions table for session-level metadata (title, timestamps).
-- Enables the "saved chats" UI so users can browse and reopen previous
-- conversations.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON public.chat_sessions(user_id, updated_at DESC);

-- Backfill: create session rows for any pre-existing chat_history data
INSERT INTO public.chat_sessions (id, user_id, title, created_at, updated_at)
SELECT DISTINCT ON (h.session_id)
  h.session_id,
  h.user_id,
  LEFT(h.content, 80) AS title,
  MIN(h.created_at) OVER (PARTITION BY h.session_id),
  MAX(h.created_at) OVER (PARTITION BY h.session_id)
FROM public.chat_history h
WHERE h.role = 'user'
ORDER BY h.session_id, h.created_at ASC
ON CONFLICT (id) DO NOTHING;

-- Trigger to auto-update updated_at on chat_sessions
CREATE OR REPLACE FUNCTION public.update_chat_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chat_sessions_updated_at ON public.chat_sessions;
CREATE TRIGGER trigger_chat_sessions_updated_at
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_chat_sessions_updated_at();
