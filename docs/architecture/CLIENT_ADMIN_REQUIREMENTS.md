# Client Admin (Tenant Admin) Requirements

This document specifies the requirements and feature set for client tenant administrators in Cohi. These are organization-level administrators who manage their own users, roles, and settings.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [User Stories](#user-stories)
- [Feature Specifications](#feature-specifications)
- [UI/UX Requirements](#uiux-requirements)
- [API Requirements](#api-requirements)
- [Data Access Rules](#data-access-rules)
- [Audit Requirements](#audit-requirements)
- [Migration Considerations](#migration-considerations)

---

## Overview

### Target User

**Client Tenant Admin** (`tenant_admin` role):
- IT Administrator at a mortgage lender
- Operations Manager responsible for team access
- Compliance Officer managing data access policies

### Goals

1. **Self-Service User Management** - Add/remove users without TVMA involvement
2. **Flexible Access Control** - Define custom roles with field-based filtering
3. **LOS Configuration** - Customize field mappings for their Encompass instance
4. **SSO Management** - Configure and manage corporate SSO
5. **Organization Settings** - Manage basic organization profile

### Non-Goals (Handled by TVMA)

- Creating/deleting the tenant itself
- Managing LOS connection credentials
- Accessing other tenants' data
- Platform-level configuration
- Billing/subscription changes

---

## User Stories

### User Management

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| UM-01 | Tenant Admin | View all users in my organization | I can see who has access |
| UM-02 | Tenant Admin | Invite new users by email | New team members can access Cohi |
| UM-03 | Tenant Admin | Assign roles to users | Users have appropriate access levels |
| UM-04 | Tenant Admin | Deactivate users who leave | Former employees lose access immediately |
| UM-05 | Tenant Admin | Reset a user's password | Users locked out can regain access |
| UM-06 | Tenant Admin | See user activity/last login | I can identify inactive accounts |
| UM-07 | Tenant Admin | Bulk invite users via CSV | I can onboard entire teams efficiently |

### Role & Permission Management

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| RP-01 | Tenant Admin | View all roles in my organization | I understand the access structure |
| RP-02 | Tenant Admin | Create custom roles | I can match our org structure |
| RP-03 | Tenant Admin | Define field-based filters for roles | Users only see relevant loans |
| RP-04 | Tenant Admin | Set section access per role | Users see only permitted features |
| RP-05 | Tenant Admin | Assign multiple roles to a user | Users can have combined access |
| RP-06 | Tenant Admin | Preview effective permissions | I can verify access before assigning |
| RP-07 | Tenant Admin | Clone an existing role | I can quickly create variations |
| RP-08 | Tenant Admin | View which users have a role | I can audit role assignments |

### LOS Field Mapping

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| FM-01 | Tenant Admin | View our LOS connection status | I know syncs are working |
| FM-02 | Tenant Admin | See the field mapping table | I understand what data flows into Cohi |
| FM-03 | Tenant Admin | Swap an Encompass field ID | Our custom fields map correctly |
| FM-04 | Tenant Admin | Search for Encompass RDB fields | I can find the right field to map |
| FM-05 | Tenant Admin | Reset a field to default mapping | I can undo a custom mapping |
| FM-06 | Tenant Admin | See field population statistics | I know which fields have data |
| FM-07 | Tenant Admin | Test a field mapping | I can verify before saving |

### SSO Configuration

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| SS-01 | Tenant Admin | View current SSO status | I know if SSO is configured |
| SS-02 | Tenant Admin | Upload IdP metadata (XML/URL) | I can connect our identity provider |
| SS-03 | Tenant Admin | Configure attribute mapping | SAML attributes map to Cohi fields |
| SS-04 | Tenant Admin | Test SSO connection | I can verify before enabling |
| SS-05 | Tenant Admin | Enable/disable SSO | I control when SSO is active |
| SS-06 | Tenant Admin | View SSO login history | I can troubleshoot login issues |
| SS-07 | Tenant Admin | Download SP metadata | I can configure our IdP |

### Organization Settings

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| OS-01 | Tenant Admin | Update organization name | Our branding is correct |
| OS-02 | Tenant Admin | Upload organization logo | Reports have our logo |
| OS-03 | Tenant Admin | Set default timezone | Date/times display correctly |
| OS-04 | Tenant Admin | Configure notification preferences | We get the right alerts |
| OS-05 | Tenant Admin | View our subscription details | I know our plan/limits |
| OS-06 | Tenant Admin | See usage statistics | I can track our consumption |

---

## Feature Specifications

### 1. User Management Section

#### 1.1 User List

**Display Fields:**
- Full name
- Email
- Role(s) assigned
- Status (Active/Invited/Deactivated)
- Last login timestamp
- Created date

**Actions:**
- Search/filter by name, email, role
- Sort by any column
- Edit user
- Deactivate/reactivate user
- Reset password
- View activity log

**Constraints:**
- Cannot see users from other tenants
- Cannot edit own role (prevent self-lockout)
- Cannot deactivate last tenant_admin

#### 1.2 Invite User Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Invite New User                                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Email:        [john.smith@lender.com_____________________]                     │
│                                                                                  │
│  Full Name:    [John Smith________________________________]  (optional)         │
│                                                                                  │
│  Assign Roles: ☑ Loan Officer                                                   │
│                ☐ Processor                                                       │
│                ☐ Branch Manager - Seattle                                        │
│                ☐ Viewer                                                          │
│                                                                                  │
│  Branch:       [Seattle (SEA001)_________________________▼]  (if applicable)    │
│                                                                                  │
│  Send welcome email: ☑                                                          │
│                                                                                  │
│  ℹ️ User will receive an email with instructions to set their password.          │
│     If SSO is enabled, they will sign in with corporate credentials.            │
│                                                                                  │
│                                                      [Cancel]  [Send Invitation] │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 1.3 Bulk Import

**CSV Format:**
```csv
email,full_name,role,branch_code
john.smith@lender.com,John Smith,loan_officer,SEA001
jane.doe@lender.com,Jane Doe,processor,SEA001
bob.jones@lender.com,Bob Jones,viewer,
```

**Import Flow:**
1. Upload CSV file
2. Preview parsed data with validation
3. Show errors (duplicate emails, invalid roles)
4. Confirm import
5. Show results (created, skipped, errors)

---

### 2. Roles & Permissions Section

#### 2.1 Role List View

**Display:**
- Role name and description
- Number of users assigned
- Number of data filters
- Section access summary
- System role indicator (🔒)

**Actions:**
- Create new role
- Edit role
- Clone role
- Delete role (non-system only)
- View users with role

#### 2.2 Role Editor

**Tabs:**
1. **General** - Name, description
2. **Data Filters** - Field-based access rules
3. **Section Access** - Which UI sections are visible
4. **Permissions** - CRUD permissions per resource
5. **Users** - Currently assigned users

**Field Filter Builder:**

See [ROW_LEVEL_SECURITY.md](../security/ROW_LEVEL_SECURITY.md#field-filter-builder) for detailed UI spec.

**Available Fields for Filtering:**

| Field | Display Name | Type | Notes |
|-------|--------------|------|-------|
| `branch_code` | Branch Code | String | Common filter dimension |
| `loan_officer_email` | Loan Officer Email | String | For self-service filtering |
| `loan_officer_name` | Loan Officer Name | String | Display name |
| `region` | Region | String | Geographic grouping |
| `loan_status` | Loan Status | String | Active, Closed, etc. |
| `loan_amount` | Loan Amount | Numeric | Amount filtering |
| `loan_purpose` | Loan Purpose | String | Purchase, Refinance |
| `property_state` | Property State | String | State code |

**Section Access Checkboxes:**

| Section | Description | Default for New Role |
|---------|-------------|----------------------|
| Dashboard | Main insights page | ☑ |
| Loans | Loan detail pages | ☑ |
| Funnel | Loan funnel visualization | ☐ |
| Leaderboard | Performance rankings | ☐ |
| Reports | Report generation | ☐ |
| Analytics | Advanced analytics | ☐ |

**Permissions Matrix:**

| Resource | Read | Create | Update | Delete | Export |
|----------|------|--------|--------|--------|--------|
| Loans | ☑/☐ | ☑/☐ | ☑/☐ | ☑/☐ | ☑/☐ |
| Reports | ☑/☐ | ☑/☐ | ☑/☐ | ☑/☐ | ☑/☐ |
| Contacts | ☑/☐ | ☑/☐ | ☑/☐ | ☑/☐ | ☑/☐ |

#### 2.3 Permission Preview

Show what a user with this role would see:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Permission Preview for: Seattle Branch Manager                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  DATA ACCESS                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Effective Filter: branch_code = 'SEA001'                               │    │
│  │                                                                         │    │
│  │  Preview: This role can access approximately 1,234 loans               │    │
│  │           (15% of total organization loans)                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  VISIBLE SECTIONS                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ✅ Dashboard                                                           │    │
│  │  ✅ Loans                                                               │    │
│  │  ✅ Reports                                                             │    │
│  │  ❌ Analytics (not permitted)                                          │    │
│  │  ❌ Settings (admin only)                                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  CAPABILITIES                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Loans:   ✅ Read  ✅ Create  ✅ Update  ❌ Delete  ✅ Export           │    │
│  │  Reports: ✅ Read  ❌ Create  ❌ Update  ❌ Delete  ✅ Export           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. LOS Field Mapping Section

#### 3.1 Connection Overview (Read-Only)

**Display:**
- Connection name
- LOS type (Encompass, etc.)
- Status (Connected/Error)
- Last sync time
- Sync statistics (loans synced, errors)

**Cannot modify:**
- Connection credentials
- Instance URL
- Cannot delete connection

#### 3.2 Field Mapping Table

**Columns:**
- Cohi Field Name (alias)
- Default Encompass Field ID
- Current Mapping (swapped ID if different)
- Field Population % (how many loans have data)
- Status (Valid/Invalid/Not Found)
- Actions (Edit, Reset)

**Search/Filter:**
- Search by field name
- Filter by: Has swap, Has issues, Population %

#### 3.3 Field Swap Dialog

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Edit Field Mapping                                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Cohi Field:           Borrower Phone Number                                    │
│  Default Encompass ID: 36                                                        │
│  Current Mapping:      CX.CELL.PHONE (custom)                                   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  New Encompass Field ID:                                                │    │
│  │  [🔍 Search Encompass fields...____________________]                    │    │
│  │  ┌───────────────────────────────────────────────────────────────────┐ │    │
│  │  │ 36       - Home Phone                                             │ │    │
│  │  │ 37       - Work Phone                                             │ │    │
│  │  │ 38       - Cell Phone                                             │ │    │
│  │  │ CX.CELL  - Custom Cell Phone                                      │ │    │
│  │  │ CX.CELL.PHONE - Custom Cell Phone (recommended)                   │ │    │
│  │  └───────────────────────────────────────────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ℹ️ This will affect how data is pulled from Encompass on the next sync.        │
│     Current loan data will not be automatically updated.                         │
│                                                                                  │
│                                   [Reset to Default]  [Cancel]  [Save Mapping]  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### 4. SSO Configuration Section

See [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) for full technical specification.

#### 4.1 SSO Status Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Single Sign-On Configuration                                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  STATUS: ✅ Enabled                                                             │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Provider:        Okta                                                  │    │
│  │  IdP Entity ID:   https://company.okta.com/app/xxx                      │    │
│  │  Last Login:      2026-01-22 14:30 (john.smith@company.com)            │    │
│  │  Logins Today:    47                                                    │    │
│  │  Failed Logins:   2                                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  [Test Connection]  [View Logs]  [Download SP Metadata]  [Edit Configuration]   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 4.2 SSO Setup Wizard

**Steps:**
1. **Choose Provider** - Okta, Azure AD, Other SAML
2. **Upload Metadata** - Paste XML or provide URL
3. **Attribute Mapping** - Map SAML attributes to Cohi fields
4. **Test** - Perform test authentication
5. **Enable** - Activate SSO for organization

**Attribute Mapping:**

| SAML Attribute | Cohi Field | Required |
|----------------|------------|----------|
| `email` | User Email | ✅ |
| `firstName` | First Name | ☐ |
| `lastName` | Last Name | ☐ |
| `department` | Department | ☐ |
| `groups` | Role Assignment | ☐ |

---

### 5. Organization Settings Section

#### 5.1 General Settings

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Organization Settings                                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  GENERAL                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Organization Name:  [Acme Mortgage Company______________]              │    │
│  │  Display Name:       [Acme Mortgage________________________]             │    │
│  │  Default Timezone:   [America/Los_Angeles (Pacific Time)__▼]            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  BRANDING                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Logo:  [Current Logo]  [Upload New]  [Remove]                          │    │
│  │         Recommended: 200x50px, PNG or SVG                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  CONTACT                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Primary Contact:  [IT Admin_______________________________]            │    │
│  │  Contact Email:    [it@acmemortgage.com____________________]            │    │
│  │  Support Phone:    [(555) 123-4567_________________________]            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│                                                                   [Save Changes] │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 5.2 Subscription & Usage (Read-Only)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Subscription & Usage                                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  CURRENT PLAN                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Plan:           Enterprise                                             │    │
│  │  Status:         Active                                                 │    │
│  │  Renewal Date:   March 15, 2026                                        │    │
│  │  Contact billing@cohi.io to make changes                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  USAGE THIS MONTH                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Users:          47 / Unlimited                                        │    │
│  │  Loans Synced:   8,234 / Unlimited                                     │    │
│  │  API Calls:      12,456 / 100,000                                      │    │
│  │  Storage:        2.3 GB / 50 GB                                        │    │
│  │                  ████████░░░░░░░░░░░░ 12%                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## API Requirements

### Endpoints for Tenant Admin

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/admin/users` | GET | List org users | tenant_admin |
| `/api/admin/users` | POST | Invite user | tenant_admin |
| `/api/admin/users/:id` | PUT | Update user | tenant_admin |
| `/api/admin/users/:id` | DELETE | Deactivate user | tenant_admin |
| `/api/admin/users/:id/reset-password` | POST | Reset password | tenant_admin |
| `/api/admin/users/bulk-invite` | POST | Bulk invite | tenant_admin |
| `/api/admin/roles` | GET | List roles | tenant_admin |
| `/api/admin/roles` | POST | Create role | tenant_admin |
| `/api/admin/roles/:id` | PUT | Update role | tenant_admin |
| `/api/admin/roles/:id` | DELETE | Delete role | tenant_admin |
| `/api/admin/roles/:id/clone` | POST | Clone role | tenant_admin |
| `/api/admin/roles/:id/users` | GET/POST/DELETE | Manage assignments | tenant_admin |
| `/api/admin/rls/fields` | GET | Available filter fields | tenant_admin |
| `/api/admin/rls/preview` | POST | Preview filter results | tenant_admin |
| `/api/admin/los/connections` | GET | List connections (read-only) | tenant_admin |
| `/api/admin/los/field-mapping` | GET | Get field mappings | tenant_admin |
| `/api/admin/los/field-mapping` | PUT | Update field swap | tenant_admin |
| `/api/admin/sso` | GET | Get SSO config | tenant_admin |
| `/api/admin/sso` | PUT | Update SSO config | tenant_admin |
| `/api/admin/sso/test` | POST | Test SSO | tenant_admin |
| `/api/admin/sso/metadata` | GET | Download SP metadata | tenant_admin |
| `/api/admin/organization` | GET | Get org settings | tenant_admin |
| `/api/admin/organization` | PUT | Update org settings | tenant_admin |
| `/api/admin/organization/logo` | POST | Upload logo | tenant_admin |

---

## Data Access Rules

### Tenant Isolation

All tenant_admin API calls must:

1. Extract `tenant_id` from authenticated user
2. Filter all queries by `tenant_id`
3. Reject any cross-tenant access attempts
4. Log access attempts for audit

### Cannot Access

- Other tenants' users, roles, or settings
- Platform-level configuration
- LOS connection credentials
- Billing/payment information (view-only)
- TVMA internal admin sections

### Cannot Create

- Users with `super_admin` role
- Roles with more permissions than they have
- LOS connections
- New tenants

### Cannot Delete

- System roles (can only edit limited properties)
- The last tenant_admin in organization
- LOS connections
- The organization itself

---

## Audit Requirements

### Logged Actions

| Action | Logged Fields |
|--------|---------------|
| User invited | user_email, roles_assigned, invited_by |
| User deactivated | user_id, deactivated_by, reason |
| Role created | role_name, permissions, created_by |
| Role updated | role_id, changes, updated_by |
| Role deleted | role_id, deleted_by |
| Role assigned | user_id, role_id, assigned_by |
| Field mapping changed | field_name, old_value, new_value, changed_by |
| SSO configured | provider, configured_by |
| Org settings changed | field, old_value, new_value, changed_by |

### Audit Log Access

- Tenant admins can view audit logs for their organization
- Logs are retained for 2 years (SOC 2 requirement)
- Cannot delete or modify audit logs

---

## Migration Considerations

### From Coheus (Qlik)

**User Migration:**
- Existing Qlik users mapped via userDirectory
- Coheus Bridge allows seamless SSO migration
- User roles need manual configuration in Cohi

**Field Mapping Migration:**
- Existing Encompass field swaps should be preserved
- Migration script to copy swaps from legacy system
- Validation of swaps against current RDB fields

### Gradual Rollout

1. **Phase 1** - TVMA configures tenant, LOS connection
2. **Phase 2** - Invite tenant_admin, train on admin features
3. **Phase 3** - Tenant admin configures roles, invites users
4. **Phase 4** - Transition SSO from Coheus Bridge to direct

---

## Related Documentation

### Admin & Architecture
- [ADMIN_PANEL.md](./ADMIN_PANEL.md) - Overall admin panel architecture
- [ROW_LEVEL_SECURITY.md](../security/ROW_LEVEL_SECURITY.md) - RLS technical specification
- [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) - SSO configuration details
- [MULTI_TENANT.md](./MULTI_TENANT.md) - Multi-tenant architecture

### Data Management
- [Data Quality Framework](../data/DATA_QUALITY.md) - Data validation and monitoring dashboard
- [Universal Connector](../data/UNIVERSAL_CONNECTOR.md) - Field mapping configuration
- [CSV Import Guide](../data/CSV_IMPORT.md) - Manual and scheduled file imports
- [Encompass Integration](../data/integrations/ENCOMPASS_INTEGRATION.md) - LOS connection setup
