-- Coheus v2: SaaS Subscription, RAG Settings, Cost Tracking, and Hybrid Deployment
-- Migration Date: 2025-12-24
-- Description: Complete schema for subscription management, RAG configuration, real-time cost tracking, and hybrid deployment support

-- ============================================================================
-- SUBSCRIPTION MANAGEMENT
-- ============================================================================

-- Subscription plans (Starter, Professional, Enterprise)
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,                    -- 'starter', 'professional', 'enterprise'
  display_name TEXT NOT NULL,                   -- 'Starter', 'Professional', 'Enterprise'
  price_monthly DECIMAL(10,2) NOT NULL,        -- $499, $999, $2499
  price_yearly DECIMAL(10,2) NOT NULL,          -- $4990, $9990, $24990
  features JSONB NOT NULL DEFAULT '{}',         -- { "max_users": 10, "los_adapters": 1, ... }
  deployment_options TEXT[] NOT NULL DEFAULT ARRAY['cloud'], -- ['cloud', 'on_premise', 'hybrid']
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.subscription_plans IS 'Available subscription plans for lenders';
COMMENT ON COLUMN public.subscription_plans.features IS 'JSON object with plan features and limits';
COMMENT ON COLUMN public.subscription_plans.deployment_options IS 'Array of allowed deployment types for this plan';

-- Tenant subscriptions
CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'paused')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  deployment_type TEXT NOT NULL CHECK (deployment_type IN ('cloud', 'on_premise', 'hybrid')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE INDEX idx_tenant_subscriptions_tenant ON public.tenant_subscriptions(tenant_id);
CREATE INDEX idx_tenant_subscriptions_stripe ON public.tenant_subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX idx_tenant_subscriptions_status ON public.tenant_subscriptions(status);

COMMENT ON TABLE public.tenant_subscriptions IS 'Active subscriptions for each tenant';
COMMENT ON COLUMN public.tenant_subscriptions.deployment_type IS 'Chosen deployment model: cloud, on_premise, or hybrid';

-- License keys for on-premise installations
CREATE TABLE IF NOT EXISTS public.license_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES public.tenant_subscriptions(id) ON DELETE CASCADE,
  license_key TEXT UNIQUE NOT NULL,            -- Encrypted, e.g., 'COHEUS-XXXX-XXXX-XXXX'
  machine_fingerprint TEXT,                     -- Hardware ID of on-premise server
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  last_heartbeat TIMESTAMPTZ,                   -- Last check-in from on-premise
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_license_keys_tenant ON public.license_keys(tenant_id);
CREATE INDEX idx_license_keys_key ON public.license_keys(license_key);
CREATE INDEX idx_license_keys_active ON public.license_keys(is_active) WHERE is_active = true;

COMMENT ON TABLE public.license_keys IS 'License keys for on-premise deployments with heartbeat tracking';

-- ============================================================================
-- DEPLOYMENT INSTANCES (Cloud + On-Premise)
-- ============================================================================

-- Deployment instances (track both cloud and on-premise)
CREATE TABLE IF NOT EXISTS public.deployment_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_type TEXT NOT NULL CHECK (instance_type IN ('cloud', 'on_premise')),
  instance_name TEXT NOT NULL,                 -- 'Primary Cloud', 'Branch Office Server'
  cloud_provider TEXT,                          -- 'aws', 'azure', 'gcp', null for on-premise
  cloud_region TEXT,                            -- 'us-east-1', null for on-premise
  ip_address TEXT,
  hostname TEXT,
  version TEXT,                                 -- Coheus version running
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'provisioning', 'active', 'syncing', 'offline', 'error')),
  last_sync_at TIMESTAMPTZ,
  sync_partner_id UUID REFERENCES public.deployment_instances(id), -- For hybrid sync pairs
  config JSONB DEFAULT '{}',                    -- Instance-specific config
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deployment_instances_tenant ON public.deployment_instances(tenant_id);
CREATE INDEX idx_deployment_instances_type ON public.deployment_instances(instance_type);
CREATE INDEX idx_deployment_instances_status ON public.deployment_instances(status);
CREATE INDEX idx_deployment_instances_sync ON public.deployment_instances(sync_partner_id) WHERE sync_partner_id IS NOT NULL;

COMMENT ON TABLE public.deployment_instances IS 'Tracks all deployment instances (cloud and on-premise) for each tenant';

-- Sync events between instances
CREATE TABLE IF NOT EXISTS public.sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instance_id UUID NOT NULL REFERENCES public.deployment_instances(id) ON DELETE CASCADE,
  target_instance_id UUID NOT NULL REFERENCES public.deployment_instances(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental', 'realtime')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  records_synced INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_events_source ON public.sync_events(source_instance_id);
CREATE INDEX idx_sync_events_target ON public.sync_events(target_instance_id);
CREATE INDEX idx_sync_events_status ON public.sync_events(status);
CREATE INDEX idx_sync_events_created ON public.sync_events(created_at DESC);

COMMENT ON TABLE public.sync_events IS 'Logs all sync operations between hybrid deployment instances';

-- ============================================================================
-- RAG (RETRIEVAL-AUGMENTED GENERATION) SETTINGS
-- ============================================================================

-- RAG configuration per tenant
CREATE TABLE IF NOT EXISTS public.tenant_rag_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  
  -- Embedding settings
  embedding_model TEXT DEFAULT 'openai/text-embedding-3-large',
  vector_database TEXT DEFAULT 'pinecone' CHECK (vector_database IN ('pinecone', 'pgvector', 'opensearch')),
  chunk_size INTEGER DEFAULT 512 CHECK (chunk_size > 0 AND chunk_size <= 8192),
  chunk_overlap INTEGER DEFAULT 50 CHECK (chunk_overlap >= 0),
  
  -- Retrieval settings
  top_k INTEGER DEFAULT 5 CHECK (top_k > 0 AND top_k <= 50),
  similarity_threshold DECIMAL(3,2) DEFAULT 0.75 CHECK (similarity_threshold >= 0 AND similarity_threshold <= 1),
  enable_reranking BOOLEAN DEFAULT true,
  reranking_model TEXT DEFAULT 'cohere/rerank-english-v3.0',
  context_window INTEGER DEFAULT 8000 CHECK (context_window > 0 AND context_window <= 200000),
  
  -- AI model settings
  chat_model TEXT DEFAULT 'openai/gpt-4o',
  voice_model TEXT DEFAULT 'google/gemini-2.0-flash-live',
  temperature DECIMAL(2,1) DEFAULT 0.3 CHECK (temperature >= 0 AND temperature <= 2),
  custom_system_prompt TEXT,
  
  -- Privacy settings
  enable_pii_sanitization BOOLEAN DEFAULT true,
  redact_ssn BOOLEAN DEFAULT true,
  redact_dob BOOLEAN DEFAULT true,
  redact_account_numbers BOOLEAN DEFAULT true,
  allow_employee_names BOOLEAN DEFAULT false,
  log_ai_interactions BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tenant_rag_settings_tenant ON public.tenant_rag_settings(tenant_id);

COMMENT ON TABLE public.tenant_rag_settings IS 'RAG configuration and AI model settings per tenant';

-- Document sources for RAG
CREATE TABLE IF NOT EXISTS public.rag_document_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 's3', 'sharepoint', 'confluence', 'url', 'api')),
  source_config JSONB NOT NULL DEFAULT '{}',    -- Connection details, credentials (encrypted)
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'active', 'error', 'paused')),
  document_count INTEGER DEFAULT 0,
  total_chunks INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  sync_frequency TEXT DEFAULT 'daily' CHECK (sync_frequency IN ('realtime', 'hourly', 'daily', 'weekly', 'manual')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rag_document_sources_tenant ON public.rag_document_sources(tenant_id);
CREATE INDEX idx_rag_document_sources_status ON public.rag_document_sources(status);

COMMENT ON TABLE public.rag_document_sources IS 'Document sources configured for RAG (S3, SharePoint, uploads, etc.)';

-- Individual documents
CREATE TABLE IF NOT EXISTS public.rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.rag_document_sources(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT,
  file_type TEXT,                               -- 'pdf', 'docx', 'txt', 'html', 'csv'
  file_size_bytes INTEGER,
  chunk_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'indexed', 'error', 'deleted')),
  error_message TEXT,
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rag_documents_source ON public.rag_documents(source_id);
CREATE INDEX idx_rag_documents_tenant ON public.rag_documents(tenant_id);
CREATE INDEX idx_rag_documents_status ON public.rag_documents(status);

COMMENT ON TABLE public.rag_documents IS 'Individual documents processed for RAG with chunk and token counts';

-- Vector embeddings (if using pgvector - requires pgvector extension)
-- Note: This table is only used if vector_database = 'pgvector'
CREATE TABLE IF NOT EXISTS public.rag_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.rag_documents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  token_count INTEGER,
  embedding vector(3072),                      -- OpenAI text-embedding-3-large dimension (adjust if needed)
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rag_embeddings_document ON public.rag_embeddings(document_id);
CREATE INDEX idx_rag_embeddings_tenant ON public.rag_embeddings(tenant_id);
CREATE UNIQUE INDEX idx_rag_embeddings_document_chunk ON public.rag_embeddings(document_id, chunk_index);
-- Note: Vector similarity index requires pgvector extension
-- CREATE INDEX ON rag_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMENT ON TABLE public.rag_embeddings IS 'Vector embeddings for documents (pgvector only)';

-- ============================================================================
-- REAL-TIME COST TRACKING
-- ============================================================================

-- Real-time cost events (granular tracking)
CREATE TABLE IF NOT EXISTS public.cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES public.deployment_instances(id) ON DELETE SET NULL,
  
  -- Event details
  service_category TEXT NOT NULL CHECK (service_category IN ('voice_ai', 'llm', 'embedding', 'aws', 'vector_db', 'other')),
  service_provider TEXT NOT NULL,              -- 'gemini', 'openai', 'aws', 'pinecone', 'cohere'
  service_name TEXT NOT NULL,                  -- 'gemini-2.0-flash-live', 'gpt-4o', 'ec2', 's3'
  
  -- Usage metrics
  usage_type TEXT NOT NULL,                    -- 'audio_input_minutes', 'tokens', 'requests', 'storage_gb', 'compute_hours'
  usage_amount DECIMAL(15,6) NOT NULL,
  usage_unit TEXT NOT NULL,                    -- 'minutes', 'tokens', 'requests', 'GB', 'hours'
  
  -- Cost calculation
  unit_price DECIMAL(10,6) NOT NULL,
  total_cost DECIMAL(10,4) NOT NULL,
  currency TEXT DEFAULT 'USD',
  
  -- Context
  request_id TEXT,                             -- For tracing
  user_id UUID,                                -- Who triggered this cost
  session_id TEXT,                            -- Voice session ID if applicable
  metadata JSONB DEFAULT '{}',                -- Additional context
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cost_events_tenant_date ON public.cost_events(tenant_id, created_at DESC);
CREATE INDEX idx_cost_events_category ON public.cost_events(service_category, created_at DESC);
CREATE INDEX idx_cost_events_instance ON public.cost_events(instance_id) WHERE instance_id IS NOT NULL;
CREATE INDEX idx_cost_events_session ON public.cost_events(session_id) WHERE session_id IS NOT NULL;

COMMENT ON TABLE public.cost_events IS 'Granular cost tracking for all services (voice AI, LLM, AWS, etc.)';

-- Aggregated daily costs (materialized for performance)
CREATE TABLE IF NOT EXISTS public.cost_daily_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- Voice AI costs
  voice_gemini_cost DECIMAL(10,4) DEFAULT 0,
  voice_openai_cost DECIMAL(10,4) DEFAULT 0,
  voice_other_cost DECIMAL(10,4) DEFAULT 0,
  voice_total_minutes DECIMAL(10,2) DEFAULT 0,
  voice_total_sessions INTEGER DEFAULT 0,
  
  -- LLM costs
  llm_input_tokens BIGINT DEFAULT 0,
  llm_output_tokens BIGINT DEFAULT 0,
  llm_total_cost DECIMAL(10,4) DEFAULT 0,
  
  -- Embedding costs
  embedding_tokens BIGINT DEFAULT 0,
  embedding_cost DECIMAL(10,4) DEFAULT 0,
  
  -- AWS costs
  aws_compute_cost DECIMAL(10,4) DEFAULT 0,
  aws_storage_cost DECIMAL(10,4) DEFAULT 0,
  aws_network_cost DECIMAL(10,4) DEFAULT 0,
  aws_other_cost DECIMAL(10,4) DEFAULT 0,
  
  -- Vector DB costs
  vector_db_cost DECIMAL(10,4) DEFAULT 0,
  
  -- Totals
  total_cost DECIMAL(10,4) NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, date)
);

CREATE INDEX idx_cost_daily_summary_tenant_date ON public.cost_daily_summary(tenant_id, date DESC);

COMMENT ON TABLE public.cost_daily_summary IS 'Daily aggregated cost summaries for fast dashboard queries';

-- Budget alerts
CREATE TABLE IF NOT EXISTS public.cost_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  budget_type TEXT NOT NULL CHECK (budget_type IN ('monthly', 'daily', 'per_category')),
  category TEXT,                                -- null for total, or 'voice_ai', 'llm', 'aws', etc.
  budget_amount DECIMAL(10,2) NOT NULL CHECK (budget_amount > 0),
  alert_threshold_percent INTEGER DEFAULT 80 CHECK (alert_threshold_percent > 0 AND alert_threshold_percent <= 100),
  alert_email TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cost_budgets_tenant ON public.cost_budgets(tenant_id);
CREATE INDEX idx_cost_budgets_active ON public.cost_budgets(is_active) WHERE is_active = true;

COMMENT ON TABLE public.cost_budgets IS 'Budget configurations with alert thresholds';

-- Budget alert history
CREATE TABLE IF NOT EXISTS public.cost_alert_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES public.cost_budgets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('threshold_reached', 'budget_exceeded')),
  current_spend DECIMAL(10,2) NOT NULL,
  budget_amount DECIMAL(10,2) NOT NULL,
  percent_used DECIMAL(5,2) NOT NULL,
  notified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cost_alert_history_budget ON public.cost_alert_history(budget_id);
CREATE INDEX idx_cost_alert_history_tenant ON public.cost_alert_history(tenant_id);
CREATE INDEX idx_cost_alert_history_date ON public.cost_alert_history(notified_at DESC);

COMMENT ON TABLE public.cost_alert_history IS 'History of budget alerts sent to tenants';

-- ============================================================================
-- USAGE METERING (for billing)
-- ============================================================================

-- Usage metrics for billing
CREATE TABLE IF NOT EXISTS public.usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES public.deployment_instances(id) ON DELETE SET NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('api_calls', 'voice_minutes', 'storage_gb', 'active_users', 'loans_processed')),
  metric_value DECIMAL(15,4) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_metrics_tenant_period ON public.usage_metrics(tenant_id, period_start DESC);
CREATE INDEX idx_usage_metrics_type ON public.usage_metrics(metric_type, period_start DESC);

COMMENT ON TABLE public.usage_metrics IS 'Usage metrics for billing and plan limit enforcement';

-- ============================================================================
-- INITIAL DATA: SUBSCRIPTION PLANS
-- ============================================================================

-- Insert default subscription plans
INSERT INTO public.subscription_plans (name, display_name, price_monthly, price_yearly, features, deployment_options, is_active)
VALUES
  (
    'starter',
    'Starter',
    499.00,
    4990.00,
    '{"max_users": 10, "los_adapters": 1, "voice_ai_minutes_per_month": 1000, "storage_gb": 50, "support_level": "email"}'::jsonb,
    ARRAY['cloud'],
    true
  ),
  (
    'professional',
    'Professional',
    999.00,
    9990.00,
    '{"max_users": 50, "los_adapters": 3, "voice_ai_minutes_per_month": 5000, "storage_gb": 200, "support_level": "phone"}'::jsonb,
    ARRAY['cloud', 'on_premise'],
    true
  ),
  (
    'enterprise',
    'Enterprise',
    2499.00,
    24990.00,
    '{"max_users": -1, "los_adapters": -1, "voice_ai_minutes_per_month": -1, "storage_gb": 1000, "support_level": "dedicated"}'::jsonb,
    ARRAY['cloud', 'on_premise', 'hybrid'],
    true
  )
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all tables
CREATE TRIGGER update_subscription_plans_updated_at BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tenant_subscriptions_updated_at BEFORE UPDATE ON public.tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_license_keys_updated_at BEFORE UPDATE ON public.license_keys FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_deployment_instances_updated_at BEFORE UPDATE ON public.deployment_instances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tenant_rag_settings_updated_at BEFORE UPDATE ON public.tenant_rag_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rag_document_sources_updated_at BEFORE UPDATE ON public.rag_document_sources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rag_documents_updated_at BEFORE UPDATE ON public.rag_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_cost_daily_summary_updated_at BEFORE UPDATE ON public.cost_daily_summary FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_cost_budgets_updated_at BEFORE UPDATE ON public.cost_budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

