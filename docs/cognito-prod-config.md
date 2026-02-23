# Cognito prod stack connection (coheus-prod user pool)

The **prod** ECS backend stack (`coheus-prod-backend`) is connected to the Cognito User Pool **coheus-prod** (`us-east-2_hhOr4kNDX`). This doc summarizes what was verified and what was changed so both SSO and email/password (and invite) work.

---

## Current configuration

| Item | Value |
|------|--------|
| **User pool** | coheus-prod |
| **User pool ID** | `us-east-2_hhOr4kNDX` |
| **App client** | coheus-prod-app |
| **Client ID** | `1snnpc5vrr0epd68qacu3apmub` |
| **Domain** | `coheus-prod.auth.us-east-2.amazoncognito.com` |
| **Callbacks** | `https://cohi.coheus1.com/auth/sso/callback`, `http://localhost:5000/auth/sso/callback` |
| **Identity providers** | COGNITO, CoheusEntraID |

**Stack:** CloudFormation parameters for `coheus-prod-backend` already include `CognitoUserPoolId`, `CognitoClientId`, `CognitoClientSecret`, and `CognitoDomain`. The backend receives these as env vars and uses them for SSO and (when enabled) email/password auth.

---

## What was done (AWS CLI)

Profile used: **DevEnvPerms-339712788893**, region **us-east-2**.

1. **Verified user pool and app client**
   - `aws cognito-idp describe-user-pool --user-pool-id us-east-2_hhOr4kNDX ...`
   - `aws cognito-idp describe-user-pool-client --user-pool-id us-east-2_hhOr4kNDX --client-id 1snnpc5vrr0epd68qacu3apmub ...`

2. **Updated prod app client auth flows**  
   The prod app client had **ExplicitAuthFlows** unset (null), so email/password sign-in and admin invite would not work. It was updated to match the dev client (password auth + OAuth/SSO):

   - **ExplicitAuthFlows:** `ALLOW_ADMIN_USER_PASSWORD_AUTH`, `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`, `ALLOW_USER_SRP_AUTH`, `ALLOW_CUSTOM_AUTH`
   - **OAuth:** `AllowedOAuthFlowsUserPoolClient=true`, `AllowedOAuthFlows=code`, same callback/logout URLs and scopes, so SSO is unchanged.

   Command used:

   ```bash
   aws cognito-idp update-user-pool-client \
     --user-pool-id us-east-2_hhOr4kNDX \
     --client-id 1snnpc5vrr0epd68qacu3apmub \
     --explicit-auth-flows ALLOW_ADMIN_USER_PASSWORD_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH ALLOW_CUSTOM_AUTH \
     --allowed-o-auth-flows code \
     --allowed-o-auth-scopes email openid phone profile \
     --allowed-o-auth-flows-user-pool-client \
     --callback-urls "http://localhost:5000/auth/sso/callback" "https://cohi.coheus1.com/auth/sso/callback" \
     --logout-urls "http://localhost:5000" "https://cohi.coheus1.com" \
     --supported-identity-providers COGNITO CoheusEntraID \
     --profile DevEnvPerms-339712788893 \
     --region us-east-2
   ```

3. **Deploy script and config**
   - **config.ps1:** Prod Cognito values were already set; added `$COGNITO_PASSWORD_AUTH_PROD` (default `"false"`) and `$COGNITO_PASSWORD_AUTH_DEV` so invite flow can be toggled per environment.
   - **02-deploy-backend.ps1:** When Cognito is configured, it now passes **CognitoPasswordAuth** to CloudFormation so the backend gets `COGNITO_PASSWORD_AUTH=true/false`.

---

## Enabling invite flow in prod

To use the same “create user → Cognito emails temp password” flow in prod:

1. **Option A – Redeploy backend with config**
   - In `scripts/deploy/config.ps1` set `$COGNITO_PASSWORD_AUTH_PROD = "true"`.
   - Run `02-deploy-backend.ps1` with `$ENVIRONMENT = "prod"` so the stack gets `CognitoPasswordAuth=true`. ECS will roll out new tasks with `COGNITO_PASSWORD_AUTH=true`.

2. **Option B – Update stack only (no redeploy of image)**
   - Update the stack parameter:
     ```bash
     aws cloudformation update-stack \
       --stack-name coheus-prod-backend \
       --use-previous-template \
       --parameters ParameterKey=CognitoPasswordAuth,ParameterValue=true \
       --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
       --profile DevEnvPerms-339712788893 \
       --region us-east-2
     ```
   - If the CLI requires all parameters, use the Console (CloudFormation → coheus-prod-backend → Edit → set **CognitoPasswordAuth** to **true**) or pass all parameters with `UsePreviousValue` where needed.

The prod app client already has **ALLOW_ADMIN_USER_PASSWORD_AUTH** enabled, so no further Cognito changes are required for invite flow.

---

## Prod user pool email (optional)

The prod user pool currently uses **EmailSendingAccount: COGNITO_DEFAULT** (Cognito’s default sender). For branded/SES-based emails (like in dev), you would configure the pool with SES and a custom invite template in the same way as dev; see **docs/cognito-email-ses-and-branding.md**.

---

## Quick reference (prod)

| What | Command / value |
|------|-----------------|
| Describe user pool | `aws cognito-idp describe-user-pool --user-pool-id us-east-2_hhOr4kNDX --profile DevEnvPerms-339712788893 --region us-east-2` |
| Describe app client | `aws cognito-idp describe-user-pool-client --user-pool-id us-east-2_hhOr4kNDX --client-id 1snnpc5vrr0epd68qacu3apmub --profile DevEnvPerms-339712788893 --region us-east-2` |
| Stack parameters | `aws cloudformation describe-stacks --stack-name coheus-prod-backend --profile DevEnvPerms-339712788893 --region us-east-2 --query 'Stacks[0].Parameters'` |
