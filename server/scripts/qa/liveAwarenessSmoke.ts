/**
 * Live smoke test using E2E creds from .env.e2e / .env.e2e.local
 * Run from repo root: npx tsx server/scripts/qa/liveAwarenessSmoke.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

for (const f of [".env.e2e", ".env.e2e.local", ".env.local"]) {
  loadEnvFile(path.join(repoRoot, f));
}

function generateTotpCode(secret: string, timestampMs = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";
  for (const char of normalized) {
    const idx = alphabet.indexOf(char);
    if (idx < 0) throw new Error("bad totp secret");
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  const key = Buffer.from(bytes);
  const counter = Math.floor(timestampMs / 30_000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function postJson(url: string, body: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function getJson(url: string, token: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function signIn(): Promise<{
  token: string;
  tenantId?: string;
  user?: { tenant_id?: string; role?: string };
}> {
  const baseURL = (process.env.E2E_BASE_URL || "http://localhost:5000").replace(
    /\/+$/,
    "",
  );
  const email = process.env.E2E_ADMIN_EMAIL?.trim();
  const password = process.env.E2E_ADMIN_PASSWORD?.trim();
  const totpSecret = process.env.E2E_ADMIN_TOTP_SECRET?.trim();
  const tenantSlug = process.env.E2E_ADMIN_TENANT_SLUG?.trim();

  if (!email || !password || !totpSecret) {
    throw new Error(
      "Missing E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, or E2E_ADMIN_TOTP_SECRET in .env.e2e / .env.local",
    );
  }

  const payload: Record<string, unknown> = { email, password };
  if (tenantSlug) payload.tenantSlug = tenantSlug;

  let signIn = await postJson(`${baseURL}/api/auth/signin`, payload);
  if (!signIn.ok) {
    throw new Error(`Sign-in failed: ${signIn.status} ${JSON.stringify(signIn.data)}`);
  }

  let data = signIn.data as {
    token?: string;
    mfaRequired?: boolean;
    session?: string;
    challengeName?: string;
    user?: { tenant_id?: string };
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
    data = verify.data as typeof data;
  }

  if (!data.token) throw new Error("No token after sign-in");

  const user = (data as { user?: { tenant_id?: string; role?: string } }).user;
  let tenantId = user?.tenant_id;

  if (!tenantId) {
    const me = await getJson(`${baseURL}/api/auth/me`, data.token);
    tenantId = (me.data as { tenant_id?: string; user?: { tenant_id?: string } })
      ?.tenant_id;
    tenantId =
      tenantId ?? (me.data as { user?: { tenant_id?: string } })?.user?.tenant_id;
  }

  return { token: data.token, tenantId, user };
}

async function main() {
  const baseURL = (process.env.E2E_BASE_URL || "http://localhost:5000").replace(
    /\/+$/,
    "",
  );
  const apiBase = baseURL.includes("5000")
    ? "http://localhost:3001"
    : baseURL;

  console.log("\n=== Live awareness smoke (authenticated) ===\n");
  const { token, tenantId: jwtTenantId, user } = await signIn();
  console.log("[OK] Signed in", user?.role ? `(${user.role})` : "", "\n");

  let tenantId = jwtTenantId;

  if (!tenantId) {
    const tenants = await getJson(`${apiBase}/api/tenants`, token);
    if (tenants.ok) {
      const raw = tenants.data;
      const tenantList: { id: string; slug?: string; name?: string }[] =
        Array.isArray(raw)
          ? raw
          : ((raw as { tenants?: { id: string; slug?: string }[] }).tenants ?? []);
      const slug = process.env.E2E_ADMIN_TENANT_SLUG?.trim().toLowerCase();
      tenantId =
        tenantList.find((t) => t.slug?.toLowerCase() === slug)?.id ?? tenantList[0]?.id;
    }
  }

  if (!tenantId) {
    const defaultTenant = await getJson(
      `${apiBase}/api/cohi-chat/default-tenant`,
      token,
    );
    tenantId = (defaultTenant.data as { tenantId?: string })?.tenantId ?? undefined;
  }

  if (!tenantId) {
    throw new Error("No tenant id from JWT, /api/tenants, or default-tenant");
  }
  console.log(`Using tenant_id: ${tenantId}\n`);

  const navQs = `?tenant_id=${encodeURIComponent(tenantId)}`;
  const nav = await getJson(`${apiBase}/api/cohi-chat/navigation-targets${navQs}`, token);
  console.log(`navigation-targets: ${nav.status}`, nav.ok ? "OK" : JSON.stringify(nav.data));
  if (nav.ok) {
    const targets = (nav.data as { targets?: { id: string }[] }).targets ?? [];
    const hasSales = targets.some((t) => t.id === "sales-scorecard");
    console.log(`  sales-scorecard in catalog: ${hasSales ? "yes" : "NO"}`);
  }

  const askBody = {
    question: "who are my top tier LOs?",
    sessionId: `smoke-${Date.now()}`,
    conversationHistory: [],
  };
  const askQs = `?tenant_id=${encodeURIComponent(tenantId)}`;
  const ask = await postJson(`${apiBase}/api/cohi-chat/ask${askQs}`, askBody, token);
  console.log(`\ncohi-chat/ask (top tier LOs): ${ask.status}`);
  if (ask.ok) {
    const msg = String((ask.data as { message?: string }).message ?? "").slice(0, 500);
    const hints = (ask.data as { navigationHints?: { path: string }[] }).navigationHints ?? [];
    const sql = (ask.data as { sqlQuery?: string }).sqlQuery ?? "";
    console.log(`  message preview: ${msg.replace(/\n/g, " ").slice(0, 280)}...`);
    console.log(`  nav paths: ${hints.map((h) => h.path).join(", ") || "(none)"}`);
    const looksLikeVolumeRank =
      /loan_count|count\(\*\)|top 10 loan officers by active application/i.test(sql + msg);
    const mentionsScorecard =
      /scorecard|top tier|tts|sales scorecard/i.test(msg + hints.map((h) => h.path).join(" "));
    console.log(`  mentions scorecard/tier: ${mentionsScorecard ? "yes" : "NO"}`);
    console.log(`  looks like volume-only ranking: ${looksLikeVolumeRank ? "YES (bad)" : "no"}`);
  } else {
    console.log("  error:", JSON.stringify(ask.data).slice(0, 300));
  }

  console.log("\n=== Done ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
