-- Create RAG Knowledge Base table for managing AI agent prompts and content
CREATE TABLE IF NOT EXISTS public.rag_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  priority INTEGER DEFAULT 100 CHECK (priority >= 0 AND priority <= 1000),
  content TEXT NOT NULL,
  keywords TEXT[], -- Array of keywords/tags
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES public.users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_tenant ON public.rag_knowledge_base(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_category ON public.rag_knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_active ON public.rag_knowledge_base(is_active);
CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_keywords ON public.rag_knowledge_base USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_created_at ON public.rag_knowledge_base(created_at DESC);

-- Comments
COMMENT ON TABLE public.rag_knowledge_base IS 'Knowledge base entries for RAG (AI agent prompts and content)';
COMMENT ON COLUMN public.rag_knowledge_base.title IS 'Title of the knowledge base entry';
COMMENT ON COLUMN public.rag_knowledge_base.category IS 'Category for organizing entries (e.g., General, Risk Analysis, Strategy)';
COMMENT ON COLUMN public.rag_knowledge_base.priority IS 'Priority value (0-1000) for ordering entries in retrieval';
COMMENT ON COLUMN public.rag_knowledge_base.content IS 'Main content of the entry (HTML/rich text)';
COMMENT ON COLUMN public.rag_knowledge_base.keywords IS 'Array of keywords/tags for search and categorization';
