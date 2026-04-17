-- Migration: extend AI control-plane ledger for evidence approval workflow
-- Created: 2026-04-17
-- Database: management

ALTER TABLE ai_control_plane.audit_ledger
  DROP CONSTRAINT IF EXISTS audit_ledger_status_check;

ALTER TABLE ai_control_plane.audit_ledger
  ADD CONSTRAINT audit_ledger_status_check
  CHECK (
    status IN (
      'started',
      'pending_approval',
      'pending_evidence_review',
      'approved',
      'evidence_approved',
      'evidence_rejected',
      'executed',
      'failed'
    )
  );

CREATE INDEX IF NOT EXISTS idx_ai_ledger_issue_key
  ON ai_control_plane.audit_ledger ((metadata->>'issueKey'))
  WHERE metadata ? 'issueKey';
