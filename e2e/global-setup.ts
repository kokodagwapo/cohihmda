import { chromium, type FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  AUTH_DIR,
  type ProvisionedState,
  type ProvisionedUser,
  writeProvisionedState,
} from "./provision-state";
import { generateTotpCode } from "./totp";

const USER_STATE = path.join(AUTH_DIR, "user.json");
const ADMIN_STATE = path.join(AUTH_DIR, "admin.json");
const CANVAS_ONLY_STATE = path.join(AUTH_DIR, "canvas-only.json");

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

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const response = await fetch(url, {
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
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

async function deleteWithAuth(url: string, token: string): Promise<void> {
  const response = await fetch(url, {
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
  return value.trim();
}

function assertStringField(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Expected response field "${field}" to be a non-empty string.`);
  }
  return value;
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
  tenantSlug: string,
  challengeName: "SOFTWARE_TOKEN_MFA" | "EMAIL_OTP" | "SMS_MFA",
  totpSecret: string,
): Promise<{ token: string; cognitoAccessToken: string | undefined }> {
  if (challengeName !== "SOFTWARE_TOKEN_MFA") {
    throw new Error(
      `[E2E] Unsupported MFA challenge "${challengeName}" for ${email}. TOTP is required.`,
    );
  }

  const candidateCodes = [0, -30_000, 30_000].map((offsetMs) =>
    generateTotpCode(totpSecret, Date.now() + offsetMs),
  );

  for (const code of candidateCodes) {
    const verify = await postJson(`${baseURL}/api/auth/mfa/verify`, {
      email,
      session,
      code,
      challengeName,
      tenantSlug,
    });
    if (verify.ok) {
      const token = assertStringField(verify.data, "token");
      const cognitoAccessToken =
        typeof verify.data.cognitoAccessToken === "string"
          ? verify.data.cognitoAccessToken
          : undefined;
      return { token, cognitoAccessToken };
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

  const first = await postJson(`${baseURL}/api/auth/signin`, {
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

    const setup = await postJson(`${baseURL}/api/auth/mfa/setup`, { cognitoAccessToken });
    if (!setup.ok) {
      throw new Error(
        `[E2E] Failed to initialize MFA setup for ${email} (status ${setup.status}).`,
      );
    }
    const totpSecret = assertStringField(setup.data, "secret");

    const candidateCodes = [0, -30_000, 30_000].map((offsetMs) =>
      generateTotpCode(totpSecret, Date.now() + offsetMs),
    );
    let confirmSucceeded = false;
    for (const code of candidateCodes) {
      const confirm = await postJson(`${baseURL}/api/auth/mfa/setup/confirm`, {
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

  throw new Error(
    `[E2E] Sign-in failed for ${email} with status ${first.status}. Payload: ${JSON.stringify(
      data,
    )}`,
  );
}

async function loginAndPersistState(
  baseURL: string,
  email: string,
  password: string,
  totpSecret: string,
  outputPath: string,
) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  const otpInput = page
    .locator('input[data-input-otp], input[autocomplete="one-time-code"], input[inputmode="numeric"]')
    .first();
  await otpInput.waitFor({ state: "visible", timeout: 15_000 });

  const verifyButton = page.getByRole("button", { name: "Verify" });
  const candidateCodes = [0, -30_000, 30_000].map((offsetMs) =>
    generateTotpCode(totpSecret, Date.now() + offsetMs),
  );

  let authed = false;
  for (const code of candidateCodes) {
    await otpInput.fill(code);
    await verifyButton.click();
    try {
      await page.waitForURL(/\/(insights|my-dashboard)/, { timeout: 8_000 });
      authed = true;
      break;
    } catch {
      // Try next TOTP window.
    }
  }

  if (!authed) {
    throw new Error(`[E2E] Unable to authenticate ${email} via UI MFA flow.`);
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

  const me = await getJson(`${baseURL}/api/auth/me`, {
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

async function deleteManagedUsersByPrefix(
  baseURL: string,
  adminToken: string,
  tenantId: string,
  managedEmailPrefix: string,
): Promise<void> {
  const list = await getJson(`${baseURL}/api/admin/tenants/${tenantId}/users`, {
    Authorization: `Bearer ${adminToken}`,
  });

  if (!list.ok) {
    throw new Error(
      `[E2E] Failed to list tenant users for cleanup (status ${list.status}).`,
    );
  }

  const users = Array.isArray(list.data.users)
    ? (list.data.users as Array<Record<string, unknown>>)
    : [];

  const matching = users.filter((u) => {
    const email = typeof u.email === "string" ? u.email.toLowerCase() : "";
    return email.startsWith(`${managedEmailPrefix.toLowerCase()}.`);
  });

  for (const user of matching) {
    const id = typeof user.id === "string" ? user.id : "";
    if (!id) continue;
    await deleteWithAuth(
      `${baseURL}/api/admin/tenants/${tenantId}/users/${id}`,
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
    `${baseURL}/api/admin/tenants/${tenantId}/users`,
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
  const baseURL = config.projects[0]?.use.baseURL as string;
  const admin = await getAdminSession(baseURL);
  await mkdir(AUTH_DIR, { recursive: true });

  const managedEmailPrefix = (
    process.env.E2E_MANAGED_EMAIL_PREFIX || "e2e.auto"
  ).toLowerCase();
  const runId = getRunId();
  const tenantUserSeed = `tenant-user-${runId}`;
  const canvasUserSeed = `canvas-only-${runId}`;
  const tenantUserEmail = `${managedEmailPrefix}.tenant-user.${runId}@coheus.test`;
  const canvasUserEmail = `${managedEmailPrefix}.canvas-only.${runId}@coheus.test`;

  await deleteManagedUsersByPrefix(
    baseURL,
    admin.token,
    admin.tenantId,
    managedEmailPrefix,
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
  );
  await loginAndPersistState(
    baseURL,
    tenantUser.email,
    tenantUser.password,
    tenantUser.totpSecret,
    USER_STATE,
  );
  await loginAndPersistState(
    baseURL,
    canvasOnlyUser.email,
    canvasOnlyUser.password,
    canvasOnlyUser.totpSecret,
    CANVAS_ONLY_STATE,
  );
}
