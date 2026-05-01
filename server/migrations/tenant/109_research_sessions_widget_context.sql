-- COHI-366: persist Research Lab widget catalog snapshot for agent + reconnect
ALTER TABLE public.research_sessions
  ADD COLUMN IF NOT EXISTS widget_context JSONB DEFAULT NULL;

COMMENT ON COLUMN public.research_sessions.widget_context IS
  'Optional { catalog: string, meta: [{ id, name, dataSource, dashboardPath, dashboardLabel }] } from client for registry-aware analyst.';
