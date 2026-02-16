# Tenant SSO Architecture Review

> Full review of the Cohi SSO implementation — architecture assessment, security findings, and recommendations.
>
> **Reviewed:** February 2026
> **Scope:** All SSO-related backend routes, services, middleware, database schemas, and admin tooling.

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Architecture Overview](#architecture-overview)
- [What's Working Well](#whats-working-well)
- [Security Findings](#security-findings)
- [Implementation Gaps](#implementation-gaps)
- [Database Schema Issues](#database-schema-issues)
- [Recommendations](#recommendations)
- [File Reference](#file-reference)

---

## Executive Summary

The SSO system is **functional and production-ready for current usage patterns**. The core authentication flow (Cognito SAML/OIDC federation → JWT issuance → session tracking) is well-implemented. However, there are several security hardening items and operational gaps that should be addressed before scaling to more tenants.

### Severity Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **High** | 3 | Should fix before onboarding new SSO-only tenants |
| **Medium** | 5 | Should fix in next 1-2 sprints |
| **Low** | 4 | Nice-to-have improvements |

---

## Architecture Overview

### Authentication Methods (4 paths, 1 JWT)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Cohi Authentication Layer                         │
│                                                                          │
│   ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────┐    │
│   │   Cognito    │  │   Coheus    │  │  Direct  │  │    Local     │    │
│   │ SAML / OIDC  │  │   Bridge    │  │   OIDC   │  │ Email / Pwd  │    │
│   │ (primary)    │  │  (legacy)   │  │ (self-   │  │ (internal)   │    │
│   │              │  │             │  │  hosted) │  │              │    │
│   └──────┬───────┘  └──────┬──────┘  └────┬─────┘  └──────┬───────┘    │
│          │                 │               │               │            │
│          └─────────────────┴───────────────┴───────────────┘            │
│                                    │                                     │
│                            ┌───────▼───────┐                            │
│                            │  Unified JWT   │                            │
│                            │  (7-day exp)   │                            │
│                            └───────┬───────┘                            │
│                                    │                                     │
│                            ┌───────▼───────┐                            │
│                            │  auth.ts       │                            │
│                            │  middleware     │                            │
│                            └───────────────┘                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### Cognito SAML Flow (Primary SSO Path)

```
User → Login Page → Email domain lookup → Redirect to Cognito
  → Cognito redirects to tenant IdP (Okta/Azure AD/etc.)
  → User authenticates at IdP
  → IdP redirects to Cognito → Cognito redirects to /auth/sso/callback
  → Frontend POSTs code to /api/auth/cognito/callback
  → Backend exchanges code for tokens via Cognito
  → Backend verifies ID token (aws-jwt-verify)
  → JIT user provisioning (create if not exists)
  → Cohi JWT issued → session stored → user logged in
```

### Key Infrastructure

| Component | Detail |
|-----------|--------|
| **Cognito User Pool** | `us-east-2_lArr8IsFK` (single pool, all tenants) |
| **IdP naming** | `tenant-{slug}-{provider}` (e.g., `tenant-acme-okta`) |
| **JWT expiry** | 7 days, no refresh token |
| **Session storage** | `sessions` table (SHA-256 token hash) |
| **Audit log** | `sso_login_history` table (per tenant DB) |
| **Tenant routing** | Email domain → `tenant_identity_providers` lookup |

---

## What's Working Well

### 1. Multi-Tenant Isolation via Single Cognito Pool
Using one Cognito User Pool with per-tenant IdP naming (`tenant-{slug}-{provider}`) is a sound architectural choice. It keeps infrastructure simple while supporting many tenants, and the `identity_provider` hint in the authorize URL routes users to the correct IdP without cross-tenant leakage.

### 2. JIT (Just-In-Time) User Provisioning
Users are automatically created on first SSO login. This eliminates the need for manual user creation and keeps Cohi in sync with the customer's IdP. Platform users from allowed domains (`teraverde.com`, `coheus.io`, `coheus.com`) are auto-provisioned as super admins.

### 3. CSRF Protection on SSO Flow
The state parameter includes a nonce and a 5-minute timestamp, preventing replay and CSRF attacks on the OAuth callback.

### 4. Session Tracking and Audit Logging
Every SSO login is recorded in `sso_login_history` with user email, provider, status, IP address, and IdP subject. Sessions are tracked with token hashes. This is good for compliance and debugging.

### 5. Admin UI for SSO Configuration
The `SSOConfigSection.tsx` admin component and `/api/admin/sso/config` endpoints allow tenant admins to configure SSO (upload SAML metadata, set email domains, test the flow) without needing direct Cognito Console access.

### 6. Email Domain Routing
The email domain → tenant mapping via `tenant_identity_providers.email_domains` (with GIN index) is a clean and performant approach for routing users to the correct IdP during login.

### 7. Three Authentication Modes
The hybrid / sso_preferred / sso_only progression with a documented migration guide (`SSO_MIGRATION_GUIDE.md`) is well thought out for gradual rollouts.

---

## Security Findings

### HIGH-1: No Session Validation in Auth Middleware

**File:** `server/src/middleware/auth.ts`

**Issue:** The `authenticateToken()` middleware only verifies the JWT signature and expiry. It does **not** check if the session exists in the `sessions` table. This means:
- A revoked/logged-out user can still access the API until their JWT expires (up to 7 days)
- There is no way to force-logout a compromised user

**Risk:** If a JWT is leaked or a user is deactivated, they retain access for up to 7 days.

**Recommendation:** Add a session existence check in the middleware. For performance, use a Redis cache or in-memory LRU cache of revoked token hashes rather than a database query on every request.

```typescript
// Pseudocode for the fix
const tokenHash = sha256(token);
const isRevoked = await checkRevokedCache(tokenHash);
if (isRevoked) return res.status(401).json({ error: 'Session revoked' });
```

---

### HIGH-2: Hardcoded Platform JIT Domains

**File:** `server/src/routes/auth/cognitoAuth.ts` (lines ~399-403)

**Issue:** The domains that receive automatic `super_admin` provisioning are hardcoded:

```typescript
const PLATFORM_JIT_DOMAINS = ['teraverde.com', 'coheus.io', 'coheus.com'];
```

**Risk:** If an attacker gains control of any of these domains (domain expiry, DNS hijack, compromised email), they get automatic super admin access to the entire platform. Additionally, any code change to this list requires a deployment.

**Recommendation:** Move to an environment variable or database configuration:

```bash
PLATFORM_JIT_DOMAINS=teraverde.com,coheus.io,coheus.com
```

---

### HIGH-3: No Rate Limiting on Auth Endpoints

**Files:** `server/src/routes/auth/cognitoAuth.ts`, `server/src/routes/admin/ssoConfig.ts`

**Issue:** The `/api/auth/cognito/callback`, `/api/auth/cognito/authorize`, and `/api/auth/cognito/lookup-tenant` endpoints have no rate limiting. An attacker could:
- Brute-force authorization codes on the callback endpoint
- Enumerate email domains via the lookup endpoint
- Flood the authorize endpoint to generate excessive Cognito requests (cost attack)

**Recommendation:** Add rate limiting middleware (e.g., `express-rate-limit`) to all auth endpoints:

```typescript
// Suggested limits
'/api/auth/cognito/callback'     → 10 req/min per IP
'/api/auth/cognito/authorize'    → 20 req/min per IP
'/api/auth/cognito/lookup-tenant' → 30 req/min per IP
'/api/auth/cognito/logout'       → 10 req/min per IP
```

---

### MEDIUM-1: Lenient State Parameter Validation

**File:** `server/src/routes/auth/cognitoAuth.ts` (line ~194)

**Issue:** When the state parameter is missing from the callback, the code logs a warning but **continues processing**. This weakens CSRF protection since the flow completes without state validation.

**Recommendation:** Reject callbacks without a valid state parameter. The only exception should be a documented development/testing bypass.

---

### MEDIUM-2: SAML Metadata Fetched Over HTTP

**File:** `server/src/routes/admin/ssoConfig.ts` (line ~92)

**Issue:** When configuring an SSO provider, the admin can provide a metadata URL. The code fetches this URL without enforcing HTTPS. An attacker could:
- Perform a man-in-the-middle attack on the metadata fetch
- Provide an internal/private IP (SSRF attack)

**Recommendation:**
1. Enforce HTTPS-only metadata URLs
2. Validate the URL is not an internal/private IP range
3. Set a reasonable timeout on the fetch

---

### MEDIUM-3: 7-Day JWT Without Refresh

**Files:** `server/src/routes/auth/cognitoAuth.ts`

**Issue:** JWTs are issued with a 7-day expiry and there is no refresh token mechanism. This is a long-lived token that, if leaked, provides prolonged access.

**Recommendation:** Implement a shorter-lived access token (15-60 minutes) with a refresh token flow, or at minimum reduce the JWT lifetime to 24 hours and implement silent re-authentication via Cognito session.

---

### MEDIUM-4: Authorization Inconsistency in SSO Admin Routes

**File:** `server/src/routes/admin/ssoConfig.ts`

**Issue:** Some admin endpoints read tenant context from `req.query.tenant_id` while others use `req.tenantId` (from JWT). This inconsistency could lead to authorization bypass if a tenant admin passes a different tenant's ID in the query string.

**Recommendation:** Always use `req.tenantId` from the authenticated JWT for tenant-scoped operations. Only allow `req.query.tenant_id` override for verified `super_admin` users.

---

### MEDIUM-5: SSO History Endpoint References Wrong Table

**File:** `server/src/routes/admin/ssoConfig.ts` (line ~758)

**Issue:** The `/api/admin/sso/history` endpoint queries `sso_auth_logs` table, but the actual table created by migration `011_sso_config.sql` is `sso_login_history`. This endpoint likely returns an error or empty results.

**Recommendation:** Update the query to reference `sso_login_history`.

---

### LOW-1: No Automatic Cleanup of Old SSO Login History

**File:** `server/migrations/tenant/011_sso_config.sql`

**Issue:** The `sso_login_history` table has a comment about 90-day retention but no automatic cleanup mechanism (no scheduled job, no partition-based pruning).

**Recommendation:** Add a scheduled cleanup job or use PostgreSQL table partitioning with automatic partition dropping.

---

### LOW-2: Unused Token Refresh Implementation

**File:** `server/src/services/cognito/cognitoService.ts`

**Issue:** `refreshTokens()` and `verifyAccessToken()` are implemented but never called. Dead code increases maintenance burden and can be confusing.

**Recommendation:** Either integrate these into the auth flow (recommended — see MEDIUM-3) or remove them.

---

### LOW-3: Unused `sso_configs` Tenant Table

**File:** `server/migrations/tenant/011_sso_config.sql`

**Issue:** The `sso_configs` table is created in every tenant database but is not referenced by any application code. SSO configuration is managed through the management database's `tenant_identity_providers` table instead.

**Recommendation:** Remove the `sso_configs` table creation from tenant migrations, or document it as reserved for future self-hosted use.

---

### LOW-4: Cognito IdP Name Collision Risk

**File:** `server/src/routes/admin/ssoConfig.ts` (lines ~186-192)

**Issue:** Cognito IdP names are generated as `tenant-{slug}-{provider}`. If tenant slugs are similar (e.g., `acme` and `acme-corp`), names could collide or cause confusion. Cognito IdP names must be unique within a pool.

**Recommendation:** Include a hash or tenant ID fragment in the IdP name, or validate uniqueness before creation.

---

## Implementation Gaps

### 1. No Token Revocation Mechanism
There is no way to immediately invalidate a user's session. The `sessions` table exists but is write-only — the auth middleware never checks it. This needs the fix described in HIGH-1.

### 2. No SSO Readiness Report API
The `SSO_MIGRATION_GUIDE.md` references a `/api/admin/tenants/{tenant_id}/sso-readiness` endpoint, but this does not appear to be implemented. This is needed for the hybrid → SSO-only migration workflow.

### 3. No Automatic Session Cleanup
Expired sessions accumulate in the `sessions` table with no cleanup job. Over time this will degrade query performance and waste storage.

### 4. No IdP Health Monitoring
There is no mechanism to detect when a tenant's IdP is down (e.g., Okta outage). Failed SSO attempts are logged, but there are no alerts or automatic fallback to hybrid mode.

### 5. Missing Logout Propagation
The Cognito logout endpoint redirects the user but does not perform Single Logout (SLO) back to the IdP. The user's IdP session may remain active, which is a concern for shared/kiosk devices.

### 6. No Multi-IdP Per Tenant Support (Partial)
The `tenant_identity_providers` table supports multiple IdPs per tenant (e.g., Okta for employees + Azure AD for contractors), but the login flow only routes to the primary IdP. Secondary IdP selection is not exposed in the UI.

---

## Database Schema Issues

### Management Database (`coheus_management`)

| Table | Status | Notes |
|-------|--------|-------|
| `tenant_identity_providers` | Active, used | Primary SSO config table. Well-indexed. |
| `coheus_tenants.auth_config` | Active, used | JSONB column for auth mode. Works but not validated. |
| `sessions` | Active, partially used | Written to but never read by middleware. |

### Tenant Database (per tenant)

| Table | Status | Notes |
|-------|--------|-------|
| `sso_configs` | Created but unused | Code uses management table instead. Should remove or repurpose. |
| `sso_login_history` | Active, used | Audit trail working. No cleanup job. |

### Schema Recommendations

1. Add a `CHECK` constraint on `coheus_tenants.auth_config` to validate the JSONB structure
2. Add an index on `sessions.expires_at` for efficient cleanup queries
3. Add an index on `sessions.token_hash` for revocation checks (if implementing HIGH-1)
4. Consider adding `last_sso_login_at` to `tenant_identity_providers` for health monitoring

---

## Recommendations

### Priority 1 — Before Next Tenant Onboarding

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 1 | HIGH-1: No session validation | Add token hash check in auth middleware + Redis/LRU cache | 2-3 days |
| 2 | HIGH-2: Hardcoded JIT domains | Move to env var `PLATFORM_JIT_DOMAINS` | 1 hour |
| 3 | HIGH-3: No rate limiting | Add `express-rate-limit` to auth routes | 0.5 days |
| 4 | MEDIUM-5: Wrong table name | Fix `sso_auth_logs` → `sso_login_history` in history endpoint | 15 min |

### Priority 2 — Next 1-2 Sprints

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 5 | MEDIUM-1: Lenient state validation | Reject callbacks without valid state | 0.5 days |
| 6 | MEDIUM-2: HTTP metadata fetch | Enforce HTTPS, add SSRF protection | 0.5 days |
| 7 | MEDIUM-4: Auth inconsistency | Standardize tenant context in admin routes | 1 day |
| 8 | Gap: Session cleanup | Add scheduled job to prune expired sessions | 0.5 days |
| 9 | Gap: SSO readiness API | Implement the readiness report endpoint | 1-2 days |

### Priority 3 — Backlog

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 10 | MEDIUM-3: Long JWT lifetime | Implement refresh token flow or reduce to 24h | 2-3 days |
| 11 | LOW-3: Unused `sso_configs` table | Remove from tenant migrations | 0.5 days |
| 12 | Gap: IdP health monitoring | Add alerting on SSO failure rate spikes | 1-2 days |
| 13 | Gap: Single Logout (SLO) | Implement SAML SLO back to IdP | 2-3 days |
| 14 | Gap: Multi-IdP UI | Add secondary IdP selection in login flow | 1-2 days |

---

## File Reference

### Backend — Authentication

| File | Purpose |
|------|---------|
| `server/src/routes/auth/cognitoAuth.ts` | Cognito SSO routes (authorize, callback, logout, lookup) |
| `server/src/services/cognito/cognitoService.ts` | Token exchange, ID token verification, URL builders |
| `server/src/middleware/auth.ts` | JWT validation middleware |
| `server/src/routes/admin/ssoConfig.ts` | SSO configuration admin API |

### Frontend — Authentication

| File | Purpose |
|------|---------|
| `src/pages/SSOCallback.tsx` | OAuth callback handler (exchanges code, stores JWT) |
| `src/components/admin/SSOConfigSection.tsx` | SSO configuration admin UI |
| `src/contexts/AuthContext.tsx` | Auth state, token storage, login/logout |

### Database — Migrations

| File | Purpose |
|------|---------|
| `server/migrations/management/003_auth_config.sql` | `tenant_identity_providers` table, `auth_config` column |
| `server/migrations/tenant/011_sso_config.sql` | `sso_configs` (unused), `sso_login_history` |

### Documentation

| File | Purpose |
|------|---------|
| `docs/security/SSO_AUTHENTICATION.md` | SSO architecture and flows |
| `docs/security/SSO_MIGRATION_GUIDE.md` | Hybrid → SSO-only migration |
| `docs/architecture/MULTI_TENANT.md` | Multi-tenant architecture |

---

## Conclusion

The SSO system is architecturally sound and covers the major use cases (Cognito SAML federation, legacy Qlik bridge, local auth). The main areas for improvement are:

1. **Security hardening** — session validation, rate limiting, and input validation need immediate attention
2. **Operational tooling** — session cleanup, SSO readiness reporting, and IdP health monitoring are needed for smooth tenant operations
3. **Token lifecycle** — the 7-day JWT without refresh is a risk that should be addressed as the user base grows

None of these are blocking for current operations, but they should be addressed before scaling the SSO-only mode to more tenants.
