-- Persist generated podcast audio metadata and queued prefetch jobs.

CREATE TABLE IF NOT EXISTS public.podcast_assets (
  id BIGSERIAL PRIMARY KEY,
  asset_type TEXT NOT NULL DEFAULT 'aletheia_briefing',
  context_hash TEXT NOT NULL,
  script TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 's3',
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'audio/pcm;rate=24000',
  sample_rate INTEGER NOT NULL DEFAULT 24000,
  segments_count INTEGER NOT NULL DEFAULT 1,
  model TEXT,
  voice_name TEXT,
  audio_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_podcast_assets_type_context
  ON public.podcast_assets (asset_type, context_hash);

CREATE INDEX IF NOT EXISTS idx_podcast_assets_expires_at
  ON public.podcast_assets (expires_at);

CREATE TABLE IF NOT EXISTS public.podcast_prefetch_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL DEFAULT 'aletheia_briefing',
  context_hash TEXT NOT NULL,
  briefing_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT,
  error_message TEXT,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_podcast_prefetch_jobs_claim
  ON public.podcast_prefetch_jobs (status, run_after, created_at);

