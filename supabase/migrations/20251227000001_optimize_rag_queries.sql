-- Optimize RAG settings queries with indexes
-- Migration Date: 2025-12-27
-- Description: Add indexes to improve RAG settings query performance

-- Index on profiles.user_id for faster tenant lookups
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id) WHERE user_id IS NOT NULL;

-- Index on tenant_rag_settings.tenant_id (should already exist, but ensure it does)
CREATE INDEX IF NOT EXISTS idx_tenant_rag_settings_tenant ON public.tenant_rag_settings(tenant_id);

-- Composite index for the JOIN query optimization
CREATE INDEX IF NOT EXISTS idx_profiles_user_tenant ON public.profiles(user_id, tenant_id) WHERE user_id IS NOT NULL AND tenant_id IS NOT NULL;

COMMENT ON INDEX idx_profiles_user_id IS 'Optimizes user_id lookups for tenant resolution';
COMMENT ON INDEX idx_profiles_user_tenant IS 'Composite index for optimized JOIN queries between profiles and tenant_rag_settings';
