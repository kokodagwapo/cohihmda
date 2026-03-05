-- Migration: Fallout card distribution and response tracking
-- Database: tenant
-- Creates:
--   - fallout_alert_config (per-tenant settings)
--   - fallout_alert_tokens (single-use action tokens)
--   - fallout_alert_responses (immutable response audit trail)

CREATE TABLE IF NOT EXISTS public.fallout_alert_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT false,
  min_risk_score INTEGER NOT NULL DEFAULT 75 CHECK (min_risk_score >= 0 AND min_risk_score <= 100),
  frequency TEXT NOT NULL DEFAULT 'daily_digest' CHECK (frequency IN ('realtime', 'daily_digest', 'weekly_digest')),
  include_risk_levels TEXT[] NOT NULL DEFAULT ARRAY['Very High', 'High'],
  custom_message TEXT,
  notify_managers BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fallout_alert_config_enabled
  ON public.fallout_alert_config (enabled);

CREATE TABLE IF NOT EXISTS public.fallout_alert_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  alert_batch_id UUID NOT NULL,
  loan_id TEXT NOT NULL,
  encompass_user_id TEXT NOT NULL,
  recipient_email TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  response TEXT CHECK (response IN ('acknowledged', 'working_on_it', 'need_help')),
  response_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fallout_alert_tokens_expires_at
  ON public.fallout_alert_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_fallout_alert_tokens_batch
  ON public.fallout_alert_tokens (alert_batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fallout_alert_tokens_loan
  ON public.fallout_alert_tokens (loan_id);

CREATE INDEX IF NOT EXISTS idx_fallout_alert_tokens_user
  ON public.fallout_alert_tokens (encompass_user_id);

CREATE TABLE IF NOT EXISTS public.fallout_alert_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES public.fallout_alert_tokens(id) ON DELETE CASCADE,
  alert_batch_id UUID NOT NULL,
  loan_id TEXT NOT NULL,
  encompass_user_id TEXT NOT NULL,
  recipient_email TEXT,
  response TEXT NOT NULL CHECK (response IN ('acknowledged', 'working_on_it', 'need_help')),
  response_note TEXT,
  ip_address TEXT,
  user_agent TEXT,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fallout_alert_responses_responded_at
  ON public.fallout_alert_responses (responded_at DESC);

CREATE INDEX IF NOT EXISTS idx_fallout_alert_responses_batch
  ON public.fallout_alert_responses (alert_batch_id, responded_at DESC);

CREATE INDEX IF NOT EXISTS idx_fallout_alert_responses_loan
  ON public.fallout_alert_responses (loan_id, responded_at DESC);

CREATE INDEX IF NOT EXISTS idx_fallout_alert_responses_user
  ON public.fallout_alert_responses (encompass_user_id, responded_at DESC);

DROP TRIGGER IF EXISTS trigger_fallout_alert_config_updated_at ON public.fallout_alert_config;
CREATE TRIGGER trigger_fallout_alert_config_updated_at
  BEFORE UPDATE ON public.fallout_alert_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
