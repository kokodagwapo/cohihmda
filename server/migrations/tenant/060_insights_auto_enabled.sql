-- Migration: Add insights_auto_enabled toggle to los_connections
-- Created: 2026-02-20
-- Database: tenant
--
-- Allows disabling automatic insight generation per connection
-- from the Sync Management admin panel.

ALTER TABLE public.los_connections
ADD COLUMN IF NOT EXISTS insights_auto_enabled BOOLEAN DEFAULT true;
