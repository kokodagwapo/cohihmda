# SSO Authentication Strategy

This document details the Single Sign-On (SSO) authentication strategy for Cohi, supporting both legacy Coheus (Qlik) clients and new direct integrations.

> **Naming Convention:**
>
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [Authentication Methods](#authentication-methods)
- [Coheus Bridge (Legacy Qlik Clients)](#coheus-bridge-legacy-qlik-clients)
- [Cognito SAML Federation (New Clients)](#cognito-saml-federation-new-clients)
- [Self-Hosted SSO](#self-hosted-sso)
- [Implementation Roadmap](#implementation-roadmap)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Client Onboarding](#client-onboarding)

---

## Overview

Cohi supports multiple authentication methods to accommodate different client scenarios:

1. **Coheus Bridge** - For existing Qlik/Coheus clients (zero reconfiguration)
2. **Cognito SAML** - For new clients configuring SSO directly
3. **Direct OIDC** - For self-hosted customers with OIDC-capable IdPs
4. **Local Auth** - For internal users and simple deployments

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          COHI AUTHENTICATION ARCHITECTURE                        │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────────┐
                              │    Cohi Auth Service    │
                              │    (Unified Gateway)    │
                              └───────────┬─────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
        ▼                                 ▼                                 ▼
┌───────────────────┐         ┌───────────────────┐         ┌───────────────────┐
│  COHEUS BRIDGE    │         │  COGNITO SAML     │         │  DIRECT LOGIN     │
│  (Phase 1)        │         │  (Phase 2)        │         │                   │
│                   │         │                   │         │                   │
│  Existing Qlik    │         │  New clients      │         │  Internal users   │
│  clients via      │         │  configure SAML   │         │  Admin access     │
│  QPS cookie       │         │  in Cognito       │         │  Support access   │
│                   │         │                   │         │                   │
│  IdPs: Any        │         │  IdPs: Okta,      │         │  Email/Password   │
│  (via Qlik SAML)  │         │  Azure AD, Ping,  │         │                   │
│                   │         │  Entra, etc.      │         │                   │
└───────────────────┘         └───────────────────┘         └───────────────────┘
        │                                 │                                 │
        └─────────────────────────────────┴─────────────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────┐
                              │    Unified Cohi JWT     │
                              │    (Standard Claims)    │
                              └─────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SELF-HOSTED SSO OPTIONS                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

  Customer's AWS Account
  ┌───────────────────────────────────────────────────────────────────────────┐
  │                                                                           │
  │   Option A: Cognito (Recommended)                                         │
  │   ┌─────────────────────────────────────────────────────────────────┐    │
  │   │  Customer's IdP ◄──── SAML ────► Cognito User Pool ──► Cohi    │    │
  │   └─────────────────────────────────────────────────────────────────┘    │
  │                                                                           │
  │   Option B: Direct OIDC                                                   │
  │   ┌─────────────────────────────────────────────────────────────────┐    │
  │   │  Customer's IdP ◄──── OIDC ────► Cohi Backend (direct)          │    │
  │   └─────────────────────────────────────────────────────────────────┘    │
  │                                                                           │
  │   Option C: Local Auth Only                                               │
  │   ┌─────────────────────────────────────────────────────────────────┐    │
  │   │  Email/Password in local PostgreSQL (no external SSO)           │    │
  │   └─────────────────────────────────────────────────────────────────┘    │
  │                                                                           │
  └───────────────────────────────────────────────────────────────────────────┘
```

---

## Cognito User Pool Configuration

Cohi uses a single AWS Cognito User Pool for both management and tenant authentication.

### Production User Pool

| Setting          | Value                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| **User Pool ID** | `us-east-2_lArr8IsFK`                                                     |
| **ARN**          | `arn:aws:cognito-idp:us-east-2:339712788893:userpool/us-east-2_lArr8IsFK` |
| **Region**       | `us-east-2`                                                               |
| **Domain**       | Configure in Cognito Console                                              |

### Environment Variables

```bash
# Required for backend SSO integration
COGNITO_USER_POOL_ID=us-east-2_lArr8IsFK
COGNITO_USER_POOL_ARN=arn:aws:cognito-idp:us-east-2:339712788893:userpool/us-east-2_lArr8IsFK
COGNITO_CLIENT_ID=<create-app-client-in-cognito>
COGNITO_CLIENT_SECRET=<from-app-client>
COGNITO_DOMAIN=<your-domain>.auth.us-east-2.amazoncognito.com
COGNITO_REGION=us-east-2
```

### App Client Setup

Create an App Client in the Cognito User Pool:

1. Navigate to AWS Console > Cognito > User Pools > `us-east-2_lArr8IsFK`
2. Go to **App integration** > **App clients**
3. Click **Create app client**
4. Configure:
   - App client name: `cohi-backend`
   - Generate client secret: **Yes**
   - Auth flows: Authorization code grant
   - OAuth 2.0 scopes: `openid`, `email`, `profile`
   - Callback URLs: `https://your-domain/api/auth/cognito/callback`
   - Sign-out URLs: `https://your-domain/logout`

### Adding Identity Providers

For each tenant that needs SSO:

1. Go to **Sign-in experience** > **Federated sign-in**
2. Click **Add identity provider**
3. Choose SAML or OIDC
4. Configure with tenant's IdP metadata
5. Name format: `tenant-{slug}-{idp}` (e.g., `tenant-acme-okta`)

---

## Authentication Methods

### Method Comparison

| Feature                 | Coheus Bridge         | Cognito SAML     | Direct OIDC    | Local Auth      |
| ----------------------- | --------------------- | ---------------- | -------------- | --------------- |
| **Target Users**        | Existing Qlik clients | New SaaS clients | Self-hosted    | Internal/simple |
| **SSO Reconfiguration** | None                  | One-time setup   | One-time setup | N/A             |
| **Supported IdPs**      | Any (via Qlik)        | SAML 2.0 IdPs    | OIDC IdPs      | N/A             |
| **MFA Support**         | Via Qlik/IdP          | Via Cognito/IdP  | Via IdP        | Optional (TOTP) |
| **Deployment Mode**     | SaaS only             | SaaS             | Self-hosted    | Both            |
| **Setup Complexity**    | Low (exists)          | Medium           | Medium         | Low             |

### Authentication Modes

Cohi supports three authentication modes per tenant:

| Mode              | Description                           | Use Case              |
| ----------------- | ------------------------------------- | --------------------- |
| **Hybrid**        | Email/password + SSO both available   | Beta, gradual rollout |
| **SSO-Preferred** | SSO primary, password for break-glass | Transition period     |
| **SSO-Only**      | SSO required, no password option      | Production security   |

Configuration is stored in `coheus_tenants.auth_config`:

```json
{
  "mode": "hybrid",
  "allow_email_password": true,
  "allow_sso": true,
  "sso_required_for_roles": [],
  "break_glass_enabled": true
}
```

See [SSO_MIGRATION_GUIDE.md](./SSO_MIGRATION_GUIDE.md) for migrating between modes.

### Unified JWT Format

All authentication methods produce the same JWT format for Cohi backend:

```typescript
interface CohiJwtPayload {
  // Standard JWT claims
  iss: string; // 'cohi.io' or self-hosted domain
  aud: string; // 'cohi-api'
  sub: string; // User ID (varies by method)
  iat: number; // Issued at
  exp: number; // Expiration (15 min for access token)

  // Cohi-specific claims
  tenant_id: string; // Cohi tenant UUID
  tenant_slug: string; // Tenant identifier (for routing)
  email: string; // User email address
  role: UserRole; // 'super_admin' | 'tenant_admin' | 'user' | 'viewer'

  // Authentication metadata
  auth_method: "coheus" | "cognito" | "oidc" | "local";
  idp_sub?: string; // Original IdP subject (for audit)
  idp_name?: string; // IdP identifier (for debugging)

  // Optional: Qlik-specific (for Coheus Bridge)
  qlik_directory?: string; // Qlik userDirectory
  qlik_user?: string; // Qlik userId
}

type UserRole =
  | "super_admin"
  | "tenant_admin"
  | "admin"
  | "user"
  | "viewer"
  | "loan_officer"
  | "processor";
```

---

## Coheus Bridge (Legacy Qlik Clients)

### Purpose

Enable existing Coheus (Qlik) clients to access Cohi without any SSO reconfiguration. Users authenticate to Qlik using their existing corporate SSO, then seamlessly access Cohi.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          COHEUS BRIDGE AUTHENTICATION FLOW                       │
└─────────────────────────────────────────────────────────────────────────────────┘

  Client IdP           Qlik Sense Enterprise        Cohi Auth           Cohi App
  (Okta/Azure AD)      (Windows Server)             Lambda
      │                        │                        │                   │
      │                        │                        │                   │
      │ 1. User accesses       │                        │                   │
      │    Qlik Hub/App        │                        │                   │
      │◄───────────────────────│                        │                   │
      │                        │                        │                   │
      │ 2. Qlik redirects to   │                        │                   │
      │    corporate IdP       │                        │                   │
      │◄───────────────────────│                        │                   │
      │                        │                        │                   │
      │ 3. User authenticates  │                        │                   │
      │    (SSO, MFA, etc.)    │                        │                   │
      │                        │                        │                   │
      │ 4. SAML Response       │                        │                   │
      │───────────────────────►│                        │                   │
      │                        │                        │                   │
      │                        │ 5. Qlik creates        │                   │
      │                        │    session (cookie)    │                   │
      │                        │                        │                   │
      │                        │ 6. User clicks         │                   │
      │                        │    "Launch Cohi"       │                   │
      │                        │    (mashup/extension)  │                   │
      │                        │───────────────────────►│                   │
      │                        │                        │                   │
      │                        │ 7. Validate session    │                   │
      │                        │◄───────────────────────│                   │
      │                        │    GET /qps/user       │                   │
      │                        │                        │                   │
      │                        │ 8. Return user info    │                   │
      │                        │───────────────────────►│                   │
      │                        │    {userId, directory} │                   │
      │                        │                        │                   │
      │                        │                        │ 9. Map directory   │
      │                        │                        │    to tenant_id    │
      │                        │                        │                   │
      │                        │                        │ 10. Generate      │
      │                        │                        │     Cohi JWT      │
      │                        │                        │──────────────────►│
      │                        │                        │                   │
      │                        │                        │ 11. Redirect to   │
      │                        │                        │     Cohi SPA      │
      │                        │                        │──────────────────►│
```

### Implementation

**Endpoint:** `POST /auth/coheus` or `GET /auth/coheus/{virtualProxy}`

```typescript
// server/src/routes/auth.ts

router.get("/coheus/:virtualProxy", async (req, res) => {
  const { virtualProxy } = req.params;
  const cookies = req.headers.cookie;

  if (!cookies) {
    return res.status(401).json({ error: "No Qlik session cookie" });
  }

  try {
    // 1. Validate Qlik session via QPS API
    const qlikUser = await validateQlikSession(cookies, virtualProxy);

    if (!qlikUser || qlikUser.session === "inactive") {
      return res.status(401).json({ error: "Invalid Qlik session" });
    }

    // 2. Map Qlik userDirectory to Cohi tenant
    const tenantMapping = await getTenantByQlikDirectory(
      qlikUser.userDirectory,
    );

    if (!tenantMapping) {
      return res
        .status(403)
        .json({ error: "Unknown Qlik directory - tenant not configured" });
    }

    // 3. Find or create user in Cohi
    const user = await findOrCreateUser({
      email: qlikUser.userId + "@" + tenantMapping.email_domain,
      tenantId: tenantMapping.tenant_id,
      externalId: `qlik:${qlikUser.userDirectory}:${qlikUser.userId}`,
    });

    // 4. Generate Cohi JWT
    const token = generateCohiJwt({
      sub: user.id,
      tenant_id: tenantMapping.tenant_id,
      tenant_slug: tenantMapping.tenant_slug,
      email: user.email,
      role: user.role,
      auth_method: "coheus",
      qlik_directory: qlikUser.userDirectory,
      qlik_user: qlikUser.userId,
    });

    // 5. Redirect to Cohi frontend with token
    const frontendUrl = process.env.FRONTEND_URL || "https://app.cohi.io";
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  } catch (error) {
    console.error("Coheus bridge auth failed:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
});

async function validateQlikSession(
  cookies: string,
  virtualProxy: string,
): Promise<QlikUser | null> {
  const qlikDomain = process.env.QLIK_SERVER_URL || "https://qlik.cohi.io";
  const qpsUrl = `${qlikDomain}/${virtualProxy}/qps/user`;

  const response = await fetch(qpsUrl, {
    method: "GET",
    headers: {
      Cookie: cookies,
      "User-Agent": "CohiAuth/1.0",
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}
```

### Qlik Integration (Mashup/Extension)

Create a Qlik mashup or extension that launches Cohi:

```javascript
// qlik-cohi-launcher.js (Qlik extension)

define(["qlik"], function (qlik) {
  return {
    paint: function ($element) {
      const virtualProxy = qlik.navigation.getCurrentSheetId().split("/")[0];

      $element.html(`
        <button onclick="launchCohi('${virtualProxy}')" class="cohi-launch-btn">
          Launch Cohi Dashboard
        </button>
      `);
    },
  };
});

function launchCohi(virtualProxy) {
  // Opens Cohi auth endpoint - cookies are sent automatically
  window.open(`https://api.cohi.io/auth/coheus/${virtualProxy}`, "_blank");
}
```

---

## Cognito SAML Federation (New Clients)

### Purpose

Enable new clients (or migrating Coheus clients) to configure SSO directly with AWS Cognito, supporting any SAML 2.0 identity provider.

### Supported Identity Providers

| IdP                  | Configuration   | Notes                        |
| -------------------- | --------------- | ---------------------------- |
| **Okta**             | SAML 2.0 App    | Well-documented, recommended |
| **Azure AD / Entra** | Enterprise App  | Common in enterprises        |
| **Ping Identity**    | SAML Connection | Enterprise-focused           |
| **OneLogin**         | SAML App        | SMB-friendly                 |
| **Google Workspace** | SAML App        | Limited to Google accounts   |
| **Custom SAML**      | Any SAML 2.0    | Requires metadata XML        |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          COGNITO MULTI-TENANT SAML                               │
└─────────────────────────────────────────────────────────────────────────────────┘

                           ┌────────────────────────────────┐
                           │      Cohi Cognito Pool         │
                           │      (Single User Pool)        │
                           │                                │
                           │  SAML Identity Providers:      │
                           │  ├── tenant-abc-okta           │
                           │  ├── tenant-xyz-azure          │
                           │  ├── tenant-123-ping           │
                           │  └── tenant-456-onelogin       │
                           └────────────────────────────────┘
                                          │
          ┌───────────────────────────────┼───────────────────────────────┐
          │                               │                               │
          ▼                               ▼                               ▼
  ┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
  │   ABC Corp Okta   │       │  XYZ Inc Azure AD │       │  123 LLC Ping     │
  │                   │       │                   │       │                   │
  │   Configured as   │       │   Configured as   │       │   Configured as   │
  │   SAML IdP in     │       │   SAML IdP in     │       │   SAML IdP in     │
  │   Cognito         │       │   Cognito         │       │   Cognito         │
  └───────────────────┘       └───────────────────┘       └───────────────────┘
```

### Login Flow

```typescript
// 1. User enters email on login page
// Frontend: src/pages/Login.tsx

const handleEmailSubmit = async (email: string) => {
  // Extract domain from email
  const domain = email.split("@")[1];

  // Lookup tenant by email domain
  const response = await fetch(`/api/auth/lookup-tenant?domain=${domain}`);
  const { tenant, sso_method, idp_name } = await response.json();

  if (sso_method === "cognito_saml") {
    // Redirect to Cognito with IdP hint
    const cognitoUrl = buildCognitoAuthUrl(idp_name);
    window.location.href = cognitoUrl;
  } else if (sso_method === "coheus") {
    // Show "Login via Qlik" button
    showQlikLoginOption(tenant);
  } else {
    // Show password field for local auth
    showPasswordField();
  }
};

function buildCognitoAuthUrl(idpName: string): string {
  const params = new URLSearchParams({
    client_id: COGNITO_CLIENT_ID,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: `${window.location.origin}/auth/callback`,
    identity_provider: idpName, // e.g., 'tenant-abc-okta'
  });

  return `https://${COGNITO_DOMAIN}/oauth2/authorize?${params}`;
}
```

### Cognito Callback Handler

```typescript
// server/src/routes/auth.ts

router.get("/cognito/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/login?error=${error}`);
  }

  try {
    // 1. Exchange code for tokens
    const tokens = await exchangeCognitoCode(code as string);

    // 2. Decode ID token to get user info
    const idToken = jwt.decode(tokens.id_token) as CognitoIdToken;

    // 3. Extract tenant from custom claim or email domain
    const tenantId =
      idToken["custom:tenant_id"] ||
      (await getTenantByEmailDomain(idToken.email));

    // 4. Find or create user
    const user = await findOrCreateUser({
      email: idToken.email,
      tenantId: tenantId,
      externalId: `cognito:${idToken.sub}`,
      fullName: idToken.name,
    });

    // 5. Generate Cohi JWT
    const cohiToken = generateCohiJwt({
      sub: user.id,
      tenant_id: tenantId,
      tenant_slug: await getTenantSlug(tenantId),
      email: user.email,
      role: user.role,
      auth_method: "cognito",
      idp_sub: idToken.sub,
      idp_name: idToken.identities?.[0]?.providerName,
    });

    // 6. Redirect to frontend with token
    res.redirect(`/auth/callback?token=${cohiToken}`);
  } catch (error) {
    console.error("Cognito callback failed:", error);
    res.redirect("/login?error=auth_failed");
  }
});
```

---

## Self-Hosted SSO

### Overview

Self-hosted Cohi deployments support customer-configured SSO through:

1. **Cognito** (Recommended) - Deployed via CloudFormation, customer adds their IdP
2. **Direct OIDC** - Customer provides OIDC discovery URL and credentials
3. **Local Auth** - Simple email/password without external SSO

### Option A: Cognito (Recommended)

CloudFormation deploys a Cognito User Pool in the customer's account. Customer then:

1. Configures their IdP as a SAML provider in Cognito
2. Provides IdP metadata via Cohi Admin UI
3. Users login via their corporate SSO

```yaml
# CloudFormation snippet for self-hosted Cognito

CohiUserPool:
  Type: AWS::Cognito::UserPool
  Properties:
    UserPoolName: !Sub "${AWS::StackName}-users"
    Schema:
      - Name: email
        Required: true
        Mutable: false
      - Name: tenant_id
        AttributeDataType: String
        Mutable: true
    AutoVerifiedAttributes:
      - email

CohiUserPoolDomain:
  Type: AWS::Cognito::UserPoolDomain
  Properties:
    Domain: !Sub "${AWS::StackName}-${AWS::AccountId}"
    UserPoolId: !Ref CohiUserPool

CohiUserPoolClient:
  Type: AWS::Cognito::UserPoolClient
  Properties:
    ClientName: !Sub "${AWS::StackName}-app"
    UserPoolId: !Ref CohiUserPool
    GenerateSecret: true
    AllowedOAuthFlows:
      - code
    AllowedOAuthScopes:
      - openid
      - email
      - profile
    CallbackURLs:
      - !Sub "https://${LoadBalancerDNS}/auth/callback"
    SupportedIdentityProviders:
      - COGNITO
      # Customer adds their SAML IdP here via console/API
```

### Option B: Direct OIDC

For customers with OIDC-capable IdPs who prefer not to use Cognito:

```typescript
// Admin UI allows customer to configure OIDC
interface OIDCConfiguration {
  provider_name: string; // "Okta", "Azure AD", etc.
  discovery_url: string; // https://company.okta.com/.well-known/openid-configuration
  client_id: string;
  client_secret: string; // Encrypted at rest
  scopes: string[]; // ['openid', 'email', 'profile']
}

// Backend validates OIDC tokens directly
router.get("/oidc/callback", async (req, res) => {
  const { code } = req.query;
  const oidcConfig = await getOIDCConfiguration();

  // 1. Discover OIDC endpoints
  const discovery = await fetch(oidcConfig.discovery_url).then((r) => r.json());

  // 2. Exchange code for tokens
  const tokens = await exchangeOIDCCode(
    code,
    discovery.token_endpoint,
    oidcConfig,
  );

  // 3. Validate ID token
  const jwks = await fetch(discovery.jwks_uri).then((r) => r.json());
  const idToken = await verifyOIDCToken(tokens.id_token, jwks);

  // 4. Generate Cohi JWT
  const cohiToken = generateCohiJwt({
    sub: idToken.sub,
    email: idToken.email,
    auth_method: "oidc",
    idp_sub: idToken.sub,
    idp_name: oidcConfig.provider_name,
  });

  res.redirect(`/auth/callback?token=${cohiToken}`);
});
```

### Option C: Local Auth

Simple email/password authentication stored in local PostgreSQL:

```typescript
// Standard login endpoint (already exists)
router.post("/signin", async (req, res) => {
  const { email, password } = req.body;

  const user = await pool.query("SELECT * FROM users WHERE email = $1", [
    email,
  ]);

  if (
    !user.rows[0] ||
    !bcrypt.compareSync(password, user.rows[0].encrypted_password)
  ) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = generateCohiJwt({
    sub: user.rows[0].id,
    email: user.rows[0].email,
    role: user.rows[0].role,
    auth_method: "local",
  });

  res.json({ token });
});
```

---

## Implementation Roadmap

### Phase 1: Coheus Bridge (Week 1-2)

**Goal:** Existing Coheus/Qlik clients can access Cohi immediately.

| Task                                         | Priority | Effort  |
| -------------------------------------------- | -------- | ------- |
| Create `/auth/coheus/:virtualProxy` endpoint | High     | 1 day   |
| Implement QPS session validation             | High     | 1 day   |
| Create tenant_sso_configs table              | High     | 0.5 day |
| Add Qlik directory → tenant mapping          | High     | 0.5 day |
| Build Qlik mashup/extension for launch       | Medium   | 1 day   |
| Test with 2-3 design partner tenants         | High     | 2 days  |
| Document Qlik admin configuration            | Medium   | 1 day   |

### Phase 2: Cognito Foundation (Week 3-4)

**Goal:** Set up Cognito infrastructure for new clients.

| Task                                  | Priority | Effort  |
| ------------------------------------- | -------- | ------- |
| Create Cognito User Pool (SaaS)       | High     | 0.5 day |
| Configure OAuth 2.0 App Client        | High     | 0.5 day |
| Implement `/auth/cognito/callback`    | High     | 1 day   |
| Add `/auth/lookup-tenant` endpoint    | High     | 0.5 day |
| Build email-domain routing logic      | High     | 1 day   |
| Update Login.tsx for SSO flow         | High     | 1 day   |
| Create admin UI for tenant SSO config | Medium   | 2 days  |

### Phase 3: SAML IdP Integration (Week 5-6)

**Goal:** Enable tenant admins to configure their IdP.

| Task                            | Priority | Effort |
| ------------------------------- | -------- | ------ |
| Add Okta as test SAML IdP       | High     | 1 day  |
| Add Azure AD as test SAML IdP   | High     | 1 day  |
| Implement JIT user provisioning | High     | 1 day  |
| Build user attribute mapping    | Medium   | 1 day  |
| Create IdP configuration wizard | Medium   | 2 days |
| Document client-side IdP setup  | High     | 1 day  |

### Phase 4: Self-Hosted SSO (Week 7-8)

**Goal:** Self-hosted customers can configure SSO.

| Task                             | Priority | Effort |
| -------------------------------- | -------- | ------ |
| Add Cognito to CloudFormation    | High     | 1 day  |
| Create post-deploy SSO wizard    | High     | 2 days |
| Implement direct OIDC validation | Medium   | 2 days |
| Test full self-hosted SSO flow   | High     | 2 days |
| Document customer SSO setup      | High     | 1 day  |

---

## Database Schema

### Tenant SSO Configuration Table

```sql
-- Add to management database (cohi_management)

CREATE TABLE tenant_sso_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES cohi_tenants(id) ON DELETE CASCADE,

    -- SSO Method
    sso_method TEXT NOT NULL CHECK (sso_method IN ('coheus', 'cognito_saml', 'oidc', 'local')),
    is_active BOOLEAN DEFAULT true,

    -- Coheus Bridge Configuration
    qlik_user_directory TEXT,           -- Maps to Qlik userDirectory claim
    qlik_virtual_proxy TEXT,            -- e.g., 'acmelender'
    qlik_server_url TEXT,               -- e.g., 'https://qlik.cohi.io'

    -- Cognito SAML Configuration
    cognito_idp_name TEXT,              -- Unique identifier in Cognito, e.g., 'tenant-abc-okta'
    cognito_idp_type TEXT,              -- 'okta', 'azure_ad', 'ping', 'custom_saml'
    cognito_idp_metadata_url TEXT,      -- IdP metadata URL (preferred)
    cognito_idp_metadata_xml TEXT,      -- Or raw XML if URL not available
    cognito_attribute_mapping JSONB,    -- Custom attribute mapping

    -- Direct OIDC Configuration (for self-hosted)
    oidc_provider_name TEXT,            -- Display name, e.g., 'Company Okta'
    oidc_discovery_url TEXT,            -- OIDC discovery endpoint
    oidc_client_id TEXT,
    oidc_client_secret_encrypted TEXT,  -- Encrypted with KMS
    oidc_scopes TEXT[] DEFAULT ARRAY['openid', 'email', 'profile'],

    -- Email Domain Routing
    email_domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    UNIQUE(tenant_id)
);

-- Index for email domain lookup (used during login)
CREATE INDEX idx_tenant_sso_email_domains ON tenant_sso_configs USING GIN (email_domains);

-- Index for Qlik directory lookup
CREATE INDEX idx_tenant_sso_qlik_directory ON tenant_sso_configs (qlik_user_directory)
  WHERE qlik_user_directory IS NOT NULL;

-- Index for Cognito IdP lookup
CREATE INDEX idx_tenant_sso_cognito_idp ON tenant_sso_configs (cognito_idp_name)
  WHERE cognito_idp_name IS NOT NULL;
```

### Example Data

```sql
-- Existing Coheus/Qlik client
INSERT INTO tenant_sso_configs (tenant_id, sso_method, qlik_user_directory, qlik_virtual_proxy, email_domains)
VALUES (
  'abc123-tenant-id',
  'coheus',
  'ACMELENDER',                    -- Qlik userDirectory
  'acmelender',                    -- Virtual proxy prefix
  ARRAY['acmelender.com', 'acme.io']
);

-- New client with Okta SSO
INSERT INTO tenant_sso_configs (tenant_id, sso_method, cognito_idp_name, cognito_idp_type, email_domains)
VALUES (
  'xyz789-tenant-id',
  'cognito_saml',
  'tenant-xyz-okta',               -- Cognito IdP identifier
  'okta',
  ARRAY['xyzlending.com']
);

-- Self-hosted client with direct OIDC
INSERT INTO tenant_sso_configs (tenant_id, sso_method, oidc_provider_name, oidc_discovery_url, oidc_client_id, email_domains)
VALUES (
  'selfhost-tenant-id',
  'oidc',
  'Corporate Azure AD',
  'https://login.microsoftonline.com/tenant-guid/v2.0/.well-known/openid-configuration',
  'app-client-id-here',
  ARRAY['selfhosted.com']
);
```

---

## API Endpoints

### Authentication Endpoints

| Method | Path                                  | Description                           |
| ------ | ------------------------------------- | ------------------------------------- |
| `GET`  | `/auth/lookup-tenant?domain={domain}` | Get tenant SSO config by email domain |
| `GET`  | `/auth/coheus/:virtualProxy`          | Coheus bridge authentication          |
| `GET`  | `/auth/cognito/callback`              | Cognito OAuth callback                |
| `GET`  | `/auth/oidc/callback`                 | Direct OIDC callback                  |
| `POST` | `/auth/signin`                        | Local email/password login            |
| `POST` | `/auth/signout`                       | Logout (invalidate session)           |
| `POST` | `/auth/refresh`                       | Refresh access token                  |
| `GET`  | `/auth/me`                            | Get current user info                 |

### Admin Endpoints (SSO Configuration)

| Method | Path                           | Description                           |
| ------ | ------------------------------ | ------------------------------------- |
| `GET`  | `/admin/tenants/:id/sso`       | Get tenant SSO configuration          |
| `PUT`  | `/admin/tenants/:id/sso`       | Update tenant SSO configuration       |
| `POST` | `/admin/tenants/:id/sso/test`  | Test SSO configuration                |
| `GET`  | `/admin/cognito/saml-metadata` | Get Cognito SP metadata for IdP setup |

---

## Client Onboarding

### For Existing Coheus/Qlik Clients

1. **Cohi Admin**: Create tenant in Cohi, note the `tenant_id`
2. **Cohi Admin**: Add SSO config with `sso_method: 'coheus'`
3. **Cohi Admin**: Set `qlik_user_directory` to match client's Qlik directory
4. **Client**: No action required - existing Qlik SSO continues to work
5. **Client**: Access Cohi via "Launch Cohi" button in Qlik apps

### For New Clients (Cognito SAML)

1. **Cohi Admin**: Create tenant in Cohi
2. **Cohi Admin**: Get Cognito SP metadata from `/admin/cognito/saml-metadata`
3. **Client IT**: Configure Cohi as SAML app in their IdP (Okta/Azure AD)
4. **Client IT**: Provide IdP metadata URL or XML
5. **Cohi Admin**: Add SAML IdP to Cognito with tenant-specific name
6. **Cohi Admin**: Update tenant SSO config with `cognito_idp_name`
7. **Client**: Users login at `app.cohi.io` with corporate email

### For Self-Hosted Customers

1. **Customer**: Deploy Cohi via AWS Marketplace
2. **Customer**: Access Cohi Admin UI at deployed URL
3. **Customer**: Navigate to Settings → SSO Configuration
4. **Customer**: Choose SSO method:
   - **Cognito**: Provide IdP metadata, Cohi configures Cognito
   - **OIDC**: Provide discovery URL and credentials
   - **Local**: Skip SSO, use email/password
5. **Customer**: Test SSO flow
6. **Customer**: Enable for all users

---

## Related Documentation

### Security

- [AUTH_REFACTOR.md](./AUTH_REFACTOR.md) - Internal authentication refactoring
- [STATE_MANAGEMENT.md](./STATE_MANAGEMENT.md) - Frontend state management
- [ROW_LEVEL_SECURITY.md](./ROW_LEVEL_SECURITY.md) - Custom field-based access control

### Architecture

- [OVERVIEW.md](../architecture/OVERVIEW.md) - System architecture
- [ADMIN_PANEL.md](../architecture/ADMIN_PANEL.md) - Admin panel architecture
- [CLIENT_ADMIN_REQUIREMENTS.md](../architecture/CLIENT_ADMIN_REQUIREMENTS.md) - Tenant admin features (includes SSO section)
- [SELF_HOSTED.md](../architecture/SELF_HOSTED.md) - Self-hosted deployment
