# SSO Migration Guide

This guide describes how to migrate a tenant from hybrid authentication (email/password + SSO) to SSO-only mode.

## Table of Contents

- [Overview](#overview)
- [Authentication Modes](#authentication-modes)
- [Prerequisites](#prerequisites)
- [Migration Process](#migration-process)
- [Rollback Procedure](#rollback-procedure)
- [Troubleshooting](#troubleshooting)
- [Support Escalation](#support-escalation)

---

## Overview

Cohi supports three authentication modes:

1. **Hybrid** (Default) - Both email/password and SSO available
2. **SSO-Preferred** - SSO primary, email/password for break-glass only
3. **SSO-Only** - All users must authenticate via SSO

This guide covers the migration from Hybrid to SSO-Only, a process that requires careful planning to avoid locking out users.

---

## Authentication Modes

### Mode 1: Hybrid (Beta Default)

```json
{
  "mode": "hybrid",
  "allow_email_password": true,
  "allow_sso": true,
  "sso_required_for_roles": [],
  "break_glass_enabled": true
}
```

- Email/password available for all users
- SSO available for configured tenants
- Users choose login method on login page
- Best for: Initial deployment, gradual SSO rollout

### Mode 2: SSO-Preferred

```json
{
  "mode": "sso_preferred",
  "allow_email_password": true,
  "allow_sso": true,
  "sso_required_for_roles": ["user", "viewer", "loan_officer", "processor"],
  "break_glass_enabled": true
}
```

- SSO is primary login method (shown prominently)
- Email/password available as small link ("Login with password")
- Admin roles can still use email/password freely
- Best for: Transition period, building SSO adoption

### Mode 3: SSO-Only

```json
{
  "mode": "sso_only",
  "allow_email_password": false,
  "allow_sso": true,
  "sso_required_for_roles": ["*"],
  "break_glass_enabled": true
}
```

- All authentication via Cognito SSO
- No email/password option for regular users
- Break-glass accounts for emergencies only
- Best for: Production tenants with mature SSO

---

## Prerequisites

Before migrating to SSO-only, ensure the following:

### 1. SSO Configuration Complete

- [ ] Cognito IdP configured and tested
- [ ] Attribute mapping verified (email, name, role)
- [ ] SSO test successful within last 7 days
- [ ] Email domains configured for tenant

**Check via API:**

```bash
GET /api/sso/config

# Expected response
{
  "provider": "cognito_saml",
  "is_enabled": true,
  "cognito_idp_name": "tenant-abc-okta",
  "last_test_at": "2026-01-28T12:00:00Z",
  "last_test_status": "success"
}
```

### 2. All Users Have SSO Identity

- [ ] Run SSO readiness report
- [ ] All active users have SSO identity linked
- [ ] No orphaned users without IdP account

**Check via API:**

```bash
GET /api/admin/tenants/{tenant_id}/sso-readiness

# Expected response
{
  "total_users": 50,
  "sso_linked_users": 48,
  "unlinked_users": 2,
  "unlinked_user_emails": ["legacy@company.com", "contractor@company.com"],
  "ready_for_sso_only": false,
  "readiness_percentage": 96
}
```

### 3. Break-Glass Accounts Configured

- [ ] At least one tenant admin has break-glass flag
- [ ] Break-glass credentials documented securely
- [ ] Emergency contact list established

### 4. Communication Plan

- [ ] Users notified of upcoming change
- [ ] Go-live date communicated
- [ ] Support escalation path documented

---

## Migration Process

### Phase A: Preparation (1-2 weeks before)

```
Week -2: Preparation Phase
├── Enable SSO for tenant (if not already)
├── Run SSO readiness report
├── Identify users without SSO identity
├── Send enrollment emails to unlinked users
├── Configure break-glass accounts
└── Document emergency contacts
```

**Steps:**

1. **Enable SSO** (if not already enabled)

   ```bash
   PUT /api/sso/config
   {
     "is_enabled": true,
     "cognito_idp_name": "tenant-abc-okta",
     "email_domains": ["company.com"]
   }
   ```

2. **Run Readiness Report**

   ```bash
   GET /api/admin/tenants/{tenant_id}/sso-readiness
   ```

3. **Send Enrollment Emails**
   - For users without SSO identity
   - Include instructions for linking account

4. **Configure Break-Glass**
   - Identify 1-2 tenant admins for break-glass
   - Document their credentials securely

### Phase B: Soft Cutover (2 weeks)

```
Week 0: Soft Cutover
├── Set auth_mode = 'sso_preferred'
├── Monitor SSO login success rate
├── Track email/password usage
├── Address any SSO failures
└── Target: >95% SSO adoption
```

**Steps:**

1. **Switch to SSO-Preferred Mode**

   ```bash
   PUT /api/admin/tenants/{tenant_id}/auth-config
   {
     "mode": "sso_preferred",
     "allow_email_password": true,
     "allow_sso": true,
     "sso_required_for_roles": ["user", "viewer", "loan_officer", "processor"]
   }
   ```

2. **Monitor Adoption**
   - Check login analytics daily
   - Target: >95% SSO logins after 1 week
   - Follow up with users still using email/password

3. **Minimum Observation Period**
   - Run in SSO-preferred mode for at least 2 weeks
   - Ensure no critical issues

### Phase C: Hard Cutover (Go-Live)

```
Week +2: Hard Cutover
├── Verify >95% SSO adoption
├── Set auth_mode = 'sso_only'
├── Notify all users
├── 24/7 support for first 48 hours
└── Monitor for issues
```

**Steps:**

1. **Final Readiness Check**

   ```bash
   GET /api/admin/tenants/{tenant_id}/sso-readiness
   # Must show readiness_percentage >= 95
   ```

2. **Switch to SSO-Only Mode**

   ```bash
   PUT /api/admin/tenants/{tenant_id}/auth-config
   {
     "mode": "sso_only",
     "allow_email_password": false,
     "allow_sso": true,
     "break_glass_enabled": true
   }
   ```

3. **Post-Cutover Monitoring**
   - Monitor login failures
   - Watch for support tickets
   - Be ready to rollback if needed

---

## Rollback Procedure

If SSO-only causes issues, rollback immediately:

### Immediate Rollback (< 5 minutes)

**Via Admin UI:**

1. Navigate to Tenant Settings > Authentication
2. Change mode to "Hybrid"
3. Save changes

**Via API:**

```bash
PUT /api/admin/tenants/{tenant_id}/auth-config
{
  "mode": "hybrid",
  "allow_email_password": true,
  "allow_sso": true
}
```

**Via Database (Emergency):**

```sql
-- Emergency rollback if API unavailable
UPDATE coheus_tenants
SET auth_config = jsonb_set(auth_config, '{mode}', '"hybrid"')
WHERE id = '<tenant-id>';

UPDATE coheus_tenants
SET auth_config = jsonb_set(auth_config, '{allow_email_password}', 'true')
WHERE id = '<tenant-id>';
```

### When to Rollback

- SSO login failures exceed 5% of attempts
- IdP outage lasting more than 15 minutes
- Critical business users unable to access
- Any security incident related to SSO

### Post-Rollback Actions

1. Notify users that email/password is available again
2. Investigate root cause
3. Document findings
4. Schedule retry after fixes

---

## Troubleshooting

### Common Issues

#### "User not found in organization"

**Cause:** User's email domain not in `email_domains` list

**Solution:**

```bash
PUT /api/sso/config
{
  "email_domains": ["company.com", "subsidiary.com"]
}
```

#### "SSO session expired"

**Cause:** Cognito session timeout shorter than expected

**Solution:**

- Check IdP session settings
- Verify Cognito token refresh configuration
- Consider increasing session duration

#### "Attribute mapping failed"

**Cause:** IdP not sending required claims

**Solution:**

1. Check IdP attribute mapping
2. Verify SAML assertion contains required fields
3. Update `attribute_mapping` in SSO config

#### "Break-glass login not working"

**Cause:** Break-glass not properly configured

**Solution:**

```sql
-- Verify break-glass is enabled
SELECT auth_config->>'break_glass_enabled'
FROM coheus_tenants WHERE id = '<tenant-id>';

-- Verify user has admin role
SELECT role FROM users WHERE email = '<break-glass-email>';
```

### Debug Checklist

- [ ] Check Cognito IdP status in AWS Console
- [ ] Verify IdP metadata is current
- [ ] Check CloudWatch logs for auth service
- [ ] Verify email domain configuration
- [ ] Check user's SSO identity link
- [ ] Verify attribute mapping

---

## Support Escalation

### Level 1: Tenant Admin

- Reset user passwords
- Check SSO configuration
- View login history
- Contact Level 2 if unresolved

### Level 2: Cohi Support

- Access management database
- Check Cognito logs
- Investigate attribute mapping
- Execute rollback if needed
- Contact Level 3 if security concern

### Level 3: Platform Engineering

- Cognito configuration changes
- IdP integration debugging
- Security incident response
- Infrastructure issues

### Emergency Contacts

| Level | Contact         | Response Time |
| ----- | --------------- | ------------- |
| L1    | Tenant IT Admin | Immediate     |
| L2    | support@cohi.io | 4 hours       |
| L3    | oncall@cohi.io  | 1 hour        |

---

## Related Documentation

- [USER_MANAGEMENT.md](./USER_MANAGEMENT.md) - User management overview
- [SSO_AUTHENTICATION.md](./SSO_AUTHENTICATION.md) - SSO architecture
- [ROW_LEVEL_SECURITY.md](./ROW_LEVEL_SECURITY.md) - Access control
