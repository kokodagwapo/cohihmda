-- Research uploads table: stores metadata for user-uploaded CSV/XLSX files
-- that are attached to Research Lab sessions or the standalone Data Explorer.
-- Supports two storage strategies:
--   'context' — small files (<= 200 rows); full dataset stored as JSONB for LLM context injection
--   'table'   — large files (> 200 rows); data ingested into a dedicated upload table in the tenant DB

CREATE TABLE IF NOT EXISTS research_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  -- File metadata
  file_name TEXT NOT NULL,           -- sanitized name used for table naming
  original_file_name TEXT NOT NULL,  -- original user-supplied filename
  file_size_bytes BIGINT NOT NULL,
  row_count INTEGER NOT NULL,
  column_count INTEGER NOT NULL,

  -- Column schema (ColumnMeta[])
  columns JSONB NOT NULL DEFAULT '[]',

  -- Storage strategy
  storage_strategy TEXT NOT NULL CHECK (storage_strategy IN ('context', 'table')),
  table_name TEXT,                   -- only set when storage_strategy = 'table'
  data_json JSONB,                   -- only set when storage_strategy = 'context'

  -- Always stored for preview UI (first 50 rows)
  sample_rows JSONB NOT NULL DEFAULT '[]',

  -- Quick insight visualizations generated on upload (array of chart configs)
  quick_insights JSONB DEFAULT '[]',

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error', 'expired')),
  error_message TEXT,
  expires_at TIMESTAMPTZ,            -- null = no expiry; set for table-backed uploads (default 7 days)

  -- Optional association with a research session
  session_id UUID,                   -- references research_sessions(id) but no FK constraint for flexibility

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_uploads_tenant ON research_uploads(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_uploads_user ON research_uploads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_uploads_session ON research_uploads(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_research_uploads_status ON research_uploads(status, expires_at) WHERE status != 'expired';

-- Add upload_ids to research_sessions so a session can reference multiple uploads
ALTER TABLE research_sessions ADD COLUMN IF NOT EXISTS upload_ids JSONB DEFAULT '[]';
