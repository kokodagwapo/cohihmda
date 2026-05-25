/**
 * Refresh e2e/.auth/user.json from E2E_ADMIN_* in .env.e2e (no user provisioning).
 * Run: npx tsx e2e/manual-auth-setup.ts
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadE2EEnv } from "./load-e2e-env.mjs";
import { generateTotpCode } from "./totp";
import { AUTH_DIR } from "./provision-state";

loadE2EEnv();

const baseURL = (process.env.E2E_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const email = process.env.E2E_ADMIN_EMAIL?.trim();
const password = process.env.E2E_ADMIN_PASSWORD?.trim();
const totpSecret = process.env.E2E_ADMIN_TOTP_SECRET?.trim();
const tenantSlug = process.env.E2E_ADMIN_TENANT_SLUG?.trim() || undefined;

if (!email || !password || !totpSecret) {
  console.error("[manual-auth] Set E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET in .env.e2e");
  process.exit(1);
}

async function postJson(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

async function signIn(): Promise<{ token: string; cognitoAccessToken?: string }> {
  const payload: Record<string, unknown> = { email, password };
  if (tenantSlug) payload.tenantSlug = tenantSlug;

  let signIn = await postJson(`${baseURL}/api/auth/signin`, payload);
  if (!signIn.ok) {
    const tenant = tenantSlug ?? "(default)";
    throw new Error(
      `Sign-in failed: ${signIn.status} ${JSON.stringify(signIn.data)} — tenant=${tenant} baseURL=${baseURL} (retry: npx tsx e2e/manual-auth-setup.ts)`,
    );
  }

  let data = signIn.data as {
    token?: string;
    cognitoAccessToken?: string;
    mfaRequired?: boolean;
    session?: string;
    challengeName?: string;
  };

  if (data.mfaRequired && data.session) {
    const code = generateTotpCode(totpSecret);
    const verify = await postJson(`${baseURL}/api/auth/mfa/verify`, {
      email,
      session: data.session,
      code,
      challengeName: data.challengeName || "SOFTWARE_TOKEN_MFA",
      ...(tenantSlug ? { tenantSlug } : {}),
    });
    if (!verify.ok || typeof verify.data.token !== "string") {
      throw new Error(`MFA failed: ${verify.status}`);
    }
    return {
      token: verify.data.token as string,
      cognitoAccessToken:
        typeof verify.data.cognitoAccessToken === "string"
          ? verify.data.cognitoAccessToken
          : undefined,
    };
  }

  if (!data.token) throw new Error("No token in sign-in response");
  return { token: data.token, cognitoAccessToken: data.cognitoAccessToken };
}

async function main() {
  await mkdir(AUTH_DIR, { recursive: true });
  const signedIn = await signIn();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ token, cognitoAccessToken }) => {
      localStorage.setItem("auth_token", token);
      if (cognitoAccessToken) {
        localStorage.setItem("cognito_access_token", cognitoAccessToken);
      }
      localStorage.setItem("cohi_force_unified_chat", "1");
    },
    signedIn,
  );
  await page.goto(`${baseURL}/insights`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/(insights|workbench|my-dashboard)/, { timeout: 30_000 });
  const out = path.join(AUTH_DIR, "user.json");
  await page.context().storageState({ path: out });
  await browser.close();
  console.log(`[manual-auth] Wrote ${out} for ${email}`);
}

export default async function globalSetup() {
  await main();
}

export { main };

const invokedDirect =
  typeof process.argv[1] === "string" &&
  process.argv[1].replace(/\\/g, "/").includes("manual-auth-setup");
if (invokedDirect) {
  main().catch((err) => {
    console.error("[manual-auth]", err);
    process.exit(1);
  });
}
