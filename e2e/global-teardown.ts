import type { FullConfig } from "@playwright/test";
import { readProvisionedState, removeProvisionedState } from "./provision-state";
import { generateTotpCode } from "./totp";

type SignInResponse = {
  token?: string;
  mfaRequired?: boolean;
  challengeName?: "SOFTWARE_TOKEN_MFA" | "EMAIL_OTP" | "SMS_MFA";
  session?: string;
};

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

async function signInAdminToken(baseURL: string, tenantSlug: string): Promise<string> {
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  const adminTotpSecret = process.env.E2E_ADMIN_TOTP_SECRET;

  if (!adminEmail || !adminPassword || !adminTotpSecret) {
    throw new Error(
      "Missing E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, or E2E_ADMIN_TOTP_SECRET for teardown cleanup.",
    );
  }

  const signIn = await postJson(`${baseURL}/api/auth/signin`, {
    email: adminEmail,
    password: adminPassword,
    tenantSlug,
  });
  const signInData = signIn.data as SignInResponse;

  if (signIn.ok && signInData.token) {
    return signInData.token;
  }

  if (!signInData.mfaRequired || !signInData.session || !signInData.challengeName) {
    throw new Error(
      `Teardown admin sign-in failed (status ${signIn.status}): ${JSON.stringify(signIn.data)}`,
    );
  }

  if (signInData.challengeName !== "SOFTWARE_TOKEN_MFA") {
    throw new Error(
      `Unsupported teardown MFA challenge: ${signInData.challengeName}.`,
    );
  }

  const candidateCodes = [0, -30_000, 30_000].map((offsetMs) =>
    generateTotpCode(adminTotpSecret, Date.now() + offsetMs),
  );

  for (const code of candidateCodes) {
    const verify = await postJson(`${baseURL}/api/auth/mfa/verify`, {
      email: adminEmail,
      session: signInData.session,
      code,
      challengeName: signInData.challengeName,
      tenantSlug,
    });
    if (verify.ok && typeof verify.data.token === "string") {
      return verify.data.token;
    }
  }

  throw new Error("Teardown admin MFA verification failed.");
}

async function deleteUser(baseURL: string, token: string, tenantId: string, userId: string) {
  const response = await fetch(`${baseURL}/api/admin/tenants/${tenantId}/users/${userId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Teardown user deletion failed (${response.status}) user=${userId} body=${body}`,
    );
  }
}

export default async function globalTeardown(config: FullConfig) {
  const state = readProvisionedState();
  if (!state) {
    return;
  }

  const baseURL = config.projects[0]?.use.baseURL as string;
  try {
    const adminToken = await signInAdminToken(baseURL, state.tenantSlug);
    await deleteUser(baseURL, adminToken, state.tenantId, state.users.tenantUser.id);
    await deleteUser(baseURL, adminToken, state.tenantId, state.users.canvasOnlyUser.id);
  } finally {
    await removeProvisionedState();
  }
}

