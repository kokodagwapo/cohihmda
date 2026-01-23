# Row-Level Security (RLS) Specification

This document specifies the custom field-based row-level security system for Cohi, enabling tenant administrators to define granular access control for their users.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [Filter Operators](#filter-operators)
- [Dynamic Filters](#dynamic-filters)
- [Section Access Control](#section-access-control)
- [Query Enforcement](#query-enforcement)
- [Admin UI Specification](#admin-ui-specification)
- [API Endpoints](#api-endpoints)
- [Examples](#examples)
- [Security Considerations](#security-considerations)

---

## Overview

Row-Level Security (RLS) in Cohi allows tenant administrators to control which loan records users can access based on field values. This is implemented through:

1. **Tenant Roles** - Custom roles defined within each tenant organization
2. **Field Filters** - Rules that filter data based on field values
3. **Section Access** - Control over which UI sections/features a role can access
4. **Query Enforcement** - Automatic filter application at the database query level

### Key Principles

- **Tenant-Scoped** - RLS is configured per-tenant, isolated from other tenants
- **Additive Filters** - Multiple filters are combined with AND logic
- **Dynamic Values** - Filters can reference the current user's attributes
- **Backend Enforced** - All filtering happens at the API/database layer
- **Audit Logged** - All RLS configuration changes are logged

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ROW-LEVEL SECURITY FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

  User Request                    Backend Processing                   Database
  ────────────                    ──────────────────                   ────────

  ┌─────────────────┐
  │ GET /api/loans  │
  │                 │
  │ Headers:        │
  │  Authorization: │
  │  Bearer <jwt>   │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ Auth Middleware │
  │                 │
  │ Extract:        │
  │  - user_id      │
  │  - tenant_id    │
  │  - email        │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐         ┌─────────────────────────────────────┐
  │ RLS Middleware  │────────▶│ Load User's Role Assignments        │
  │                 │         │                                     │
  │ Build filters   │         │ SELECT r.*, f.*                     │
  │ from role       │         │ FROM user_role_assignments ura      │
  │ assignments     │         │ JOIN tenant_roles r ON ...          │
  │                 │         │ JOIN role_field_filters f ON ...    │
  │                 │         │ WHERE ura.user_id = $1              │
  └────────┬────────┘         └─────────────────────────────────────┘
           │
           ▼
  ┌─────────────────┐
  │ Query Builder   │
  │                 │
  │ Inject WHERE    │
  │ conditions      │
  │ from filters    │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐         ┌─────────────────────────────────────┐
  │ Execute Query   │────────▶│ SELECT * FROM loans                 │
  │                 │         │ WHERE tenant_id = $1                │
  │                 │         │   AND branch_code = 'SEA001'        │
  │                 │         │   AND loan_officer_email = $2       │
  └─────────────────┘         └─────────────────────────────────────┘
```

---

## Database Schema

### Core Tables

```sql
-- ============================================================================
-- TENANT ROLES
-- Custom roles defined within each tenant organization
-- ============================================================================
CREATE TABLE tenant_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES cohi_tenants(id) ON DELETE CASCADE,
    
    -- Role Identity
    name TEXT NOT NULL,                    -- Display name, e.g., "Seattle Branch Manager"
    slug TEXT NOT NULL,                    -- URL-safe identifier, e.g., "seattle-branch-manager"
    description TEXT,                      -- Human-readable description
    
    -- Base Permissions (section access)
    section_access JSONB NOT NULL DEFAULT '[]'::JSONB,
    -- Example: ["dashboard", "loans", "reports"]
    
    -- Feature Permissions
    permissions JSONB NOT NULL DEFAULT '{}'::JSONB,
    -- Example: {
    --   "loans": { "read": true, "create": false, "update": false, "delete": false, "export": true },
    --   "reports": { "read": true, "export": true }
    -- }
    
    -- Role Metadata
    is_system_role BOOLEAN DEFAULT false,  -- Built-in roles that cannot be deleted
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,            -- Higher priority roles take precedence
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    
    -- Constraints
    UNIQUE(tenant_id, slug)
);

-- Index for fast tenant lookups
CREATE INDEX idx_tenant_roles_tenant ON tenant_roles(tenant_id) WHERE is_active = true;

-- ============================================================================
-- ROLE FIELD FILTERS
-- Field-based access filters attached to roles
-- ============================================================================
CREATE TABLE role_field_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
    
    -- Filter Definition
    field_name TEXT NOT NULL,              -- Database column name, e.g., "branch_code"
    field_display_name TEXT,               -- Human-readable name, e.g., "Branch Code"
    operator TEXT NOT NULL,                -- Filter operator (see Operators section)
    value JSONB,                           -- Static value(s) or null for dynamic
    
    -- Dynamic Filter Settings
    is_dynamic BOOLEAN DEFAULT false,      -- If true, value derived from user context
    dynamic_source TEXT,                   -- Source for dynamic value: 'user_email', 'user_branch', etc.
    
    -- Filter Metadata
    is_active BOOLEAN DEFAULT true,
    description TEXT,                      -- Explanation of this filter's purpose
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_operator CHECK (operator IN (
        'equals', 'not_equals',
        'in', 'not_in',
        'contains', 'not_contains',
        'starts_with', 'ends_with',
        'greater_than', 'less_than',
        'greater_or_equal', 'less_or_equal',
        'between',
        'is_null', 'is_not_null',
        'is_current_user', 'is_current_user_branch'
    ))
);

-- Index for role lookups
CREATE INDEX idx_role_field_filters_role ON role_field_filters(role_id) WHERE is_active = true;

-- ============================================================================
-- USER ROLE ASSIGNMENTS
-- Associates users with roles (and optional field overrides)
-- ============================================================================
CREATE TABLE user_role_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES cohi_tenants(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
    
    -- User-Specific Overrides
    field_overrides JSONB DEFAULT '{}'::JSONB,
    -- Example: { "branch_code": "SEA001" } -- Overrides dynamic lookup
    
    -- Assignment Metadata
    is_active BOOLEAN DEFAULT true,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    expires_at TIMESTAMPTZ,                -- Optional expiration
    
    -- Constraints
    UNIQUE(user_id, tenant_id, role_id)
);

-- Indexes for fast lookups
CREATE INDEX idx_user_role_assignments_user ON user_role_assignments(user_id) WHERE is_active = true;
CREATE INDEX idx_user_role_assignments_tenant ON user_role_assignments(tenant_id) WHERE is_active = true;

-- ============================================================================
-- USER PROFILE EXTENSIONS
-- Additional user attributes for dynamic filters
-- ============================================================================
-- Note: This extends the existing profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS branch_code TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id);

-- ============================================================================
-- RLS AUDIT LOG
-- Track all RLS configuration changes
-- ============================================================================
CREATE TABLE rls_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES cohi_tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Action Details
    action TEXT NOT NULL,                  -- 'create_role', 'update_role', 'delete_role',
                                           -- 'create_filter', 'update_filter', 'delete_filter',
                                           -- 'assign_role', 'unassign_role'
    entity_type TEXT NOT NULL,             -- 'role', 'filter', 'assignment'
    entity_id UUID NOT NULL,
    
    -- Change Details
    previous_value JSONB,
    new_value JSONB,
    
    -- Context
    ip_address INET,
    user_agent TEXT,
    
    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for audit queries
CREATE INDEX idx_rls_audit_tenant_time ON rls_audit_log(tenant_id, created_at DESC);
```

### System Roles (Pre-seeded)

```sql
-- Insert default system roles for each tenant on creation
INSERT INTO tenant_roles (tenant_id, name, slug, description, is_system_role, section_access, permissions)
VALUES
  ($tenant_id, 'Administrator', 'admin', 'Full access to all organization features', true,
   '["dashboard", "loans", "reports", "analytics", "settings"]'::JSONB,
   '{"loans": {"read": true, "create": true, "update": true, "delete": true, "export": true}}'::JSONB),
   
  ($tenant_id, 'Loan Officer', 'loan-officer', 'Access to own loans only', true,
   '["dashboard", "loans", "reports"]'::JSONB,
   '{"loans": {"read": true, "create": true, "update": true, "delete": false, "export": true}}'::JSONB),
   
  ($tenant_id, 'Processor', 'processor', 'Access to assigned loans', true,
   '["dashboard", "loans"]'::JSONB,
   '{"loans": {"read": true, "create": false, "update": true, "delete": false, "export": false}}'::JSONB),
   
  ($tenant_id, 'Viewer', 'viewer', 'Read-only access', true,
   '["dashboard", "loans", "reports"]'::JSONB,
   '{"loans": {"read": true, "create": false, "update": false, "delete": false, "export": false}}'::JSONB);
```

---

## Filter Operators

### Comparison Operators

| Operator | Description | Value Type | Example |
|----------|-------------|------------|---------|
| `equals` | Exact match | Single value | `branch_code = 'SEA001'` |
| `not_equals` | Not equal | Single value | `status != 'Denied'` |
| `in` | Match any in list | Array | `branch_code IN ('SEA001', 'PDX001')` |
| `not_in` | Not in list | Array | `status NOT IN ('Denied', 'Withdrawn')` |
| `contains` | Contains substring | String | `loan_officer_name ILIKE '%Smith%'` |
| `not_contains` | Does not contain | String | `notes NOT ILIKE '%confidential%'` |
| `starts_with` | Starts with | String | `loan_number LIKE 'SEA%'` |
| `ends_with` | Ends with | String | `email LIKE '%@company.com'` |

### Numeric Operators

| Operator | Description | Value Type | Example |
|----------|-------------|------------|---------|
| `greater_than` | Greater than | Number | `loan_amount > 500000` |
| `less_than` | Less than | Number | `loan_amount < 1000000` |
| `greater_or_equal` | Greater or equal | Number | `fico_score >= 720` |
| `less_or_equal` | Less or equal | Number | `ltv_ratio <= 80` |
| `between` | Between two values | Array[2] | `loan_amount BETWEEN 200000 AND 500000` |

### Null Operators

| Operator | Description | Value Type | Example |
|----------|-------------|------------|---------|
| `is_null` | Value is null | None | `closing_date IS NULL` |
| `is_not_null` | Value is not null | None | `application_date IS NOT NULL` |

### Dynamic Operators

| Operator | Description | Dynamic Source | Example |
|----------|-------------|----------------|---------|
| `is_current_user` | Matches current user's email/ID | `user_email` | `loan_officer_email = current_user.email` |
| `is_current_user_branch` | Matches current user's branch | `user_branch` | `branch_code = current_user.branch_code` |

---

## Dynamic Filters

Dynamic filters resolve their value at query time based on the current user's context.

### Available Dynamic Sources

| Source | Description | User Attribute |
|--------|-------------|----------------|
| `user_email` | Current user's email | `users.email` |
| `user_id` | Current user's ID | `users.id` |
| `user_branch` | User's assigned branch | `profiles.branch_code` |
| `user_region` | User's assigned region | `profiles.region` |
| `user_department` | User's department | `profiles.department` |
| `user_manager` | User's manager ID | `profiles.manager_id` |

### Dynamic Filter Examples

```json
// Loan Officer sees only their own loans
{
  "field_name": "loan_officer_email",
  "operator": "is_current_user",
  "is_dynamic": true,
  "dynamic_source": "user_email"
}

// Branch Manager sees their branch
{
  "field_name": "branch_code",
  "operator": "is_current_user_branch",
  "is_dynamic": true,
  "dynamic_source": "user_branch"
}

// Regional VP sees their region (with field override for specific assignment)
{
  "field_name": "region",
  "operator": "equals",
  "is_dynamic": true,
  "dynamic_source": "user_region"
}
// User assignment has: field_overrides: { "region": "West" }
```

### Dynamic Resolution Algorithm

```typescript
function resolveDynamicFilter(
  filter: RoleFieldFilter,
  user: UserContext
): ResolvedFilter {
  if (!filter.is_dynamic) {
    return { field: filter.field_name, operator: filter.operator, value: filter.value };
  }
  
  // Check for user-specific override first
  const override = user.role_assignment?.field_overrides?.[filter.field_name];
  if (override !== undefined) {
    return { field: filter.field_name, operator: 'equals', value: override };
  }
  
  // Resolve from user context
  const dynamicValue = resolveDynamicSource(filter.dynamic_source, user);
  if (dynamicValue === null) {
    throw new RLSError(`Dynamic source '${filter.dynamic_source}' not available for user`);
  }
  
  return { field: filter.field_name, operator: filter.operator, value: dynamicValue };
}
```

---

## Section Access Control

Beyond row-level data filtering, roles also control which UI sections users can access.

### Available Sections

| Section ID | Description | Default Access |
|------------|-------------|----------------|
| `dashboard` | Main dashboard/insights | All roles |
| `loans` | Loan detail pages | All roles |
| `reports` | Reports and analytics | Most roles |
| `analytics` | Advanced analytics | Admin, managers |
| `funnel` | Loan funnel view | Admin, managers |
| `leaderboard` | Performance leaderboard | Varies |
| `settings` | Organization settings | Admin only |
| `users` | User management | Admin only |

### Section Access JSON Schema

```json
{
  "section_access": ["dashboard", "loans", "reports"],
  "permissions": {
    "loans": {
      "read": true,
      "create": true,
      "update": true,
      "delete": false,
      "export": true
    },
    "reports": {
      "read": true,
      "export": true
    }
  }
}
```

---

## Query Enforcement

### RLS Service Implementation

```typescript
// server/src/services/rlsService.ts

interface RLSContext {
  userId: string;
  tenantId: string;
  email: string;
  branchCode?: string;
  region?: string;
}

interface ResolvedFilter {
  field: string;
  operator: string;
  value: any;
  paramIndex?: number;
}

class RLSService {
  /**
   * Load user's effective RLS filters
   */
  async getUserFilters(userId: string, tenantId: string): Promise<ResolvedFilter[]> {
    // 1. Get user's role assignments
    const assignments = await this.getUserRoleAssignments(userId, tenantId);
    
    if (assignments.length === 0) {
      // No role = no access (return impossible filter)
      return [{ field: '1', operator: 'equals', value: '0' }];
    }
    
    // 2. Load user context for dynamic resolution
    const userContext = await this.getUserContext(userId, tenantId);
    
    // 3. Collect all filters from all roles
    const allFilters: ResolvedFilter[] = [];
    
    for (const assignment of assignments) {
      const roleFilters = await this.getRoleFilters(assignment.role_id);
      
      for (const filter of roleFilters) {
        // Apply field overrides from assignment
        const contextWithOverrides = {
          ...userContext,
          role_assignment: assignment,
        };
        
        const resolved = this.resolveDynamicFilter(filter, contextWithOverrides);
        allFilters.push(resolved);
      }
    }
    
    return allFilters;
  }
  
  /**
   * Build WHERE clause from filters
   */
  buildWhereClause(filters: ResolvedFilter[], startParamIndex: number = 1): {
    clause: string;
    params: any[];
  } {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = startParamIndex;
    
    for (const filter of filters) {
      const { sql, newParams, newParamIndex } = this.filterToSQL(filter, paramIndex);
      conditions.push(sql);
      params.push(...newParams);
      paramIndex = newParamIndex;
    }
    
    return {
      clause: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
      params,
    };
  }
  
  /**
   * Convert filter to SQL condition
   */
  private filterToSQL(filter: ResolvedFilter, paramIndex: number): {
    sql: string;
    newParams: any[];
    newParamIndex: number;
  } {
    const { field, operator, value } = filter;
    const col = this.sanitizeColumnName(field);
    
    switch (operator) {
      case 'equals':
        return {
          sql: `${col} = $${paramIndex}`,
          newParams: [value],
          newParamIndex: paramIndex + 1,
        };
        
      case 'not_equals':
        return {
          sql: `${col} != $${paramIndex}`,
          newParams: [value],
          newParamIndex: paramIndex + 1,
        };
        
      case 'in':
        const placeholders = value.map((_: any, i: number) => `$${paramIndex + i}`).join(', ');
        return {
          sql: `${col} IN (${placeholders})`,
          newParams: value,
          newParamIndex: paramIndex + value.length,
        };
        
      case 'contains':
        return {
          sql: `${col} ILIKE $${paramIndex}`,
          newParams: [`%${value}%`],
          newParamIndex: paramIndex + 1,
        };
        
      case 'is_null':
        return {
          sql: `${col} IS NULL`,
          newParams: [],
          newParamIndex: paramIndex,
        };
        
      case 'between':
        return {
          sql: `${col} BETWEEN $${paramIndex} AND $${paramIndex + 1}`,
          newParams: [value[0], value[1]],
          newParamIndex: paramIndex + 2,
        };
        
      // ... other operators
      
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }
  }
}
```

### Middleware Integration

```typescript
// server/src/middleware/rls.ts

export function applyRLS() {
  return async (req: RBACRequest, res: Response, next: NextFunction) => {
    if (!req.userId || !req.userTenantId) {
      return next(); // Let auth middleware handle
    }
    
    // Skip RLS for super_admin
    if (req.userRole === 'super_admin') {
      req.rlsFilters = [];
      return next();
    }
    
    try {
      const rlsService = new RLSService();
      const filters = await rlsService.getUserFilters(req.userId, req.userTenantId);
      
      req.rlsFilters = filters;
      next();
    } catch (error) {
      logError('RLS filter resolution failed', error);
      res.status(500).json({ error: 'Access control error' });
    }
  };
}

// Usage in routes
router.get('/loans',
  authenticateToken,
  attachTenantContext,
  applyRLS(),
  async (req, res) => {
    const { clause, params } = rlsService.buildWhereClause(req.rlsFilters);
    
    const result = await tenantPool.query(
      `SELECT * FROM loans WHERE ${clause} ORDER BY created_at DESC`,
      params
    );
    
    res.json({ loans: result.rows });
  }
);
```

---

## Admin UI Specification

### Roles & Permissions Section

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Roles & Permissions                                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  [+ Create Role]                                          [Search roles] │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ROLE                  │ USERS │ FILTERS │ SECTIONS │ ACTIONS          │    │
│  ├────────────────────────┼───────┼─────────┼──────────┼──────────────────┤    │
│  │  Administrator         │   3   │    0    │   All    │ [Edit] [Users]   │    │
│  │  🔒 System Role        │       │         │          │                  │    │
│  ├────────────────────────┼───────┼─────────┼──────────┼──────────────────┤    │
│  │  Seattle Branch Mgr    │   2   │    1    │    4     │ [Edit] [Delete]  │    │
│  │  branch_code = SEA001  │       │         │          │ [Users]          │    │
│  ├────────────────────────┼───────┼─────────┼──────────┼──────────────────┤    │
│  │  Loan Officer          │  15   │    1    │    3     │ [Edit] [Users]   │    │
│  │  🔒 System Role        │       │         │          │                  │    │
│  │  loan_officer = me     │       │         │          │                  │    │
│  └────────────────────────┴───────┴─────────┴──────────┴──────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Role Edit Dialog

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Edit Role: Seattle Branch Manager                                    [X Close] │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  GENERAL                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Name:        [Seattle Branch Manager________________]                  │    │
│  │  Description: [Access to all Seattle branch loans____]                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  DATA FILTERS                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Users with this role can only see data matching these filters:         │    │
│  │                                                                         │    │
│  │  ┌───────────────────────────────────────────────────────────────────┐ │    │
│  │  │  Field          │ Operator │ Value                    │ [Delete] │ │    │
│  │  ├─────────────────┼──────────┼──────────────────────────┼──────────┤ │    │
│  │  │  [branch_code▼] │ [equals▼]│ [SEA001________________] │    🗑    │ │    │
│  │  └─────────────────┴──────────┴──────────────────────────┴──────────┘ │    │
│  │                                                                         │    │
│  │  [+ Add Filter]                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  SECTION ACCESS                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ☑ Dashboard    ☑ Loans    ☑ Reports    ☐ Analytics    ☐ Settings     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  PERMISSIONS                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Loans:    ☑ Read  ☑ Create  ☑ Update  ☐ Delete  ☑ Export              │    │
│  │  Reports:  ☑ Read  ☐ Create  ☐ Update  ☐ Delete  ☑ Export              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│                                                        [Cancel]  [Save Changes] │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Field Filter Builder

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Add Data Filter                                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────────────────────────┐                                       │
│  │  Select Field                        │                                       │
│  │  ┌────────────────────────────────┐  │                                       │
│  │  │ 🔍 Search fields...            │  │                                       │
│  │  ├────────────────────────────────┤  │                                       │
│  │  │ ○ branch_code (Branch Code)    │  │                                       │
│  │  │ ○ loan_officer_email (LO Email)│  │                                       │
│  │  │ ○ loan_officer_name (LO Name)  │  │                                       │
│  │  │ ○ region (Region)              │  │                                       │
│  │  │ ○ loan_status (Loan Status)    │  │                                       │
│  │  │ ○ loan_amount (Loan Amount)    │  │                                       │
│  │  │ ○ application_date (App Date)  │  │                                       │
│  │  └────────────────────────────────┘  │                                       │
│  └──────────────────────────────────────┘                                       │
│                                                                                  │
│  ┌──────────────────────────────────────┐                                       │
│  │  Select Operator                     │                                       │
│  │  ┌────────────────────────────────┐  │                                       │
│  │  │ ○ equals                       │  │                                       │
│  │  │ ○ not equals                   │  │                                       │
│  │  │ ○ is in list                   │  │                                       │
│  │  │ ○ contains                     │  │                                       │
│  │  │ ○ is current user ⚡           │  │                                       │
│  │  │ ○ is current user's branch ⚡  │  │                                       │
│  │  └────────────────────────────────┘  │                                       │
│  └──────────────────────────────────────┘                                       │
│                                                                                  │
│  ⚡ = Dynamic filter (resolves at query time based on logged-in user)           │
│                                                                                  │
│                                                          [Cancel]  [Add Filter] │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Role Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/roles` | List all roles for tenant |
| `POST` | `/api/admin/roles` | Create new role |
| `GET` | `/api/admin/roles/:id` | Get role details |
| `PUT` | `/api/admin/roles/:id` | Update role |
| `DELETE` | `/api/admin/roles/:id` | Delete role (non-system) |

### Filter Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/roles/:id/filters` | Get role's filters |
| `POST` | `/api/admin/roles/:id/filters` | Add filter to role |
| `PUT` | `/api/admin/roles/:id/filters/:filterId` | Update filter |
| `DELETE` | `/api/admin/roles/:id/filters/:filterId` | Remove filter |

### User Assignment

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/roles/:id/users` | List users with role |
| `POST` | `/api/admin/roles/:id/users` | Assign role to user |
| `DELETE` | `/api/admin/roles/:id/users/:userId` | Remove role from user |
| `PUT` | `/api/admin/roles/:id/users/:userId` | Update assignment (overrides) |

### Field Discovery

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/rls/fields` | List available fields for filtering |
| `GET` | `/api/admin/rls/fields/:field/values` | Get distinct values for field |

---

## Examples

### Example 1: Branch Manager

**Role Configuration:**
```json
{
  "name": "Seattle Branch Manager",
  "section_access": ["dashboard", "loans", "reports", "analytics"],
  "permissions": {
    "loans": { "read": true, "create": true, "update": true, "delete": false, "export": true }
  },
  "filters": [
    {
      "field_name": "branch_code",
      "operator": "equals",
      "value": "SEA001",
      "is_dynamic": false
    }
  ]
}
```

**Generated SQL:**
```sql
SELECT * FROM loans
WHERE tenant_id = $1
  AND branch_code = 'SEA001'
ORDER BY created_at DESC;
```

### Example 2: Loan Officer (Own Loans)

**Role Configuration:**
```json
{
  "name": "Loan Officer",
  "section_access": ["dashboard", "loans"],
  "filters": [
    {
      "field_name": "loan_officer_email",
      "operator": "is_current_user",
      "is_dynamic": true,
      "dynamic_source": "user_email"
    }
  ]
}
```

**Generated SQL (for user jsmith@company.com):**
```sql
SELECT * FROM loans
WHERE tenant_id = $1
  AND loan_officer_email = 'jsmith@company.com'
ORDER BY created_at DESC;
```

### Example 3: Regional VP (Multiple Branches)

**Role Configuration:**
```json
{
  "name": "West Region VP",
  "filters": [
    {
      "field_name": "branch_code",
      "operator": "in",
      "value": ["SEA001", "PDX001", "SFO001", "LAX001"],
      "is_dynamic": false
    }
  ]
}
```

**Generated SQL:**
```sql
SELECT * FROM loans
WHERE tenant_id = $1
  AND branch_code IN ('SEA001', 'PDX001', 'SFO001', 'LAX001')
ORDER BY created_at DESC;
```

---

## Security Considerations

### SQL Injection Prevention

- All field names are validated against a whitelist of actual column names
- All values are parameterized, never interpolated directly
- Operators are validated against allowed list

### Privilege Escalation Prevention

- Users cannot create roles with more permissions than they have
- System roles cannot be deleted or have core permissions removed
- Role assignment requires appropriate permission

### Audit Trail

- All RLS configuration changes are logged
- Logs include before/after values for changes
- Logs are retained according to retention policy

### Performance Considerations

- RLS filters should use indexed columns when possible
- Filter complexity is bounded (max 10 filters per role)
- Dynamic filters are resolved once per request and cached

---

## Related Documentation

- [ADMIN_PANEL.md](../architecture/ADMIN_PANEL.md) - Admin panel architecture
- [AUTH_REFACTOR.md](./AUTH_REFACTOR.md) - Authentication system
- [MULTI_TENANT.md](../architecture/MULTI_TENANT.md) - Multi-tenant architecture
