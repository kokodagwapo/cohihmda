/**
 * Single source of truth: dashboard insight sourcePageId → app route and navigation state.
 * Ensures "Go to [dashboard]" from evidence modal, Cohi, etc. lands on the correct page.
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
  const raw = (pageId || "").trim();
  if (!raw) return "/insights";
  const id = raw.toLowerCase();
  if (id === "loan-complexity") return "/loan-complexity";
  if (id === "company-scorecard") return "/company-scorecard";
  if (id === "credit-risk-management") return "/credit-risk-management";
  if (id === "workflow-conversion") return "/workflow-conversion";
  /** Matches App.tsx: <Route path="/performance/toptiering-comparison" ... /> */
  if (id === "top-tiering-comparison" || id === "toptiering-comparison") {
    return "/performance/toptiering-comparison";
  }
  return `/insights#${raw}`;
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
  const raw = (pageId || "").trim();
  if (!raw) return {};
  const id = raw.toLowerCase();

  if (id === "loan-complexity") {
    return {};
  }

  if (id === "company-scorecard") {
    return {};
  }

  if (id === "credit-risk-management") {
    return {};
  }

  if (id === "workflow-conversion") {
    return {};
  }

  if (id === "top-tiering-comparison" || id === "toptiering-comparison") {
    return {};
  }

  const state: Record<string, unknown> = {
    scrollToSection: raw,
  };

  const hasFilters = filterContext && Object.keys(filterContext).length > 0;
  if (hasFilters && id === "leaderboard") {
    state.dashboardInsightFilterContext = filterContext;
    state.sourcePageId = raw;
  }

  return state;
}
