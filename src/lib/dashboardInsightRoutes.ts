/**
 * Single source of truth: dashboard insight sourcePageId → app route and navigation state.
 * Ensures "Go to [dashboard]" from evidence modal, Aletheia, etc. lands on the correct page.
 *
 * filter_context / dashboardInsightFilterContext is only applied where a section reads it
 * (currently Leaderboard on /insights).
 */

/** Registered dashboard insight page ids (extend when adding new insight-enabled dashboards). */
export const DASHBOARD_INSIGHT_PAGE_IDS = [
  "leaderboard",
  "loan-complexity",
  "company-scorecard",
  "credit-risk-management",
  "workflow-conversion",
  "top-tiering-comparison",
] as const;
export type DashboardInsightPageId = (typeof DASHBOARD_INSIGHT_PAGE_IDS)[number];

export function isKnownDashboardInsightPageId(pageId: string): pageId is DashboardInsightPageId {
  return (DASHBOARD_INSIGHT_PAGE_IDS as readonly string[]).includes(pageId);
}

/**
 * Path to open for an insight's source dashboard (hash for /insights sections, full path for standalone routes).
 */
export function getDashboardInsightPath(pageId: string): string {
  if (!pageId) return "/insights";
  if (pageId === "loan-complexity") return "/loan-complexity";
  if (pageId === "company-scorecard") return "/company-scorecard";
  if (pageId === "credit-risk-management") return "/credit-risk-management";
  if (pageId === "workflow-conversion") return "/workflow-conversion";
  if (pageId === "top-tiering-comparison") return "/top-tiering-comparison";
  return `/insights#${pageId}`;
}

/**
 * React Router location.state for navigate() after "Go to dashboard".
 * - Leaderboard: scroll + optional filter_context for LeaderBoardSection.
 * - Loan Complexity: no filter state in router (page does not consume it yet).
 * - Other /insights#section: scroll only.
 */
export function getDashboardInsightNavigateState(
  pageId: string,
  filterContext?: Record<string, unknown>
): Record<string, unknown> {
  if (!pageId) return {};

  if (pageId === "loan-complexity") {
    return {};
  }

  if (pageId === "company-scorecard") {
    return {};
  }

  if (pageId === "credit-risk-management") {
    return {};
  }

  if (pageId === "workflow-conversion") {
    return {};
  }

  if (pageId === "top-tiering-comparison") {
    return {};
  }

  const state: Record<string, unknown> = {
    scrollToSection: pageId,
  };

  const hasFilters = filterContext && Object.keys(filterContext).length > 0;
  if (hasFilters && pageId === "leaderboard") {
    state.dashboardInsightFilterContext = filterContext;
    state.sourcePageId = pageId;
  }

  return state;
}
