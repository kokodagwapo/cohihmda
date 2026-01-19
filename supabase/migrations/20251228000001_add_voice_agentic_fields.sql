-- Add voice agentic configuration fields to tenant_rag_settings
-- Migration Date: 2025-12-28
-- Description: Add fields for voice agentic topics, rules, personality, and knowledge base links

-- Add voice agentic configuration columns
ALTER TABLE public.tenant_rag_settings
  ADD COLUMN IF NOT EXISTS allowed_topics TEXT,
  ADD COLUMN IF NOT EXISTS conversation_rules TEXT,
  ADD COLUMN IF NOT EXISTS personality_tone TEXT DEFAULT 'professional',
  ADD COLUMN IF NOT EXISTS personality_style TEXT DEFAULT 'concise',
  ADD COLUMN IF NOT EXISTS personality_custom TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_base_links TEXT;

-- Add comments
COMMENT ON COLUMN public.tenant_rag_settings.allowed_topics IS 'Allowed conversation topics for Ailethia voice agentic (one per line)';
COMMENT ON COLUMN public.tenant_rag_settings.conversation_rules IS 'Conversation rules for Ailethia voice agentic (one per line)';
COMMENT ON COLUMN public.tenant_rag_settings.personality_tone IS 'Personality tone: professional, friendly, executive, consultative, analytical';
COMMENT ON COLUMN public.tenant_rag_settings.personality_style IS 'Communication style: concise, detailed, conversational, formal';
COMMENT ON COLUMN public.tenant_rag_settings.personality_custom IS 'Custom personality prompt for Ailethia voice agentic';
COMMENT ON COLUMN public.tenant_rag_settings.knowledge_base_links IS 'Links to knowledge base resources (one per line)';
