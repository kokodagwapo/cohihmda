# User Management

This document describes the user management system for Cohi, including user types, roles, authentication methods, Encompass integration, and permission scoping.

## Table of Contents

- [Overview](#overview)
- [User Types](#user-types)
- [Role System](#role-system)
- [Authentication Methods](#authentication-methods)
- [Encompass User Integration](#encompass-user-integration)
- [Loan Access Scoping](#loan-access-scoping)
- [User Impersonation](#user-impersonation)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)

---

## Overview

Cohi uses a two-tier user management system:

1. **Management Users** - Platform administrators stored in the central management database
2. **Tenant Users** - Client organization users stored in per-tenant databases

This architecture provides complete tenant isolation while allowing platform-wide administration.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          COHI USER MANAGEMENT                                    │
└─────────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────┐
                    │    Management Database      │
                    │    (coheus_management)      │
                    │                             │
                    │  ┌───────────────────────┐  │
                    │  │    coheus_users       │  │
                    │  │  - Super Admins       │  │
                    │  │  - Platform Admins    │  │
                    │  │  - Support Staff      │  │
                    │  └───────────────────────┘  │
                    └─────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
        ┌─────────────────────┐     ┌─────────────────────┐
        │  Tenant A Database  │     │  Tenant B Database  │
        │                     │     │                     │
        │  ┌───────────────┐  │     │  ┌───────────────┐  │
        │  │    users      │  │     │  │    users      │  │
        │  │ - Admins      │  │     │  │ - Admins      │  │
        │  │ - LOs         │  │     │  │ - LOs         │  │
        │  │ - Processors  │  │     │  │ - Processors  │  │
        │  └───────────────┘  │     │  └───────────────┘  │
        └─────────────────────┘     └─────────────────────┘
```

---

## User Types

### Management Users (Super Admins)

Stored in: `coheus_management.coheus_users`

| Role             | Description                                  | Access Level                  |
| ---------------- | -------------------------------------------- | ----------------------------- |
| `super_admin`    | Full platform access, can manage all tenants | All tenants, all features     |
| `platform_admin` | Manages tenants and users                    | All tenants, limited settings |
| `support`        | Read-only access for troubleshooting         | View-only across tenants      |

### Tenant Users

Stored in: Each tenant's `users` table (no `tenant_id` column - isolated by database)

| Role           | Description               | Default Access                          |
| -------------- | ------------------------- | --------------------------------------- |
| `tenant_admin` | Full access within tenant | All data, all features, user management |
| `admin`        | Administrative access     | All data, most features                 |
| `loan_officer` | Access to assigned loans  | Own loans, limited metrics              |
| `processor`    | Access to assigned loans  | Assigned loans, processing features     |
| `user`         | Standard access           | Based on role assignment                |
| `viewer`       | Read-only access          | Insights only                           |

---

## Role System

Cohi uses a flexible RBAC (Role-Based Access Control) system with two layers:

### 1. System Roles

Built-in roles defined in the `role` column of the users table:

- `tenant_admin`, `admin`, `loan_officer`, `processor`, `user`, `viewer`

### 2. Custom Roles (Tenant-Specific)

Defined in `tenant_roles` table with:

- **Section Access** - Which parts of the app the role can access
- **Field Restrictions** - Which data fields are hidden from the role
- **Row Filters** - Dynamic filters based on user attributes (e.g., branch)

#### Available Sections

| Section        | Description               |
| -------------- | ------------------------- |
| `insights`     | Dashboard and KPI metrics |
| `loans`        | Loan pipeline and details |
| `leaderboard`  | Performance rankings      |
| `funnel`       | Loan funnel analysis      |
| `reports`      | Report generation         |
| `data_quality` | Data quality monitoring   |
| `data_chat`    | AI-powered data chat      |
| `users`        | User management           |
| `settings`     | Tenant settings           |

#### Example Role Configuration

```sql
-- Loan Officer role with restricted access
INSERT INTO tenant_roles (name, description, section_access, permissions)
VALUES (
  'Loan Officer',
  'Access to own loans only',
  ARRAY['insights', 'loans', 'funnel', 'data_chat'],
  '{"fieldRestrictions": ["branch_price_concession", "net_buy", "net_sell"]}'
);
```

---

## Authentication Methods

Cohi supports multiple authentication methods operating in **hybrid mode**:

### 1. Email/Password (Local Auth)

- Default for all users
- Passwords hashed with bcrypt
- Rate limiting and account lockout
- Password reset via email (SES)

### 2. Cognito SSO

- SAML/OIDC federation via AWS Cognito
- Per-tenant IdP configuration
- Just-in-time (JIT) user provisioning
- Attribute mapping from IdP claims

### 3. Coheus Bridge (Legacy)

- SSO via existing Qlik Sense session
- For existing Coheus/Qlik clients
- Zero IdP reconfiguration required

### Authentication Modes

| Mode            | Description                           | Email/Password   | SSO            |
| --------------- | ------------------------------------- | ---------------- | -------------- |
| `hybrid`        | Both methods available                | Yes              | Yes            |
| `sso_preferred` | SSO primary, password for break-glass | Admin only       | Yes (primary)  |
| `sso_only`      | SSO required                          | Break-glass only | Yes (required) |

Configuration stored in `coheus_tenants.auth_config`:

```json
{
  "mode": "hybrid",
  "allow_email_password": true,
  "allow_sso": true,
  "sso_required_for_roles": [],
  "break_glass_enabled": true
}
```

---

## Encompass User Integration

Cohi integrates with Encompass to sync users and scope permissions based on loan access.

### How It Works

1. **Sync Encompass Users** - Admin triggers sync via UI or API
2. **Cache Users** - Users stored in `encompass_users` table
3. **Invite to Cohi** - Admin invites users, linking Encompass ID
4. **Scope Permissions** - Loan queries filtered by `loan_officer_id`

### Encompass User Sync

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Encompass     │     │   Cohi Backend  │     │   Tenant DB     │
│   v1 API        │     │                 │     │                 │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  GET /v1/company/users                        │
         │◄──────────────────────│                       │
         │                       │                       │
         │  [user list]          │                       │
         │──────────────────────►│                       │
         │                       │                       │
         │                       │  UPSERT encompass_users
         │                       │──────────────────────►│
         │                       │                       │
         │                       │  Admin invites user   │
         │                       │──────────────────────►│
         │                       │  (creates user with   │
         │                       │   encompass_user_id)  │
```

### User-Loan Mapping

When a user has `encompass_user_id` set, their loan access is automatically scoped:

```sql
-- Automatic loan filter for loan officers
SELECT * FROM loans
WHERE loan_officer_id = (
  SELECT encompass_user_id FROM users WHERE id = $current_user_id
);
```

### API Endpoints

| Endpoint                              | Method | Description                 |
| ------------------------------------- | ------ | --------------------------- |
| `/api/admin/encompass-users`          | GET    | List cached Encompass users |
| `/api/admin/encompass-users/sync`     | POST   | Trigger sync from Encompass |
| `/api/admin/users/:id/link-encompass` | POST   | Link user to Encompass ID   |

---

## Loan Access Scoping

Loan access is determined by a combination of:

1. **User Role** - Admins see all, loan officers see assigned
2. **Encompass User ID** - Matches `loan_officer_id` in loans table
3. **Custom Role Filters** - Dynamic filters based on user attributes

### Access Matrix

| Role           | Loan Access                        | Metric Access   |
| -------------- | ---------------------------------- | --------------- |
| `tenant_admin` | All loans                          | All metrics     |
| `admin`        | All loans                          | All metrics     |
| `loan_officer` | Own loans (by `encompass_user_id`) | Own metrics     |
| `processor`    | Assigned loans                     | Limited metrics |
| `viewer`       | None (insights only)               | Aggregate only  |

### Implementation

Loan queries automatically apply access filters:

```typescript
// Server-side access filter
async function getUserLoanAccessFilter(
  userId: string,
  pool: Pool,
): Promise<string | null> {
  const user = await pool.query(
    "SELECT role, encompass_user_id FROM users WHERE id = $1",
    [userId],
  );

  if (["tenant_admin", "admin"].includes(user.rows[0].role)) {
    return null; // No filter - full access
  }

  if (user.rows[0].encompass_user_id) {
    return `loan_officer_id = '${user.rows[0].encompass_user_id}'`;
  }

  return "FALSE"; // No access if no encompass_user_id
}
```

---

## User Impersonation

Super admins can impersonate tenant users for testing and support.

### How It Works

1. Super admin selects user to impersonate
2. System generates time-limited impersonation token (1 hour max)
3. All actions logged with `impersonatedBy` field
4. Super admin can end impersonation at any time

### Security Controls

- Only `super_admin` role can impersonate
- Token expires after 1 hour
- All actions during impersonation are audit logged
- Original admin ID preserved in JWT (`impersonatedBy`)
- Cannot impersonate other super admins

### API Endpoints

| Endpoint                      | Method | Description         |
| ----------------------------- | ------ | ------------------- |
| `/api/auth/impersonate`       | POST   | Start impersonation |
| `/api/auth/end-impersonation` | POST   | End impersonation   |

### Audit Log Entry

```json
{
  "action": "impersonation_start",
  "userId": "target-user-id",
  "impersonatedBy": "super-admin-id",
  "tenantId": "tenant-id",
  "timestamp": "2026-01-30T12:00:00Z",
  "expiresAt": "2026-01-30T13:00:00Z"
}
```

---

## Database Schema

### Management Database (`coheus_management`)

```sql
-- Super admins and platform users
CREATE TABLE coheus_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  encrypted_password TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'platform_admin', 'support')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  mfa_enabled BOOLEAN DEFAULT false,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auth configuration per tenant
ALTER TABLE coheus_tenants ADD COLUMN auth_config JSONB DEFAULT '{
  "mode": "hybrid",
  "allow_email_password": true,
  "allow_sso": true
}';
```

### Tenant Database

```sql
-- Tenant users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  encrypted_password TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT true,
  encompass_user_id TEXT,           -- Link to Encompass
  los_connection_id UUID,           -- Which LOS connection
  last_login_at TIMESTAMPTZ,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cached Encompass users
CREATE TABLE encompass_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID REFERENCES los_connections(id),
  encompass_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  user_indicators TEXT[],
  is_enabled BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(los_connection_id, encompass_user_id)
);

-- SSO configuration
CREATE TABLE sso_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  cognito_idp_name TEXT,
  attribute_mapping JSONB DEFAULT '{}',
  email_domains TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Reference

### Authentication

| Endpoint                           | Method | Auth        | Description            |
| ---------------------------------- | ------ | ----------- | ---------------------- |
| `/api/auth/signin`                 | POST   | None        | Email/password login   |
| `/api/auth/signout`                | POST   | JWT         | Logout                 |
| `/api/auth/me`                     | GET    | JWT         | Get current user       |
| `/api/auth/password-reset/request` | POST   | None        | Request reset email    |
| `/api/auth/password-reset/confirm` | POST   | None        | Confirm reset          |
| `/api/auth/cognito/authorize`      | GET    | None        | Start Cognito SSO flow |
| `/api/auth/cognito/callback`       | GET    | None        | Cognito callback       |
| `/api/auth/impersonate`            | POST   | Super Admin | Start impersonation    |
| `/api/auth/end-impersonation`      | POST   | JWT         | End impersonation      |

### User Management

| Endpoint                               | Method | Auth           | Description        |
| -------------------------------------- | ------ | -------------- | ------------------ |
| `/api/admin/super-admins`              | GET    | Platform Admin | List super admins  |
| `/api/admin/super-admins`              | POST   | Super Admin    | Create super admin |
| `/api/admin/tenants/:id/users`         | GET    | Admin          | List tenant users  |
| `/api/admin/tenants/:id/users`         | POST   | Admin          | Create tenant user |
| `/api/admin/tenants/:id/users/:userId` | PUT    | Admin          | Update user        |
| `/api/admin/tenants/:id/users/:userId` | DELETE | Admin          | Delete user        |

### Encompass Integration

| Endpoint                              | Method | Auth  | Description          |
| ------------------------------------- | ------ | ----- | -------------------- |
| `/api/admin/encompass-users`          | GET    | Admin | List Encompass users |
| `/api/admin/encompass-users/sync`     | POST   | Admin | Sync from Encompass  |
| `/api/admin/users/:id/link-encompass` | POST   | Admin | Link to Encompass    |

### SSO Configuration

| Endpoint                               | Method | Auth  | Description                   |
| -------------------------------------- | ------ | ----- | ----------------------------- |
| `/api/sso/config`                      | GET    | Admin | Get SSO config                |
| `/api/sso/config`                      | PUT    | Admin | Update SSO config             |
| `/api/admin/tenants/:id/auth-config`   | GET    | Admin | Get auth mode                 |
| `/api/admin/tenants/:id/auth-config`   | PUT    | Admin | Set auth mode                 |
| `/api/admin/tenants/:id/sso-readiness` | GET    | Admin | Check SSO migration readiness |

---

## Related Documentation

- [SSO_AUTHENTICATION.md](./SSO_AUTHENTICATION.md) - SSO architecture and configuration
- [SSO_MIGRATION_GUIDE.md](./SSO_MIGRATION_GUIDE.md) - Migrating from hybrid to SSO-only
- [ROW_LEVEL_SECURITY.md](./ROW_LEVEL_SECURITY.md) - Custom field-based access control
- [../admin/ENCOMPASS_USER_SYNC.md](../admin/ENCOMPASS_USER_SYNC.md) - Encompass user sync guide
