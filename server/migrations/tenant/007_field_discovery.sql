-- Migration: Field Discovery and Auto-Mapping
-- Created: 2026-01-30
-- Database: tenant
--
-- Creates tables for:
-- - Encompass field discovery cache (RDB + custom fields)
-- - Field population analysis results
-- - Auto-mapping functionality support

-- =============================================================================
-- ENCOMPASS_FIELD_DISCOVERY_CACHE - Cache V1 field definitions
-- =============================================================================
CREATE TABLE IF NOT EXISTS encompass_field_discovery_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID NOT NULL REFERENCES los_connections(id) ON DELETE CASCADE,
  field_id VARCHAR(255) NOT NULL,
  description TEXT,
  format VARCHAR(50),          -- DATE, STRING, DECIMAL_2, YN, etc.
  field_type INTEGER,          -- Numeric field type from V1 API
  is_custom BOOLEAN DEFAULT FALSE,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(los_connection_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_field_discovery_connection 
  ON encompass_field_discovery_cache(los_connection_id);
CREATE INDEX IF NOT EXISTS idx_field_discovery_field_id 
  ON encompass_field_discovery_cache(field_id);
CREATE INDEX IF NOT EXISTS idx_field_discovery_cached_at 
  ON encompass_field_discovery_cache(cached_at);
CREATE INDEX IF NOT EXISTS idx_field_discovery_is_custom 
  ON encompass_field_discovery_cache(is_custom) WHERE is_custom = TRUE;

COMMENT ON TABLE encompass_field_discovery_cache IS 
  'Cache of discovered Encompass fields from V1 API (refreshed weekly)';
COMMENT ON COLUMN encompass_field_discovery_cache.field_id IS 
  'Encompass field ID (e.g., Fields.3142, CX.CUSTOM1)';
COMMENT ON COLUMN encompass_field_discovery_cache.format IS 
  'Field format from RDB: DATE, STRING, DECIMAL_2, YN, INTEGER, etc.';
COMMENT ON COLUMN encompass_field_discovery_cache.is_custom IS 
  'True if this is a custom field (CX.*)';

-- =============================================================================
-- ENCOMPASS_FIELD_ANALYSIS - Field population analysis from sample loans
-- =============================================================================
CREATE TABLE IF NOT EXISTS encompass_field_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID NOT NULL REFERENCES los_connections(id) ON DELETE CASCADE,
  field_id VARCHAR(255) NOT NULL,
  sample_size INTEGER NOT NULL,
  population_rate DECIMAL(5,2) NOT NULL,  -- 0.00 to 100.00
  sample_values JSONB,                     -- Array of anonymized sample values
  detected_format VARCHAR(50),             -- Inferred from actual values
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(los_connection_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_field_analysis_connection 
  ON encompass_field_analysis(los_connection_id);
CREATE INDEX IF NOT EXISTS idx_field_analysis_field_id 
  ON encompass_field_analysis(field_id);
CREATE INDEX IF NOT EXISTS idx_field_analysis_population 
  ON encompass_field_analysis(population_rate DESC);
CREATE INDEX IF NOT EXISTS idx_field_analysis_analyzed_at 
  ON encompass_field_analysis(analyzed_at);

COMMENT ON TABLE encompass_field_analysis IS 
  'Population analysis results from sample loan data (cached for 24 hours)';
COMMENT ON COLUMN encompass_field_analysis.population_rate IS 
  'Percentage of sample loans with non-null values (0.00 to 100.00)';
COMMENT ON COLUMN encompass_field_analysis.sample_values IS 
  'Array of anonymized sample values for pattern detection';
COMMENT ON COLUMN encompass_field_analysis.detected_format IS 
  'Format detected from actual values: DATE, DECIMAL, INTEGER, STRING, BOOLEAN';

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to clean up old cached data
CREATE OR REPLACE FUNCTION cleanup_field_discovery_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete field discovery cache older than 7 days
  DELETE FROM encompass_field_discovery_cache
  WHERE cached_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Delete analysis cache older than 24 hours
  DELETE FROM encompass_field_analysis
  WHERE analyzed_at < NOW() - INTERVAL '24 hours';
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_field_discovery_cache() IS 
  'Removes stale field discovery and analysis cache entries';

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
