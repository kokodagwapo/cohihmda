-- =============================================================================
-- Migration 059: Encompass webhook runtime tables and configuration
-- =============================================================================

ALTER TABLE public.los_connections
  ADD COLUMN IF NOT EXISTS webhook_mode TEXT DEFAULT 'priority_only'
    CHECK (webhook_mode IN ('priority_only', 'all_changes')),
  ADD COLUMN IF NOT EXISTS webhook_priority_field_ids JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS webhook_priority_field_limit INTEGER DEFAULT 20
    CHECK (webhook_priority_field_limit >= 1 AND webhook_priority_field_limit <= 50),
  ADD COLUMN IF NOT EXISTS webhook_reconciliation_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS webhook_last_reconciled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.encompass_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  los_connection_id UUID NOT NULL REFERENCES public.los_connections(id) ON DELETE CASCADE,
  event_type TEXT,
  resource_type TEXT,
  resource_id TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'queued', 'processed', 'failed', 'ignored')),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_encompass_webhook_events_connection
  ON public.encompass_webhook_events(los_connection_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_encompass_webhook_events_status
  ON public.encompass_webhook_events(status, received_at DESC);

CREATE TABLE IF NOT EXISTS public.encompass_webhook_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE REFERENCES public.encompass_webhook_events(event_id) ON DELETE CASCADE,
  los_connection_id UUID NOT NULL REFERENCES public.los_connections(id) ON DELETE CASCADE,
  loan_guid TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encompass_webhook_queue_next_attempt
  ON public.encompass_webhook_queue(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_encompass_webhook_queue_connection
  ON public.encompass_webhook_queue(los_connection_id, status);

DROP TRIGGER IF EXISTS trigger_encompass_webhook_queue_updated_at ON public.encompass_webhook_queue;
CREATE TRIGGER trigger_encompass_webhook_queue_updated_at
  BEFORE UPDATE ON public.encompass_webhook_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
