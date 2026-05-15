-- =============================================================================
-- Migration 130: Unified chat — folder_id + legacy_source (COHI-395)
-- =============================================================================

ALTER TABLE public.unified_chat_conversations
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS legacy_source TEXT;

COMMENT ON COLUMN public.unified_chat_conversations.folder_id IS
  'Optional folder assignment; FK deferred until folders table (COHI-403).';
COMMENT ON COLUMN public.unified_chat_conversations.legacy_source IS
  'Provenance: cohi_chat, research_lab, etc. (distinct from legacy_ref id).';

CREATE INDEX IF NOT EXISTS idx_unified_chat_conversations_folder_id
  ON public.unified_chat_conversations (folder_id)
  WHERE folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unified_chat_conversations_legacy_source
  ON public.unified_chat_conversations (legacy_source)
  WHERE legacy_source IS NOT NULL;
