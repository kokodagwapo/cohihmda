import { chromium, type FullConfig, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  AUTH_DIR,
  type ProvisionedState,
  type ProvisionedUser,
  writeProvisionedState,
} from "./provision-state";
import { generateTotpCode } from "./totp";
import { loadE2EEnv } from "./load-e2e-env.mjs";

loadE2EEnv();

const USER_STATE = path.join(AUTH_DIR, "user.json");
const ADMIN_STATE = path.join(AUTH_DIR, "admin.json");
const PLATFORM_ADMIN_STATE = path.join(AUTH_DIR, "platform-admin.json");
const CANVAS_ONLY_STATE = path.join(AUTH_DIR, "canvas-only.json");
const TOTP_RETRY_OFFSETS_MS = [0, -30_000, 30_000, -60_000, 60_000, -90_000, 90_000];

type SignInResponse = {
  token?: string;
  cognitoAccessToken?: string;
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  newPasswordRequired?: boolean;
  challengeName?: "SOFTWARE_TOKEN_MFA" | "EMAIL_OTP" | "SMS_MFA" | "MFA_SETUP" | "NEW_PASSWORD_REQUIRED";
  session?: string;
  user?: {
    tenant_id?: string | null;
    tenant_slug?: string | null;
  };
};

function sanitizeAuthPayload(data: SignInResponse): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...data };
  if (typeof clone.cognitoAccessToken === "string") {
    clone.cognitoAccessToken = "[REDACTED]";
  }
  return clone;
}

function normalizeBaseUrl(baseURL: string): string {
  const trimmed = baseURL.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      `Invalid E2E_BASE_URL "${baseURL}". It must start with http:// or https://`,
    );
  }
  return trimmed.replace(/\/+$/, "");
}

function apiUrl(baseURL: string, routePath: string): string {
  return `${baseURL}${routePath.startsWith("/") ? routePath : `/${routePath}`}`;
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const response = await fetchWithRateLimitRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

async function getJson(
  url: string,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetchWithRateLimitRetry(url, {
    method: "GET",
    headers: {
      ...headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
  maxRetries = 4,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= maxRetries) {
      return response;
    }
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const waitMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(1000, retryAfterSeconds * 1000)
      : 1500 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    attempt += 1;
  }
}

async function deleteWithAuth(url: string, token: string): Promise<void> {
  const response = await fetchWithRateLimitRetry(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Delete request failed (${response.status}): ${text || "unknown error"}`,
    );
  }
}

function assertStringEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("$")) {
    throw new Error(
      `Environment variable ${name} appears to be set to a literal placeholder value ("${trimmed}"). Set it to the real secret/value, not "$VARNAME".`,
    );
  }
  return trimmed;
}

function assertStringField(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Expected response field "${field}" to be a non-empty string.`);
  }
  return value;
}

function isAuthenticatedAppPath(urlString: string): boolean {
  try {
    const path = new URL(urlString).pathname.toLowerCase();
    if (path === "/login" || path === "/forgot-password" || path === "/reset-password") {
      return false;
    }
    if (path.startsWith("/auth/")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function waitForAuthenticatedNavigation(page: Page, timeout: number): Promise<boolean> {
  return page
    .waitForURL((url) => isAuthenticatedAppPath(url.toString()), { timeout })
    .then(() => true)
    .catch(() => false);
}

function getRunId(): string {
  const raw =
    process.env.BITBUCKET_BUILD_NUMBER ||
    process.env.BUILD_BUILDNUMBER ||
    `${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
}

function makePassword(seed: string): string {
  return `C0hi!${seed}#E2Esafe`;
}

async function completeMfaChallenge(
  baseURL: string,
  email: string,
  session: string,
  tenantSlug: string | undefined,
  challengeName: "SOFTWARE_TOKEN_MFA" | "EMAIL_OTP" | "SMS_MFA",
  totpSecret: string,
): Promise<{ token: string; cognitoAccessToken: string | undefined }> {
  if (challengeName !== "SOFTWARE_TOKEN_MFA") {
    throw new Error(
      `[E2E] Unsupported MFA challenge "${challengeName}" for ${email}. TOTP is required.`,
    );
  }

  for (let round = 0; round < 3; round += 1) {
    const candidateCodes = Array.from(
      new Set(
        TOTP_RETRY_OFFSETS_MS.map((offsetMs) =>
          generateTotpCode(totpSecret, Date.now() + offsetMs),
        ),
      ),
    );

    for (const code of candidateCodes) {
      const payload: Record<string, unknown> = {
        email,
        session,
        code,
        challengeName,
      };
      if (tenantSlug && tenantSlug.trim()) {
        payload.tenantSlug = tenantSlug.trim();
      }
      const verify = await postJson(apiUrl(baseURL, "/api/auth/mfa/verify"), payload);
      if (verify.ok) {
        const token = assertStringField(verify.data, "token");
        const cognitoAccessToken =
          typeof verify.data.cognitoAccessToken === "string"
            ? verify.data.cognitoAccessToken
            : undefined;
        return { token, cognitoAccessToken };
      }
    }

    if (round < 2) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }

  throw new Error(
    `[E2E] MFA verification failed for ${email}. Check TOTP clock sync and secret.`,
  );
}

async function signInAndResolveToken(
  baseURL: string,
  email: string,
  password: string,
  tenantSlug: string | undefined,
  opts: { allowMfaSetup: boolean; existingTotpSecret?: string },
): Promise<{ token: string; cognitoAccessToken?: string; totpSecret?: string }> {
  const signInPayload: Record<string, unknown> = { email, password };
  if (tenantSlug && tenantSlug.trim()) {
    signInPayload.tenantSlug = tenantSlug.trim();
  }

  const first = await postJson(apiUrl(baseURL, "/api/auth/signin"), {
    ...signInPayload,
  });
  const data = first.data as SignInResponse;

  if (first.ok && data.token) {
    return {
      token: data.token,
      cognitoAccessToken: data.cognitoAccessToken,
      totpSecret: opts.existingTotpSecret,
    };
  }

  if (data.newPasswordRequired) {
    throw new Error(
      `[E2E] ${email} triggered NEW_PASSWORD_REQUIRED. Users must be created with permanent passwords.`,
    );
  }

  if (data.mfaRequired && data.session && data.challengeName) {
    if (!opts.existingTotpSecret) {
      throw new Error(
        `[E2E] Missing TOTP secret to complete MFA challenge for ${email}.`,
      );
    }
    const verified = await completeMfaChallenge(
      baseURL,
      email,
      data.session,
      tenantSlug,
      data.challengeName,
      opts.existingTotpSecret,
    );
    return {
      token: verified.token,
      cognitoAccessToken: verified.cognitoAccessToken,
      totpSecret: opts.existingTotpSecret,
    };
  }

  if (data.mfaSetupRequired && opts.allowMfaSetup) {
    const cognitoAccessToken = data.cognitoAccessToken;
    if (!cognitoAccessToken) {
      throw new Error(
        `[E2E] ${email} requires MFA setup but no Cognito access token was returned.`,
      );
    }

    const setup = await postJson(apiUrl(baseURL, "/api/auth/mfa/setup"), { cognitoAccessToken });
    if (!setup.ok) {
      throw new Error(
        `[E2E] Failed to initialize MFA setup for ${email} (status ${setup.status}).`,
      );
    }
    const totpSecret = assertStringField(setup.data, "secret");

    const candidateCodes = TOTP_RETRY_OFFSETS_MS.map((offsetMs) =>
      generateTotpCode(totpSecret, Date.now() + offsetMs),
    );
    let confirmSucceeded = false;
    for (const code of candidateCodes) {
      const confirm = await postJson(apiUrl(baseURL, "/api/auth/mfa/setup/confirm"), {
        cognitoAccessToken,
        code,
      });
      if (confirm.ok) {
        confirmSucceeded = true;
        break;
      }
    }
    if (!confirmSucceeded) {
      throw new Error(
        `[E2E] Failed to confirm MFA setup for ${email} after retry windows.`,
      );
    }

    return signInAndResolveToken(baseURL, email, password, tenantSlug, {
      allowMfaSetup: false,
      existingTotpSecret: totpSecret,
    });
  }

  if (data.mfaSetupRequired && !opts.allowMfaSetup) {
    throw new Error(
      `[E2E] ${email} requires MFA setup before automated tests can run. Complete authenticator MFA enrollment for this admin account, then set E2E_ADMIN_TOTP_SECRET to that account's Base32 secret.`,
    );
  }

  throw new Error(
    `[E2E] Sign-in failed for ${email} with status ${first.status}. Payload: ${JSON.stringify(
      sanitizeAuthPayload(data),
    )}`,
  );
}

/**
 * Sign in as a platform admin (no tenant context) and persist the storage
 * state to `outputPath`. Unlike `loginAndPersistState`, this does not navigate
 * to `/insights` because platform admins do not have a tenant and the insights
 * page is tenant-scoped. The persisted storage state contains only what the
 * AI AC Validator needs: an `auth_token` in localStorage that carries platform
 * admin privileges for calling `/api/admin/*` platform routes.
 */
async function loginPlatformAdminAndPersistState(
  baseURL: string,
  email: string,
  password: string,
  totpSecret: string,
  outputPath: string,
) {
  const signedIn = await signInAndResolveToken(baseURL, email, password, undefined, {
    allowMfaSetup: false,
    existingTotpSecret: totpSecret,
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(apiUrl(baseURL, "/login"), { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ token, cognitoAccessToken }) => {
      localStorage.setItem("auth_token", token);
      if (cognitoAccessToken) {
        localStorage.setItem("cognito_access_token", cognitoAccessToken);
      }
    },
    { token: signedIn.token, cognitoAccessToken: signedIn.cognitoAccessToken },
  );

  await page.context().storageState({ path: outputPath });
  await browser.close();
}

async function loginAndPersistState(
  baseURL: string,
  email: string,
  password: string,
  totpSecret: string,
  outputPath: string,
  tenantSlug?: string,
) {
  const signedIn = await signInAndResolveToken(baseURL, email, password, tenantSlug, {
    allowMfaSetup: false,
    existingTotpSecret: totpSecret,
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(apiUrl(baseURL, "/login"), { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ token, cognitoAccessToken }) => {
      localStorage.setItem("auth_token", token);
      if (cognitoAccessToken) {
        localStorage.setItem("cognito_access_token", cognitoAccessToken);
      }
    },
    { token: signedIn.token, cognitoAccessToken: signedIn.cognitoAccessToken },
  );

  await page.goto(apiUrl(baseURL, "/insights"), { waitUntil: "domcontentloaded" });
  const authed = await waitForAuthenticatedNavigation(page, 15_000);
  if (!authed) {
    throw new Error(`[E2E] Unable to persist authenticated state for ${email}.`);
  }

  await page.context().storageState({ path: outputPath });
  await browser.close();
}

async function getAdminSession(baseURL: string, tenantSlugHint?: string) {
  const adminEmail = assertStringEnv("E2E_ADMIN_EMAIL");
  const adminPassword = assertStringEnv("E2E_ADMIN_PASSWORD");
  const adminTotpSecret = assertStringEnv("E2E_ADMIN_TOTP_SECRET");

  const initialTenantSlug = tenantSlugHint || process.env.E2E_ADMIN_TENANT_SLUG || "";
  const signedIn = await signInAndResolveToken(
    baseURL,
    adminEmail,
    adminPassword,
    initialTenantSlug,
    { allowMfaSetup: false, existingTotpSecret: adminTotpSecret },
  );

  const me = await getJson(apiUrl(baseURL, "/api/auth/me"), {
    Authorization: `Bearer ${signedIn.token}`,
  });
  if (!me.ok || typeof me.data.user !== "object" || !me.data.user) {
    throw new Error("[E2E] Failed to fetch /api/auth/me for admin session.");
  }

  const user = me.data.user as Record<string, unknown>;
  const tenantId = assertStringField(user, "tenant_id");
  const tenantSlug = assertStringField(user, "tenant_slug");

  return {
    adminEmail,
    adminPassword,
    adminTotpSecret,
    token: signedIn.token,
    tenantId,
    tenantSlug,
  };
}

/**
 * Delete any pre-existing tenant users whose email EXACTLY matches one of
 * `emails`. This is intentionally scoped per-run (by exact email, not by
 * shared prefix) because two QA pipelines can legitimately run at the same
 * time against the same dev tenant — e.g. `ai-qa-dev` + a push-triggered
 * branch pipeline, or a rerun that overlaps with a zombie executor — and a
 * broad prefix-based cleanup will delete the OTHER run's freshly-provisioned
 * users mid-test, which then 404s `/api/auth/me` and cascades into hundreds
 * of Playwright failures that look like a `toHaveURL` / auth regression but
 * are actually just shared-tenant test-user clobbering.
 *
 * Non-fatal if a target email does not exist (likely the common case thanks
 * to the per-run random suffix below); we only care about reclaiming a slot
 * if a previous run crashed before `global-teardown` ran.
 */
async function deleteTenantUsersByEmail(
  baseURL: string,
  adminToken: string,
  tenantId: string,
  emails: readonly string[],
): Promise<void> {
  if (emails.length === 0) return;

  const list = await getJson(apiUrl(baseURL, `/api/admin/tenants/${tenantId}/users`), {
    Authorization: `Bearer ${adminToken}`,
  });

  if (!list.ok) {
    throw new Error(
      `[E2E] Failed to list tenant users for targeted cleanup (status ${list.status}).`,
    );
  }

  const users = Array.isArray(list.data.users)
    ? (list.data.users as Array<Record<string, unknown>>)
    : [];

  const targets = new Set(emails.map((email) => email.toLowerCase()));
  const matching = users.filter((u) => {
    const email = typeof u.email === "string" ? u.email.toLowerCase() : "";
    return targets.has(email);
  });

  for (const user of matching) {
    const id = typeof user.id === "string" ? user.id : "";
    if (!id) continue;
    await deleteWithAuth(
      apiUrl(baseURL, `/api/admin/tenants/${tenantId}/users/${id}`),
      adminToken,
    );
  }
}

async function createProvisionedUser(
  baseURL: string,
  adminToken: string,
  tenantId: string,
  tenantSlug: string,
  params: {
    email: string;
    password: string;
    fullName: string;
    persona: "tenant_user" | "tenant_canvas_only_user";
  },
): Promise<ProvisionedUser> {
  const create = await postJson(
    apiUrl(baseURL, `/api/admin/tenants/${tenantId}/users`),
    {
      email: params.email,
      password: params.password,
      full_name: params.fullName,
      persona: params.persona,
    },
    { Authorization: `Bearer ${adminToken}` },
  );

  if (!create.ok) {
    throw new Error(
      `[E2E] Failed creating ${params.persona} (${params.email}) status=${create.status} payload=${JSON.stringify(
        create.data,
      )}`,
    );
  }

  const userObj = create.data.user as Record<string, unknown> | undefined;
  const userId = userObj ? assertStringField(userObj, "id") : "";

  const signin = await signInAndResolveToken(
    baseURL,
    params.email,
    params.password,
    tenantSlug,
    { allowMfaSetup: true },
  );

  if (!signin.totpSecret) {
    throw new Error(
      `[E2E] Missing TOTP secret after provisioning ${params.email}.`,
    );
  }

  return {
    id: userId,
    email: params.email,
    password: params.password,
    totpSecret: signin.totpSecret,
    persona: params.persona,
  };
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = normalizeBaseUrl(config.projects[0]?.use.baseURL as string);
  const admin = await getAdminSession(baseURL);
  await mkdir(AUTH_DIR, { recursive: true });

  const managedEmailPrefix = (
    process.env.E2E_MANAGED_EMAIL_PREFIX || "e2e.auto"
  ).toLowerCase();
  const runId = getRunId();
  // Unique per-process suffix (8 hex chars). `BITBUCKET_BUILD_NUMBER` alone
  // is NOT sufficient to dedupe provisioned users across concurrent pipelines
  // (rerun zombies, parallel custom pipelines, branch pipelines firing at the
  // same time, etc.). The suffix guarantees that even if two runs somehow
  // share a `runId`, they allocate disjoint Cognito users and cannot clobber
  // each other via the shared dev tenant.
  const uniqueSuffix = randomBytes(4).toString("hex");
  const tenantUserSeed = `tenant-user-${runId}-${uniqueSuffix}`;
  const canvasUserSeed = `canvas-only-${runId}-${uniqueSuffix}`;
  const tenantUserEmail = `${managedEmailPrefix}.tenant-user.${runId}.${uniqueSuffix}@coheus.test`;
  const canvasUserEmail = `${managedEmailPrefix}.canvas-only.${runId}.${uniqueSuffix}@coheus.test`;

  // Targeted cleanup: only reclaim the exact two emails we are about to
  // provision (in the very unlikely event a previous crashed run happened
  // to pick the same random suffix and build number). Do NOT touch users
  // owned by other concurrent runs.
  await deleteTenantUsersByEmail(
    baseURL,
    admin.token,
    admin.tenantId,
    [tenantUserEmail, canvasUserEmail],
  );

  const tenantUser = await createProvisionedUser(
    baseURL,
    admin.token,
    admin.tenantId,
    admin.tenantSlug,
    {
      email: tenantUserEmail,
      password: makePassword(tenantUserSeed),
      fullName: "E2E Tenant User",
      persona: "tenant_user",
    },
  );
  const canvasOnlyUser = await createProvisionedUser(
    baseURL,
    admin.token,
    admin.tenantId,
    admin.tenantSlug,
    {
      email: canvasUserEmail,
      password: makePassword(canvasUserSeed),
      fullName: "E2E Canvas Only User",
      persona: "tenant_canvas_only_user",
    },
  );

  const provisionedState: ProvisionedState = {
    tenantId: admin.tenantId,
    tenantSlug: admin.tenantSlug,
    managedEmailPrefix,
    users: {
      tenantUser,
      canvasOnlyUser,
    },
  };
  await writeProvisionedState(provisionedState);

  await loginAndPersistState(
    baseURL,
    admin.adminEmail,
    admin.adminPassword,
    admin.adminTotpSecret,
    ADMIN_STATE,
    admin.tenantSlug,
  );
  await loginAndPersistState(
    baseURL,
    tenantUser.email,
    tenantUser.password,
    tenantUser.totpSecret,
    USER_STATE,
    admin.tenantSlug,
  );
  await loginAndPersistState(
    baseURL,
    canvasOnlyUser.email,
    canvasOnlyUser.password,
    canvasOnlyUser.totpSecret,
    CANVAS_ONLY_STATE,
    admin.tenantSlug,
  );

  // Optional platform-admin session for the AI AC Validator. Platform-admin
  // credentials are only required when an AC targets platform-scoped admin
  // routes (e.g., `/api/admin/global-knowledge/categories`). If the envs are
  // not set, we skip this step so the broader E2E suite can still run for
  // engineers who do not have platform-admin credentials provisioned locally.
  const platformAdminEmail = process.env.E2E_PLATFORM_ADMIN_EMAIL?.trim();
  const platformAdminPassword = process.env.E2E_PLATFORM_ADMIN_PASSWORD?.trim();
  const platformAdminTotpSecret = process.env.E2E_PLATFORM_ADMIN_TOTP_SECRET?.trim();
  if (platformAdminEmail && platformAdminPassword && platformAdminTotpSecret) {
    try {
      await loginPlatformAdminAndPersistState(
        baseURL,
        platformAdminEmail,
        platformAdminPassword,
        platformAdminTotpSecret,
        PLATFORM_ADMIN_STATE,
      );
      console.log(
        `[E2E] Persisted platform-admin session for AI AC Validator (${platformAdminEmail}).`,
      );
    } catch (error) {
      // Do NOT fail the whole setup if platform admin login fails — only the
      // AI AC Validator's admin-API ACs depend on it. Surface a loud warning
      // so the AC failure logs correlate to this missing session.
      console.warn(
        `[E2E] Platform-admin session setup failed: ${
          error instanceof Error ? error.message : String(error)
        }. AI AC Validator steps against /api/admin/* platform routes will fall back to the tenant-admin token and likely 403.`,
      );
    }
  } else {
    console.log(
      "[E2E] E2E_PLATFORM_ADMIN_* envs not set — skipping platform-admin session. AI AC Validator admin-API steps will use tenant-admin credentials only.",
    );
  }
}
