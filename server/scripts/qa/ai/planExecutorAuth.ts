/**
 * Pure auth-routing helpers for the AC validator's plan executor. Kept in a
 * separate module (with no Playwright / Node.js fs dependencies) so the
 * backend's predeploy Vitest suite can unit-test the path classifier without
 * pulling the executor's `@playwright/test` import — `@playwright/test` is an
 * E2E-only devDependency at the repo root and is not installed in the
 * `server/` workspace.
 */

/**
 * API paths that require a `platform_admin` or `super_admin` identity (these
 * routes are mounted behind `requirePlatformAdmin` / `requireSuperAdmin`
 * middleware on the backend). Calling them with a tenant-admin token produces
 * a 403 Forbidden, so the executor must transparently switch to the platform
 * admin storage state when these paths appear in the plan.
 *
 * Tenant-scoped admin routes like `/api/admin/tenants/:id/...` are NOT on this
 * list: they run under tenant admins today and their ACs should continue to
 * exercise tenant-admin credentials.
 */
export const PLATFORM_ADMIN_API_PATH_PREFIXES: readonly string[] = [
  "/api/admin/global-knowledge",
  "/api/admin/platform-settings",
  "/api/admin/ai-prompts",
  "/api/admin/release-notes",
  "/api/admin/insight-feedback",
  "/api/admin/tenant-config-transfer",
];

export function requiresPlatformAdmin(apiPath: string): boolean {
  return PLATFORM_ADMIN_API_PATH_PREFIXES.some((prefix) => apiPath.startsWith(prefix));
}
