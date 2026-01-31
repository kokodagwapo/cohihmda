-- Migration: Additional Fields System
-- Created: 2026-01-30
-- Database: tenant
--
-- Creates infrastructure for client-defined additional loan fields:
-- - additional_field_definitions: Metadata for dynamic columns
-- - Dynamic column support on loans table
-- - Replaces the old custom_fields approach with proper ETL integration

-- =============================================================================
-- ADDITIONAL_FIELD_DEFINITIONS - Track client-defined additional loan fields
-- =============================================================================
-- This table tracks additional fields that clients want to sync from their LOS
-- beyond the default 296 Coheus fields. Each entry corresponds to a dynamically
-- added column on the loans table.

CREATE TABLE IF NOT EXISTS additional_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID REFERENCES los_connections(id) ON DELETE CASCADE,
  los_field_id VARCHAR(255) NOT NULL,           -- Encompass field ID (e.g., "Fields.CX.REVENUE", "CX.CUSTOMFIELD1")
  column_name VARCHAR(63) NOT NULL,             -- PostgreSQL column name (auto-generated from display name)
  display_name VARCHAR(255) NOT NULL,           -- Human-readable name for UI
  data_type VARCHAR(50) NOT NULL CHECK (data_type IN ('string', 'number', 'date', 'boolean', 'currency', 'percentage')),
  db_column_type VARCHAR(50) NOT NULL,          -- Actual PostgreSQL type (TEXT, DECIMAL(15,2), DATE, BOOLEAN, etc.)
  category VARCHAR(100),                        -- Optional category for grouping in UI
  description TEXT,                             -- Optional description
  is_enabled BOOLEAN DEFAULT TRUE,              -- Whether to sync this field
  include_in_rag BOOLEAN DEFAULT TRUE,          -- Whether to include in RAG embeddings
  sort_order INTEGER DEFAULT 0,                 -- Display order in UI
  column_created BOOLEAN DEFAULT FALSE,         -- Whether the column has been created on loans table
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_los_field_per_connection UNIQUE(los_connection_id, los_field_id),
  CONSTRAINT unique_column_name UNIQUE(column_name)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_additional_fields_connection 
  ON additional_field_definitions(los_connection_id);
CREATE INDEX IF NOT EXISTS idx_additional_fields_enabled 
  ON additional_field_definitions(is_enabled) WHERE is_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_additional_fields_rag 
  ON additional_field_definitions(include_in_rag) WHERE include_in_rag = TRUE;
CREATE INDEX IF NOT EXISTS idx_additional_fields_column_created 
  ON additional_field_definitions(column_created) WHERE column_created = TRUE;

-- Comments for documentation
COMMENT ON TABLE additional_field_definitions IS 
  'Tracks client-defined additional loan fields beyond the default Coheus fields. Each row corresponds to a dynamically added column on the loans table.';
COMMENT ON COLUMN additional_field_definitions.los_field_id IS 
  'The LOS field ID (e.g., Encompass Fields.CX.REVENUE) to extract data from';
COMMENT ON COLUMN additional_field_definitions.column_name IS 
  'The PostgreSQL column name on loans table (auto-generated from display name)';
COMMENT ON COLUMN additional_field_definitions.db_column_type IS 
  'The PostgreSQL data type for the column (TEXT, DECIMAL(15,2), DATE, BOOLEAN, etc.)';
COMMENT ON COLUMN additional_field_definitions.include_in_rag IS 
  'Whether this field should be included in RAG embeddings for AI queries';
COMMENT ON COLUMN additional_field_definitions.column_created IS 
  'Whether ALTER TABLE has been run to create this column on loans table';

-- =============================================================================
-- ADDITIONAL_FIELD_AUDIT_LOG - Track changes to additional fields
-- =============================================================================
CREATE TABLE IF NOT EXISTS additional_field_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_definition_id UUID REFERENCES additional_field_definitions(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL CHECK (action IN ('create', 'update', 'delete', 'enable', 'disable', 'column_added', 'column_dropped')),
  previous_values JSONB,
  new_values JSONB,
  performed_by UUID,
  performed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_additional_field_audit_field 
  ON additional_field_audit_log(field_definition_id);
CREATE INDEX IF NOT EXISTS idx_additional_field_audit_action 
  ON additional_field_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_additional_field_audit_date 
  ON additional_field_audit_log(performed_at DESC);

COMMENT ON TABLE additional_field_audit_log IS 
  'Audit trail for changes to additional field definitions';

-- =============================================================================
-- DATA TYPE MAPPING REFERENCE
-- =============================================================================
-- This comment documents the mapping from UI data types to PostgreSQL types:
--
-- | UI Data Type | db_column_type    | Notes                              |
-- |--------------|-------------------|------------------------------------|
-- | string       | TEXT              | Variable-length text               |
-- | number       | DECIMAL(15,4)     | Large numbers with 4 decimal places|
-- | date         | DATE              | Date only (no time)                |
-- | boolean      | BOOLEAN           | true/false                         |
-- | currency     | DECIMAL(15,2)     | Money values with 2 decimal places |
-- | percentage   | DECIMAL(8,4)      | Percentages with 4 decimal places  |

-- =============================================================================
-- TRIGGER: Update updated_at timestamp
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_additional_field_definitions_updated_at ON additional_field_definitions;
CREATE TRIGGER trigger_additional_field_definitions_updated_at
  BEFORE UPDATE ON additional_field_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- HELPER FUNCTION: Generate column name from display name
-- =============================================================================
CREATE OR REPLACE FUNCTION generate_additional_field_column_name(display_name TEXT)
RETURNS TEXT AS $$
DECLARE
  base_name TEXT;
  result TEXT;
BEGIN
  -- Convert to lowercase
  base_name := lower(display_name);
  
  -- Replace spaces and special chars with underscores
  base_name := regexp_replace(base_name, '[^a-z0-9]+', '_', 'g');
  
  -- Remove leading/trailing underscores
  base_name := trim(both '_' from base_name);
  
  -- Collapse multiple underscores
  base_name := regexp_replace(base_name, '_+', '_', 'g');
  
  -- Prefix with af_ to identify as additional field
  result := 'af_' || base_name;
  
  -- Truncate to 63 chars (PostgreSQL limit)
  IF length(result) > 63 THEN
    result := substring(result from 1 for 63);
    -- Remove trailing underscore if truncation created one
    result := rtrim(result, '_');
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION generate_additional_field_column_name(TEXT) IS 
  'Generates a valid PostgreSQL column name from a display name, prefixed with af_';

-- =============================================================================
-- HELPER FUNCTION: Get all additional fields for a connection (for ETL)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_enabled_additional_fields(connection_id UUID)
RETURNS TABLE (
  los_field_id VARCHAR(255),
  column_name VARCHAR(63),
  display_name VARCHAR(255),
  data_type VARCHAR(50),
  db_column_type VARCHAR(50)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    afd.los_field_id,
    afd.column_name,
    afd.display_name,
    afd.data_type,
    afd.db_column_type
  FROM additional_field_definitions afd
  WHERE afd.los_connection_id = connection_id
    AND afd.is_enabled = TRUE
    AND afd.column_created = TRUE
  ORDER BY afd.sort_order, afd.display_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_enabled_additional_fields(UUID) IS 
  'Returns all enabled additional fields for a LOS connection that have columns created';

-- =============================================================================
-- HELPER FUNCTION: Get RAG-enabled additional fields for a connection
-- =============================================================================
CREATE OR REPLACE FUNCTION get_rag_additional_fields(connection_id UUID)
RETURNS TABLE (
  column_name VARCHAR(63),
  display_name VARCHAR(255),
  data_type VARCHAR(50)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    afd.column_name,
    afd.display_name,
    afd.data_type
  FROM additional_field_definitions afd
  WHERE afd.los_connection_id = connection_id
    AND afd.is_enabled = TRUE
    AND afd.include_in_rag = TRUE
    AND afd.column_created = TRUE
  ORDER BY afd.sort_order, afd.display_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_rag_additional_fields(UUID) IS 
  'Returns additional fields that should be included in RAG embeddings';

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
