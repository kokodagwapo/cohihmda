# Multi-Tenant Database Architecture

This document explains how the Cohi application manages tenant database selection across the frontend and backend.

## Overview

The application uses a **database-per-tenant** architecture where each client/lender has their own isolated PostgreSQL database. This provides complete data isolation and security between tenants.

---

## Database Structure

### 1. Management Database (`coheus_management`)

The central registry of all tenants, containing:

- **`coheus_tenants` table** - Tenant metadata:
  - `id` - UUID primary key
  - `name` - Display name
  - `slug` - Unique identifier (e.g., "acme-corp")
  - `database_name` - Tenant's database name
  - `database_host` - Database server host
  - `database_port` - Database port
  - `database_user` - Database username
  - `database_password_encrypted` - Encrypted password
  - `status` - active/suspended/deleted/provisioning
  - `deployment_type` - cloud/on_premise/per_lender_aws

- **`coheus_users` table** - Super admin/platform admin users

### 2. Tenant Databases (one per tenant)

Each tenant has a separate database (e.g., `tenant_acme_corp`, `tenant_xyz_lending`) containing:

- Tenant-specific data: loans, users, profiles, etc.
- Schema is enforced/created automatically via `tenantDatabaseSchema.ts`

---

## User Roles

### Super Admin Roles (stored in management DB)

| Role | Description |
|------|-------------|
| `super_admin` | Cohi internal admin with full platform access |
| `platform_admin` | Cohi staff with limited platform access |
| `support` | Cohi support staff |

### Tenant Roles (stored in tenant DBs)

| Role | Description |
|------|-------------|
| `tenant_admin` | Client admin with access to their organization's settings |
| `admin` | Organization admin (legacy, same as tenant_admin) |
| `user` | Regular user with standard access |
| `viewer` | Read-only access |
| `loan_officer` | Loan officer with specific permissions |
| `processor` | Loan processor with specific permissions |

---

## Frontend Tenant Selection

### 1. Authentication Context (`AuthContext.tsx`)

When a user logs in, the JWT token contains tenant information:

```typescript
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  is_super_admin: boolean;
  tenant_id?: string | null;    // Which tenant this user belongs to
  tenant_name?: string | null;
  tenant_slug?: string | null;
}
```

**Login process:**

```typescript
const login = useCallback(async (email: string, password: string, tenantSlug?: string) => {
  const response = await api.request<{ user: AuthUser; token: string }>('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password, tenantSlug }),
  });
  
  localStorage.setItem(AUTH_TOKEN_KEY, response.token);  // Store JWT
  api.setToken(response.token);  // Set for API calls
  setUser(response.user);  // Contains tenant_id, tenant_name, etc.
});
```

### 2. Admin Tenant Context (`AdminTenantContext.tsx`)

For admin sections, there's a separate context that manages tenant selection:

**For Tenant Admins (locked to their tenant):**

```typescript
// Auto-sets to their assigned tenant, cannot change
if (user.role === 'tenant_admin' && user.tenant_id) {
  setSelectedTenantIdInternal(user.tenant_id);
}
```

**For Platform Admins (can select any tenant):**

```typescript
// Starts with no tenant, can select via UI
const setSelectedTenantId = useCallback((id: string | null) => {
  if (isTenantAdmin) {
    // Tenant admins cannot change tenant
    return;
  }
  setSelectedTenantIdInternal(id);
}, [isTenantAdmin]);
```

### 3. API Calls Include Tenant ID

When making API requests, tenant information is sent two ways:

**A. JWT Token (in Authorization header):**

```typescript
// From api.ts
if (this.token) {
  headers['Authorization'] = `Bearer ${this.token}`;
}
```

**B. Query Parameter (for admin tenant selection):**

```typescript
// Example from a hook
const params = new URLSearchParams();
if (selectedTenantId) {
  params.append('tenant_id', selectedTenantId);
}
const url = `/api/loans/stats?${params.toString()}`;
```

---

## Backend Tenant Resolution

### 1. Authentication Middleware (`auth.ts`)

First, the JWT is decoded and user info attached to the request:

```typescript
// Extracts from JWT:
req.userId = decoded.userId;
req.userRole = decoded.role;
req.tenantId = decoded.tenantId;      // From JWT payload
req.tenantSlug = decoded.tenantSlug;
```

### 2. Tenant Context Middleware (`tenantContext.ts`)

This middleware resolves which tenant database to use:

```typescript
export async function attachTenantContext(req: AuthRequest, res: Response, next: NextFunction) {
  // 1. Check for tenant_id query parameter (admin override)
  const queryTenantId = req.query.tenant_id as string | undefined;
  
  // 2. Get tenant from JWT (set by auth middleware)
  const jwtTenantId = req.tenantId || null;
  const userRole = req.userRole || 'user';
  
  // 3. Determine which tenant to use
  const isPlatformStaff = ['super_admin', 'platform_admin', 'support'].includes(userRole);
  let tenantId: string | null = null;
  
  // Platform staff or tenant_admin can use query param to select tenant
  if (queryTenantId && (isPlatformStaff || userRole === 'tenant_admin')) {
    // Verify tenant exists and is active
    const tenantCheck = await managementPool.query(
      `SELECT id FROM coheus_tenants WHERE id = $1 AND status = 'active'`,
      [queryTenantId]
    );
    if (tenantCheck.rows.length > 0) {
      tenantId = queryTenantId;  // Use the selected tenant
    }
  }
  
  // Fall back to JWT tenant if no query param
  if (!tenantId && jwtTenantId) {
    tenantId = jwtTenantId;
  }
  
  // 4. Get database pool for this tenant
  const tenantPool = await tenantDbManager.getTenantPool(tenantId);
  
  // 5. Attach to request for route handlers
  req.tenantContext = {
    tenantId,
    tenantPool,       // PostgreSQL connection pool
    tenantInfo: { id, name, slug, database_name }
  };
  
  next();
}
```

### 3. Tenant Database Manager (`tenantDatabaseManager.ts`)

This manages connection pools for tenant databases:

```typescript
class TenantDatabaseManager {
  private tenantPools: Map<string, CachedPool> = new Map();  // Pool cache
  private maxPoolCacheSize = 50;  // Max pools to cache
  private poolIdleTimeout = 30 * 60 * 1000;  // 30 minutes
  
  async getTenantPool(tenantId: string): Promise<pg.Pool> {
    // Check cache first
    const cached = this.tenantPools.get(tenantId);
    if (cached) {
      // Validate health, return if healthy
      const isHealthy = await this.validatePoolHealth(cached.pool, tenantId);
      if (isHealthy) {
        cached.lastAccessed = Date.now();
        return cached.pool;
      }
    }
    
    // Get tenant config from management DB
    const config = await this.getTenantConfig(tenantId);
    // Returns: { database_host, database_port, database_name, database_user, database_password }
    
    // Create new pool
    const pool = new Pool({
      host: config.database_host,
      port: config.database_port,
      database: config.database_name,  // e.g., "tenant_acme_corp"
      user: config.database_user,
      password: config.database_password,  // Decrypted
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
    
    // Cache and return
    this.tenantPools.set(tenantId, { pool, lastAccessed: Date.now(), ... });
    return pool;
  }
}
```

**Features:**
- Connection pool caching (up to 50 pools)
- Pool health validation with auto-recovery
- Schema enforcement on first connection
- Connection retry logic for transient failures
- Pool eviction for idle/unhealthy connections
- Periodic cleanup of idle pools (every 5 minutes)

### 4. Route Handlers Use Tenant Pool

```typescript
// Example route handler
app.get('/api/loans', async (req, res) => {
  const { tenantPool } = req.tenantContext;  // Already resolved
  
  // Query the correct tenant's database
  const result = await tenantPool.query('SELECT * FROM loans WHERE ...');
  res.json(result.rows);
});
```

---

## Complete Flow Diagram

```
User Login
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/auth/signin { email, password, tenantSlug? }     │
│                                                             │
│  Backend checks:                                            │
│  1. Super admin in management DB?                           │
│  2. Tenant user across tenant DBs?                          │
│                                                             │
│  Returns JWT containing:                                    │
│  { userId, email, role, tenantId, tenantSlug, isSuperAdmin }│
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend stores JWT in localStorage                        │
│  AuthContext stores user info (including tenant_id)         │
│  AdminTenantContext sets selectedTenantId based on role     │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  User navigates to Dashboard                                │
│                                                             │
│  • Tenant Admin: tenant auto-selected (can't change)        │
│  • Platform Admin: can select tenant via TenantSelector UI  │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  API Call: GET /api/loans?tenant_id=xxx                     │
│  Headers: Authorization: Bearer <JWT>                       │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend Middleware Chain:                                  │
│                                                             │
│  1. authenticateToken → extracts tenantId from JWT          │
│  2. attachTenantContext →                                   │
│     • Checks query param tenant_id (for admins)             │
│     • Falls back to JWT tenantId                            │
│     • Looks up tenant in management DB                      │
│     • Gets/creates connection pool for tenant DB            │
│     • Attaches tenantContext to request                     │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Route Handler:                                             │
│  const { tenantPool } = req.tenantContext;                  │
│  const loans = await tenantPool.query('SELECT * FROM ...')  │
│                                                             │
│  Query runs against correct tenant database!                │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Files Reference

### Frontend

| File | Purpose |
|------|---------|
| `src/contexts/AuthContext.tsx` | User authentication state, stores tenant_id from JWT |
| `src/contexts/AdminTenantContext.tsx` | Admin tenant selection state management |
| `src/lib/api.ts` | API client, adds JWT to all requests |
| `src/components/dashboard/TenantSelector.tsx` | UI component for tenant selection |
| `src/hooks/admin/useTenants.ts` | Hook for loading/managing tenants |

### Backend

| File | Purpose |
|------|---------|
| `server/src/middleware/auth.ts` | JWT validation, extracts tenant from token |
| `server/src/middleware/tenantContext.ts` | Resolves tenant, attaches DB pool to request |
| `server/src/config/tenantDatabaseManager.ts` | Manages tenant DB connection pools |
| `server/src/config/managementDatabase.ts` | Management DB connection |
| `server/src/config/tenantDatabaseSchema.ts` | Schema definition for tenant databases |
| `server/src/routes/auth.ts` | Authentication endpoints |
| `server/src/routes/tenants.ts` | Tenant management endpoints |
| `server/src/services/tenantProvisioningService.ts` | Tenant creation/provisioning |

---

## Security Considerations

1. **Data Isolation**: Each tenant has a completely separate database, ensuring no data leakage between tenants.

2. **JWT-based Authentication**: Tenant ID is embedded in the JWT, preventing users from accessing other tenants' data.

3. **Admin Override Validation**: When platform admins use the `tenant_id` query parameter, the backend verifies:
   - The user has admin privileges
   - The tenant exists and is active

4. **Encrypted Credentials**: Database passwords are stored encrypted in the management database and decrypted only when creating connections.

5. **Connection Pool Isolation**: Each tenant gets their own connection pool, preventing connection exhaustion from affecting other tenants.

---

## Adding a New Tenant

1. Create entry in `coheus_tenants` table with database connection info
2. Create the tenant's database with the required schema
3. Tenant is immediately available for authentication and data access

The `tenantProvisioningService.ts` handles automated tenant provisioning including:
- Creating the database
- Applying the schema
- Setting up initial data
