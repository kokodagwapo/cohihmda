-- Migration: Post-sync hook run tracking
-- Created: 2026-03-31
-- Database: tenant
--
-- Records the status, duration, and outcome of each post-sync hook that runs
-- after a successful LOS sync (predictions, insights, podcast, etc.).
-- Surfaced in the Sync Management admin UI to give platform admins visibility
-- into the full post-sync pipeline, not just the sync itself.

CREATE TABLE IF NOT EXISTS public.post_sync_hook_runs (
  id              SERIAL PRIMARY KEY,
  -- Soft reference to los_sync_history.id (no FK — history table schema varies across tenants).
  -- NULL if hooks ran outside a tracked sync (e.g. manual trigger).
  sync_history_id INTEGER,
  los_connection_id TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  hook_name       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  error_message   TEXT,
  -- Flexible metadata: insight count, podcast job ID, etc.
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_sync_hook_runs_connection
  ON public.post_sync_hook_runs(los_connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_sync_hook_runs_sync_history
  ON public.post_sync_hook_runs(sync_history_id);

CREATE INDEX IF NOT EXISTS idx_post_sync_hook_runs_tenant
  ON public.post_sync_hook_runs(tenant_id, created_at DESC);
