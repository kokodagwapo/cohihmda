-- Links research_uploads to unified_chat_conversations (chat, workbench, research).
-- Enables "Files in this chat" and Data Explorer reverse lookup.

CREATE TABLE IF NOT EXISTS research_upload_conversation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  upload_id UUID NOT NULL REFERENCES research_uploads(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  chat_type TEXT NOT NULL CHECK (chat_type IN ('chat', 'workbench', 'research', 'insight_builder')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (upload_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_upload_conv_links_upload
  ON research_upload_conversation_links (upload_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_upload_conv_links_conv
  ON research_upload_conversation_links (conversation_id);
