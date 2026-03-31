-- Migration: Add podcast_auto_enabled toggle to los_connections
-- Created: 2026-03-31
-- Database: tenant
--
-- Allows enabling/disabling automatic podcast generation per connection
-- from the Sync Management admin panel. When enabled, a podcast prefetch
-- job is enqueued automatically after each successful insight generation
-- run for that connection.

ALTER TABLE public.los_connections
ADD COLUMN IF NOT EXISTS podcast_auto_enabled BOOLEAN DEFAULT true;
