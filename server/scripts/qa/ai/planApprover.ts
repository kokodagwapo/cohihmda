import type { TestPlan } from "./types.js";

export interface PlanApprovalDecision {
  approved: boolean;
  approvalStatus: "auto_read_only" | "rejected_state_change";
  reason?: string;
}

export function approvePlan(plan: TestPlan): PlanApprovalDecision {
  const hasStateChangingStep = plan.steps.some((step) => step.kind === "api" && step.method !== "GET" && step.method !== "HEAD");
  if (hasStateChangingStep) {
    return {
      approved: false,
      approvalStatus: "rejected_state_change",
      reason: "State-changing steps are not allowed in v1",
    };
  }

  return {
    approved: true,
    approvalStatus: "auto_read_only",
  };
}
