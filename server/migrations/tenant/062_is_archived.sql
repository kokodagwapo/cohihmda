-- Migration: Add is_archived to loans (Encompass Fields.5016)
-- Created: 2026-02-20
-- Database: tenant
--
-- Syncs Encompass archived flag so active pipeline metrics,
-- data quality tests, and AI context exclude archived loans.

ALTER TABLE public.loans
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN;
