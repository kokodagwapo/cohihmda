-- Migration: LLM cost and token tracking tables
-- Created: 2026-03-31
-- Database: tenant
--
-- Creates cost_events (one row per LLM API call) and cost_daily_summary
-- (aggregated daily totals per tenant) in the tenant DB. These are the
-- canonical tables for per-tenant usage reporting on the admin dashboard.
--
-- The existing costTracking.ts middleware was wired to the management DB
-- (wrong target). This migration creates the tables in the correct location
-- so that llmUsageTracker.ts can write directly via the tenant pool.

CREATE TABLE IF NOT EXISTS public.cost_events (
  id                SERIAL PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  -- Optional FK-style reference; no hard FK since instance table varies by LOS type
  instance_id       TEXT,
  service_category  TEXT NOT NULL
                      CHECK (service_category IN ('voice_ai', 'llm', 'embedding', 'aws', 'vector_db', 'other')),
  service_provider  TEXT NOT NULL,     -- 'openai', 'aws', etc.
  service_name      TEXT NOT NULL,     -- model name: 'gpt-4o', 'tts-1', etc.
  usage_type        TEXT NOT NULL,     -- 'tokens', 'audio_input_minutes', 'characters'
  usage_amount      NUMERIC NOT NULL,
  usage_unit        TEXT NOT NULL,
  unit_price        NUMERIC NOT NULL DEFAULT 0,  -- cost per single unit
  total_cost        NUMERIC NOT NULL DEFAULT 0,
  -- Token breakdown (NULL for non-LLM event types)
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,
  -- Attribution
  request_id        TEXT,
  user_id           TEXT,
  session_id        TEXT,
  requested_by      TEXT,             -- 'post-sync-hook', 'user', 'scheduler', etc.
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_events_tenant
  ON public.cost_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cost_events_model
  ON public.cost_events(service_name, created_at DESC);

-- Daily aggregated summary for fast admin dashboard queries
CREATE TABLE IF NOT EXISTS public.cost_daily_summary (
  id                SERIAL PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  date              DATE NOT NULL,
  total_cost        NUMERIC NOT NULL DEFAULT 0,
  total_tokens      BIGINT NOT NULL DEFAULT 0,
  prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  voice_total_minutes NUMERIC NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_cost_daily_summary_tenant
  ON public.cost_daily_summary(tenant_id, date DESC);
