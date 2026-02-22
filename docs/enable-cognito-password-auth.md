# Enable Cognito password auth (invite flow)

When enabled, creating a user in the admin UI does **not** ask for a password; Cognito emails the user a temporary password and they set a permanent one on first login.

---

## Step 1: Enable the auth flow in Cognito

The Cognito **app client** used by your app must allow the admin-initiated password auth flow.

**Important:** If you use the **Console**, just enable **ALLOW_ADMIN_USER_PASSWORD_AUTH** and save—OAuth/SSO settings stay as-is. If you use the **CLI** to update the app client, you **must** include `--allowed-o-auth-flows-user-pool-client` (and your existing callback URLs, OAuth flows, etc.); otherwise the client can lose "Enable OAuth 2.0 flows" and SSO will break with "Client is not enabled for OAuth2.0 flows".

1. Open **AWS Console** → **Cognito** → **User pools**.
2. Click your user pool (the one whose domain is `us-east-2larr8isfk.auth.us-east-2.amazoncognito.com` → pool ID is likely `us-east-2_lArr8IsFK`).
3. Go to **App integration** (left menu).
4. Under **App client list**, click the app client used by your app (the one whose **Client ID** matches what you have in env / config, e.g. `3b3ntlo09hcc46gec2esd6iii5`).
5. Click **Edit** (or the client name to open it, then Edit).
6. Under **Authentication flows**, enable:
   - **ALLOW_ADMIN_USER_PASSWORD_AUTH**
7. Ensure **Hosted UI** / **OAuth 2.0** settings are still enabled if you use SSO (e.g. "Enable OAuth 2.0 flows" and your callback URLs).
8. Save changes.

---

## Step 2: Set the stack parameter so the server gets `COGNITO_PASSWORD_AUTH=true`

Your backend runs on ECS and gets env from CloudFormation. The parameter is **CognitoPasswordAuth**.

### Option A: AWS Console

1. Open **AWS Console** → **CloudFormation** → **Stacks**.
2. Select your **backend** stack (e.g. `coheus-dev-backend` or similar).
3. Click **Update**.
4. Choose **Use current template** → **Next**.
5. On **Parameters**, find **CognitoPasswordAuth**.
6. Set it to **true**.
7. Click **Next** through the rest, then **Submit**.
8. Wait until the stack status is **UPDATE_COMPLETE**. ECS will roll out new tasks with the new env.

### Option B: AWS CLI

Replace `YOUR-STACK-NAME` with your backend stack name (e.g. `coheus-dev-backend`).

```bash
aws cloudformation update-stack \
  --stack-name YOUR-STACK-NAME \
  --use-previous-template \
  --parameters ParameterKey=CognitoPasswordAuth,ParameterValue=true \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region us-east-2
```

If the stack has many parameters and the CLI complains about missing parameters, you may need to pass all parameters. You can get current parameters first:

```bash
aws cloudformation describe-stacks --stack-name YOUR-STACK-NAME --region us-east-2 \
  --query 'Stacks[0].Parameters' --output json
```

Then build a `--parameters` list that includes `CognitoPasswordAuth=true` and **UsePreviousValue** for the rest (or supply current values). Alternatively, use the Console (Option A) so it keeps existing values for you.

---

## Step 3: Confirm

1. Wait for the stack update to finish and for ECS to run new tasks (or trigger a new deployment if needed).
2. In the app, open **Create User** (Admin → Users → Add User).
3. In the dialog you should see “Checking sign-in method…” then the **invite** message and **no password field**.
4. Or call the API and check the response:
   - `GET https://your-api-url/api/auth/cognito/config`
   - Response should include `"useInviteFlow": true`.

---

## Local dev only

To test the same behavior locally:

1. In `server/.env` add (or set):
   ```env
   COGNITO_PASSWORD_AUTH=true
   ```
2. Restart the server.
3. Ensure Step 1 (Cognito app client) is done so the same pool allows admin password auth.

---

## If it still shows `useInviteFlow: false`

- **Cognito**: Confirm **ALLOW_ADMIN_USER_PASSWORD_AUTH** is enabled on the app client and saved.
- **CloudFormation**: Confirm the stack update completed and the parameter **CognitoPasswordAuth** is **true** (Stacks → your stack → **Parameters** tab).
- **ECS**: Confirm new tasks were started after the update (ECS → Cluster → Service → **Tasks** → check task start time). If not, trigger a new deployment so tasks pick up the new env.
- **Env value**: The app checks `process.env.COGNITO_PASSWORD_AUTH === "true"` (string). So the value must be exactly the string `true`, not `True` or `1`.
