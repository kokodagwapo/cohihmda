-- =============================================================================
-- Migration 071: Granular canvas sharing with permission levels
-- =============================================================================
-- Replaces flat shared_with_user_ids with a join table supporting both users
-- and groups, plus per-share permission (viewer vs editor).

CREATE TABLE IF NOT EXISTS public.canvas_share_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id UUID NOT NULL REFERENCES public.workbench_canvases(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.user_groups(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer', 'editor')),
  shared_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT canvas_share_target_check CHECK (
    (user_id IS NOT NULL AND group_id IS NULL) OR
    (user_id IS NULL AND group_id IS NOT NULL)
  )
);

-- Unique per canvas: one row per user, one per group
CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_share_entries_canvas_user
  ON public.canvas_share_entries(canvas_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_share_entries_canvas_group
  ON public.canvas_share_entries(canvas_id, group_id) WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canvas_share_entries_canvas_id ON public.canvas_share_entries(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_share_entries_user_id ON public.canvas_share_entries(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canvas_share_entries_group_id ON public.canvas_share_entries(group_id) WHERE group_id IS NOT NULL;

COMMENT ON TABLE public.canvas_share_entries IS 'Per-user or per-group share with permission (viewer/editor). Replaces shared_with_user_ids for granular control.';
