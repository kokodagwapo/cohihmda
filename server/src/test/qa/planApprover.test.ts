import { afterEach, describe, expect, it } from "vitest";
import { approvePlan } from "../../../scripts/qa/ai/planApprover.js";
import type { TestPlan } from "../../../scripts/qa/ai/types.js";
import { createHmac, createHash } from "crypto";

const BASE_PLAN: TestPlan = {
  planVersion: 1,
  issueKey: "COHI-96",
  modelName: "gpt-5.4",
  modelTemperature: 0,
  generatedAt: "2026-04-17T00:00:00.000Z",
  steps: [],
};

function planHash(plan: TestPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

describe("planApprover", () => {
  afterEach(() => {
    delete process.env.QA_AC_ALLOW_BROAD_SCOPE_TOKEN;
    delete process.env.QA_AC_APPROVAL_HMAC_SECRET;
  });

  it("auto-approves self-scoped plans", () => {
    const decision = approvePlan({
      ...BASE_PLAN,
      steps: [
        {
          id: "ac1-create-canvas",
          kind: "api",
          method: "POST",
          path: "/api/workbench/canvases",
          expectStatus: 200,
          scope: "self_scoped",
          requiresElevation: false,
        },
      ],
    });

    expect(decision.approved).toBe(true);
    expect(decision.approvalStatus).toBe("auto_self_scoped");
    expect(decision.elevatedSteps).toEqual([]);
  });

  it("requires explicit approval for broad-scope plans", () => {
    const decision = approvePlan({
      ...BASE_PLAN,
      steps: [
        {
          id: "ac1-delete-tenant",
          kind: "api",
          method: "DELETE",
          path: "/api/tenants/123",
          expectStatus: 204,
          scope: "broad_scope",
          requiresElevation: true,
        },
      ],
    });

    expect(decision.approved).toBe(false);
    expect(decision.approvalStatus).toBe("pending_pre_approval");
    expect(decision.elevatedSteps).toEqual(["ac1-delete-tenant"]);
  });

  it("accepts a valid HMAC token for broad-scope plans", () => {
    process.env.QA_AC_APPROVAL_HMAC_SECRET = "super-secret";

    const plan: TestPlan = {
      ...BASE_PLAN,
      steps: [
        {
          id: "ac1-delete-tenant",
          kind: "api",
          method: "DELETE",
          path: "/api/tenants/123",
          expectStatus: 204,
          scope: "broad_scope",
          requiresElevation: true,
        },
      ],
    };
    const hash = planHash(plan);
    const signature = createHmac("sha256", process.env.QA_AC_APPROVAL_HMAC_SECRET)
      .update(hash)
      .digest("hex");
    process.env.QA_AC_ALLOW_BROAD_SCOPE_TOKEN = `${hash}.${signature}`;

    const decision = approvePlan(plan);

    expect(decision.approved).toBe(true);
    expect(decision.approvalStatus).toBe("human_pre_approved");
    expect(decision.tokenMatched).toBe(true);
  });
});
