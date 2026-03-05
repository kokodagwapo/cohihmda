const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;

/**
 * Return the primary frontend URL for use in outbound emails, redirects, etc.
 *
 * FRONTEND_URL can be comma-separated (for CORS). This function picks
 * the **first non-localhost** URL in production/staging, or the first URL
 * when running locally (NODE_ENV=development).
 */
export function resolveFrontendUrl(): string {
  const raw = process.env.FRONTEND_URL ?? "";
  const candidates = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    if (process.env.NODE_ENV === "development") {
      return "http://localhost:5173";
    }
    throw new Error(
      "FRONTEND_URL environment variable is not set. Cannot generate outbound links.",
    );
  }

  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    const local = candidates.find((u) => LOCALHOST_RE.test(u));
    if (local) return local;
    return candidates[0];
  }

  const nonLocal = candidates.find((u) => !LOCALHOST_RE.test(u));
  if (nonLocal) return nonLocal;
  console.error(
    `[frontendUrl] FRONTEND_URL only contains localhost values in ${process.env.NODE_ENV} mode: ${raw}`,
  );
  return candidates[0];
}

/**
 * Guard: throws if `url` contains a localhost origin and we're not in development.
 * Call before sending any outbound email to prevent leaking localhost links.
 */
export function assertNoLocalhostInProduction(url: string, context: string): void {
  if (process.env.NODE_ENV === "development") return;
  if (LOCALHOST_RE.test(url)) {
    throw new Error(
      `[${context}] Refusing to send email with localhost URL (${url}). ` +
        `Set FRONTEND_URL to your public domain.`,
    );
  }
}
