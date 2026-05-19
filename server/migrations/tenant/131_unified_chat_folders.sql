-- =============================================================================
-- Migration 131: Unified chat folders (COHI-403)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.unified_chat_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.unified_chat_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  depth INT NOT NULL DEFAULT 1 CHECK (depth >= 1 AND depth <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unified_chat_folders_user_parent
  ON public.unified_chat_folders (user_id, parent_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unified_chat_conversations_folder_id_fkey'
  ) THEN
    ALTER TABLE public.unified_chat_conversations
      ADD CONSTRAINT unified_chat_conversations_folder_id_fkey
      FOREIGN KEY (folder_id) REFERENCES public.unified_chat_folders(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_unified_chat_folders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_unified_chat_folders_updated_at ON public.unified_chat_folders;
CREATE TRIGGER trigger_unified_chat_folders_updated_at
  BEFORE UPDATE ON public.unified_chat_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_unified_chat_folders_updated_at();
