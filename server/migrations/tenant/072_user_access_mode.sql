-- =============================================================================
-- Migration 072: User access_mode for canvas-only users
-- =============================================================================
-- full = normal platform access; canvas_only = user only sees shared canvases
-- (slim UI, no insights/loans/admin nav).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'full'
    CHECK (access_mode IN ('full', 'canvas_only'));

COMMENT ON COLUMN public.users.access_mode IS
  'full = full platform; canvas_only = only canvases shared with this user (slim UI)';

CREATE INDEX IF NOT EXISTS idx_users_access_mode ON public.users(access_mode);
