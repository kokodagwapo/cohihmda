import type { RoleKey } from "./constants.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type AccessPolicy =
  | "public"
  | "auth"
  | "platform_staff"
  | "platform_admin"
  | "any_admin"
  | "tenant_admin_or_super"
  | "analytics_admin"
  | "distributions_admin";

export interface RouteExpectation {
  routeGroup: string;
  method: HttpMethod;
  path: string;
  policy: AccessPolicy;
  expect: Record<RoleKey, number>;
}

const AUTH_EXPECTED: Record<RoleKey, number> = {
  super_admin: 200,
  platform_admin: 200,
  support: 200,
  tenant_admin: 200,
  user: 200,
  canvas_only_user: 200,
  unauthenticated: 401,
};

const AUTH_BLOCKS_CANVAS_ONLY: Record<RoleKey, number> = {
  ...AUTH_EXPECTED,
  canvas_only_user: 403,
};

const PLATFORM_STAFF_EXPECTED: Record<RoleKey, number> = {
  super_admin: 200,
  platform_admin: 200,
  support: 200,
  tenant_admin: 403,
  user: 403,
  canvas_only_user: 403,
  unauthenticated: 401,
};

const PLATFORM_ADMIN_EXPECTED: Record<RoleKey, number> = {
  super_admin: 200,
  platform_admin: 200,
  support: 403,
  tenant_admin: 403,
  user: 403,
  canvas_only_user: 403,
  unauthenticated: 401,
};

const ANY_ADMIN_EXPECTED: Record<RoleKey, number> = {
  super_admin: 200,
  platform_admin: 200,
  support: 200,
  tenant_admin: 200,
  user: 403,
  canvas_only_user: 403,
  unauthenticated: 401,
};

const TENANT_ADMIN_OR_SUPER_EXPECTED: Record<RoleKey, number> = {
  super_admin: 200,
  platform_admin: 403,
  support: 403,
  tenant_admin: 200,
  user: 403,
  canvas_only_user: 403,
  unauthenticated: 401,
};

const ANALYTICS_ADMIN_EXPECTED: Record<RoleKey, number> = {
  super_admin: 200,
  platform_admin: 200,
  support: 403,
  tenant_admin: 200,
  user: 403,
  canvas_only_user: 403,
  unauthenticated: 401,
};

const DISTRIBUTIONS_ADMIN_EXPECTED: Record<RoleKey, number> = {
  super_admin: 200,
  platform_admin: 200,
  support: 403,
  tenant_admin: 200,
  user: 403,
  canvas_only_user: 403,
  unauthenticated: 401,
};

const PUBLIC_EXPECTED: Record<RoleKey, number> = {
  super_admin: 200,
  platform_admin: 200,
  support: 200,
  tenant_admin: 200,
  user: 200,
  canvas_only_user: 200,
  unauthenticated: 200,
};

const PUBLIC_BLOCKS_CANVAS_ONLY: Record<RoleKey, number> = {
  ...PUBLIC_EXPECTED,
  canvas_only_user: 403,
};

export const ROLE_MATRIX: RouteExpectation[] = [
  { routeGroup: "/api/auth", method: "GET", path: "/api/auth/__rbac_probe", policy: "public", expect: PUBLIC_EXPECTED },
  { routeGroup: "/api/subscriptions", method: "GET", path: "/api/subscriptions/__rbac_probe", policy: "platform_staff", expect: PLATFORM_STAFF_EXPECTED },
  { routeGroup: "/api/rag", method: "GET", path: "/api/rag/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/metrics", method: "GET", path: "/api/metrics/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/dashboard", method: "GET", path: "/api/dashboard/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/dashboard-insights", method: "GET", path: "/api/dashboard-insights/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/admin", method: "GET", path: "/api/admin/__rbac_probe", policy: "platform_staff", expect: PLATFORM_STAFF_EXPECTED },
  { routeGroup: "/api/los", method: "GET", path: "/api/los/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/synapse", method: "GET", path: "/api/synapse/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/loans", method: "GET", path: "/api/loans/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/scorecard", method: "GET", path: "/api/scorecard/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/toptiering", method: "GET", path: "/api/toptiering/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/pricing-dashboard", method: "GET", path: "/api/pricing-dashboard/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/lock-stratification", method: "GET", path: "/api/lock-stratification/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/pipeline-analysis", method: "GET", path: "/api/pipeline-analysis/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/predictions", method: "GET", path: "/api/predictions/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/fallout", method: "GET", path: "/api/fallout/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/user", method: "GET", path: "/api/user/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/encompass", method: "GET", path: "/api/encompass/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/tenants", method: "GET", path: "/api/tenants/__rbac_probe", policy: "platform_staff", expect: PLATFORM_STAFF_EXPECTED },
  { routeGroup: "/api/tenant-config", method: "GET", path: "/api/tenant-config/__rbac_probe", policy: "tenant_admin_or_super", expect: TENANT_ADMIN_OR_SUPER_EXPECTED },
  { routeGroup: "/api/cohi-chat", method: "GET", path: "/api/cohi-chat/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/cohi-chat/workbench", method: "GET", path: "/api/cohi-chat/workbench/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/data-quality", method: "GET", path: "/api/data-quality/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/news", method: "GET", path: "/api/news/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/email", method: "GET", path: "/api/email/__rbac_probe", policy: "public", expect: PUBLIC_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/admin/global-knowledge", method: "GET", path: "/api/admin/global-knowledge/__rbac_probe", policy: "platform_admin", expect: PLATFORM_ADMIN_EXPECTED },
  { routeGroup: "/api/admin/ai-prompts", method: "GET", path: "/api/admin/ai-prompts/__rbac_probe", policy: "platform_admin", expect: PLATFORM_ADMIN_EXPECTED },
  { routeGroup: "/api/admin/platform-settings", method: "GET", path: "/api/admin/platform-settings/__rbac_probe", policy: "platform_admin", expect: PLATFORM_ADMIN_EXPECTED },
  { routeGroup: "/api/admin/tenant-config-transfer", method: "GET", path: "/api/admin/tenant-config-transfer/__rbac_probe", policy: "platform_admin", expect: PLATFORM_ADMIN_EXPECTED },
  { routeGroup: "/api/admin/insight-feedback", method: "GET", path: "/api/admin/insight-feedback/__rbac_probe", policy: "platform_admin", expect: PLATFORM_ADMIN_EXPECTED },
  { routeGroup: "/api/admin/release-notes", method: "GET", path: "/api/admin/release-notes/__rbac_probe", policy: "platform_admin", expect: PLATFORM_ADMIN_EXPECTED },
  { routeGroup: "/api/knowledge-center", method: "GET", path: "/api/knowledge-center/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/workbench/canvases", method: "GET", path: "/api/workbench/canvases/__rbac_probe", policy: "auth", expect: AUTH_EXPECTED },
  { routeGroup: "/api/groups", method: "GET", path: "/api/groups/__rbac_probe", policy: "any_admin", expect: ANY_ADMIN_EXPECTED },
  { routeGroup: "/api/workbench/reports", method: "GET", path: "/api/workbench/reports/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/distributions", method: "GET", path: "/api/distributions/__rbac_probe", policy: "distributions_admin", expect: DISTRIBUTIONS_ADMIN_EXPECTED },
  { routeGroup: "/api/research", method: "GET", path: "/api/research/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/insights/tracked", method: "GET", path: "/api/insights/tracked/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/onboarding", method: "GET", path: "/api/onboarding/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/jobs", method: "GET", path: "/api/jobs/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/help", method: "GET", path: "/api/help/__rbac_probe", policy: "platform_staff", expect: PLATFORM_STAFF_EXPECTED },
  { routeGroup: "/api/analytics", method: "GET", path: "/api/analytics/__rbac_probe", policy: "analytics_admin", expect: ANALYTICS_ADMIN_EXPECTED },
  { routeGroup: "/api/release-notes", method: "GET", path: "/api/release-notes/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/fallout-alerts", method: "GET", path: "/api/fallout-alerts/__rbac_probe", policy: "distributions_admin", expect: DISTRIBUTIONS_ADMIN_EXPECTED },
  { routeGroup: "/api/fallout-response", method: "GET", path: "/api/fallout-response/__rbac_probe", policy: "public", expect: PUBLIC_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/podcast/cohi", method: "GET", path: "/api/podcast/cohi/__rbac_probe", policy: "auth", expect: AUTH_BLOCKS_CANVAS_ONLY },
  { routeGroup: "/api/cohibuilder/portfolio", method: "GET", path: "/api/cohibuilder/portfolio/__rbac_probe", policy: "public", expect: PUBLIC_BLOCKS_CANVAS_ONLY },
];

