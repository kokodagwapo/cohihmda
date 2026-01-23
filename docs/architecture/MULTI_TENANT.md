# Multi-Tenant SaaS Architecture

This document details the multi-tenant architecture for Cohi SaaS deployment, including database isolation, tenant routing, and scaling strategies.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [Database Architecture](#database-architecture)
- [Tenant Routing](#tenant-routing)
- [Connection Management](#connection-management)
- [Data Isolation](#data-isolation)
- [Scaling Strategy](#scaling-strategy)
- [Cost Optimization](#cost-optimization)
- [Implementation Details](#implementation-details)

---

## Overview

The multi-tenant architecture uses a **database-per-tenant** isolation model with Aurora Serverless v2 clusters to balance strong data isolation with cost efficiency.

### Key Principles

1. **Complete Data Isolation** - Each tenant's data resides in a separate PostgreSQL database
2. **Shared Compute** - Application servers are shared across tenants (more cost-effective)
3. **Tenant Clustering** - Multiple tenant databases share an Aurora cluster (storage layer efficiency)
4. **Dynamic Routing** - Middleware routes requests to the correct tenant database at runtime

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MULTI-TENANT SaaS ARCHITECTURE                       │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────┐
                              │  CloudFront │
                              │    + WAF    │
                              └──────┬──────┘
                                     │
                              ┌──────▼──────┐
                              │     ALB     │
                              └──────┬──────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
       ┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
       │ ECS Task 1  │       │ ECS Task 2  │       │ ECS Task N  │
       │  (Backend)  │       │  (Backend)  │       │  (Backend)  │
       └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
              │                      │                      │
              └──────────────────────┼──────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
             ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
             │ Management  │  │ Aurora      │  │ ElastiCache │
             │  Database   │  │ Clusters    │  │   Redis     │
             │ (Aurora)    │  │ (Tenants)   │  │             │
             └─────────────┘  └─────────────┘  └─────────────┘
```

---

## Database Architecture

### Three-Tier Database Model

| Tier | Database | Purpose |
|------|----------|---------|
| **Management** | `cohi_management` | Tenant registry, user mappings, cluster assignments |
| **Default** | `cohi` | Shared user authentication, audit logs, system configs |
| **Tenant** | `tenant_{id}` | Tenant-specific loan data, analytics, configurations |

### Management Database Schema

```sql
-- Tenant Registry
CREATE TABLE cohi_tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    
    -- Database Configuration
    database_name TEXT NOT NULL,
    database_host TEXT NOT NULL,          -- Aurora cluster endpoint
    database_port INTEGER DEFAULT 5432,
    database_user TEXT NOT NULL,
    database_password_encrypted TEXT NOT NULL,
    
    -- Cluster Assignment
    cluster_id TEXT NOT NULL,             -- Which Aurora cluster
    cluster_endpoint TEXT NOT NULL,       -- Cluster writer endpoint
    
    -- Status
    status TEXT DEFAULT 'active',         -- active, suspended, provisioning, deleted
    deployment_type TEXT NOT NULL,        -- cloud, on_premise, per_lender_aws
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User-Tenant Mappings
CREATE TABLE user_tenant_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    tenant_id UUID NOT NULL REFERENCES cohi_tenants(id),
    role TEXT DEFAULT 'user',
    is_primary BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, tenant_id)
);

-- Cluster Registry
CREATE TABLE tenant_clusters (
    id TEXT PRIMARY KEY,                  -- e.g., 'cluster-001'
    name TEXT NOT NULL,
    writer_endpoint TEXT NOT NULL,
    reader_endpoint TEXT,
    current_tenant_count INTEGER DEFAULT 0,
    max_tenants INTEGER DEFAULT 25,
    min_acu DECIMAL DEFAULT 0.5,
    max_acu DECIMAL DEFAULT 8,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Tenant Database Schema

Each tenant database contains:

```sql
-- Loan Data (296 columns)
CREATE TABLE public.loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id TEXT,
    loan_number TEXT,
    loan_amount DECIMAL,
    loan_type TEXT,
    current_loan_status TEXT,
    
    -- Dates
    started_date DATE,
    application_date DATE,
    lock_date DATE,
    closing_date DATE,
    funding_date DATE,
    
    -- Personnel
    loan_officer TEXT,
    processor TEXT,
    underwriter TEXT,
    closer TEXT,
    branch TEXT,
    
    -- ... 100+ additional columns matching Qlik Logic Dictionary
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_loans_status ON public.loans(current_loan_status);
CREATE INDEX idx_loans_officer ON public.loans(loan_officer);
CREATE INDEX idx_loans_started ON public.loans(started_date);
CREATE INDEX idx_loans_branch ON public.loans(branch);
```

---

## Tenant Routing

### Request Flow

```
1. Request arrives with JWT token
                │
                ▼
2. authenticateToken middleware
   - Validates JWT signature
   - Extracts userId from token
   - Attaches userId to request
                │
                ▼
3. attachTenantContext middleware
   - Checks for ?tenant_id query param (admin override)
   - Looks up user's tenant in management DB
   - Gets cluster endpoint for tenant
   - Creates/retrieves connection pool
   - Attaches tenantContext to request
                │
                ▼
4. Route Handler
   - Uses req.tenantContext.tenantPool for queries
   - All queries execute against tenant's database
```

### Tenant Context Middleware

**File:** `server/src/middleware/tenantContext.ts`

```typescript
export interface TenantContext {
  tenantId: string;
  tenantPool: pg.Pool;
  tenantInfo: {
    id: string;
    name: string;
    slug: string;
    database_name: string;
  };
}

export async function attachTenantContext(req, res, next) {
  // 1. Check for admin tenant override
  const queryTenantId = req.query.tenant_id;
  
  // 2. Get user role
  const userRole = await getUserRole(req.userId);
  
  // 3. Determine tenant ID
  let tenantId;
  if (queryTenantId && isAdmin(userRole)) {
    tenantId = queryTenantId;  // Admin can select any tenant
  } else {
    tenantId = await getUserTenant(req.userId);  // User's assigned tenant
  }
  
  // 4. Get tenant database pool
  const tenantPool = await tenantDbManager.getTenantPool(tenantId);
  
  // 5. Attach to request
  req.tenantContext = {
    tenantId,
    tenantPool,
    tenantInfo: await getTenantInfo(tenantId)
  };
  
  next();
}
```

### Admin Tenant Selection

Admins (super_admin, tenant_admin) can query any tenant's data using query parameters:

```
GET /api/loans?tenant_id=4ea27f49-7863-40a5-bd72-0f76cfd19e0b
GET /api/dashboard/insights?tenant_id=xxx&dateFilter=mtd
```

---

## Connection Management

### Tenant Database Manager

**File:** `server/src/config/tenantDatabaseManager.ts`

The TenantDatabaseManager maintains a cache of connection pools for active tenants:

```typescript
class TenantDatabaseManager {
  private poolCache: Map<string, pg.Pool>;
  private maxPoolCacheSize = 50;
  private poolIdleTimeout = 30 * 60 * 1000; // 30 minutes
  
  async getTenantPool(tenantId: string): Promise<pg.Pool> {
    // Check cache
    if (this.poolCache.has(tenantId)) {
      return this.poolCache.get(tenantId);
    }
    
    // Get tenant config from management DB
    const config = await this.getTenantConfig(tenantId);
    
    // Create new pool
    const pool = new pg.Pool({
      host: config.cluster_endpoint,
      port: config.database_port,
      database: config.database_name,
      user: config.database_user,
      password: decrypt(config.database_password_encrypted),
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
    
    // Cache and return
    this.poolCache.set(tenantId, pool);
    return pool;
  }
  
  // Cleanup idle pools
  private cleanupIdlePools() {
    // Remove pools that haven't been used in 30 minutes
  }
}
```

### Connection Pool Settings

| Setting | Value | Rationale |
|---------|-------|-----------|
| `max` | 10 | Per-tenant pool size |
| `idleTimeoutMillis` | 30000 | Close idle connections after 30s |
| `connectionTimeoutMillis` | 5000 | Fail fast on connection issues |
| Pool Cache Size | 50 | Max tenants with active pools |
| Pool Cache TTL | 30 min | Evict unused tenant pools |

---

## Data Isolation

### Isolation Guarantees

| Layer | Mechanism | Enforcement |
|-------|-----------|-------------|
| **Application** | Tenant context middleware | Request-level |
| **Database** | Separate databases per tenant | Infrastructure-level |
| **Network** | VPC security groups | AWS-level |
| **Encryption** | TLS in transit, KMS at rest | AWS-level |

### Security Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        VPC Security Boundary                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐ │
│  │   Tenant A     │    │   Tenant B     │    │   Tenant C     │ │
│  │   Database     │    │   Database     │    │   Database     │ │
│  │                │    │                │    │                │ │
│  │  ┌──────────┐  │    │  ┌──────────┐  │    │  ┌──────────┐  │ │
│  │  │  loans   │  │    │  │  loans   │  │    │  │  loans   │  │ │
│  │  │  table   │  │    │  │  table   │  │    │  │  table   │  │ │
│  │  └──────────┘  │    │  └──────────┘  │    │  └──────────┘  │ │
│  │                │    │                │    │                │ │
│  └────────────────┘    └────────────────┘    └────────────────┘ │
│                                                                  │
│  ═══════════════════════════════════════════════════════════════ │
│                    Aurora Cluster Storage Layer                  │
│                    (Shared, but logically isolated)              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Cross-Tenant Access Prevention

1. **Middleware Enforcement**: Tenant context middleware validates tenant access before every request
2. **No Shared Queries**: Application never joins across tenant databases
3. **Audit Logging**: All data access is logged with tenant context
4. **Admin Override Logging**: When admins access other tenants, it's logged for SOC 2 compliance

---

## Scaling Strategy

### Horizontal Scaling (Compute)

| Component | Scaling Trigger | Min | Max |
|-----------|----------------|-----|-----|
| ECS Tasks | CPU > 70% or Memory > 80% | 2 | 20 |
| ALB | Auto-scales with traffic | - | - |
| CloudFront | Global edge caching | - | - |

### Database Scaling (Aurora Serverless v2)

| Metric | Scale Up | Scale Down |
|--------|----------|------------|
| ACU | CPU > 70% | CPU < 30% for 15 min |
| Range | 0.5 ACU (idle) | 8 ACU (peak) per cluster |
| Time | Seconds | Minutes |

### Tenant Cluster Strategy

```
Cluster Allocation:
┌─────────────────────────────────────────────────────────────────┐
│ Cluster 1: 25 tenants (0.5-8 ACU)                               │
│ ├─ tenant_001, tenant_002, ... tenant_025                       │
│                                                                  │
│ Cluster 2: 25 tenants (0.5-8 ACU)                               │
│ ├─ tenant_026, tenant_027, ... tenant_050                       │
│                                                                  │
│ Cluster N: Up to 25 tenants (0.5-8 ACU)                         │
│ ├─ tenant_051, ...                                              │
└─────────────────────────────────────────────────────────────────┘

New Tenant Allocation Algorithm:
1. Find cluster with capacity (current_tenant_count < max_tenants)
2. If no cluster has capacity, provision new cluster
3. Create tenant database in selected cluster
4. Update tenant record with cluster assignment
```

---

## Cost Optimization

### Aurora Serverless v2 vs RDS Comparison

| Tenants | RDS (db.t3.micro each) | Aurora Serverless v2 |
|---------|------------------------|----------------------|
| 10 | ~$150/mo | ~$86/mo (1 cluster) |
| 25 | ~$375/mo | ~$130/mo (1 cluster) |
| 50 | ~$750/mo | ~$260/mo (2 clusters) |
| 100 | ~$1,500/mo | ~$430/mo (4 clusters) |
| 200 | ~$3,000/mo | ~$860/mo (8 clusters) |

### Cost Optimization Techniques

1. **Bursty Workload Scaling**: Aurora scales down to 0.5 ACU during off-hours
2. **Shared Storage**: Tenants in same cluster share storage layer
3. **Connection Pooling**: Reuse connections across requests
4. **Cache Utilization**: Redis caching reduces database load
5. **Reserved Capacity**: Consider reserved instances for predictable baseline

---

## Implementation Details

### Provisioning a New Tenant

```typescript
async function provisionTenant(name: string, adminEmail: string) {
  // 1. Find or create cluster
  const cluster = await findAvailableCluster();
  
  // 2. Create tenant database
  const dbName = `tenant_${generateSlug(name)}`;
  await cluster.createDatabase(dbName);
  
  // 3. Run migrations on new database
  await runMigrations(cluster.endpoint, dbName);
  
  // 4. Register tenant in management DB
  const tenant = await managementPool.query(`
    INSERT INTO cohi_tenants (name, slug, database_name, cluster_id, cluster_endpoint, ...)
    VALUES ($1, $2, $3, $4, $5, ...)
    RETURNING *
  `, [name, generateSlug(name), dbName, cluster.id, cluster.endpoint]);
  
  // 5. Create admin user mapping
  await createUserTenantMapping(adminEmail, tenant.id, 'tenant_admin');
  
  return tenant;
}
```

### Deprovisioning a Tenant

```typescript
async function deprovisionTenant(tenantId: string) {
  // 1. Mark tenant as deleted
  await managementPool.query(`
    UPDATE cohi_tenants SET status = 'deleted', updated_at = NOW()
    WHERE id = $1
  `, [tenantId]);
  
  // 2. Close active connections
  await tenantDbManager.closePool(tenantId);
  
  // 3. Archive database (don't delete immediately)
  // Database deletion happens after retention period
  
  // 4. Remove user mappings
  await managementPool.query(`
    DELETE FROM user_tenant_mappings WHERE tenant_id = $1
  `, [tenantId]);
}
```

---

## Related Documentation

### Architecture
- [OVERVIEW.md](./OVERVIEW.md) - System architecture overview
- [AURORA_CLUSTERS.md](./AURORA_CLUSTERS.md) - Aurora Serverless v2 details
- [ADMIN_PANEL.md](./ADMIN_PANEL.md) - Admin panel architecture and role-based access
- [INTERNAL_ADMIN_REQUIREMENTS.md](./INTERNAL_ADMIN_REQUIREMENTS.md) - TVMA internal admin features
- [CLIENT_ADMIN_REQUIREMENTS.md](./CLIENT_ADMIN_REQUIREMENTS.md) - Client tenant admin features

### Security
- [ROW_LEVEL_SECURITY.md](../security/ROW_LEVEL_SECURITY.md) - Custom field-based access control
- [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) - SSO strategy (Qlik Bridge + Cognito)
- [AUTH_REFACTOR.md](../security/AUTH_REFACTOR.md) - Authentication refactoring plan

### Implementation
- [BACKEND_ARCHITECTURE.md](../BACKEND_ARCHITECTURE.md) - Backend implementation details
