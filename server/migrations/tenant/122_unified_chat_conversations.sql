-- =============================================================================
-- Migration 122: Unified chat conversations (COHI-395 baseline)
-- Stores messages as JSONB array (blocks + metadata per turn).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.unified_chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'global_session',
  scope_key TEXT,
  title TEXT NOT NULL DEFAULT 'Chat',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unified_chat_conv_user_scope
  ON public.unified_chat_conversations (user_id, scope_type, COALESCE(scope_key, ''), updated_at DESC);

CREATE OR REPLACE FUNCTION public.update_unified_chat_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_unified_chat_conversations_updated_at ON public.unified_chat_conversations;
CREATE TRIGGER trigger_unified_chat_conversations_updated_at
  BEFORE UPDATE ON public.unified_chat_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_unified_chat_conversations_updated_at();
