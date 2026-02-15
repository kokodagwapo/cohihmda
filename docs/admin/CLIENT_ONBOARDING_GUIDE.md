# Client Onboarding Guide

> Step-by-step guide for onboarding a new client onto the Cohi platform — from initial tenant creation through Encompass integration, SSO configuration, user setup, and go-live.

---

## Table of Contents

- [Onboarding Overview](#onboarding-overview)
- [Prerequisites](#prerequisites)
- [Phase 1: Tenant Provisioning](#phase-1-tenant-provisioning)
- [Phase 2: Encompass / LOS Integration](#phase-2-encompass--los-integration)
- [Phase 3: SSO Configuration](#phase-3-sso-configuration)
- [Phase 4: User Setup](#phase-4-user-setup)
- [Phase 5: Configuration and Tuning](#phase-5-configuration-and-tuning)
- [Phase 6: Data Sync and Validation](#phase-6-data-sync-and-validation)
- [Phase 7: Go-Live](#phase-7-go-live)
- [Post-Onboarding](#post-onboarding)
- [Onboarding Checklist](#onboarding-checklist)
- [Troubleshooting](#troubleshooting)
- [Appendix: IdP Setup Guides](#appendix-idp-setup-guides)

---

## Onboarding Overview

### Timeline

| Phase | Duration | Owner |
|-------|----------|-------|
| 1. Tenant Provisioning | 30 minutes | Cohi Admin |
| 2. Encompass Integration | 1-3 days | Cohi Admin + Client IT |
| 3. SSO Configuration | 1-2 days | Cohi Admin + Client IT |
| 4. User Setup | 1 day | Cohi Admin + Client Admin |
| 5. Configuration / Tuning | 1-3 days | Cohi Admin + Client Stakeholders |
| 6. Data Sync / Validation | 1-2 days | Cohi Admin |
| 7. Go-Live | 1 day | All |

**Total: 1-2 weeks** (depending on client IT responsiveness for SSO/Encompass setup)

### Roles

| Role | Responsibilities |
|------|-----------------|
| **Cohi Admin** (super_admin) | Tenant creation, system configuration, troubleshooting |
| **Client IT / SSO Admin** | IdP configuration (Okta/Azure AD), Encompass API credentials |
| **Client Tenant Admin** | User management, scoring weights, org-specific settings |
| **Client Stakeholders** | Validate data, approve configuration, sign off on go-live |

### Information to Collect Before Starting

Gather this from the client before beginning:

```
Company Information
├── Company name
├── Preferred tenant slug (URL-friendly, e.g., "acme-mortgage")
├── Primary contact name and email
├── Time zone
└── Deployment type: SaaS (cloud) or self-hosted

SSO Information
├── Identity Provider: Okta / Azure AD (Entra) / Ping / Google Workspace / Other
├── Email domain(s) (e.g., acmemortgage.com, acme.io)
├── IT admin contact for IdP configuration
└── Preferred auth mode: hybrid / sso-preferred / sso-only

Encompass / LOS Information
├── LOS type: Encompass / MeridianLink / Other
├── Encompass Instance ID (e.g., BE11111111)
├── Authentication method: Partner Connect (preferred) / Service Account (ROPC)
├── Encompass admin contact
├── Loan folders to sync (e.g., "My Pipeline", "Processing", "Closed Loans")
├── Custom fields in use (any non-standard field IDs)
└── Approximate loan volume (for sync planning)
```

---

## Prerequisites

### Platform Requirements

Before onboarding a new client, confirm:

- [ ] Management database (`coheus_management`) is running and migrated
- [ ] Backend server is deployed and healthy
- [ ] Frontend is deployed and accessible
- [ ] AWS Cognito User Pool is configured (for SSO tenants)
- [ ] You have `super_admin` access to the Cohi admin panel

### Required Access

| System | Access Needed |
|--------|--------------|
| Cohi Admin Panel | super_admin account |
| AWS Console | Cognito User Pool access (for IdP management) |
| AWS Secrets Manager | For storing Encompass Partner Connect credentials |
| Client's Encompass | Admin-level access or credentials from client |
| Client's IdP | Admin access or IT contact who can configure SAML apps |

---

## Phase 1: Tenant Provisioning

### Step 1.1: Create the Tenant

**Via Admin UI** (recommended):

1. Log in to Cohi as `super_admin`
2. Navigate to **Admin** → **Tenants**
3. Click **Create Tenant**
4. Fill in:
   - **Name:** Client's company name (e.g., "Acme Mortgage")
   - **Slug:** URL-friendly identifier (e.g., `acme-mortgage`) — this becomes the database name
   - **Deployment Type:** `cloud` for SaaS clients
5. Click **Create**

**Via API** (alternative):

```bash
POST /api/tenants
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "name": "Acme Mortgage",
  "slug": "acme-mortgage",
  "deployment_type": "cloud"
}
```

**Expected response:**

```json
{
  "id": "a1b2c3d4-...",
  "name": "Acme Mortgage",
  "slug": "acme-mortgage",
  "status": "active",
  "database_name": "coheus_tenant_acme-mortgage"
}
```

### Step 1.2: Verify Tenant Provisioning

The system automatically:
1. Creates a PostgreSQL database (`coheus_tenant_acme-mortgage`)
2. Runs the full tenant schema (tables, indexes, functions)
3. Applies all tenant migrations
4. Seeds default configuration (personas, scoring weights, range rules, roles)
5. Sets tenant status to `active`

**Verify:**

```bash
GET /api/tenants/<tenant_id>
# Status should be "active"
```

Or check in the Admin UI — the tenant should appear in the tenant list with a green status.

### Step 1.3: Create the Initial Tenant Admin

Create the client's first admin user so they can access the admin panel:

**Via Admin UI:**

1. Navigate to **Admin** → **Tenants** → select the new tenant
2. Click **Add User**
3. Fill in:
   - **Email:** Client admin's email
   - **Full Name:** Client admin's name
   - **Role:** `tenant_admin`
   - **Password:** Temporary password (client will change on first login)

**Via API:**

```bash
POST /api/admin/tenants/<tenant_id>/users
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "email": "admin@acmemortgage.com",
  "full_name": "Jane Smith",
  "role": "tenant_admin",
  "password": "TemporaryP@ss123!"
}
```

> **Note:** If SSO will be configured, this password is only used during initial setup. Once SSO is enabled, the user authenticates via their corporate IdP.

---

## Phase 2: Encompass / LOS Integration

### Step 2.1: Determine Authentication Method

| Method | Best For | Requirements |
|--------|----------|-------------|
| **Partner Connect** (recommended) | Production clients | Encompass Partner Connect enrollment, AWS Secrets Manager ARN |
| **Service Account (ROPC)** | Quick setup, testing | Encompass service account username/password |
| **API Key** (legacy) | Legacy integrations | Encompass API key |

**For Partner Connect** — the client must:
1. Enroll Cohi as a Partner Connect integration in Encompass Settings
2. Provide the OAuth client credentials (stored in AWS Secrets Manager)
3. Grant appropriate API permissions (loan read, user read)

**For Service Account (ROPC)** — the client must:
1. Create a service account in Encompass (Settings → Users)
2. Grant it API access and read permissions on target loan folders
3. Provide the username and password to Cohi admin

### Step 2.2: Create the LOS Connection

**Via Admin UI:**

1. Navigate to **Admin** → **LOS Settings** (or **Encompass Settings** if tenant-scoped)
2. Click **Add Connection**
3. Fill in:
   - **LOS Type:** Encompass
   - **Connection Name:** e.g., "Production Encompass"
   - **Instance ID:** The client's Encompass instance ID (e.g., `BE11111111`)
   - **Authentication Method:** Partner Connect or ROPC
   - **Credentials:** Either the Secrets Manager ARN or encrypted username/password
4. Click **Save**

**Via API:**

```bash
POST /api/admin/los-connections
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "los_type": "encompass",
  "name": "Production Encompass",
  "connection_method": "api",
  "encompass_instance_id": "BE11111111",
  "encompass_api_server": "https://api.elliemae.com",
  "encompass_extraction_method": "partner",
  "encompass_secret_arn": "arn:aws:secretsmanager:us-east-1:123456789:secret:acme-encompass-creds",
  "sync_enabled": true,
  "sync_frequency": "hourly"
}
```

### Step 2.3: Test the Connection

```bash
POST /api/admin/los-connections/<connection_id>/test
Authorization: Bearer <super_admin_jwt>
```

Expected response:

```json
{
  "status": "success",
  "message": "Successfully connected to Encompass instance BE11111111",
  "loan_count": 1523,
  "folders_available": ["My Pipeline", "Processing", "Underwriting", "Closed Loans"]
}
```

If the test fails, check:
- Encompass Instance ID is correct
- Credentials are valid and not expired
- Service account has appropriate permissions
- Network connectivity (if self-hosted)

### Step 2.4: Configure Loan Folders

Select which Encompass loan folders to sync:

```bash
PUT /api/admin/los-connections/<connection_id>
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "encompass_selected_folders": [
    "My Pipeline",
    "Processing",
    "Underwriting",
    "Closing",
    "Closed Loans",
    "Funded Loans"
  ]
}
```

### Step 2.5: Configure Field Mappings (If Needed)

If the client uses custom Encompass fields, configure field swaps:

**Via Admin UI:**

1. Navigate to **Admin** → **LOS Field Mapping** (or **Encompass Field Swaps**)
2. For each custom field:
   - Select the Cohi field alias (e.g., `loanAmount`, `borrowerFICO`)
   - Enter the client's custom Encompass field ID (e.g., `CX.CUSTOM.LOAN.AMT`)
3. Click **Save**

**Via API:**

```bash
POST /api/admin/encompass-field-swaps
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "swaps": [
    {
      "alias": "loanAmount",
      "custom_field_id": "CX.CUSTOM.LOAN.AMT",
      "description": "Custom loan amount field"
    }
  ]
}
```

> **Note:** Most clients use standard Encompass fields and don't need custom mappings. Only configure swaps if the client confirms they use non-standard field IDs.

---

## Phase 3: SSO Configuration

### Step 3.1: Choose the SSO Path

| Client Scenario | SSO Path |
|----------------|----------|
| New client, has Okta/Azure AD/Ping | Cognito SAML Federation |
| Existing Coheus/Qlik client | Coheus Bridge (zero reconfiguration) |
| Self-hosted deployment | Direct OIDC or Cognito in their AWS |
| Small client, no IdP | Local auth (email/password) |

### Step 3.2a: Cognito SAML Setup (New Clients)

This is the most common path for new clients.

#### Get Cohi's Service Provider (SP) Metadata

The client's IT team needs Cohi's SP metadata to configure their IdP:

```bash
GET /api/admin/sso/config
Authorization: Bearer <super_admin_jwt>

# Response includes sp_metadata with:
# - Entity ID
# - ACS URL (Assertion Consumer Service)
# - Required attributes (email, name)
```

**Or provide these values manually:**

| Setting | Value |
|---------|-------|
| **SP Entity ID** | `urn:amazon:cognito:sp:us-east-2_lArr8IsFK` |
| **ACS URL** | `https://<cognito-domain>.auth.us-east-2.amazoncognito.com/saml2/idpresponse` |
| **Name ID Format** | `urn:oasis:names:tc:SAML:2.0:nameid-format:emailAddress` |
| **Required Attributes** | `email` (required), `given_name` (optional), `family_name` (optional) |

#### Client IT: Configure Cohi as a SAML App in Their IdP

Send the client IT team instructions for their specific IdP. See [Appendix: IdP Setup Guides](#appendix-idp-setup-guides) for IdP-specific steps.

**What the client IT team provides back:**
- IdP Metadata URL (preferred) — e.g., `https://acme.okta.com/app/xyz/sso/saml/metadata`
- **OR** IdP Metadata XML file

#### Configure SSO in Cohi

**Via Admin UI:**

1. Navigate to **Admin** → **SSO Configuration**
2. Select the tenant
3. Click **Configure SSO**
4. Fill in:
   - **Provider Type:** SAML (Okta / Azure AD / Ping / Custom)
   - **IdP Metadata:** Paste URL or upload XML
   - **Email Domains:** `acmemortgage.com` (comma-separated if multiple)
5. Click **Save**

The system will:
1. Parse the SAML metadata
2. Create a Cognito IdP named `tenant-acme-mortgage-okta`
3. Add it to the Cognito App Client's supported providers
4. Store configuration in `tenant_identity_providers` table

**Via API:**

```bash
POST /api/admin/sso/config
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "tenant_id": "<tenant_id>",
  "provider_type": "saml",
  "provider_name": "okta",
  "metadata_url": "https://acme.okta.com/app/xyz/sso/saml/metadata",
  "email_domains": ["acmemortgage.com"],
  "is_enabled": true,
  "is_primary": true,
  "attribute_mapping": {
    "email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    "given_name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
    "family_name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"
  }
}
```

#### Test the SSO Flow

```bash
POST /api/admin/sso/test
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "tenant_id": "<tenant_id>"
}
```

This returns a test URL. Open it in a browser and verify:
1. You're redirected to the client's IdP login page
2. After authenticating, you're redirected back to Cohi
3. A user session is created successfully
4. The `sso_login_history` table has a record with `status: 'success'`

### Step 3.2b: Coheus Bridge Setup (Legacy Qlik Clients)

For clients already using Coheus (Qlik), no SSO reconfiguration is needed:

1. **Map the Qlik User Directory to the Cohi tenant** — set `qlik_user_directory` in the SSO config
2. **Install the Cohi launcher** in the client's Qlik environment (mashup or extension)
3. Users click "Launch Cohi" in Qlik and are automatically authenticated via the Qlik session

### Step 3.3: Set Authentication Mode

Start with **hybrid** mode (email/password + SSO both available) during setup:

```bash
PUT /api/admin/sso/auth-mode
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "tenant_id": "<tenant_id>",
  "mode": "hybrid",
  "allow_email_password": true,
  "allow_sso": true
}
```

After validating SSO works, migrate to SSO-preferred or SSO-only per the [SSO Migration Guide](../security/SSO_MIGRATION_GUIDE.md).

---

## Phase 4: User Setup

### Step 4.1: Sync Encompass Users (Recommended)

If the client uses Encompass, pull their user list directly:

```bash
POST /api/admin/encompass-users/sync
Authorization: Bearer <super_admin_jwt>
```

This fetches all enabled users from Encompass and stores them in the `encompass_users` table. Each user record includes:
- Encompass User ID
- Full name
- Email
- Whether they've been invited to Cohi

### Step 4.2: Invite Users

For each user that should have Cohi access:

**Via Admin UI:**

1. Navigate to **Admin** → **Encompass Users**
2. Review the synced user list
3. Click **Invite** next to each user (or bulk-invite)
4. Choose invitation method:
   - **SSO-only:** User will log in via SSO on first visit (no password needed)
   - **Email invite:** Sends email with login link
   - **Manual password:** Set a temporary password

**Via API:**

```bash
POST /api/admin/encompass-users/<encompass_user_id>/invite
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "role": "loan_officer",
  "invitation_method": "sso"
}
```

### Step 4.3: Assign Roles

| Role | Access Level | Typical User |
|------|-------------|-------------|
| `tenant_admin` | Full tenant access, admin panel | Client's system administrator |
| `loan_officer` | Own loans only (scoped by Encompass User ID) | Loan officers |
| `processor` | Assigned loans | Processors |
| `user` | Standard access to dashboards | Operations managers, branch managers |
| `viewer` | Read-only | Executives, stakeholders |

### Step 4.4: JIT Provisioning (Alternative to Manual Setup)

If SSO is enabled, users can be automatically created on first login (JIT provisioning). The system will:
1. Detect the user's email domain matches the tenant
2. Create a user record with default role (`user`)
3. Link the SSO identity
4. The tenant admin can then adjust roles as needed

This is the simplest approach for large organizations — just configure SSO and tell users to log in.

---

## Phase 5: Configuration and Tuning

### Step 5.1: Personas

Personas control what dashboards and data views are available. Five defaults are seeded:

1. **Lender Admin** — Full access to all dashboards
2. **Operations Manager** — Operations scorecard and pipeline views
3. **Sales Manager** — Sales scorecard and production views
4. **Loan Officer** — Personal pipeline and performance
5. **Executive** — High-level KPIs and trends

Review with the client and customize if needed via **Admin** → **Personas**.

### Step 5.2: Scoring Weights

Scoring weights determine how loans are evaluated on the scorecards. Defaults are provided but should be tuned to the client's priorities:

- **Sales TTS (Time to Start)** weights
- **Operations TTS (Time to Start)** weights
- **Fallout risk weights**
- **Complexity scoring weights**

Configure via **Admin** → **Scoring Configuration** or the API.

### Step 5.3: Range Rules

Range rules define the color-coding thresholds for scorecard metrics (green/yellow/red). Defaults include:

- LTV thresholds
- DTI thresholds
- FICO score bands
- Days-in-stage targets
- Pull-through rate benchmarks

Review with the client and adjust to match their operational targets.

### Step 5.4: Revenue Formula

The default revenue calculation formula may need adjustment based on the client's fee structure. Configure via the admin panel.

### Step 5.5: RAG Settings (Optional)

If the client will use the AI-powered Cohi Chat feature, configure:
- RAG document uploads (policies, guidelines)
- AI model settings
- Persona-specific prompts

---

## Phase 6: Data Sync and Validation

### Step 6.1: Trigger Initial Data Sync

Run the first full loan sync from Encompass:

```bash
POST /api/admin/los-connections/<connection_id>/sync
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "sync_type": "full"
}
```

**Expected timeline by loan volume:**

| Loan Count | Sync Duration |
|-----------|---------------|
| < 1,000 | 5-15 minutes |
| 1,000-5,000 | 15-45 minutes |
| 5,000-20,000 | 1-3 hours |
| 20,000+ | 3-8 hours |

Monitor sync progress in the admin panel or via API.

### Step 6.2: Validate Data Quality

After the initial sync, verify:

1. **Loan count** — Does the count in Cohi match Encompass?
   ```bash
   GET /api/admin/los-connections/<connection_id>/sync-status
   ```

2. **Field mapping** — Spot-check 5-10 loans:
   - Loan amount matches Encompass
   - Borrower name/FICO/DTI populated
   - Loan status correct
   - Dates (application, closing, lock expiration) populated

3. **Personnel mapping** — Verify loan officers are correctly associated:
   - Loan officer names match
   - `encompass_user_id` links are correct
   - Processor/underwriter/closer fields populated

4. **Missing data** — Check for systematic gaps:
   ```bash
   GET /api/admin/data-quality/report
   ```

### Step 6.3: Enable Incremental Sync

After validating the initial sync, enable scheduled incremental syncs:

```bash
PUT /api/admin/los-connections/<connection_id>
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "sync_enabled": true,
  "sync_frequency": "hourly"
}
```

Incremental syncs only fetch loans modified since the last sync, keeping Cohi data fresh without full re-extraction.

---

## Phase 7: Go-Live

### Step 7.1: Pre-Go-Live Checklist

- [ ] Tenant provisioned and active
- [ ] Encompass connection tested and syncing
- [ ] SSO configured and tested
- [ ] Users created/invited
- [ ] Scoring weights reviewed with client
- [ ] Range rules reviewed with client
- [ ] Data validated (loan counts, field accuracy)
- [ ] Client tenant admin trained on admin panel
- [ ] Support escalation path documented

### Step 7.2: Soft Launch

Recommended approach — roll out in stages:

1. **Week 1:** Enable for tenant admins and power users only (5-10 users)
2. **Week 2:** Enable for all managers (20-50 users)
3. **Week 3:** Enable for all users (full organization)

This catches configuration issues before they affect the entire organization.

### Step 7.3: Client Communication

Send the client:

1. **Login URL:** `https://app.cohi.io` (or custom domain if configured)
2. **Login instructions:**
   - For SSO: "Log in with your corporate email — you'll be redirected to your company's login page"
   - For email/password: "Use the email and temporary password provided by your admin"
3. **Support contact:** Who to reach out to for issues
4. **Quick start guide:** Overview of dashboards and features available

### Step 7.4: Migrate to SSO-Only (When Ready)

After confirming SSO works for all users, follow the [SSO Migration Guide](../security/SSO_MIGRATION_GUIDE.md) to transition from hybrid to SSO-only mode.

---

## Post-Onboarding

### Ongoing Monitoring

| Check | Frequency | How |
|-------|-----------|-----|
| Loan sync health | Daily (automated) | Admin panel → Sync Status |
| SSO login success rate | Weekly | Admin panel → SSO History |
| Data freshness | Daily (automated) | Check last sync timestamp |
| User activity | Weekly | Login audit logs |
| System errors | Daily (automated) | CloudWatch / server logs |

### Common Post-Onboarding Requests

| Request | Action |
|---------|--------|
| Add new users | Sync Encompass users or create manually |
| Add email domains | Update SSO config with additional domains |
| Custom field mapping | Add field swaps in LOS settings |
| Adjust scoring | Update scoring weights in admin panel |
| Add loan folders | Update LOS connection folder list |
| Role changes | Update user roles in admin panel |

### Tenant Configuration Export/Import

For setting up similar tenants, you can export a tenant's configuration and import it into a new tenant:

```bash
# Export
GET /api/admin/tenants/<source_tenant_id>/config/export

# Import into new tenant
POST /api/admin/tenants/<target_tenant_id>/config/import
```

This copies personas, scoring weights, range rules, and other configuration — but not user data or loan data.

---

## Onboarding Checklist

Print this checklist for each new client onboarding:

```
CLIENT: ________________________    DATE: _______________
COHI ADMIN: ____________________    TENANT SLUG: ________

PHASE 1: TENANT PROVISIONING
[ ] Tenant created (name, slug, cloud)
[ ] Tenant status = active
[ ] Initial tenant admin user created
[ ] Tenant admin can log in

PHASE 2: ENCOMPASS INTEGRATION
[ ] Encompass Instance ID obtained
[ ] Authentication method chosen (Partner Connect / ROPC)
[ ] Credentials obtained and stored securely
[ ] LOS connection created
[ ] Connection test passed
[ ] Loan folders selected
[ ] Custom field swaps configured (if needed)

PHASE 3: SSO CONFIGURATION
[ ] IdP type identified (Okta / Azure AD / Ping / Other / None)
[ ] SP metadata provided to client IT
[ ] Client IT configured SAML app in their IdP
[ ] IdP metadata received from client
[ ] SSO configured in Cohi admin
[ ] SSO test passed
[ ] Email domain(s) configured
[ ] Auth mode set (hybrid initially)

PHASE 4: USER SETUP
[ ] Encompass user sync completed
[ ] Users invited (SSO / email / manual)
[ ] Roles assigned
[ ] Tenant admin access confirmed

PHASE 5: CONFIGURATION
[ ] Personas reviewed / customized
[ ] Scoring weights reviewed / customized
[ ] Range rules reviewed / customized
[ ] Revenue formula reviewed (if applicable)

PHASE 6: DATA SYNC
[ ] Initial full sync completed
[ ] Loan count validated
[ ] Field accuracy spot-checked (5-10 loans)
[ ] Personnel mapping verified
[ ] Incremental sync enabled

PHASE 7: GO-LIVE
[ ] Pre-go-live checklist complete
[ ] Soft launch (admins/power users)
[ ] Full launch (all users)
[ ] Client communication sent
[ ] Support escalation path documented

POST-ONBOARDING
[ ] First week monitoring complete
[ ] SSO-preferred mode enabled (if applicable)
[ ] SSO-only mode enabled (if applicable)
[ ] Client sign-off received
```

---

## Troubleshooting

### Tenant Provisioning

**Issue: Tenant creation fails with "database already exists"**

A previous provisioning attempt may have partially completed.

```bash
# Check if the database exists
SELECT datname FROM pg_database WHERE datname = 'coheus_tenant_acme-mortgage';

# If it exists but tenant status is not 'active', the schema may be incomplete.
# Option 1: Delete the database and re-create the tenant
# Option 2: Run migrations manually
```

**Issue: Tenant status stuck on "provisioning"**

Check the server logs for migration errors. Common cause: a migration failed due to a syntax error or dependency issue. Fix the migration and re-run:

```bash
POST /api/admin/tenants/<tenant_id>/run-migrations
```

---

### Encompass Integration

**Issue: "401 Unauthorized" on connection test**

- Partner Connect: Verify the Secrets Manager ARN is correct and credentials are current
- ROPC: Verify username/password, ensure the account isn't locked
- Check that the Encompass instance ID matches (common mix-up: `BE` prefix)

**Issue: "403 Forbidden" on loan retrieval**

The service account lacks permissions on the selected folders. Ask the client to grant folder access in Encompass.

**Issue: Sync completes but loan count is low**

- Check folder selection — some folders may be excluded
- Check date range — the sync may be filtering by date
- Verify the service account can see all loans (not just their own)

**Issue: Custom fields returning null**

- Verify the field ID is correct (e.g., `CX.CUSTOM.FIELD` not `Custom.FIELD`)
- Check that the custom field exists in the client's Encompass instance
- Ensure the field swap is configured correctly in Cohi

---

### SSO

**Issue: "User not found in organization" after SSO login**

The user's email domain is not in the SSO config's `email_domains` list.

```bash
PUT /api/admin/sso/config
{
  "email_domains": ["acmemortgage.com", "acme-subsidiary.com"]
}
```

**Issue: SSO redirect goes to wrong IdP**

The `identity_provider` hint may be incorrect. Check:
1. The Cognito IdP name matches what's configured
2. The email domain → IdP mapping is correct
3. No domain conflicts with another tenant

**Issue: "Invalid SAML response" after IdP authentication**

- The IdP's ACS URL may be wrong — should point to Cognito, not directly to Cohi
- The NameID format may not match (should be email)
- The IdP's signing certificate may have changed — re-upload metadata

**Issue: User created with wrong role after SSO login**

JIT provisioning creates users with the default `user` role. Adjust roles manually after first login, or pre-create users with the correct role before they log in via SSO.

---

### Data Quality

**Issue: FICO scores showing as 0 or null**

- The Encompass field for FICO may be mapped differently
- Some loans may genuinely lack FICO data (pre-qual stage)
- Check field swap configuration

**Issue: Loan officer names don't match**

- The Encompass user sync may not have completed
- The `loan_officer_id` field in Encompass may use a different user identifier
- Verify the Encompass User ID → Cohi user mapping

---

## Appendix: IdP Setup Guides

### Okta SAML Setup

Provide these instructions to the client's Okta administrator:

1. Log in to Okta Admin Console
2. Navigate to **Applications** → **Create App Integration**
3. Select **SAML 2.0**, click **Next**
4. Configure:
   - **App Name:** `Cohi`
   - **Single sign-on URL:** `https://<cognito-domain>.auth.us-east-2.amazoncognito.com/saml2/idpresponse`
   - **Audience URI (SP Entity ID):** `urn:amazon:cognito:sp:us-east-2_lArr8IsFK`
   - **Name ID format:** `EmailAddress`
   - **Application username:** `Email`
5. Configure Attribute Statements:

   | Name | Value |
   |------|-------|
   | `email` | `user.email` |
   | `given_name` | `user.firstName` |
   | `family_name` | `user.lastName` |

6. Click **Next** → **Finish**
7. Navigate to the app's **Sign On** tab
8. Copy the **Metadata URL** (under "SAML Signing Certificates" → Actions → View IdP Metadata)
9. Assign the Cohi app to users/groups who need access

**Provide back to Cohi Admin:** The Metadata URL from step 8.

---

### Azure AD (Entra ID) SAML Setup

Provide these instructions to the client's Azure AD administrator:

1. Log in to **Azure Portal** → **Microsoft Entra ID**
2. Navigate to **Enterprise Applications** → **New Application** → **Create your own application**
3. Name: `Cohi`, select **Integrate any other application**, click **Create**
4. Go to **Single sign-on** → select **SAML**
5. Configure **Basic SAML Configuration:**
   - **Identifier (Entity ID):** `urn:amazon:cognito:sp:us-east-2_lArr8IsFK`
   - **Reply URL (ACS):** `https://<cognito-domain>.auth.us-east-2.amazoncognito.com/saml2/idpresponse`
   - **Sign on URL:** `https://app.cohi.io` (optional)
6. Configure **Attributes & Claims:**
   - Required claim: `emailaddress` → `user.mail`
   - Optional: `givenname` → `user.givenname`
   - Optional: `surname` → `user.surname`
7. Download **Federation Metadata XML** (or copy the App Federation Metadata URL)
8. Under **Users and groups**, assign users/groups who need access

**Provide back to Cohi Admin:** The Federation Metadata XML or URL from step 7.

---

### Google Workspace SAML Setup

Provide these instructions to the client's Google Workspace administrator:

1. Log in to **Google Admin Console**
2. Navigate to **Apps** → **Web and mobile apps** → **Add App** → **Add custom SAML app**
3. Name: `Cohi`, click **Continue**
4. Copy the **SSO URL**, **Entity ID**, and download the **Certificate** (you'll need these)
5. Configure **Service provider details:**
   - **ACS URL:** `https://<cognito-domain>.auth.us-east-2.amazoncognito.com/saml2/idpresponse`
   - **Entity ID:** `urn:amazon:cognito:sp:us-east-2_lArr8IsFK`
   - **Name ID format:** `EMAIL`
   - **Name ID:** `Basic Information > Primary email`
6. Configure **Attribute mapping:**
   - `email` → `Basic Information > Primary email`
   - `given_name` → `Basic Information > First name`
   - `family_name` → `Basic Information > Last name`
7. Click **Finish**
8. Turn the app **ON** for the relevant organizational units

**Provide back to Cohi Admin:** The metadata from step 4 (SSO URL, Entity ID, Certificate).

---

### Ping Identity SAML Setup

Provide these instructions to the client's Ping administrator:

1. Log in to **PingOne Admin Console** (or PingFederate)
2. Navigate to **Applications** → **Add Application** → **New SAML Application**
3. Configure:
   - **Application Name:** `Cohi`
   - **ACS URL:** `https://<cognito-domain>.auth.us-east-2.amazoncognito.com/saml2/idpresponse`
   - **Entity ID:** `urn:amazon:cognito:sp:us-east-2_lArr8IsFK`
   - **Subject NameID Format:** `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress`
4. Configure Attribute Mapping:
   - `saml_subject` → `Email Address`
   - `email` → `Email Address`
   - `given_name` → `Given Name`
   - `family_name` → `Family Name`
5. Enable the application
6. Download/copy the IdP Metadata URL

**Provide back to Cohi Admin:** The IdP Metadata URL from step 6.

---

## Related Documentation

- [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) — SSO architecture and technical details
- [SSO_MIGRATION_GUIDE.md](../security/SSO_MIGRATION_GUIDE.md) — Migrating from hybrid to SSO-only
- [SSO_REVIEW.md](../security/SSO_REVIEW.md) — SSO security review and recommendations
- [ENCOMPASS_INTEGRATION.md](../data/integrations/ENCOMPASS_INTEGRATION.md) — Encompass integration details
- [ENCOMPASS_USER_SYNC.md](./ENCOMPASS_USER_SYNC.md) — Encompass user sync process
- [MULTI_TENANT.md](../architecture/MULTI_TENANT.md) — Multi-tenant architecture
- [DEPLOYMENT_RUNBOOK.md](../deployment/DEPLOYMENT_RUNBOOK.md) — Deployment procedures
