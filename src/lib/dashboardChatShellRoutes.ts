/**
 * Routes that mount the unified Cohi chat shell (same behavior as /insights).
 * Excludes help, feedback, admin, settings, and communications center.
 */

/** Layouts that use DashboardLayout but must not show the chat band. */
export const UNIFIED_CHAT_SHELL_EXCLUDED_PATHS = new Set([
  "/workbench/distributions",
  "/hmda",
]);

export function isUnifiedChatShellExcluded(pathname: string): boolean {
  return UNIFIED_CHAT_SHELL_EXCLUDED_PATHS.has(pathname);
}

const DASHBOARD_CHAT_SHELL_PATHS = new Set([
  "/insights",
  "/actors",
  "/company-scorecard",
  "/fallout-forecast",
  "/loan-complexity",
  "/loan-detail",
  "/capture-analysis",
  "/business-overview",
  "/performance/financial-modeling-sandbox",
  "/performance/toptiering-comparison",
  "/high-performers",
  "/leaderboard",
  "/pricing-dashboard",
  "/sales-scorecard",
  "/sales-scorecard-overview",
  "/sales-company-overview",
  "/sales-trends",
  "/production-trends",
  "/production-summary-by-week",
  "/pipeline-analysis",
  "/lock-stratification",
  "/performance/operation-scorecard",
  "/performance/operation-scorecard-trends",
  "/credit-risk-management",
  "/workflow-conversion",
  "/performance/estimated-closings-risk",
  "/performance/active-workload",
  "/data-quality",
]);

export function isDashboardChatShellRoute(pathname: string): boolean {
  return DASHBOARD_CHAT_SHELL_PATHS.has(pathname);
}

/** Top Tiering dashboard pages (excludes /insights card-style shell). */
export function isTopTieringDashboardRoute(pathname: string): boolean {
  return isDashboardChatShellRoute(pathname) && pathname !== "/insights";
}

/** All dashboard nav targets from top nav (for documentation / tests). */
export const DASHBOARD_NAV_ROUTE_LIST = [...DASHBOARD_CHAT_SHELL_PATHS].sort();
