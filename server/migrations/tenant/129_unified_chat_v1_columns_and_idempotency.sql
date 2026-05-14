-- =============================================================================
-- Migration 128: Unified chat v1 — conversation mode columns + idempotency
-- (COHI-401 / COHI-387)
-- =============================================================================

ALTER TABLE public.unified_chat_conversations
  ADD COLUMN IF NOT EXISTS chat_type TEXT NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS legacy_ref TEXT;

ALTER TABLE public.unified_chat_conversations
  DROP CONSTRAINT IF EXISTS unified_chat_conversations_chat_type_check;

ALTER TABLE public.unified_chat_conversations
  ADD CONSTRAINT unified_chat_conversations_chat_type_check
  CHECK (chat_type IN ('chat', 'research', 'insight_builder', 'workbench'));

CREATE TABLE IF NOT EXISTS public.unified_chat_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_message_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 days'),
  CONSTRAINT unified_chat_idempotency_keys_unique UNIQUE (tenant_id, user_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_unified_chat_idem_expires
  ON public.unified_chat_idempotency_keys (expires_at);
