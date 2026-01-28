# Internal Admin (TVMA) Requirements

This document specifies the requirements and feature set for TVMA internal administrators in Cohi. These are platform-level administrators who manage all tenants, system configuration, and platform health.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **TVMA** - Teraverde Mortgage Analytics (the company operating Cohi)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [User Stories](#user-stories)
- [Feature Specifications](#feature-specifications)
- [Operational Procedures](#operational-procedures)
- [Monitoring & Alerting](#monitoring--alerting)
- [Security Considerations](#security-considerations)

---

## Overview

### Target User

**TVMA Internal Admin** (`super_admin` role):
- Platform Operations Engineer
- Customer Success Manager
- Technical Support Specialist
- DevOps Engineer

### Goals

1. **Tenant Lifecycle Management** - Provision, configure, and decommission tenants
2. **Platform Monitoring** - Monitor system health, performance, and costs
3. **Customer Support** - Assist with tenant configuration and troubleshooting
4. **Compliance Management** - Maintain SOC 2 compliance, audit trails
5. **Integration Management** - Configure LOS connections, vendor integrations

### Access Model

- Internal admins access the same `/admin` route as tenant admins
- Role-based filtering shows internal-only sections
- Future: Separate `admin.cohi.io` with IP/VPN restrictions

---

## User Stories

### Tenant Management

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| TM-01 | Platform Admin | List all tenants with status | I can see platform usage |
| TM-02 | Platform Admin | Create a new tenant | New customers can onboard |
| TM-03 | Platform Admin | Configure tenant settings | Each tenant is properly set up |
| TM-04 | Platform Admin | View tenant metrics (loans, users) | I can monitor customer health |
| TM-05 | Platform Admin | Deactivate a tenant | Churned customers lose access |
| TM-06 | Platform Admin | Reactivate a tenant | Returning customers regain access |
| TM-07 | Platform Admin | Delete a tenant (with data) | I can comply with data deletion requests |
| TM-08 | Platform Admin | Assign tenant to Aurora cluster | I can manage database resources |
| TM-09 | Platform Admin | View tenant's LOS connections | I can troubleshoot sync issues |
| TM-10 | Platform Admin | Impersonate tenant admin | I can assist with configuration |

### User Management (Cross-Tenant)

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| UM-01 | Platform Admin | List all users across tenants | I can see total platform usage |
| UM-02 | Platform Admin | Create super_admin users | New TVMA staff can access |
| UM-03 | Platform Admin | Create tenant_admin for any tenant | I can set up customer admins |
| UM-04 | Platform Admin | Reset any user's password | I can assist locked-out users |
| UM-05 | Platform Admin | View user activity across platform | I can identify issues |
| UM-06 | Platform Admin | Deactivate any user | I can respond to security incidents |
| UM-07 | Platform Admin | Transfer user between tenants | I can handle customer mergers |

### LOS Connection Management

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| LOS-01 | Platform Admin | Create LOS connection for tenant | Customers can sync loan data |
| LOS-02 | Platform Admin | Configure connection credentials | Connections work properly |
| LOS-03 | Platform Admin | Test any connection | I can verify setup |
| LOS-04 | Platform Admin | Trigger manual sync | I can recover from failures |
| LOS-05 | Platform Admin | View sync history and errors | I can troubleshoot issues |
| LOS-06 | Platform Admin | Delete LOS connection | I can remove broken integrations |
| LOS-07 | Platform Admin | View field mappings for any tenant | I can assist with customization |
| LOS-08 | Platform Admin | Configure sync schedules | Data stays current |

### System Configuration

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| SC-01 | Platform Admin | View system health dashboard | I know if platform is healthy |
| SC-02 | Platform Admin | Configure feature flags | I can control feature rollout |
| SC-03 | Platform Admin | Manage API keys | External integrations work |
| SC-04 | Platform Admin | View environment configuration | I can verify settings |
| SC-05 | Platform Admin | Trigger database migrations | I can update schemas |
| SC-06 | Platform Admin | View system logs | I can troubleshoot issues |

### RAG & Voice Configuration

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| RV-01 | Platform Admin | Configure OpenAI/Anthropic API keys | AI features work |
| RV-02 | Platform Admin | Manage Aletheia topics | Voice assistant has relevant content |
| RV-03 | Platform Admin | Configure voice rules | Aletheia responds appropriately |
| RV-04 | Platform Admin | View AI usage costs | I can track expenses |
| RV-05 | Platform Admin | Upload RAG documents | Knowledge base is updated |
| RV-06 | Platform Admin | Configure per-tenant AI settings | Each tenant has customized AI |

### Deployment & Infrastructure

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| DI-01 | Platform Admin | View all deployment instances | I know infrastructure state |
| DI-02 | Platform Admin | Provision new deployment | I can scale infrastructure |
| DI-03 | Platform Admin | Trigger failover | I can recover from outages |
| DI-04 | Platform Admin | View sync events | I know data pipeline status |
| DI-05 | Platform Admin | Configure AWS hosting | Tenant AWS resources are managed |

### Billing & Subscriptions

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| BS-01 | Platform Admin | View all subscriptions | I know revenue status |
| BS-02 | Platform Admin | Create subscription plans | I can offer new pricing |
| BS-03 | Platform Admin | Assign plan to tenant | Customers have correct access |
| BS-04 | Platform Admin | View revenue metrics | I can track business health |
| BS-05 | Platform Admin | Generate invoices | Customers can pay |

### Compliance & Audit

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| CA-01 | Platform Admin | View platform-wide audit logs | I can demonstrate compliance |
| CA-02 | Platform Admin | Export audit logs | I can provide to auditors |
| CA-03 | Platform Admin | View security events | I can identify threats |
| CA-04 | Platform Admin | Generate compliance reports | I can maintain SOC 2 |
| CA-05 | Platform Admin | Configure retention policies | Data is retained appropriately |

---

## Feature Specifications

### 1. Tenants Section

#### 1.1 Tenant List

**Display Fields:**
- Tenant name
- Status (Active/Inactive/Provisioning)
- Cluster assignment
- User count
- Loan count
- LOS connection status
- Last sync time
- Created date

**Actions:**
- Search/filter tenants
- Create new tenant
- Edit tenant
- View tenant metrics
- Access tenant's admin (impersonation)
- Deactivate/reactivate
- Delete (with confirmation)

#### 1.2 Create Tenant Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Create New Tenant                                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  TENANT INFORMATION                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Tenant Name:     [Acme Mortgage Company__________________]             │    │
│  │  Slug:            [acme-mortgage__________________________]  (auto)     │    │
│  │  Primary Contact: [John Smith_____________________________]             │    │
│  │  Contact Email:   [jsmith@acmemortgage.com________________]             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  DATABASE CONFIGURATION                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Aurora Cluster:  [cluster-01 (15 tenants, 42% capacity)__▼]            │    │
│  │  Database Name:   [tenant_acme_mortgage___________________]  (auto)     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  INITIAL ADMIN                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Admin Email:     [admin@acmemortgage.com_________________]             │    │
│  │  Send Invite:     ☑ Send welcome email with setup instructions          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  SUBSCRIPTION                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Plan:            [Enterprise_____________________________▼]            │    │
│  │  Trial Period:    [30 days________________________________▼]            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ℹ️ Creating a tenant will:                                                      │
│     • Provision a new database in the selected cluster                          │
│     • Create default roles and permissions                                      │
│     • Send welcome email to the admin                                           │
│                                                                                  │
│                                                         [Cancel]  [Create Tenant]│
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 1.3 Tenant Detail View

**Tabs:**
1. **Overview** - Key metrics, status
2. **Users** - All users in tenant
3. **LOS Connections** - Configured connections
4. **Subscription** - Plan, billing
5. **Audit Log** - Tenant-specific events
6. **Settings** - SSO, preferences

---

### 2. Users Section (Platform-Wide)

#### 2.1 User List

**Display Fields:**
- Full name
- Email
- Tenant (or "Platform" for super_admin)
- Platform role
- Status
- Last login
- Created date

**Filters:**
- By tenant
- By role
- By status
- By date range

**Actions:**
- Create user (any role, any tenant)
- Edit user
- Reset password
- Deactivate
- Transfer to another tenant

#### 2.2 Create Platform User

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Create User                                                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  USER INFORMATION                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Email:           [newuser@company.com____________________]             │    │
│  │  Full Name:       [New User_______________________________]             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ACCESS LEVEL                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ○ Platform Admin (super_admin)                                         │    │
│  │    Full access to all tenants and platform configuration                │    │
│  │                                                                         │    │
│  │  ● Tenant Admin (tenant_admin)                                          │    │
│  │    Full access to assigned tenant only                                  │    │
│  │    Tenant: [Acme Mortgage Company_________________________▼]            │    │
│  │                                                                         │    │
│  │  ○ Regular User                                                         │    │
│  │    Access based on tenant role assignment                               │    │
│  │    Tenant: [Select tenant_________________________________▼]            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  INITIAL PASSWORD                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ● Send password reset email                                            │    │
│  │  ○ Set temporary password: [________________]                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│                                                           [Cancel]  [Create User]│
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. LOS Settings Section (Full Control)

#### 3.1 Connection Management

**View Modes:**
- All connections (default)
- By tenant (filtered)
- By status (Connected/Error/Pending)

**Connection Card:**
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Acme Mortgage - Encompass Production                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Status: ✅ Connected          Last Sync: 2026-01-22 14:30 (2 hours ago)        │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Instance:     encompass.acmemortgage.com                               │    │
│  │  Client ID:    abc123...                                                │    │
│  │  Loans Synced: 8,234                                                    │    │
│  │  Sync Errors:  3 (last 24h)                                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  [Test] [Sync Now] [View Logs] [Field Mapping] [Edit] [Delete]                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 3.2 Create LOS Connection

**Supported LOS Types:**
- Encompass (ICE Mortgage Technology)
- MeridianLink
- Byte
- Calyx
- Custom API

**Configuration Fields (Encompass):**
- Tenant selection
- Connection name
- Instance URL
- Client ID
- Client Secret
- API User
- API Password
- Sync folder selection
- Sync schedule

---

### 4. System Section

#### 4.1 System Health Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  System Health                                                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  SERVICES                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ✅ Backend API         Healthy     Response: 45ms                      │    │
│  │  ✅ Database (Primary)  Healthy     Connections: 23/100                 │    │
│  │  ✅ Database (Replica)  Healthy     Lag: 0ms                            │    │
│  │  ✅ Redis Cache         Healthy     Memory: 234MB/1GB                   │    │
│  │  ✅ WebSocket Server    Healthy     Connections: 47                     │    │
│  │  ⚠️ Encompass API       Degraded    Rate limit: 80%                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  AURORA CLUSTERS                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Cluster         │ Tenants │ ACU Usage │ Storage │ Status              │    │
│  │  cluster-01      │   15    │  2.5/8    │  45 GB  │ ✅ Healthy          │    │
│  │  cluster-02      │   12    │  1.8/8    │  32 GB  │ ✅ Healthy          │    │
│  │  cluster-mgmt    │    1    │  0.5/4    │   2 GB  │ ✅ Healthy          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 4.2 Environment Configuration

**View (Read-Only):**
- Node environment
- API version
- Database hosts
- Redis host
- Feature flags
- Rate limits

**Cannot View:**
- Secrets
- API keys
- Passwords

---

### 5. Security Section

#### 5.1 Security Dashboard

**Metrics:**
- Total users
- Verified users
- Recent logins (7 days)
- Failed login attempts
- Active sessions
- MFA adoption rate

**Alerts:**
- Unusual login patterns
- Brute force attempts
- Expired sessions
- Disabled accounts accessing

#### 5.2 API Key Management

**Actions:**
- List API keys (masked)
- Create new API key
- Revoke API key
- View API key usage

---

### 6. SOC 2 Compliance Section

#### 6.1 Compliance Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  SOC 2 Compliance                                                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  COMPLIANCE STATUS: ✅ Compliant                                                │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CONTROL AREA              │ STATUS │ LAST CHECK │ EVIDENCE             │    │
│  │  ─────────────────────────────────────────────────────────────────────── │    │
│  │  Access Control            │   ✅   │ 2026-01-22 │ [View]               │    │
│  │  Change Management         │   ✅   │ 2026-01-22 │ [View]               │    │
│  │  System Operations         │   ✅   │ 2026-01-22 │ [View]               │    │
│  │  Risk Management           │   ✅   │ 2026-01-22 │ [View]               │    │
│  │  Data Protection           │   ✅   │ 2026-01-22 │ [View]               │    │
│  │  Incident Response         │   ⚠️   │ 2026-01-15 │ [View] (needs review)│    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  [Export Compliance Report]  [Schedule Audit]  [View Audit History]             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 6.2 Audit Log Viewer

**Filters:**
- Date range
- User
- Tenant
- Action type
- Resource type
- Status (success/failure)

**Export:**
- CSV
- JSON
- PDF report

---

### 7. RAG & Voice Section

#### 7.1 AI Configuration

**Global Settings:**
- OpenAI API key
- Anthropic API key
- Default model selection
- Rate limits
- Cost alerts

**Per-Tenant Overrides:**
- Custom topics
- Response rules
- Knowledge base

#### 7.2 Cost Tracking

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  AI Usage & Costs (January 2026)                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  TOTAL: $1,234.56                                                               │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Category       │ Usage          │ Cost      │ % of Total              │    │
│  │  ─────────────────────────────────────────────────────────────────────── │    │
│  │  Voice (TTS)    │ 45,000 chars   │ $234.00   │ ███████░░░ 19%          │    │
│  │  LLM (GPT-4)    │ 2.3M tokens    │ $680.00   │ ██████████████░ 55%     │    │
│  │  Embedding      │ 5.1M tokens    │ $51.00    │ █░░░░░░░░░ 4%           │    │
│  │  Voice (STT)    │ 12,000 min     │ $269.56   │ █████░░░░░ 22%          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  BY TENANT                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Acme Mortgage        │ $456.78  │ ██████████████░░░░░░ 37%             │    │
│  │  Best Lending         │ $312.45  │ ██████████░░░░░░░░░░ 25%             │    │
│  │  Capital Home Loans   │ $234.12  │ ███████░░░░░░░░░░░░░ 19%             │    │
│  │  Other (7 tenants)    │ $231.21  │ ███████░░░░░░░░░░░░░ 19%             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### 8. Deployment Section

#### 8.1 Deployment Instances

**Display:**
- Instance ID
- Region
- Status
- Version
- Tenant assignment
- Last health check

**Actions:**
- View logs
- Trigger deploy
- Failover
- Scale up/down

#### 8.2 Sync Events

**Event Types:**
- Sync started
- Sync completed
- Sync failed
- Loan count changed
- Schema updated

---

### 9. Stripe Payments Section

#### 9.1 Subscription Plans

**Plan Management:**
- List plans
- Create plan
- Edit plan pricing
- Archive plan

**Plan Fields:**
- Name
- Price (monthly/annual)
- Features included
- User limits
- Loan limits

#### 9.2 Active Subscriptions

**Display:**
- Tenant
- Plan
- Status
- MRR contribution
- Next billing date
- Payment method

---

### 10. AWS Hosting Section

#### 10.1 Self-Hosted Deployments

**For AWS Marketplace customers:**
- List deployments
- View health
- Usage metrics
- Support tickets

---

## Operational Procedures

### Tenant Onboarding

1. **Create Tenant**
   - Enter tenant information
   - Select Aurora cluster
   - Choose subscription plan

2. **Provision Database**
   - System creates database in cluster
   - Runs schema migrations
   - Seeds default roles

3. **Configure LOS**
   - Create Encompass connection
   - Test connection
   - Configure field mappings

4. **Invite Admin**
   - Create tenant_admin user
   - Send welcome email
   - Schedule onboarding call

### Tenant Offboarding

1. **Deactivate Tenant**
   - Disable all user access
   - Stop LOS syncs
   - Mark tenant inactive

2. **Data Retention Period**
   - Keep data for 90 days (configurable)
   - Export available on request

3. **Delete Tenant**
   - Remove database
   - Clear connection pools
   - Archive audit logs
   - Remove from management DB

### Emergency Procedures

#### Database Failover
1. Identify affected cluster
2. Initiate Aurora failover
3. Update connection endpoints
4. Verify tenant access
5. Document incident

#### Security Incident
1. Identify affected accounts
2. Disable compromised accounts
3. Reset credentials
4. Review audit logs
5. Notify affected tenants
6. Document and report

---

## Monitoring & Alerting

### Key Metrics

| Metric | Warning | Critical |
|--------|---------|----------|
| API response time | > 500ms | > 2s |
| Database connections | > 70% | > 90% |
| Error rate | > 1% | > 5% |
| Sync failures | > 3/hour | > 10/hour |
| Failed logins | > 10/min | > 50/min |

### Alert Channels

- Slack (#cohi-alerts)
- PagerDuty (critical)
- Email (daily digest)

---

## Security Considerations

### Super Admin Access

- Requires MFA
- Session timeout: 4 hours
- Actions logged with extra detail
- Cannot delete own account
- IP allowlist (optional)

### Impersonation

- Logged as impersonation event
- Time-limited (1 hour)
- Cannot perform destructive actions
- Audit trail shows actual admin

### Credential Handling

- Secrets stored in AWS Secrets Manager
- Never displayed in UI after creation
- Rotated on schedule
- Access logged

---

## Related Documentation

- [ADMIN_PANEL.md](./ADMIN_PANEL.md) - Admin panel architecture
- [CLIENT_ADMIN_REQUIREMENTS.md](./CLIENT_ADMIN_REQUIREMENTS.md) - Tenant admin features
- [ROW_LEVEL_SECURITY.md](../security/ROW_LEVEL_SECURITY.md) - RLS specification
- [AURORA_CLUSTERS.md](./AURORA_CLUSTERS.md) - Database cluster management
- [MULTI_TENANT.md](./MULTI_TENANT.md) - Multi-tenant architecture
