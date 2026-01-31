/**
 * Canonical loan representation for embedding.
 * Converts a loan record into a stable, deterministic textual representation
 * using selected signal strength fields plus client-defined additional fields.
 * Same format for historical and active loans.
 * 
 * Additional fields are dynamically loaded from additional_field_definitions table
 * where include_in_rag = true.
 */

import pg from 'pg';

export type CanonicalConfig = {
  /** Ordered list of signal strength field names. */
  signalFields: readonly string[];
  /** Optional labels; key = field name, value = display label. */
  labels?: Record<string, string>;
  /** Additional fields from additional_field_definitions (loaded dynamically). */
  additionalFields?: AdditionalFieldConfig[];
};

export type AdditionalFieldConfig = {
  columnName: string;
  displayName: string;
  dataType: string;
};

/** Default config using standard signal fields. */
const defaultLabels: Record<string, string> = {
  creditMetricsSignalStrength: 'Credit Metrics',
  loanCharacteristicsSignalStrength: 'Loan Characteristics',
  timeInMotionSignalStrength: 'Time in Motion',
  mloAeFalloutProneSignalStrength: 'MLO AE Fallout Prone',
  interestLockVsMarketSignalStrength: 'Interest Lock vs Market',
  uwPullthroughSignalStrength: 'UW Pullthrough',
  closerPullthroughSignalStrength: 'Closer Pullthrough',
  processorPullthroughSignalStrength: 'Processor Pullthrough',
};

/**
 * Load additional fields that are marked for RAG inclusion for a given connection.
 * Returns an array of field configs with column names and display names.
 */
export async function loadRagAdditionalFields(
  tenantPool: pg.Pool,
  losConnectionId?: string
): Promise<AdditionalFieldConfig[]> {
  try {
    // Query additional_field_definitions for RAG-enabled fields
    const query = losConnectionId
      ? `SELECT column_name, display_name, data_type 
         FROM additional_field_definitions 
         WHERE los_connection_id = $1 
           AND is_enabled = TRUE 
           AND include_in_rag = TRUE 
           AND column_created = TRUE
         ORDER BY sort_order, display_name`
      : `SELECT DISTINCT ON (column_name) column_name, display_name, data_type 
         FROM additional_field_definitions 
         WHERE is_enabled = TRUE 
           AND include_in_rag = TRUE 
           AND column_created = TRUE
         ORDER BY column_name, sort_order, display_name`;
    
    const params = losConnectionId ? [losConnectionId] : [];
    const result = await tenantPool.query(query, params);
    
    return result.rows.map(row => ({
      columnName: row.column_name,
      displayName: row.display_name,
      dataType: row.data_type,
    }));
  } catch (error: any) {
    // Table may not exist during migration - return empty array
    console.warn(`[canonicalLoan] Could not load additional fields: ${error.message}`);
    return [];
  }
}

/**
 * Format a value for RAG text based on data type.
 */
function formatValueForRag(value: unknown, dataType: string): string {
  if (value === null || value === undefined) return '';
  
  const strValue = String(value).trim();
  if (!strValue) return '';
  
  switch (dataType) {
    case 'currency':
      // Format as currency
      const numVal = parseFloat(strValue);
      return isNaN(numVal) ? strValue : `$${numVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    case 'percentage':
      // Format as percentage
      const pctVal = parseFloat(strValue);
      return isNaN(pctVal) ? strValue : `${pctVal.toFixed(2)}%`;
    
    case 'date':
      // Format as date
      const dateVal = new Date(strValue);
      return isNaN(dateVal.getTime()) ? strValue : dateVal.toLocaleDateString('en-US');
    
    case 'boolean':
      // Format as Yes/No
      const lowerVal = strValue.toLowerCase();
      return lowerVal === 'true' || lowerVal === '1' || lowerVal === 'y' || lowerVal === 'yes' ? 'Yes' : 'No';
    
    default:
      return strValue;
  }
}

/**
 * Convert a loan record into a deterministic string suitable for embedding.
 * Uses the configured signal fields plus any additional fields marked for RAG.
 * Consistent ordering, no free-form text.
 */
export function toCanonicalLoanText(
  loan: Record<string, unknown>,
  config: CanonicalConfig
): string {
  const { signalFields, labels = defaultLabels, additionalFields = [] } = config;
  const lines: string[] = [];
  
  // Add standard signal fields
  for (const field of signalFields) {
    const raw = loan[field];
    const value = raw === null || raw === undefined ? '' : String(raw).trim();
    const label = labels[field] ?? field;
    lines.push(`${label}: ${value}`);
  }
  
  // Add additional fields (from additional_field_definitions with include_in_rag=true)
  if (additionalFields.length > 0) {
    // Add a separator for additional fields
    lines.push(''); // Empty line
    lines.push('--- Additional Fields ---');
    
    for (const additionalField of additionalFields) {
      const raw = loan[additionalField.columnName];
      const value = formatValueForRag(raw, additionalField.dataType);
      if (value) { // Only include non-empty values
        lines.push(`${additionalField.displayName}: ${value}`);
      }
    }
  }
  
  return lines.join('\n');
}

/**
 * Create a canonical config with additional fields loaded from the database.
 * Use this when building embeddings to ensure additional fields are included.
 */
export async function createCanonicalConfigWithAdditionalFields(
  tenantPool: pg.Pool,
  baseSignalFields: readonly string[],
  losConnectionId?: string,
  baseLabels?: Record<string, string>
): Promise<CanonicalConfig> {
  const additionalFields = await loadRagAdditionalFields(tenantPool, losConnectionId);
  
  return {
    signalFields: baseSignalFields,
    labels: baseLabels ?? defaultLabels,
    additionalFields,
  };
}
