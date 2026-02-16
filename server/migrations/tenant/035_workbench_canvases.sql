-- =============================================================================
-- Migration 035: Create workbench_canvases table
-- =============================================================================
-- Stores user-created dashboard canvases for the workbench feature.
-- Previously only created by tenantDatabaseSchema.ts at runtime.

CREATE TABLE IF NOT EXISTS public.workbench_canvases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Canvas',
  layout_version TEXT NOT NULL DEFAULT 'freeform-v1',
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  favorited BOOLEAN DEFAULT false,
  shared BOOLEAN DEFAULT false,
  share_pin TEXT,
  share_scope TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workbench_canvases_user_id
  ON public.workbench_canvases(user_id);

CREATE INDEX IF NOT EXISTS idx_workbench_canvases_updated
  ON public.workbench_canvases(updated_at DESC);
