# Admin Panel Architecture

This document details the admin panel architecture for Cohi, supporting two distinct user experiences: TVMA internal administrators and client tenant administrators.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [User Roles](#user-roles)
- [Section Access Matrix](#section-access-matrix)
- [Internal Admin (TVMA)](#internal-admin-tvma)
- [Client Admin (Tenant Admin)](#client-admin-tenant-admin)
- [Future Separation Strategy](#future-separation-strategy)
- [Implementation Notes](#implementation-notes)

---

## Overview

The Cohi admin panel serves two distinct audiences from a single `/admin` route, with role-based section filtering:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ADMIN PANEL ARCHITECTURE                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────────┐
                              │      /admin Route       │
                              │                         │
                              │   Role Detection at     │
                              │   Page Load             │
                              └───────────┬─────────────┘
                                          │
                    ┌─────────────────────┴─────────────────────┐
                    │                                           │
                    ▼                                           ▼
        ┌───────────────────────┐               ┌───────────────────────┐
        │   SUPER_ADMIN View    │               │  TENANT_ADMIN View    │
        │   (TVMA Internal)     │               │  (Client Admin)       │
        │                       │               │                       │
        │   14 Sections:        │               │   6 Sections:         │
        │   - Overview          │               │   - Overview          │
        │   - Tenants           │               │   - Users             │
        │   - Users             │               │   - Roles & Perms     │
        │   - LOS Settings      │               │   - LOS Field Mapping │
        │   - Synapse Connect   │               │   - SSO Config        │
        │   - RAG & Voice       │               │   - Org Settings      │
        │   - Demo Data         │               │                       │
        │   - System            │               │                       │
        │   - Security          │               │                       │
        │   - SOC 2 Compliance  │               │                       │
        │   - Deployment        │               │                       │
        │   - Stripe Payments   │               │                       │
        │   - AWS Hosting       │               │                       │
        │   - Metrics Catalog   │               │                       │
        └───────────────────────┘               └───────────────────────┘
```

### Design Principles

1. **Single Codebase** - Both admin experiences share the same React application
2. **Backend Enforcement** - All access control is enforced at the API layer via RBAC middleware
3. **Progressive Enhancement** - Start with same app, architect for future separation
4. **Tenant Isolation** - Tenant admins can only access their own organization's data

---

## User Roles

### Platform Roles

| Role | Description | Access Level |
|------|-------------|--------------|
| `super_admin` | TVMA internal administrator | Full platform access, all tenants |
| `admin` | Legacy role, mapped to `super_admin` | Same as super_admin |
| `tenant_admin` | Client organization administrator | Full access to own tenant only |
| `loan_officer` | Loan originator within tenant | Access to own loans (RLS) |
| `processor` | Loan processor within tenant | Access to assigned loans (RLS) |
| `viewer` | Read-only user | Scoped read access (RLS) |
| `user` | Basic user | Minimal access |

### Role Hierarchy

```
super_admin
    │
    └── Can manage ALL tenants, users, system config
    
tenant_admin
    │
    └── Can manage OWN tenant's users, roles, settings
        │
        ├── loan_officer (tenant-scoped)
        ├── processor (tenant-scoped)
        ├── viewer (tenant-scoped)
        └── user (tenant-scoped)
```

---

## Section Access Matrix

### Current Sections (Pre-Refactor)

| Section | ID | super_admin | tenant_admin | Notes |
|---------|-----|-------------|--------------|-------|
| Overview | `overview` | ✅ Platform-wide | ✅ Org-only | Different data scope |
| Tenants | `tenants` | ✅ | ❌ | Internal only |
| Users | `users` | ✅ All users | ✅ Org users | Scoped by tenant |
| LOS Settings | `los` | ✅ Full control | ⚠️ Limited | Field mapping only |
| Synapse Connect | `synapse` | ✅ | ❌ | Internal only |
| RAG & Voice | `rag-voice` | ✅ | ❌ | Internal only |
| Demo Data | `demo` | ✅ | ❌ | Internal only |
| System | `system` | ✅ | ❌ | Internal only |
| Security | `security` | ✅ | ❌ | Internal only |
| SOC 2 Compliance | `soc2` | ✅ | ❌ | Internal only |
| Deployment | `deployment` | ✅ | ❌ | Internal only |
| Stripe Payments | `stripe` | ✅ | ❌ | Internal only |
| AWS Hosting | `aws-hosting` | ✅ | ❌ | Internal only |
| Metrics Catalog | `metrics-catalog` | ✅ | ❌ | Internal only |

### New Sections (Post-Refactor)

| Section | ID | super_admin | tenant_admin | Notes |
|---------|-----|-------------|--------------|-------|
| Roles & Permissions | `roles-permissions` | ❌ | ✅ | Tenant-scoped RLS config |
| LOS Field Mapping | `los-mapping` | ❌ | ✅ | Subset of LOS Settings |
| SSO Configuration | `sso-config` | ✅ | ✅ | Different capabilities |
| Organization Settings | `org-settings` | ❌ | ✅ | Tenant profile/prefs |

---

## Internal Admin (TVMA)

### Overview Section (Platform-Wide)

Displays aggregated platform statistics:

- Total tenants (active/inactive)
- Total users across all tenants
- Total loans across all tenants
- LOS connection health (all connections)
- Recent activity (new tenants, new users)
- Cost summary (voice, LLM, embedding, AWS)
- Subscription metrics

### Tenants Section

Full tenant lifecycle management:

- List all tenants with status
- Create new tenant (provisions database)
- Edit tenant details
- View tenant metrics (loans, users, connections)
- Deactivate/reactivate tenant
- Delete tenant (with data retention policy)

### Users Section (All Users)

Cross-tenant user management:

- List all users with tenant association
- Create users for any tenant
- Assign platform roles (super_admin, tenant_admin, etc.)
- Reset passwords
- View user activity/audit logs

### LOS Settings (Full Control)

Complete LOS connection management:

- List all connections across all tenants
- Create new LOS connections
- Configure connection credentials
- Test connections
- Trigger syncs (full, incremental, test)
- Delete connections
- Access field mapping for any connection

### Additional Internal Sections

| Section | Key Capabilities |
|---------|------------------|
| **Synapse Connect** | Vendor API integrations, catalog management |
| **RAG & Voice** | Cohi settings, topics, rules, API keys, costs |
| **Demo Data** | Upload anonymized test data for demos |
| **System** | Server config, environment, feature flags |
| **Security** | Auth stats, failed logins, API keys, audit |
| **SOC 2 Compliance** | Audit trail, compliance monitoring, reports |
| **Deployment** | Instance management, failover, sync events |
| **Stripe Payments** | Subscription plans, billing, revenue metrics |
| **AWS Hosting** | Per-tenant AWS hosting, cost allocation |
| **Metrics Catalog** | Browse/test all available metrics |

---

## Client Admin (Tenant Admin)

### Overview Section (Organization-Only)

Displays organization-specific statistics:

- Total users in organization
- Total loans in organization
- LOS connection status (their connections only)
- Recent activity within organization
- Subscription status (their plan)

### Users Section (Organization Users)

Manage users within their organization:

- List users in their tenant only
- Invite new users (creates with tenant association)
- Assign tenant-scoped roles (loan_officer, processor, viewer)
- Cannot assign super_admin or tenant_admin to others
- Reset passwords for their users
- Deactivate users

### Roles & Permissions Section (NEW)

Custom role and row-level security management:

- Create custom roles within their organization
- Define field-based access filters per role
- Assign roles to users
- Preview effective permissions

See [ROW_LEVEL_SECURITY.md](../security/ROW_LEVEL_SECURITY.md) for detailed specification.

### LOS Field Mapping Section (NEW)

Limited LOS configuration access:

- View existing LOS connections (read-only connection details)
- Edit field mappings (swap Encompass field IDs)
- View field population statistics
- Cannot create/delete connections
- Cannot modify connection credentials

### SSO Configuration Section (NEW)

Organization SSO setup:

- View current SSO status (enabled/disabled, provider)
- Upload IdP metadata (SAML)
- Configure attribute mapping
- Test SSO connection
- View SSO audit logs

See [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) for detailed specification.

### Organization Settings Section (NEW)

Basic organization profile management:

- Organization name and display settings
- Logo upload
- Default timezone
- Contact information
- Notification preferences

---

## Future Separation Strategy

The current architecture supports future separation into distinct applications:

### Phase 1: Current (Same App)

```
app.cohi.io
├── /admin (role-filtered)
├── /insights
├── /loans
└── /...
```

### Phase 2: Future (Separated)

```
app.cohi.io (Public)              admin.cohi.io (Internal)
├── /settings (tenant_admin)      ├── /admin (super_admin only)
├── /insights                     └── IP/VPN restricted
├── /loans
└── /...
```

### Separation Checklist

When ready to separate:

1. **Extract internal components** - Move TVMA-only sections to separate build
2. **Create separate entry point** - New React app with internal-only routes
3. **Configure infrastructure** - Separate CloudFront distribution
4. **Add network restrictions** - IP whitelist or VPN requirement
5. **Update CI/CD** - Separate deployment pipelines
6. **Shared component library** - Extract common UI components to npm package

### Code Organization for Future Separation

```
src/
├── components/
│   ├── admin/
│   │   ├── internal/           # TVMA-only components
│   │   │   ├── TenantsSection.tsx
│   │   │   ├── SystemSection.tsx
│   │   │   └── ...
│   │   ├── client/             # Tenant admin components
│   │   │   ├── RolesPermissionsSection.tsx
│   │   │   ├── OrganizationSettingsSection.tsx
│   │   │   └── ...
│   │   └── shared/             # Shared admin components
│   │       ├── AdminLayout.tsx
│   │       ├── UserManagementSection.tsx
│   │       └── ...
│   └── ...
└── ...
```

---

## Implementation Notes

### Role Detection

```typescript
// Pseudocode for role-based section filtering
const useAdminSections = () => {
  const { user } = useAuth();
  
  const allSections = [...]; // All 14+ sections
  
  const visibleSections = useMemo(() => {
    if (user.role === 'super_admin') {
      return allSections.filter(s => SUPER_ADMIN_SECTIONS.includes(s.id));
    }
    if (user.role === 'tenant_admin') {
      return allSections.filter(s => TENANT_ADMIN_SECTIONS.includes(s.id));
    }
    return []; // No admin access
  }, [user.role]);
  
  return visibleSections;
};
```

### API Endpoint Protection

All admin endpoints must enforce RBAC:

```typescript
// Example: Tenants endpoint (super_admin only)
router.get('/tenants', 
  authenticateToken, 
  requireRole('super_admin'), 
  async (req, res) => { ... }
);

// Example: Users endpoint (scoped by role)
router.get('/users', 
  authenticateToken, 
  requireRole('super_admin', 'tenant_admin'),
  enforceTenantIsolation(), // Limits tenant_admin to own tenant
  async (req, res) => { ... }
);
```

### Component Reuse

Some sections have different capabilities based on role:

```typescript
// Example: LOS Settings with role-based features
<LOSSettingsSection
  losConnections={losConnections}
  readOnly={userRole === 'tenant_admin'} // Limits to field mapping only
  showConnectionManagement={userRole === 'super_admin'}
  showAllTenants={userRole === 'super_admin'}
  tenantId={userRole === 'tenant_admin' ? currentTenantId : selectedTenantId}
/>
```

---

## Related Documentation

- [ROW_LEVEL_SECURITY.md](../security/ROW_LEVEL_SECURITY.md) - Field-based access control
- [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) - SSO configuration
- [AUTH_REFACTOR.md](../security/AUTH_REFACTOR.md) - Authentication architecture
- [STATE_MANAGEMENT.md](../security/STATE_MANAGEMENT.md) - Frontend state patterns
