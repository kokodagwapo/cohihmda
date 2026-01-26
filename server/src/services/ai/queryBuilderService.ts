/**
 * Query Builder Service with RLS Integration
 * Builds SQL queries that respect row-level security, field-level access, and tenant isolation
 */

import pg from 'pg';
import { tenantDbManager } from '../../config/tenantDatabaseManager.js';

// ============================================================================
// Types
// ============================================================================

export interface QueryContext {
  userId: string;
  tenantId: string;
  userRole: string;
  userEmail?: string;
}

export interface UserPermissions {
  sectionAccess: string[];
  rowFilters: RowFilter[];
  fieldRestrictions: string[]; // Fields the user CANNOT see
  allowedFields?: string[];    // Fields the user CAN see (if defined, only these are allowed)
}

export interface RowFilter {
  field: string;
  operator: FilterOperator;
  value?: string | string[] | number | number[];
  dynamicSource?: DynamicSource;
}

export type FilterOperator = 
  | 'equals' 
  | 'not_equals'
  | 'in' 
  | 'not_in' 
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'is_null'
  | 'is_not_null'
  | 'is_current_user'
  | 'is_current_user_branch';

export type DynamicSource = 
  | 'user_email'
  | 'user_id'
  | 'user_branch'
  | 'user_region'
  | 'user_department';

export interface SecureQueryResult {
  sql: string;
  params: any[];
  allowedFields: string[];
  appliedFilters: string[];
}

// ============================================================================
// Default Permissions by Role
// ============================================================================

const DEFAULT_ROLE_PERMISSIONS: Record<string, Partial<UserPermissions>> = {
  super_admin: {
    sectionAccess: ['*'],
    rowFilters: [],
    fieldRestrictions: [],
  },
  platform_admin: {
    sectionAccess: ['*'],
    rowFilters: [],
    fieldRestrictions: [],
  },
  tenant_admin: {
    sectionAccess: ['insights', 'loans', 'leaderboard', 'funnel', 'reports', 'data_quality', 'users', 'settings', 'data_chat', 'my_dashboard'],
    rowFilters: [],
    fieldRestrictions: [],
  },
  admin: {
    sectionAccess: ['insights', 'loans', 'leaderboard', 'funnel', 'reports', 'data_quality', 'data_chat', 'my_dashboard'],
    rowFilters: [],
    fieldRestrictions: [],
  },
  loan_officer: {
    sectionAccess: ['insights', 'loans', 'funnel', 'data_chat', 'my_dashboard'],
    rowFilters: [
      { field: 'loan_officer', operator: 'is_current_user', dynamicSource: 'user_email' }
    ],
    fieldRestrictions: ['branch_price_concession', 'corporate_price_concession', 'net_buy', 'net_sell'],
  },
  processor: {
    sectionAccess: ['insights', 'loans', 'funnel', 'data_chat', 'my_dashboard'],
    rowFilters: [
      { field: 'processor', operator: 'is_current_user', dynamicSource: 'user_email' }
    ],
    fieldRestrictions: ['branch_price_concession', 'corporate_price_concession', 'net_buy', 'net_sell', 'srp_from_investor'],
  },
  viewer: {
    sectionAccess: ['insights', 'data_chat'],
    rowFilters: [],
    fieldRestrictions: ['branch_price_concession', 'corporate_price_concession', 'net_buy', 'net_sell', 'srp_from_investor', 'pa_srp_amt', 'pa_sell_amt'],
  },
  user: {
    sectionAccess: ['insights', 'loans', 'data_chat', 'my_dashboard'],
    rowFilters: [],
    fieldRestrictions: ['branch_price_concession', 'corporate_price_concession', 'net_buy', 'net_sell'],
  },
};

// ============================================================================
// Permission Resolution
// ============================================================================

/**
 * Get permissions for a user
 * First tries to load from database, then falls back to role-based defaults
 */
export async function getUserPermissions(
  context: QueryContext
): Promise<UserPermissions> {
  // Try to load from database
  try {
    const tenantPool = await tenantDbManager.getTenantPool(context.tenantId);
    
    // Check if custom roles table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'tenant_roles'
      ) as exists
    `);
    
    if (tableCheck.rows[0]?.exists) {
      // Try to load custom role permissions
      const roleResult = await tenantPool.query(`
        SELECT tr.section_access, tr.permissions, rff.filters
        FROM public.user_role_assignments ura
        JOIN public.tenant_roles tr ON ura.role_id = tr.id
        LEFT JOIN (
          SELECT role_id, json_agg(json_build_object(
            'field', field_name,
            'operator', operator,
            'value', value,
            'dynamic_source', dynamic_source
          )) as filters
          FROM public.role_field_filters
          GROUP BY role_id
        ) rff ON rff.role_id = tr.id
        WHERE ura.user_id = $1
        AND tr.is_active = true
      `, [context.userId]);

      if (roleResult.rows.length > 0) {
        const role = roleResult.rows[0];
        return {
          sectionAccess: role.section_access || [],
          rowFilters: role.filters || [],
          fieldRestrictions: role.permissions?.fieldRestrictions || [],
        };
      }
    }
  } catch (error) {
    console.log('[QueryBuilder] Custom roles not available, using defaults');
  }

  // Fall back to role-based defaults
  const defaultPerms = DEFAULT_ROLE_PERMISSIONS[context.userRole] || DEFAULT_ROLE_PERMISSIONS.user;
  
  return {
    sectionAccess: defaultPerms.sectionAccess || ['insights'],
    rowFilters: defaultPerms.rowFilters || [],
    fieldRestrictions: defaultPerms.fieldRestrictions || [],
  };
}

// ============================================================================
// Query Building
// ============================================================================

/**
 * Build a secure query with RLS filters applied
 */
export async function buildSecureQuery(
  baseQuery: string,
  context: QueryContext,
  requestedFields: string[] = []
): Promise<SecureQueryResult> {
  const permissions = await getUserPermissions(context);
  const appliedFilters: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  // Filter out restricted fields from SELECT
  const allowedFields = filterAllowedFields(requestedFields, permissions);

  // Build WHERE clauses from row filters
  const whereClauses: string[] = [];
  
  for (const filter of permissions.rowFilters) {
    const clause = buildFilterClause(filter, context, params, paramIndex);
    if (clause) {
      whereClauses.push(clause.sql);
      paramIndex = clause.nextParamIndex;
      appliedFilters.push(`${filter.field} ${filter.operator}`);
    }
  }

  // Inject filters into the query
  let finalSql = baseQuery;
  
  if (whereClauses.length > 0) {
    const rlsClause = whereClauses.join(' AND ');
    
    // Check if query already has WHERE clause
    const hasWhere = /\bWHERE\b/i.test(baseQuery);
    
    if (hasWhere) {
      // Add to existing WHERE with AND
      finalSql = baseQuery.replace(
        /\bWHERE\b/i,
        `WHERE (${rlsClause}) AND`
      );
    } else {
      // Find a good place to insert WHERE
      // Look for GROUP BY, ORDER BY, LIMIT, or end of query
      const insertPoint = baseQuery.search(/\b(GROUP BY|ORDER BY|LIMIT|$)/i);
      if (insertPoint > 0) {
        finalSql = baseQuery.slice(0, insertPoint) + ` WHERE ${rlsClause} ` + baseQuery.slice(insertPoint);
      } else {
        finalSql = baseQuery + ` WHERE ${rlsClause}`;
      }
    }
  }

  return {
    sql: finalSql,
    params,
    allowedFields,
    appliedFilters,
  };
}

/**
 * Filter fields based on permissions
 */
function filterAllowedFields(
  requestedFields: string[],
  permissions: UserPermissions
): string[] {
  if (permissions.allowedFields && permissions.allowedFields.length > 0) {
    // Whitelist mode: only allow specified fields
    return requestedFields.filter(f => 
      permissions.allowedFields!.includes(f) || f === '*'
    );
  }
  
  // Blacklist mode: remove restricted fields
  return requestedFields.filter(f => 
    !permissions.fieldRestrictions.includes(f)
  );
}

/**
 * Build a single filter clause
 */
function buildFilterClause(
  filter: RowFilter,
  context: QueryContext,
  params: any[],
  startParamIndex: number
): { sql: string; nextParamIndex: number } | null {
  let paramIndex = startParamIndex;
  
  // Resolve dynamic values
  let value = filter.value;
  if (filter.dynamicSource) {
    value = resolveDynamicValue(filter.dynamicSource, context);
    if (value === null) return null;
  }

  const field = `l.${filter.field}`;
  
  switch (filter.operator) {
    case 'equals':
    case 'is_current_user':
      params.push(value);
      return { sql: `${field} = $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'not_equals':
      params.push(value);
      return { sql: `${field} != $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'in':
      if (!Array.isArray(value)) value = [value];
      params.push(value);
      return { sql: `${field} = ANY($${paramIndex})`, nextParamIndex: paramIndex + 1 };

    case 'not_in':
      if (!Array.isArray(value)) value = [value];
      params.push(value);
      return { sql: `${field} != ALL($${paramIndex})`, nextParamIndex: paramIndex + 1 };

    case 'contains':
      params.push(`%${value}%`);
      return { sql: `${field} ILIKE $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'starts_with':
      params.push(`${value}%`);
      return { sql: `${field} ILIKE $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'ends_with':
      params.push(`%${value}`);
      return { sql: `${field} ILIKE $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'greater_than':
      params.push(value);
      return { sql: `${field} > $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'less_than':
      params.push(value);
      return { sql: `${field} < $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'between':
      if (Array.isArray(value) && value.length >= 2) {
        params.push(value[0], value[1]);
        return { 
          sql: `${field} BETWEEN $${paramIndex} AND $${paramIndex + 1}`, 
          nextParamIndex: paramIndex + 2 
        };
      }
      return null;

    case 'is_null':
      return { sql: `${field} IS NULL`, nextParamIndex: paramIndex };

    case 'is_not_null':
      return { sql: `${field} IS NOT NULL`, nextParamIndex: paramIndex };

    case 'is_current_user_branch':
      // This would need to look up the user's branch first
      // For now, we'll handle this specially
      const branch = resolveDynamicValue('user_branch', context);
      if (branch) {
        params.push(branch);
        return { sql: `${field} = $${paramIndex}`, nextParamIndex: paramIndex + 1 };
      }
      return null;

    default:
      return null;
  }
}

/**
 * Resolve dynamic filter values
 */
function resolveDynamicValue(
  source: DynamicSource,
  context: QueryContext
): string | null {
  switch (source) {
    case 'user_email':
      return context.userEmail || null;
    case 'user_id':
      return context.userId;
    case 'user_branch':
      // Would need to look up from user profile
      // For now, return null to skip the filter
      return null;
    case 'user_region':
    case 'user_department':
      // Would need to look up from user profile
      return null;
    default:
      return null;
  }
}

// ============================================================================
// Section Access Check
// ============================================================================

/**
 * Check if user has access to a dashboard section
 */
export async function checkSectionAccess(
  section: string,
  context: QueryContext
): Promise<boolean> {
  const permissions = await getUserPermissions(context);
  
  // Wildcard access
  if (permissions.sectionAccess.includes('*')) {
    return true;
  }
  
  return permissions.sectionAccess.includes(section);
}

// ============================================================================
// Field Access Check
// ============================================================================

/**
 * Check if user can access a specific field
 */
export async function checkFieldAccess(
  field: string,
  context: QueryContext
): Promise<boolean> {
  const permissions = await getUserPermissions(context);
  
  // Check whitelist if defined
  if (permissions.allowedFields && permissions.allowedFields.length > 0) {
    return permissions.allowedFields.includes(field);
  }
  
  // Check blacklist
  return !permissions.fieldRestrictions.includes(field);
}

/**
 * Get list of accessible fields for a user
 */
export async function getAccessibleFields(
  allFields: string[],
  context: QueryContext
): Promise<string[]> {
  const permissions = await getUserPermissions(context);
  return filterAllowedFields(allFields, permissions);
}

// ============================================================================
// Exports
// ============================================================================

export {
  DEFAULT_ROLE_PERMISSIONS,
  filterAllowedFields,
  buildFilterClause,
  resolveDynamicValue,
};
