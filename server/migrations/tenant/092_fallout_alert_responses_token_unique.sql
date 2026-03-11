-- Migration: Ensure one latest response row per fallout token
-- Database: tenant
--
-- Deduplicates historical fallout alert responses by token_id, then enforces
-- uniqueness so repeated clicks update the same response row.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY token_id
      ORDER BY responded_at DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.fallout_alert_responses
)
DELETE FROM public.fallout_alert_responses r
USING ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fallout_alert_responses_token_id
  ON public.fallout_alert_responses (token_id);
