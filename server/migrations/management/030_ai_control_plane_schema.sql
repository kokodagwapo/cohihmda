-- Migration: AI Control Plane schema and audit ledger
-- Created: 2026-04-14
-- Database: management
--
-- Creates the ai_control_plane schema and the audit_ledger table used by the
-- AiAgentOrchestrator service.  This table is the fail-closed compliance
-- boundary for all AI-initiated actions: a row must be written to this table
-- before any LLM call or privileged mutation is attempted.
--
-- Lifecycle statuses (append-only, discrete writes per stage):
--   started          - action registered; DB write is the go/no-go gate
--   pending_approval - action requires human approval before mutation
--   approved         - human operator approved via CLI or future dashboard
--   executed         - action completed successfully
--   failed           - action aborted or errored
--
-- DB role note: this migration does NOT create ai_orchestrator_role.
-- Role creation is handled separately by the infra/bootstrap step that runs
-- with elevated admin credentials after the Aurora cluster is provisioned.
-- The GRANT statements at the bottom assume the role already exists; they are
-- wrapped in a DO block so the migration does not fail in environments where
-- the role has not yet been created (e.g. local dev without the role).

CREATE SCHEMA IF NOT EXISTS ai_control_plane;

CREATE TABLE IF NOT EXISTS ai_control_plane.audit_ledger (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Correlation keys
  action_id      UUID        NOT NULL DEFAULT gen_random_uuid(),
  request_id     TEXT        NOT NULL,

  -- Agent identity
  agent_id       TEXT        NOT NULL,
  agent_sub_type TEXT        NOT NULL DEFAULT 'ai_agent',

  -- Tenant context
  tenant_id      UUID        NULL,

  -- Action classification
  action_type    TEXT        NOT NULL,

  -- Lifecycle
  status         TEXT        NOT NULL
                   CHECK (status IN ('started','pending_approval','approved','executed','failed')),

  -- Human approval (populated when status transitions to approved)
  approved_by    TEXT        NULL,
  approved_at    TIMESTAMPTZ NULL,
  approval_note  TEXT        NULL,

  -- Artifact reference (for blobs > 10KB that live in S3)
  artifacts      JSONB       NULL,
  -- Expected shape of each entry in artifacts array:
  -- { bucket, s3_key, size_bytes, checksum?, content_type? }

  -- Metadata (redacted structured payload, safe fields only)
  metadata       JSONB       NULL,

  -- Error detail (populated when status = failed)
  error_message  TEXT        NULL,

  -- Timestamps
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to keep updated_at current
DROP TRIGGER IF EXISTS trg_ai_audit_ledger_updated_at ON ai_control_plane.audit_ledger;
CREATE OR REPLACE FUNCTION ai_control_plane.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ai_audit_ledger_updated_at
  BEFORE UPDATE ON ai_control_plane.audit_ledger
  FOR EACH ROW EXECUTE FUNCTION ai_control_plane.set_updated_at();

-- Primary lookup indexes
CREATE INDEX IF NOT EXISTS idx_ai_ledger_action_id
  ON ai_control_plane.audit_ledger (action_id);

CREATE INDEX IF NOT EXISTS idx_ai_ledger_request_id
  ON ai_control_plane.audit_ledger (request_id);

CREATE INDEX IF NOT EXISTS idx_ai_ledger_status
  ON ai_control_plane.audit_ledger (status);

CREATE INDEX IF NOT EXISTS idx_ai_ledger_created_at
  ON ai_control_plane.audit_ledger (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_ledger_tenant_id
  ON ai_control_plane.audit_ledger (tenant_id)
  WHERE tenant_id IS NOT NULL;

-- Grant limited access to ai_orchestrator_role if it already exists.
-- Wrapped in DO block so local dev environments without the role do not fail.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_orchestrator_role') THEN
    GRANT USAGE ON SCHEMA ai_control_plane TO ai_orchestrator_role;
    GRANT SELECT, INSERT, UPDATE ON ai_control_plane.audit_ledger TO ai_orchestrator_role;
  END IF;
END;
$$;
