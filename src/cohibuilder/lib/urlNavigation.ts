/**
 * Cohi Builder deep-linking when embedded in Coheus Capture Analysis:
 * /capture-analysis?view=...&loanId=...&appId=...&drawId=...&lenderId=...
 * `loanId` may be the portfolio synthetic id or the import LOS loan number (Loanno).
 * Optional UI: hideNav=1 keeps the Builder left rail off-canvas (header menu opens it).
 */

export type NavIds = {
  loanId: number | null;
  appId: string | null;
  drawId: string | null;
  lenderId: number | null;
};

export type AppRoute =
  | { mode: "landing" }
  | { mode: "app"; view: string } & NavIds;

export const EMPTY_IDS: NavIds = {
  loanId: null,
  appId: null,
  drawId: null,
  lenderId: null,
};

const BASE_PATH = "/capture-analysis";

/** Views that clear entity IDs when navigated to (sidebar / top-level). */
export const VIEWS_RESET_IDS = new Set([
  "dashboard",
  "portfolio-map",
  "draws",
  "lenders",
  "survey",
  "integrations",
  "respa",
  "active-builds",
  "expiring-docs",
  "locks-expiring",
  "high-risk-loans",
  "non-qm-loans",
  "all-loans",
  "capture-rate",
  "rate-lock-coverage",
]);

function parseId(param: string | null): number | null {
  if (param == null || param === "") return null;
  const n = Number(param);
  return Number.isFinite(n) ? n : null;
}

export function readRouteFromLocation(): AppRoute {
  const path = window.location.pathname;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) {
    const q = new URLSearchParams(window.location.search);
    return {
      mode: "app",
      view: q.get("view") || "dashboard",
      loanId: parseId(q.get("loanId")),
      appId: q.get("appId"),
      drawId: q.get("drawId"),
      lenderId: parseId(q.get("lenderId")),
    };
  }
  return { mode: "landing" };
}

export function routeToPath(route: AppRoute): string {
  if (route.mode === "landing") {
    return BASE_PATH;
  }
  const isBareDashboard =
    route.view === "dashboard" &&
    route.loanId == null &&
    !route.appId &&
    !route.drawId &&
    route.lenderId == null;
  if (isBareDashboard) {
    return BASE_PATH;
  }
  const q = new URLSearchParams();
  q.set("view", route.view);
  if (route.loanId != null) q.set("loanId", String(route.loanId));
  if (route.appId) q.set("appId", route.appId);
  if (route.drawId) q.set("drawId", route.drawId);
  if (route.lenderId != null) q.set("lenderId", String(route.lenderId));
  return `${BASE_PATH}?${q.toString()}`;
}

function navIdsFromRoute(route: AppRoute): NavIds {
  if (route.mode !== "app") return { ...EMPTY_IDS };
  return {
    loanId: route.loanId,
    appId: route.appId,
    drawId: route.drawId,
    lenderId: route.lenderId,
  };
}

export function buildNextRoute(
  prev: AppRoute,
  view: string,
  patch?: Partial<NavIds>,
): AppRoute {
  if (view === "landing") {
    return { mode: "landing" };
  }
  const preservedIds = navIdsFromRoute(prev);
  const reset = VIEWS_RESET_IDS.has(view);
  const nextIds: NavIds = reset
    ? { ...EMPTY_IDS, ...patch }
    : { ...preservedIds, ...patch };
  return {
    mode: "app",
    view,
    ...nextIds,
  };
}
