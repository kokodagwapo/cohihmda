-- Research sessions table for persisting agentic research investigations
CREATE TABLE IF NOT EXISTS research_sessions (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  user_email TEXT,
  topic TEXT,
  phase TEXT NOT NULL DEFAULT 'created',
  plan JSONB,
  findings JSONB DEFAULT '[]',
  report JSONB,
  events JSONB DEFAULT '[]',
  follow_up_history JSONB DEFAULT '[]',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_sessions_tenant ON research_sessions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_sessions_user ON research_sessions(user_id, created_at DESC);
