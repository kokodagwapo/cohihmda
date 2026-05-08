-- Metric composer / SQL governance traces (tenant database)

CREATE TABLE IF NOT EXISTS public.metric_query_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id_surface text NOT NULL,
  question text,
  metric_spec jsonb,
  composed_sql text,
  params jsonb,
  access_filter_applied boolean,
  validation_passed boolean,
  execution_ms integer,
  row_count integer,
  confidence integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metric_query_traces_created
  ON public.metric_query_traces (created_at DESC);
