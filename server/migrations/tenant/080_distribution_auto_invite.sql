-- =============================================================================
-- Migration 080: Distribution recipient list auto-invite settings
-- =============================================================================
-- Adds optional auto-invite behavior for external distribution recipients.
-- When enabled, unknown external emails can be provisioned as canvas_only users
-- and optionally assigned to a user group.

ALTER TABLE public.distribution_recipient_lists
  ADD COLUMN IF NOT EXISTS auto_invite BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.distribution_recipient_lists
  ADD COLUMN IF NOT EXISTS auto_invite_group_id UUID REFERENCES public.user_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_distribution_recipient_lists_auto_invite_group
  ON public.distribution_recipient_lists(auto_invite_group_id)
  WHERE auto_invite_group_id IS NOT NULL;
