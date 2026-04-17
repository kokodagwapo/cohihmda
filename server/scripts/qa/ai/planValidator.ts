import { type PlanStep, type StepScope, type TestPlan } from "./types.js";

export interface PlanValidationResult {
  ok: boolean;
  errors: string[];
  plan: TestPlan;
  elevatedSteps: string[];
  writesPlanned: number;
}

const DEFAULT_SELF_SCOPED_PATHS = [
  String.raw`^/api/(workbench|cohi-chat|knowledge-center|rag/knowledge-base|users/me|saved-visualizations)`,
];
const DEFAULT_BROAD_SCOPE_PATHS = [
  String.raw`^/api/(tenants/[^/]+(/.*)?|admin/(users|platform|stripe|rag-voice|global-knowledge)|sso|platform-settings)`,
  String.raw`^/api/tenants`,
  String.raw`/all\b`,
];
const DEFAULT_API_PATH_DENYLIST = [
  "/api/admin/platform-team",
  "/api/auth/logout-all",
  "/api/tenants/delete-all",
];

function getMaxStepsPerIssue(): number {
  return Number(process.env.QA_AC_MAX_STEPS_PER_ISSUE || "20");
}

function parseRegexList(raw: string | undefined, defaults: string[]): RegExp[] {
  const source = raw
    ? raw.split(",").map((entry) => entry.trim()).filter(Boolean)
    : defaults;
  return source.map((pattern) => new RegExp(pattern, "i"));
}

function getSelectorDenyList(): RegExp[] {
  return parseRegexList(process.env.QA_AC_SELECTOR_DENYLIST, [
    String.raw`data-role=['"]admin['"]`,
    String.raw`data-testid=.*admin`,
  ]);
}

function getSelfScopedPathPatterns(): RegExp[] {
  return parseRegexList(process.env.QA_AC_SELF_SCOPED_PATHS, DEFAULT_SELF_SCOPED_PATHS);
}

function getBroadScopePathPatterns(): RegExp[] {
  return parseRegexList(process.env.QA_AC_BROAD_SCOPE_PATHS, DEFAULT_BROAD_SCOPE_PATHS);
}

function getApiPathDenyList(): RegExp[] {
  return parseRegexList(process.env.QA_AC_API_PATH_DENYLIST, DEFAULT_API_PATH_DENYLIST);
}

function getUrlAllowlist(): string[] {
  const configured = process.env.QA_AC_URL_ALLOWLIST;
  if (!configured) {
    return [process.env.E2E_BASE_URL || "", "http://localhost:5000"].filter(Boolean);
  }
  return configured.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function isAllowedUrl(url: string, allowlist: string[]): boolean {
  if (url.startsWith("/")) {
    return true;
  }
  return allowlist.some((allowed) => allowed && url.startsWith(allowed));
}

function normalizeApiPath(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    try {
      const parsed = new URL(path);
      return parsed.pathname || path;
    } catch {
      return path;
    }
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function validateFixtureFilePath(step: Extract<PlanStep, { kind: "upload" }>): string | null {
  if (step.fixtureFile.includes("..") || step.fixtureFile.startsWith("/") || /^[a-z]:/i.test(step.fixtureFile)) {
    return `Step ${step.id} uses fixtureFile outside e2e/fixtures/qa-agent: ${step.fixtureFile}`;
  }
  return null;
}

function validateSelector(step: PlanStep, selectorDenyList: RegExp[]): string | null {
  const selector =
    "locator" in step
      ? step.locator
      : step.kind === "expectDownload"
        ? step.triggerLocator
        : null;
  if (!selector) {
    return null;
  }
  return matchesAny(selector, selectorDenyList)
    ? `Step ${step.id} uses denied selector ${selector}`
    : null;
}

export function classifyPlanStep(step: PlanStep, opts?: {
  selfScopedPatterns?: RegExp[];
  broadScopePatterns?: RegExp[];
  apiPathDenyList?: RegExp[];
}): { scope: StepScope; requiresElevation: boolean; error?: string } {
  const selfScopedPatterns = opts?.selfScopedPatterns ?? getSelfScopedPathPatterns();
  const broadScopePatterns = opts?.broadScopePatterns ?? getBroadScopePathPatterns();
  const apiPathDenyList = opts?.apiPathDenyList ?? getApiPathDenyList();

  if (
    step.kind === "goto" ||
    step.kind === "assert" ||
    step.kind === "waitFor" ||
    step.kind === "expectDownload"
  ) {
    return { scope: "readonly", requiresElevation: false };
  }

  if (
    step.kind === "click" ||
    step.kind === "fill" ||
    step.kind === "upload" ||
    step.kind === "select" ||
    step.kind === "press"
  ) {
    return { scope: "self_scoped", requiresElevation: false };
  }

  if (step.kind !== "api") {
    return {
      scope: "readonly",
      requiresElevation: false,
      error: `Step ${step.id} has unsupported classification kind ${(step as PlanStep).kind}`,
    };
  }

  const normalizedPath = normalizeApiPath(step.path);
  if (matchesAny(normalizedPath, apiPathDenyList)) {
    return {
      scope: "broad_scope",
      requiresElevation: true,
      error: `Step ${step.id} targets a denied API path: ${normalizedPath}`,
    };
  }

  if (step.method === "GET" || step.method === "HEAD") {
    return { scope: "readonly", requiresElevation: false };
  }

  const isBroadDelete = step.method === "DELETE" && /^\/api\/tenants/i.test(normalizedPath);
  if (matchesAny(normalizedPath, broadScopePatterns) || isBroadDelete) {
    return { scope: "broad_scope", requiresElevation: true };
  }

  if (matchesAny(normalizedPath, selfScopedPatterns)) {
    return { scope: "self_scoped", requiresElevation: false };
  }

  return {
    scope: "broad_scope",
    requiresElevation: true,
    error: `Step ${step.id} uses mutation path outside QA_AC_SELF_SCOPED_PATHS and QA_AC_BROAD_SCOPE_PATHS: ${normalizedPath}`,
  };
}

export function validatePlan(plan: TestPlan): PlanValidationResult {
  const errors: string[] = [];
  const allowlist = getUrlAllowlist();
  const selectorDenyList = getSelectorDenyList();
  const selfScopedPatterns = getSelfScopedPathPatterns();
  const broadScopePatterns = getBroadScopePathPatterns();
  const apiPathDenyList = getApiPathDenyList();
  const maxSteps = getMaxStepsPerIssue();
  const seenStepIds = new Set<string>();
  const elevatedSteps: string[] = [];

  const validatedPlan: TestPlan = JSON.parse(JSON.stringify(plan)) as TestPlan;

  if (validatedPlan.steps.length > maxSteps) {
    errors.push(`Plan contains ${validatedPlan.steps.length} steps but the limit is ${maxSteps}`);
  }

  for (const step of validatedPlan.steps) {
    if (seenStepIds.has(step.id)) {
      errors.push(`Duplicate step id detected: ${step.id}`);
    }
    seenStepIds.add(step.id);

    if (!/^ac\d+-/i.test(step.id)) {
      errors.push(`Step ${step.id} must start with ac{statementNumber}-`);
    }

    if (step.kind === "goto" && !isAllowedUrl(step.url, allowlist)) {
      errors.push(`Step ${step.id} uses URL outside QA_AC_URL_ALLOWLIST: ${step.url}`);
    }

    if (step.kind === "upload") {
      const fixtureError = validateFixtureFilePath(step);
      if (fixtureError) {
        errors.push(fixtureError);
      }
    }

    const selectorError = validateSelector(step, selectorDenyList);
    if (selectorError) {
      errors.push(selectorError);
    }

    const classification = classifyPlanStep(step, {
      selfScopedPatterns,
      broadScopePatterns,
      apiPathDenyList,
    });
    step.scope = classification.scope;
    step.requiresElevation = classification.requiresElevation;

    if (classification.requiresElevation) {
      elevatedSteps.push(step.id);
    }
    if (classification.error) {
      errors.push(classification.error);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    plan: validatedPlan,
    elevatedSteps,
    writesPlanned: validatedPlan.steps.filter((step) => step.scope !== "readonly").length,
  };
}
