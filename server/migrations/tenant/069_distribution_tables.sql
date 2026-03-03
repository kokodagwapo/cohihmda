-- =============================================================================
-- Migration 069: Report distribution tables
-- =============================================================================
-- Tables for scheduled report/dashboard/canvas/insight distribution to users.
-- Used by distribution scheduler and API.

-- Recipient lists (reusable named groups)
CREATE TABLE IF NOT EXISTS public.distribution_recipient_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_ids UUID[] DEFAULT '{}',
  external_emails TEXT[] DEFAULT '{}',
  role_filter TEXT[] DEFAULT '{}',
  is_dynamic BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_distribution_recipient_lists_created_by
  ON public.distribution_recipient_lists(created_by);

-- Distribution schedules
CREATE TABLE IF NOT EXISTS public.distribution_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  content_type TEXT NOT NULL CHECK (content_type IN ('report', 'dashboard', 'canvas', 'insight_digest')),
  content_id UUID,
  content_config JSONB DEFAULT '{}'::jsonb,

  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'one_time')),
  schedule_time TIME NOT NULL DEFAULT '08:00',
  schedule_day INT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',

  recipient_list_id UUID REFERENCES public.distribution_recipient_lists(id) ON DELETE SET NULL,
  recipient_emails TEXT[] DEFAULT '{}',

  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  failure_count INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_distribution_schedules_next_run
  ON public.distribution_schedules(next_run_at) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_distribution_schedules_created_by
  ON public.distribution_schedules(created_by);
CREATE INDEX IF NOT EXISTS idx_distribution_schedules_content
  ON public.distribution_schedules(content_type, content_id);

-- Send log (audit trail per run)
CREATE TABLE IF NOT EXISTS public.distribution_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.distribution_schedules(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial_failure', 'failed')),
  recipients_count INT,
  successful_count INT,
  failed_recipients JSONB DEFAULT '[]'::jsonb,
  content_snapshot JSONB DEFAULT '{}'::jsonb,
  export_format TEXT,
  error_message TEXT,
  duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_distribution_send_log_schedule_id
  ON public.distribution_send_log(schedule_id);
CREATE INDEX IF NOT EXISTS idx_distribution_send_log_sent_at
  ON public.distribution_send_log(sent_at DESC);
