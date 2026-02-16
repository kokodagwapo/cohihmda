-- ============================================================================
-- Management Database Cleanup Script
-- ============================================================================
-- Run this via ECS Exec against BOTH dev and prod management databases
-- AFTER the code changes from the database schema cleanup have been deployed.
--
-- These tables were incorrectly created in coheus_management by the legacy
-- runMigrations() in database.ts. They belong in tenant-specific databases
-- (created by server/migrations/tenant/) and are no longer referenced by
-- any management-level code.
--
-- Usage (via ECS Exec):
--   aws ecs execute-command --cluster coheus-dev-cluster \
--     --task <TASK_ID> --container backend --interactive \
--     --command "/bin/sh"
--   Then inside the container:
--     psql -h $DB_HOST -U $DB_USER -d coheus_management
--     \i /path/to/this/script.sql   (or paste the SQL below)
-- ============================================================================

-- Tenant tables that were misplaced in management DB
DROP TABLE IF EXISTS public.call_sessions CASCADE;
DROP TABLE IF EXISTS public.contacts CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.loans CASCADE;
DROP TABLE IF EXISTS public.los_connections CASCADE;
DROP TABLE IF EXISTS public.los_sync_logs CASCADE;
DROP TABLE IF EXISTS public.vendor_connections CASCADE;
DROP TABLE IF EXISTS public.vendor_sync_logs CASCADE;
DROP TABLE IF EXISTS public.tenant_field_mappings CASCADE;
DROP TABLE IF EXISTS public.encompass_field_swaps CASCADE;
DROP TABLE IF EXISTS public.encompass_token_cache CASCADE;
DROP TABLE IF EXISTS public.encompass_concurrency_metrics CASCADE;
DROP TABLE IF EXISTS public.rag_settings CASCADE;
DROP TABLE IF EXISTS public.rag_document_sources CASCADE;
DROP TABLE IF EXISTS public.rag_documents CASCADE;
DROP TABLE IF EXISTS public.user_sessions CASCADE;
DROP TABLE IF EXISTS public.failed_login_attempts CASCADE;
DROP TABLE IF EXISTS public.data_access_logs CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;

-- Legacy user/profile/tenant tables (replaced by coheus_users, user_tenant_mappings, coheus_tenants)
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.tenants CASCADE;

-- Deleted feature tables (deployments, aws-hosting routes removed)
DROP TABLE IF EXISTS public.deployment_instances CASCADE;
DROP TABLE IF EXISTS public.aws_deployments CASCADE;
DROP TABLE IF EXISTS public.aws_billing_history CASCADE;

-- Legacy Supabase auth schema (never used)
DROP SCHEMA IF EXISTS auth CASCADE;

-- Verify: list remaining tables (should only be management tables)
SELECT table_schema, table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
