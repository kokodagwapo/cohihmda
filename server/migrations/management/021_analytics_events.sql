-- User behavior analytics: sessions, events (partitioned), session replays.
-- Retention: events 90 days, replays 30 days.

-- =============================================================================
-- ANALYTICS_SESSIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  page_count INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  device_type VARCHAR(32),
  browser VARCHAR(64),
  os VARCHAR(64),
  screen_width INTEGER,
  screen_height INTEGER,
  entry_page TEXT,
  exit_page TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_tenant_started
  ON analytics_sessions(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user_id
  ON analytics_sessions(user_id);

-- =============================================================================
-- ANALYTICS_EVENTS (parent, partitioned by month)
-- =============================================================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id VARCHAR(64) NOT NULL,
  user_id UUID NOT NULL,
  tenant_id TEXT NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  event_name VARCHAR(255),
  page_url TEXT,
  page_path TEXT,
  referrer_path TEXT,
  element_tag VARCHAR(64),
  element_id VARCHAR(255),
  element_text VARCHAR(512),
  element_selector TEXT,
  click_x INTEGER,
  click_y INTEGER,
  viewport_width INTEGER,
  viewport_height INTEGER,
  metadata JSONB DEFAULT '{}',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partition for current month and next 12 months (created in DO block below)
DO $$
DECLARE
  d DATE := date_trunc('month', CURRENT_DATE)::date;
  partition_name TEXT;
  range_start TIMESTAMPTZ;
  range_end TIMESTAMPTZ;
  i INT := 0;
BEGIN
  WHILE i <= 12 LOOP
    range_start := d + (i || ' months')::interval;
    range_end   := d + (i + 1 || ' months')::interval;
    partition_name := 'analytics_events_' || to_char(range_start, 'YYYY_MM');
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = partition_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.analytics_events FOR VALUES FROM (%L) TO (%L)',
        partition_name, range_start, range_end
      );
    END IF;
    i := i + 1;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_created
  ON analytics_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created
  ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_path
  ON analytics_events(event_type, page_path);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id
  ON analytics_events(session_id);

-- =============================================================================
-- ANALYTICS_SESSION_REPLAYS (rrweb chunks)
-- =============================================================================
CREATE TABLE IF NOT EXISTS analytics_session_replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(64) NOT NULL,
  user_id UUID NOT NULL,
  tenant_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  events_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_session_replays_session
  ON analytics_session_replays(session_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_analytics_session_replays_tenant_created
  ON analytics_session_replays(tenant_id, created_at DESC);

-- =============================================================================
-- CLEANUP: purge old events and replays
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_old_analytics_events()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Delete events older than 90 days (partitioned deletes are efficient)
  DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL '90 days';
  -- Delete replays older than 30 days
  DELETE FROM analytics_session_replays WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;
