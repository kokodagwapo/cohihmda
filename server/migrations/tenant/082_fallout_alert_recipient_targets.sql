-- Migration: fallout alert recipient targeting
-- Adds explicit LO and manager targeting fields to config.

ALTER TABLE public.fallout_alert_config
  ADD COLUMN IF NOT EXISTS target_encompass_user_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE public.fallout_alert_config
  ADD COLUMN IF NOT EXISTS manager_user_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
