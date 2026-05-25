/**
 * Playwright globalSetup: refresh e2e/.auth/user.json when stale (>50 min) or missing.
 * Set MANUAL_AUTH_SKIP_REFRESH=1 to reuse existing storage state without API sign-in.
 * Set MANUAL_AUTH_FORCE_REFRESH=1 to always refresh.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { loadE2EEnv } from "./load-e2e-env.mjs";
import { AUTH_DIR } from "./provision-state";

loadE2EEnv();

const AUTH_MAX_AGE_MS = 50 * 60 * 1000;
const userJson = path.join(AUTH_DIR, "user.json");

export default async function globalSetup() {
  if (process.env.MANUAL_AUTH_SKIP_REFRESH === "1") {
    console.log(
      "[manual-auth] Skipping refresh (MANUAL_AUTH_SKIP_REFRESH=1)",
    );
    return;
  }

  const force = process.env.MANUAL_AUTH_FORCE_REFRESH === "1";
  let shouldRefresh = force || !existsSync(userJson);

  if (!shouldRefresh && existsSync(userJson)) {
    const ageMs = Date.now() - statSync(userJson).mtimeMs;
    shouldRefresh = ageMs > AUTH_MAX_AGE_MS;
    if (!shouldRefresh) {
      console.log(
        `[manual-auth] Reusing ${userJson} (age ${Math.round(ageMs / 60000)}m)`,
      );
      return;
    }
    console.log(
      `[manual-auth] Auth stale (${Math.round(ageMs / 60000)}m > 50m), refreshing…`,
    );
  } else if (!existsSync(userJson)) {
    console.log("[manual-auth] No user.json — refreshing…");
  } else if (force) {
    console.log("[manual-auth] MANUAL_AUTH_FORCE_REFRESH=1 — refreshing…");
  }

  const { main: runManualAuth } = await import("./manual-auth-setup.ts");
  await runManualAuth();
}
