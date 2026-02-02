-- Migration: Loan Access Helper Functions
-- Created: 2026-01-31
-- Database: tenant
--
-- Provides optimized SQL functions for loan-level access filtering
-- Used by application services to efficiently filter loans based on user permissions

-- =============================================================================
-- LOAN ACCESS CHECK FUNCTION
-- =============================================================================
-- Efficiently checks if a user can access a specific loan
-- Uses the user's role and loan_access_mode to determine access
-- NOTE: p_loan_guid should be the loan's GUID (stored in loans.guid column)

CREATE OR REPLACE FUNCTION check_user_loan_access(
  p_user_id UUID,
  p_loan_guid TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_access_mode TEXT;
  v_role TEXT;
BEGIN
  -- Get user's access mode and role in a single query
  SELECT 
    COALESCE(loan_access_mode, 'encompass_sync'),
    role 
  INTO v_access_mode, v_role
  FROM users 
  WHERE id = p_user_id AND is_active = true;
  
  -- User not found or inactive
  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Full access roles bypass junction table
  IF v_role IN ('tenant_admin', 'admin', 'super_admin', 'platform_admin') THEN
    RETURN TRUE;
  END IF;
  
  -- Check based on access mode
  CASE v_access_mode
    WHEN 'full_access' THEN
      RETURN TRUE;
    WHEN 'no_access' THEN
      RETURN FALSE;
    ELSE
      -- For 'encompass_sync' and 'manual' modes, check junction table
      RETURN EXISTS (
        SELECT 1 FROM user_loan_access 
        WHERE user_id = p_user_id AND loan_guid = p_loan_guid
      );
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- USER ACCESS MODE FUNCTION
-- =============================================================================
-- Returns the effective loan access mode for a user (considering role overrides)

CREATE OR REPLACE FUNCTION get_user_loan_access_mode(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_access_mode TEXT;
  v_role TEXT;
BEGIN
  SELECT 
    COALESCE(loan_access_mode, 'encompass_sync'),
    role 
  INTO v_access_mode, v_role
  FROM users 
  WHERE id = p_user_id AND is_active = true;
  
  -- User not found or inactive
  IF v_role IS NULL THEN
    RETURN 'no_access';
  END IF;
  
  -- Full access roles
  IF v_role IN ('tenant_admin', 'admin', 'super_admin', 'platform_admin') THEN
    RETURN 'full_access';
  END IF;
  
  -- Viewer role
  IF v_role = 'viewer' THEN
    RETURN 'no_access';
  END IF;
  
  RETURN v_access_mode;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- ACCESSIBLE LOANS COUNT FUNCTION
-- =============================================================================
-- Returns count of loans a user can access (for UI display)

CREATE OR REPLACE FUNCTION count_user_accessible_loans(p_user_id UUID)
RETURNS BIGINT AS $$
DECLARE
  v_access_mode TEXT;
BEGIN
  v_access_mode := get_user_loan_access_mode(p_user_id);
  
  CASE v_access_mode
    WHEN 'full_access' THEN
      RETURN (SELECT COUNT(*) FROM loans);
    WHEN 'no_access' THEN
      RETURN 0;
    ELSE
      RETURN (SELECT COUNT(*) FROM user_loan_access WHERE user_id = p_user_id);
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================
-- Ensure optimal query performance for access checks

-- Composite index for the most common access pattern
CREATE INDEX IF NOT EXISTS idx_user_loan_access_lookup 
  ON user_loan_access(user_id, loan_guid);

-- Index on loans.guid for efficient joins
CREATE INDEX IF NOT EXISTS idx_loans_guid 
  ON loans(guid) 
  WHERE guid IS NOT NULL;

-- Partial index for active users with non-full access
CREATE INDEX IF NOT EXISTS idx_users_loan_access_mode 
  ON users(id, loan_access_mode) 
  WHERE is_active = true AND loan_access_mode NOT IN ('full_access', 'no_access');

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON FUNCTION check_user_loan_access IS 
  'Checks if a specific user can access a specific loan based on role and access mode';

COMMENT ON FUNCTION get_user_loan_access_mode IS 
  'Returns the effective loan access mode for a user, accounting for role-based overrides';

COMMENT ON FUNCTION count_user_accessible_loans IS 
  'Returns the count of loans a user can access for display purposes';
