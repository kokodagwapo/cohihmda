-- Sync jobs queue for dedicated worker: API enqueues, worker processes.
-- Replaces in-process setImmediate() sync so heavy ETL does not starve the API.

CREATE TABLE IF NOT EXISTS sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  los_connection_id UUID NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'encompass-sync',
  status TEXT NOT NULL DEFAULT 'pending',
  options JSONB DEFAULT '{}',
  requested_by UUID,
  progress INTEGER DEFAULT 0,
  progress_message TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, created_at);
