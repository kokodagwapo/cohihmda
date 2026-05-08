-- Migration 123: My Insights — per-user generated insights, interest profiles, custom prompts

-- ---------------------------------------------------------------------------
-- user_interest_profiles: cached behavioral / explicit signals summary per user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_interest_profiles (
  user_id UUID PRIMARY KEY,
  profile_json JSONB NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL DEFAULT '',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signals_through TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  last_generation_at TIMESTAMPTZ,
  last_generation_profile_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_interest_profiles_computed
  ON public.user_interest_profiles (computed_at DESC);

COMMENT ON TABLE public.user_interest_profiles IS
  'Aggregated interest signals for My Insights personalization; refreshed before user insight generation.';

-- ---------------------------------------------------------------------------
-- user_insight_prompts: user-authored recurring prompts (MVP: user scope only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_insight_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  specifiers JSONB NOT NULL DEFAULT '{}',
  schedule TEXT NOT NULL DEFAULT 'batch' CHECK (schedule IN ('batch', 'on_demand')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  scope TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'tenant', 'platform')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_insight_prompts_user_enabled
  ON public.user_insight_prompts (user_id, enabled)
  WHERE enabled = true AND schedule = 'batch';

COMMENT ON TABLE public.user_insight_prompts IS
  'Custom My Insights prompts; specifiers applied as SQL predicates server-side.';

-- ---------------------------------------------------------------------------
-- user_generated_insights: same conceptual shape as generated_insights, scoped by user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_generated_insights (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  bucket TEXT NOT NULL,
  priority TEXT NOT NULL,
  headline TEXT NOT NULL,
  understory TEXT,
  insight_type TEXT NOT NULL,
  source TEXT,
  severity_score DECIMAL(4,2),
  impact JSONB DEFAULT '{}',
  scope JSONB DEFAULT '{}',
  evidence JSONB DEFAULT '{}',
  for_podcast BOOLEAN DEFAULT false,
  date_filter TEXT NOT NULL DEFAULT 'ytd',
  channel_group TEXT,
  generation_batch TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  detail_query JSONB DEFAULT NULL,
  generation_method TEXT NOT NULL DEFAULT 'user_agent',
  detail_data JSONB DEFAULT NULL,
  value_score DECIMAL(5, 4),
  functional_category TEXT,
  understory_bullets JSONB,
  insight_origin TEXT NOT NULL DEFAULT 'behavior' CHECK (insight_origin IN ('behavior', 'custom_prompt')),
  user_insight_prompt_id UUID REFERENCES public.user_insight_prompts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_generated_insights_user_generated
  ON public.user_generated_insights (user_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_generated_insights_user_batch
  ON public.user_generated_insights (user_id, generation_batch);

CREATE INDEX IF NOT EXISTS idx_user_generated_insights_bucket
  ON public.user_generated_insights (user_id, bucket, severity_score DESC);

COMMENT ON TABLE public.user_generated_insights IS
  'Personalized insights for My Insights; independent from tenant generated_insights.';
