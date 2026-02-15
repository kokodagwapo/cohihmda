-- =============================================================================
-- Migration 033: Rename data_chat permission to cohi_chat
-- =============================================================================
-- The "data_chat" section access identifier has been replaced by "cohi_chat"
-- across the application. This migration updates all existing roles.

-- Update section_access arrays in tenant_roles: replace 'data_chat' with 'cohi_chat'
UPDATE public.tenant_roles
SET section_access = array_replace(section_access, 'data_chat', 'cohi_chat')
WHERE 'data_chat' = ANY(section_access);
