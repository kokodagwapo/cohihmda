/**
 * Field Mapper Service
 * Maps CSV columns and custom field names to standardized LOS fields
 */

import { pool } from '../config/database.js';
import { LOS_FIELD_LIBRARY, findFieldByAlias } from './losFieldLibrary.js';

/**
 * Field mapping configuration stored per tenant
 */
export interface TenantFieldMapping {
  tenant_id: string;
  field_mappings: Record<string, FieldMappingRule>;
  custom_display_names: Record<string, string>;
  updated_at: Date;
}

export interface FieldMappingRule {
  /** Source field name (from CSV/LOS) */
  source: string;
  /** Target field key (standardized) */
  target: string;
  /** Custom display name */
  displayName?: string;
  /** Data transformation function (optional) */
  transform?: (value: any) => any;
}

/**
 * Get field mappings for a tenant
 */
export async function getTenantFieldMappings(tenantId: string): Promise<TenantFieldMapping | null> {
  try {
    const result = await pool.query(
      `SELECT field_mappings, custom_display_names, updated_at 
       FROM public.tenant_field_mappings 
       WHERE tenant_id = $1`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      tenant_id: tenantId,
      field_mappings: result.rows[0].field_mappings || {},
      custom_display_names: result.rows[0].custom_display_names || {},
      updated_at: result.rows[0].updated_at,
    };
  } catch (error: any) {
    console.error('Error fetching tenant field mappings:', error);
    return null;
  }
}

/**
 * Save field mappings for a tenant
 */
export async function saveTenantFieldMappings(
  tenantId: string,
  fieldMappings: Record<string, FieldMappingRule>,
  customDisplayNames: Record<string, string>
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.tenant_field_mappings (tenant_id, field_mappings, custom_display_names, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id) 
       DO UPDATE SET 
         field_mappings = EXCLUDED.field_mappings,
         custom_display_names = EXCLUDED.custom_display_names,
         updated_at = NOW()`,
      [tenantId, JSON.stringify(fieldMappings), JSON.stringify(customDisplayNames)]
    );
  } catch (error: any) {
    console.error('Error saving tenant field mappings:', error);
    throw error;
  }
}

/**
 * Apply field mapping to a record
 */
export function applyFieldMapping(
  record: Record<string, any>,
  mapping: Record<string, FieldMappingRule>
): Record<string, any> {
  const mapped: Record<string, any> = {};
  const unmapped: Record<string, any> = {};

  for (const [sourceKey, value] of Object.entries(record)) {
    const rule = mapping[sourceKey];
    
    if (rule) {
      // Apply transformation if provided
      const transformedValue = rule.transform ? rule.transform(value) : value;
      mapped[rule.target] = transformedValue;
    } else {
      // Store unmapped fields in raw_data
      unmapped[sourceKey] = value;
    }
  }

  // Include unmapped fields in raw_data
  if (Object.keys(unmapped).length > 0) {
    mapped.raw_data = { ...mapped.raw_data, ...unmapped };
  }

  return mapped;
}

/**
 * Detect and suggest field mappings from CSV headers
 * Uses comprehensive LOS field library for intelligent matching
 */
export function suggestFieldMappings(csvHeaders: string[]): Record<string, string> {
  const suggestions: Record<string, string> = {};
  const usedFields = new Set<string>();

  // First pass: Exact and alias matches (highest confidence)
  for (const header of csvHeaders) {
    const field = findFieldByAlias(header);
    if (field && !usedFields.has(field.sourceKey)) {
      suggestions[header] = field.sourceKey;
      usedFields.add(field.sourceKey);
    }
  }

  // Second pass: Fuzzy matching for unmapped headers (lower confidence)
  for (const header of csvHeaders) {
    if (suggestions[header]) continue; // Already mapped
    
    let bestMatch: { field: typeof LOS_FIELD_LIBRARY[0]; score: number } | null = null;
    const normalizedHeader = header.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    
    for (const field of LOS_FIELD_LIBRARY) {
      if (usedFields.has(field.sourceKey)) continue; // Already used
      
      // Calculate similarity scores
      const sourceKeyNorm = field.sourceKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      const displayNameNorm = field.displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      let maxScore = 0;
      
      // Check source key
      if (sourceKeyNorm === normalizedHeader) {
        maxScore = 1.0;
      } else if (sourceKeyNorm.includes(normalizedHeader) || normalizedHeader.includes(sourceKeyNorm)) {
        maxScore = Math.max(maxScore, 0.8);
      } else {
        const similarity = calculateSimilarity(normalizedHeader, sourceKeyNorm);
        maxScore = Math.max(maxScore, similarity);
      }
      
      // Check display name
      if (displayNameNorm === normalizedHeader) {
        maxScore = 1.0;
      } else if (displayNameNorm.includes(normalizedHeader) || normalizedHeader.includes(displayNameNorm)) {
        maxScore = Math.max(maxScore, 0.8);
      } else {
        const similarity = calculateSimilarity(normalizedHeader, displayNameNorm);
        maxScore = Math.max(maxScore, similarity);
      }
      
      // Check aliases
      if (field.aliases) {
        for (const alias of field.aliases) {
          const aliasNorm = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (aliasNorm === normalizedHeader) {
            maxScore = 1.0;
          } else if (aliasNorm.includes(normalizedHeader) || normalizedHeader.includes(aliasNorm)) {
            maxScore = Math.max(maxScore, 0.8);
          } else {
            const similarity = calculateSimilarity(normalizedHeader, aliasNorm);
            maxScore = Math.max(maxScore, similarity);
          }
        }
      }
      
      // Update best match if score is high enough (threshold: 0.6)
      if (maxScore >= 0.6 && (!bestMatch || maxScore > bestMatch.score)) {
        bestMatch = { field, score: maxScore };
      }
    }
    
    // Apply best match if found
    if (bestMatch && bestMatch.score >= 0.6) {
      suggestions[header] = bestMatch.field.sourceKey;
      usedFields.add(bestMatch.field.sourceKey);
    }
  }

  return suggestions;
}

/**
 * Calculate similarity score between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Simple Levenshtein-like scoring
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const editDistance = getEditDistance(longer, shorter);
  return 1 - (editDistance / longer.length);
}

function getEditDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
}
