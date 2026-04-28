# Encompass User Sync

This guide explains how to sync users from Encompass into Cohi and configure loan-level access scoping.

## Table of Contents

- [Overview](#overview)
- [Encompass API Reference](#encompass-api-reference)
- [User Sync Process](#user-sync-process)
- [Inviting Users](#inviting-users)
- [Loan Access Mapping](#loan-access-mapping)
- [Admin UI Guide](#admin-ui-guide)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## Overview

Cohi integrates with Encompass to:

1. **Sync Users** - Pull user list from Encompass v1 API
2. **Cache Users** - Store in local database for admin UI
3. **Invite Users** - Allow admins to create Cohi accounts linked to Encompass
4. **Scope Access** - Filter loans based on Encompass user ID

## Scheduled user cache sync

After a successful **Encompass loan sync**, Cohi can automatically refresh the local `encompass_users` cache (enabled by default per LOS connection via `encompass_users_sync_enabled`). This keeps **actor status** fields such as `is_enabled` and Encompass login metadata aligned with loan sync cadence, which downstream features (for example active-actor reporting) rely on.

- User sync runs in a **post-sync hook**; it does **not** block or roll back the loan sync if it fails.
- The hook updates `los_connections.last_encompass_users_sync_at` on success.
- Scheduled runs may be **throttled** with `ENCOMPASS_USER_SYNC_MIN_INTERVAL_HOURS` (hours between scheduled-trigger user syncs; `0` disables throttling). Manual operations are not throttled by this env.

See also: **Sync Management** in the platform admin UI (`/api/admin/sync-management`) for toggles and timezone.

## Business-day scheduling

Per LOS connection (not tenant-wide):

- **`sync_business_days_only`** — When true, the **automatic LOS scheduler** (15-minute cadence) does not **start** loan sync on Saturday/Sunday in `scheduler_timezone`. **Manual sync** from the admin UI or tenant API is **never** blocked by this flag.
- **`insights_business_days_only`** — When true, **post-sync** prediction / agent / tracked insight hooks skip weekends **only** when the loan sync trigger was **`scheduled`**. Manual and webhook-triggered syncs still run those hooks according to `insights_auto_enabled`.
- **`scheduler_timezone`** — IANA zone (default `America/New_York`) used to decide local weekend for the above.

Holiday calendars are **not** included in this story.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       ENCOMPASS USER INTEGRATION FLOW                            │
└─────────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
    │  Encompass  │        │    Cohi     │        │  Cohi Admin │
    │    API      │        │   Backend   │        │     UI      │
    └──────┬──────┘        └──────┬──────┘        └──────┬──────┘
           │                      │                      │
           │  GET /v1/company/users                      │
           │◄─────────────────────│                      │
           │                      │                      │
           │  [user list]         │                      │
           │─────────────────────►│                      │
           │                      │                      │
           │                      │  Cache in            │
           │                      │  encompass_users     │
           │                      │                      │
           │                      │  Display users       │
           │                      │─────────────────────►│
           │                      │                      │
           │                      │  Admin invites user  │
           │                      │◄─────────────────────│
           │                      │                      │
           │                      │  Create Cohi user    │
           │                      │  with encompass_user_id
           │                      │                      │
           │                      │  Loan queries now    │
           │                      │  filtered by         │
           │                      │  loan_officer_id     │
```

---

## Encompass API Reference

### Authentication

Cohi uses the existing LOS connection credentials to authenticate with Encompass:

- **Partner Flow**: Client credentials grant
- **ROPC Flow**: Resource owner password credentials

The token is cached and refreshed automatically.

### Get Users Endpoint (V1 API)

```
GET /encompass/v1/company/users
Authorization: Bearer {access_token}
```

**Query Parameters:**

| Parameter | Type    | Description                          |
| --------- | ------- | ------------------------------------ |
| `limit`   | integer | Max users to return (default: 10000) |

**Response:**

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "userName": "jsmith",
    "firstName": "John",
    "lastName": "Smith",
    "email": "jsmith@lender.com",
    "userIndicators": ["Enabled", "ApiUser", "LOConnect"]
  },
  {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "userName": "jdoe",
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jdoe@lender.com",
    "userIndicators": ["Enabled"]
  }
]
```

### User Indicators

| Indicator   | Description                |
| ----------- | -------------------------- |
| `Enabled`   | User account is active     |
| `Disabled`  | User account is disabled   |
| `ApiUser`   | User can access API        |
| `LOConnect` | User has LO Connect access |
| `WebAccess` | User has web access        |

**Note:** Cohi only imports users with the `Enabled` indicator.

### Rate Limits

- Respect Encompass concurrency limits (20% ISV threshold)
- Use token caching to minimize authentication requests
- Sync users during off-peak hours if possible

---

## User Sync Process

### Automatic Sync

User sync is triggered:

- Manually by admin via UI or API
- Automatically on first admin access to Encompass Users section
- Can be scheduled via cron job (future enhancement)

### Sync Logic

```typescript
async function syncEncompassUsers(tenantId: string, losConnectionId: string) {
  // 1. Fetch users from Encompass
  const encompassUsers = await encompassApi.getEncompassUsers(
    tenantId,
    losConnectionId,
  );

  // 2. Filter to enabled users only
  const enabledUsers = encompassUsers.filter((u) =>
    u.userIndicators?.includes("Enabled"),
  );

  // 3. Upsert into encompass_users table
  for (const user of enabledUsers) {
    await pool.query(
      `
      INSERT INTO encompass_users 
        (los_connection_id, encompass_user_id, username, email, first_name, last_name, user_indicators, is_enabled, last_synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
      ON CONFLICT (los_connection_id, encompass_user_id) 
      DO UPDATE SET 
        username = EXCLUDED.username,
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        user_indicators = EXCLUDED.user_indicators,
        is_enabled = true,
        last_synced_at = NOW()
    `,
      [
        losConnectionId,
        user.id,
        user.userName,
        user.email,
        user.firstName,
        user.lastName,
        user.userIndicators,
      ],
    );
  }

  // 4. Mark users not in response as disabled
  await pool.query(
    `
    UPDATE encompass_users 
    SET is_enabled = false, last_synced_at = NOW()
    WHERE los_connection_id = $1 
    AND encompass_user_id NOT IN (SELECT unnest($2::text[]))
  `,
    [losConnectionId, enabledUsers.map((u) => u.id)],
  );
}
```

### Database Schema

```sql
CREATE TABLE encompass_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID REFERENCES los_connections(id) ON DELETE CASCADE,
  encompass_user_id TEXT NOT NULL,        -- Encompass user GUID
  username TEXT NOT NULL,                  -- Encompass userName
  email TEXT,                              -- User email
  first_name TEXT,                         -- First name
  last_name TEXT,                          -- Last name
  user_indicators TEXT[],                  -- Array of indicators
  is_enabled BOOLEAN DEFAULT true,         -- Active in Encompass
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(los_connection_id, encompass_user_id)
);

CREATE INDEX idx_encompass_users_email ON encompass_users(email);
CREATE INDEX idx_encompass_users_enabled ON encompass_users(is_enabled) WHERE is_enabled = true;
```

---

## Inviting Users

### Invite Flow

1. Admin views Encompass users list
2. Admin clicks "Invite to Cohi" on a user
3. System creates Cohi user with `encompass_user_id` set
4. User receives invite email with setup link
5. User sets password or links SSO identity

### Invite Options

| Option              | Description                         |
| ------------------- | ----------------------------------- |
| **Email Invite**    | Send email with password setup link |
| **SSO Only**        | User must log in via SSO first time |
| **Manual Password** | Admin sets initial password         |

### Bulk Invite

Admins can select multiple Encompass users and invite them all at once:

```typescript
// POST /api/admin/encompass-users/bulk-invite
{
  "encompass_user_ids": ["guid1", "guid2", "guid3"],
  "invite_method": "email",  // or "sso_only" or "manual"
  "default_role": "loan_officer"
}
```

---

## Loan Access Mapping

### How It Works

When a Cohi user has `encompass_user_id` set, their loan access is automatically scoped:

1. **Loan Sync**: Loans include `loan_officer_id` from Encompass
2. **User Query**: When user queries loans, filter is applied
3. **Automatic Filter**: `WHERE loan_officer_id = user.encompass_user_id`

### Loan Officer Field Mapping

The `loan_officer_id` is extracted from Encompass using:

| Encompass Field                             | Description                  |
| ------------------------------------------- | ---------------------------- |
| `Fields.LoanTeamMember.UserID.Loan Officer` | Primary loan officer user ID |
| `Fields.317`                                | Loan officer name (backup)   |

### Access Scoping Rules

| User Role      | `encompass_user_id` Set | Loan Access              |
| -------------- | ----------------------- | ------------------------ |
| `tenant_admin` | Any                     | All loans                |
| `admin`        | Any                     | All loans                |
| `loan_officer` | Yes                     | Own loans only           |
| `loan_officer` | No                      | No loans (misconfigured) |
| `processor`    | Yes                     | Assigned loans           |
| `viewer`       | Any                     | No direct loan access    |

### Implementation

```typescript
// In loan queries
async function applyLoanAccessFilter(
  userId: string,
  pool: Pool,
): Promise<string | null> {
  const user = await pool.query(
    "SELECT role, encompass_user_id FROM users WHERE id = $1",
    [userId],
  );

  const { role, encompass_user_id } = user.rows[0];

  // Admins have full access
  if (["tenant_admin", "admin"].includes(role)) {
    return null;
  }

  // Loan officers filtered by encompass_user_id
  if (role === "loan_officer" && encompass_user_id) {
    return `loan_officer_id = '${encompass_user_id}'`;
  }

  // Processors might have different logic (team-based)
  if (role === "processor" && encompass_user_id) {
    return `loan_processor_id = '${encompass_user_id}'`;
  }

  // No access for users without proper mapping
  return "FALSE";
}
```

---

## Admin UI Guide

### Accessing Encompass Users

1. Navigate to **Admin** > **User Management**
2. Click **Encompass Users** tab
3. If first time, system will auto-sync users

### User List Features

| Feature           | Description                      |
| ----------------- | -------------------------------- |
| **Search**        | Filter by name, email, username  |
| **Status Filter** | Show enabled/disabled users      |
| **Sync Button**   | Manually refresh from Encompass  |
| **Last Synced**   | Shows when data was last updated |

### Inviting a User

1. Find user in the list
2. Click **Invite to Cohi** button
3. Select role (Loan Officer, Processor, etc.)
4. Choose invite method (Email, SSO, Manual)
5. Click **Send Invite**

### Linking Existing User

If a Cohi user already exists:

1. Go to **User Management** > **Tenant Users**
2. Click **Edit** on the user
3. Select **Link to Encompass User**
4. Choose from dropdown or search
5. Save changes

---

## API Reference

### List Encompass Users

```
GET /api/admin/encompass-users
Authorization: Bearer {jwt}
```

**Query Parameters:**

| Parameter      | Type    | Description             |
| -------------- | ------- | ----------------------- |
| `search`       | string  | Filter by name/email    |
| `enabled_only` | boolean | Only show enabled users |
| `page`         | integer | Page number             |
| `limit`        | integer | Results per page        |

**Response:**

```json
{
  "users": [
    {
      "id": "uuid",
      "encompass_user_id": "a1b2c3d4-...",
      "username": "jsmith",
      "email": "jsmith@lender.com",
      "first_name": "John",
      "last_name": "Smith",
      "is_enabled": true,
      "cohi_user_id": null,
      "last_synced_at": "2026-01-30T12:00:00Z"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20
}
```

### Sync Encompass Users

```
POST /api/admin/encompass-users/sync
Authorization: Bearer {jwt}
```

**Response:**

```json
{
  "success": true,
  "users_synced": 150,
  "users_added": 5,
  "users_updated": 145,
  "users_disabled": 2,
  "sync_duration_ms": 3500
}
```

### Invite User

```
POST /api/admin/encompass-users/{encompass_user_id}/invite
Authorization: Bearer {jwt}
Content-Type: application/json

{
  "role": "loan_officer",
  "invite_method": "email"
}
```

**Response:**

```json
{
  "success": true,
  "cohi_user_id": "new-user-uuid",
  "invite_sent": true
}
```

### Link User to Encompass

```
POST /api/admin/users/{user_id}/link-encompass
Authorization: Bearer {jwt}
Content-Type: application/json

{
  "encompass_user_id": "a1b2c3d4-..."
}
```

**Response:**

```json
{
  "success": true,
  "loan_access_scope": "own_loans",
  "accessible_loan_count": 47
}
```

---

## Troubleshooting

### Sync Failures

**Issue:** "Failed to fetch Encompass users"

**Possible Causes:**

- LOS connection credentials expired
- Encompass API rate limit exceeded
- Network connectivity issue

**Solution:**

1. Check LOS connection status in Admin > Settings
2. Test connection with "Test Connection" button
3. Wait 5 minutes if rate limited
4. Check server logs for detailed error

### User Not Showing

**Issue:** User exists in Encompass but not in Cohi

**Possible Causes:**

- User doesn't have "Enabled" indicator
- Sync hasn't run since user was created
- User is in different Encompass organization

**Solution:**

1. Verify user has "Enabled" indicator in Encompass
2. Trigger manual sync
3. Check `encompass_users` table directly

### Loan Access Not Working

**Issue:** Loan officer can't see their loans

**Possible Causes:**

- `encompass_user_id` not set on Cohi user
- `loan_officer_id` not populated in loans table
- Field mapping incorrect

**Solution:**

1. Check user's `encompass_user_id` is set
2. Verify loans have `loan_officer_id` populated
3. Check field mapping in LOS connection settings

### Permission Denied

**Issue:** "Permission denied" when accessing Encompass users

**Possible Causes:**

- User doesn't have admin role
- Tenant doesn't have active LOS connection

**Solution:**

1. Verify user role is `tenant_admin` or `admin`
2. Check that LOS connection exists and is active

---

## Related Documentation

- [USER_MANAGEMENT.md](../security/USER_MANAGEMENT.md) - User management overview
- [ENCOMPASS_INTEGRATION.md](../data/integrations/ENCOMPASS_INTEGRATION.md) - Full Encompass integration guide
- [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) - SSO configuration
