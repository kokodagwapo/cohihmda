import { type TestPlan } from "./types.js";

export interface PlanValidationResult {
  ok: boolean;
  errors: string[];
}

function getMaxStepsPerIssue(): number {
  return Number(process.env.QA_AC_MAX_STEPS_PER_ISSUE || "20");
}

function getSelectorDenyList(): RegExp[] {
  const configured = process.env.QA_AC_SELECTOR_DENYLIST;
  if (!configured) {
    return [/data-role=['"]admin['"]/i, /data-testid=.*admin/i];
  }
  return configured
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => new RegExp(pattern, "i"));
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

export function validatePlan(plan: TestPlan): PlanValidationResult {
  const errors: string[] = [];
  const allowlist = getUrlAllowlist();
  const selectorDenyList = getSelectorDenyList();
  const maxSteps = getMaxStepsPerIssue();

  if (plan.steps.length > maxSteps) {
    errors.push(`Plan contains ${plan.steps.length} steps but the limit is ${maxSteps}`);
  }

  for (const step of plan.steps) {
    if (step.kind === "goto" && !isAllowedUrl(step.url, allowlist)) {
      errors.push(`Step ${step.id} uses URL outside QA_AC_URL_ALLOWLIST: ${step.url}`);
    }

    if (step.kind === "api" && !["GET", "HEAD"].includes(step.method)) {
      errors.push(`Step ${step.id} uses disallowed method ${step.method}`);
    }

    if (step.kind === "click" || step.kind === "fill" || step.kind === "assert") {
      if (selectorDenyList.some((pattern) => pattern.test(step.locator))) {
        errors.push(`Step ${step.id} uses denied selector ${step.locator}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
