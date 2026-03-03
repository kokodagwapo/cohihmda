-- =============================================================================
-- Migration 073: Migrate shared_with_user_ids into canvas_share_entries
-- =============================================================================
-- One-time data migration. For each canvas with visibility = 'shared' and
-- non-empty shared_with_user_ids, insert viewer entries into canvas_share_entries.
-- shared_with_user_ids is left in place (deprecated) for safe rollback.

INSERT INTO public.canvas_share_entries (canvas_id, user_id, permission, shared_by)
SELECT c.id, u.id, 'viewer', c.user_id
FROM public.workbench_canvases c,
     unnest(c.shared_with_user_ids) AS uid
JOIN public.users u ON u.id = uid
WHERE c.visibility = 'shared'
  AND c.shared_with_user_ids IS NOT NULL
  AND array_length(c.shared_with_user_ids, 1) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.canvas_share_entries e
    WHERE e.canvas_id = c.id AND e.user_id = u.id
  );
