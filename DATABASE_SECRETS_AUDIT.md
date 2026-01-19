# Database Secrets Audit Report

## Summary

**YES, the database stores API keys and secrets.** This audit identifies all locations where sensitive credentials are stored in the database and whether they are encrypted.

---

## 🔴 Critical Findings: Unencrypted Secrets

### 1. LOS Connections Table (`los_connections`)

**Location:** `server/src/config/database.ts` (lines 318-358)

**Fields storing secrets:**
- `api_client_id` (TEXT)
- `api_client_secret` (TEXT) ⚠️ **UNENCRYPTED**
- `api_key` (TEXT) ⚠️ **UNENCRYPTED**
- `api_access_token` (TEXT) ⚠️ **UNENCRYPTED**
- `api_refresh_token` (TEXT) ⚠️ **UNENCRYPTED**
- `db_password` (TEXT) ⚠️ **UNENCRYPTED**
- `webhook_secret` (TEXT) ⚠️ **UNENCRYPTED**

**Storage Route:** `server/src/routes/los.ts` (lines 186-213)
- **Status:** ❌ **NOT ENCRYPTED** - Secrets are stored directly in plaintext

**Risk Level:** 🔴 **HIGH** - Contains OAuth credentials, API keys, database passwords, and webhook secrets

---

### 2. Vendor Connections Table (`vendor_connections`)

**Location:** `server/src/config/database.ts` (lines 410-420)

**Fields storing secrets:**
- `vendor_api_key` (TEXT) ⚠️ **UNENCRYPTED**
- `vendor_credentials` (TEXT) ⚠️ **UNENCRYPTED**
- `vendor_webhook_secret` (TEXT) ⚠️ **UNENCRYPTED**

**Storage Route:** `server/src/routes/synapse.ts` (lines 159-183)
- **Status:** ❌ **NOT ENCRYPTED** - Secrets are stored directly in plaintext

**Risk Level:** 🔴 **HIGH** - Contains vendor API keys and credentials

---

### 3. RAG Settings Table (`tenant_rag_settings` / `rag_settings`)

**Location:** 
- Migration: `supabase/migrations/20251228000000_add_api_keys_to_rag.sql`
- Schema: `server/src/config/database.ts` (lines 914-915)

**Fields storing secrets:**
- `openai_api_key` (TEXT)
- `gemini_api_key` (TEXT)

**Storage Route:** `server/src/routes/rag.ts` (lines 351-430)
- **Status:** ✅ **ENCRYPTED** - Uses `encryptAPIKeys()` from `server/src/services/encryption.ts`
- **Encryption Method:** AWS KMS (Key Management Service)
- **Encryption Service:** `server/src/services/encryption.ts`

**Risk Level:** 🟢 **LOW** - Properly encrypted using AWS KMS

**Note:** The migration file comments indicate encryption should happen at the application level, which is correctly implemented.

---

## 🟡 Partially Secure: Hashed Secrets

### 4. API Keys Table (`api_keys`)

**Location:** `supabase/migrations/20250105000000_subscription_billing.sql` (lines 57-69)

**Fields storing secrets:**
- `key_hash` (TEXT) ✅ **HASHED** - Uses cryptographic hash (not reversible)
- `key_prefix` (TEXT) - First 8 characters for display (not sensitive)

**Status:** ✅ **SECURE** - Only stores hashed values, not plaintext keys

**Risk Level:** 🟢 **LOW** - Uses one-way hashing

---

### 5. License Keys Table (`license_keys`)

**Location:** `supabase/migrations/20251224000000_saas_rag_costs.sql` (lines 50-63)

**Fields storing secrets:**
- `license_key` (TEXT) - Comment indicates "Encrypted" but implementation unclear

**Status:** ⚠️ **UNCLEAR** - Comment says encrypted, but no encryption code found

**Risk Level:** 🟡 **MEDIUM** - Needs verification of encryption implementation

---

## 🟢 Secure: Encrypted Passwords

### 6. Users Table (`users`)

**Location:** Multiple migration files

**Fields storing secrets:**
- `encrypted_password` (TEXT) ✅ **HASHED** - Uses bcrypt (one-way hash)

**Status:** ✅ **SECURE** - Uses bcrypt hashing (not reversible)

**Risk Level:** 🟢 **LOW** - Industry-standard password hashing

---

## 📊 Summary Table

| Table | Secret Fields | Encryption Status | Risk Level |
|-------|--------------|------------------|------------|
| `los_connections` | `api_client_secret`, `api_key`, `api_access_token`, `api_refresh_token`, `db_password`, `webhook_secret` | ❌ **NONE** | 🔴 **HIGH** |
| `vendor_connections` | `vendor_api_key`, `vendor_credentials`, `vendor_webhook_secret` | ❌ **NONE** | 🔴 **HIGH** |
| `tenant_rag_settings` | `openai_api_key`, `gemini_api_key` | ✅ **AWS KMS** | 🟢 **LOW** |
| `api_keys` | `key_hash` | ✅ **HASHED** | 🟢 **LOW** |
| `license_keys` | `license_key` | ⚠️ **UNCLEAR** | 🟡 **MEDIUM** |
| `users` | `encrypted_password` | ✅ **BCRYPT** | 🟢 **LOW** |

---

## 🚨 Immediate Action Required

### Critical Issues:

1. **LOS Connections** - All OAuth credentials, API keys, database passwords, and webhook secrets are stored in **plaintext**
2. **Vendor Connections** - All vendor API keys and credentials are stored in **plaintext**

### Recommended Fixes:

1. **Implement encryption for LOS connections:**
   - Use the existing `encryptField()` function from `server/src/services/encryption.ts`
   - Encrypt: `api_client_secret`, `api_key`, `api_access_token`, `api_refresh_token`, `db_password`, `webhook_secret`
   - Update `server/src/routes/los.ts` to encrypt before storing and decrypt when reading

2. **Implement encryption for vendor connections:**
   - Use the existing `encryptField()` function
   - Encrypt: `vendor_api_key`, `vendor_credentials`, `vendor_webhook_secret`
   - Update `server/src/routes/synapse.ts` to encrypt before storing and decrypt when reading

3. **Verify license key encryption:**
   - Check if `license_keys.license_key` is actually encrypted
   - If not, implement encryption using the same pattern as RAG settings

---

## ✅ Good Practices Found

1. **RAG Settings Encryption** - Properly implements AWS KMS encryption for API keys
2. **Encryption Service** - Well-structured encryption service exists (`server/src/services/encryption.ts`)
3. **Password Hashing** - Uses bcrypt for user passwords
4. **API Key Hashing** - Uses one-way hashing for tenant API keys

---

## 📝 Encryption Service Details

**Location:** `server/src/services/encryption.ts`

**Features:**
- Uses AWS KMS for encryption/decryption
- Supports field-level encryption
- Has functions for encrypting API keys: `encryptAPIKeys()`, `decryptAPIKeys()`
- Has functions for encrypting PII: `encryptPII()`, `decryptPII()`
- Can be disabled in development mode (returns plaintext)

**Configuration:**
- Requires `KMS_KEY_ID` environment variable
- Enabled when `ENABLE_ENCRYPTION=true` or `NODE_ENV=production`

---

## 🔍 Additional Notes

- The codebase has infrastructure for encryption but it's not consistently applied
- AWS Secrets Manager is used for Lambda functions (see `infrastructure/aws/secrets-setup.sh`)
- Database-level encryption is not used; encryption happens at the application level
- Row Level Security (RLS) is enabled on sensitive tables, which provides access control but not encryption

---

**Audit Date:** 2026-01-03  
**Auditor:** AI Code Review  
**Status:** ⚠️ **REQUIRES IMMEDIATE ATTENTION**
