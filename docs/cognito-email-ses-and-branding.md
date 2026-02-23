# Cognito email: SES (coheus1.com) and branded invitation

Invitation (and other) emails from the Cognito User Pool are sent from **SES** using the **coheus1.com** domain and use a **branded HTML invitation template**.

---

## What was configured (via AWS CLI)

Profile used: **DevEnvPerms-339712788893**  
Region: **us-east-2**  
User Pool ID: **us-east-2_lArr8IsFK**

### 1. SES as the email sender (FROM coheus1.com)

Cognito was switched from the default sender to **Amazon SES** with a **FROM** address on your verified domain.

**Command run:**

```bash
aws cognito-idp update-user-pool \
  --user-pool-id us-east-2_lArr8IsFK \
  --profile DevEnvPerms-339712788893 \
  --region us-east-2 \
  --email-configuration "EmailSendingAccount=DEVELOPER,SourceArn=arn:aws:ses:us-east-2:339712788893:identity/coheus1.com,From=noreply@coheus1.com,ReplyToEmailAddress=support@coheus1.com"
```

**Result:**

- **EmailSendingAccount**: `DEVELOPER` (SES)
- **SourceArn**: `arn:aws:ses:us-east-2:339712788893:identity/coheus1.com`
- **From**: `noreply@coheus1.com`
- **ReplyToEmailAddress**: `support@coheus1.com`

The identity **coheus1.com** was already verified in SES in **us-east-2**; no SES changes were needed.

---

### 2. Branded invitation message (subject + HTML body)

The **Invitation message** template was set so new users receive a clear, branded email with their sign-in details.

**Steps:**

1. **HTML template** was saved to `tmp_invite_email.html` (single-line HTML with placeholders `{username}` and `{####}`).
2. **JSON input** for `update-user-pool` was built with Node so the HTML was correctly escaped:  
   `node scripts/build-invite-json.cjs` (writes `tmp_update_pool.json`).
3. **User pool** was updated with:

```bash
aws cognito-idp update-user-pool \
  --cli-input-json file://tmp_update_pool.json \
  --profile DevEnvPerms-339712788893 \
  --region us-east-2
```

**Important:** Using `--cli-input-json` only sends the parameters in the JSON file. **Email configuration is not in that file**, so it was reset to default. The **email configuration was re-applied** by running the first command again (the `--email-configuration` command above).

**Template content:**

- **Subject:** `You're invited to Coheus – sign in with your temporary password`
- **Body:** HTML email that includes:
  - “You're invited to Coheus”
  - Short intro and instruction to set a new password on first sign-in
  - **Email** and **Temporary password** in a simple card (values from `{username}` and `{####}`)
  - Sign-in URL example: https://cohi-dev.coheus1.com and note about MFA in account settings
  - Help line and link to coheus1.com

Placeholders **`{username}`** and **`{####}`** are required; Cognito replaces them with the sign-in email and temporary password.

---

## Verifying

**Email configuration (SES, FROM, Reply-To):**

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id us-east-2_lArr8IsFK \
  --profile DevEnvPerms-339712788893 \
  --region us-east-2 \
  --query "UserPool.EmailConfiguration" --output json
```

Expected: `EmailSendingAccount: DEVELOPER`, `From: noreply@coheus1.com`, `SourceArn` pointing to `identity/coheus1.com`.

**Invitation template (subject + body):**

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id us-east-2_lArr8IsFK \
  --profile DevEnvPerms-339712788893 \
  --region us-east-2 \
  --query "UserPool.AdminCreateUserConfig.InviteMessageTemplate" --output json
```

Expected: `EmailSubject` and `EmailMessage` (HTML) containing `{username}` and `{####}`.

---

## If you change the invitation template again

1. Update the HTML in `tmp_invite_email.html` (or your own file); keep **`{username}`** and **`{####}`** in the body.
2. Regenerate the JSON, e.g. with `node scripts/build-invite-json.cjs` (adjust paths in the script if the file location changes).
3. Run:
   ```bash
   aws cognito-idp update-user-pool --cli-input-json file://tmp_update_pool.json --profile DevEnvPerms-339712788893 --region us-east-2
   ```
4. **Re-apply email configuration** (so SES/FROM are not reset):
   ```bash
   aws cognito-idp update-user-pool --user-pool-id us-east-2_lArr8IsFK --profile DevEnvPerms-339712788893 --region us-east-2 --email-configuration "EmailSendingAccount=DEVELOPER,SourceArn=arn:aws:ses:us-east-2:339712788893:identity/coheus1.com,From=noreply@coheus1.com,ReplyToEmailAddress=support@coheus1.com"
   ```

Alternatively, use the **Cognito console** (Messaging → Message customizations → Invitation message and Email configuration) so all settings are updated in one place.

---

## If emails still don’t send

- **SES sandbox (most common):** In sandbox, SES only delivers to **verified recipient addresses**. Invitations to e.g. user@gmail.com will not arrive unless that address is verified in SES or you request production access. Check: `aws ses get-send-quota` (sandbox often shows Max24HourSend=200).
- **SES region:** Cognito and the SES identity must be in the same region (here: **us-east-2**).
- **Sending authorization:** In the same account, Cognito’s service-linked role is usually enough. If you use a different identity or see permission errors, attach a sending authorization policy to the SES identity allowing `email.cognito-idp.amazonaws.com` to send; see [Cognito user pool email](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html).

---

## Programmatic recipient verification (sandbox)

When an admin creates a user **with invite** (no password), the app:

1. **Requests SES verification** for that email (`VerifyEmailIdentity`). SES sends a verification email to the recipient; they must click the link to become verified. This runs before creating the user in Cognito.
2. **Creates the user in Cognito** with invite, so Cognito sends the branded invitation email as usual.

So the recipient may get **two emails**: first the SES verification email, then the Coheus invitation. In **sandbox**, the invitation may not be delivered until the recipient has completed verification; once they click the verification link, the address is verified and future emails (and the invite, if it was queued or retried) can be delivered.

**Why not "verify then send" in one step?** SES cannot mark an address as verified without the recipient completing the verification (clicking the link). There is no API to verify programmatically in the sense of bypassing that step. So we request verification and send the invite in the same flow; in production SES you can send to any address without per-recipient verification.

**Code:** `server/src/services/sesVerificationService.ts` exposes `requestEmailVerification(email)` and `isEmailVerifiedInSES(email)`. The admin user-create routes call `requestEmailVerification` when creating with invite. Use `AWS_SES_REGION` (e.g. `us-east-2`) so this uses the same region as Cognito's SES identity.

---

## Files used (optional / one-time)

- **tmp_invite_email.html** – HTML body for the invitation (can be kept or recreated for future edits).
- **tmp_update_pool.json** – Generated JSON for `update-user-pool` (generated by `scripts/build-invite-json.cjs`).
- **scripts/build-invite-json.cjs** – Node script that reads the HTML and writes `tmp_update_pool.json`. You can keep it to regenerate the JSON after editing the HTML.
