import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { TestPlan } from "./types.js";

export interface PlanApprovalDecision {
  approved: boolean;
  approvalStatus: "auto_self_scoped" | "human_pre_approved" | "pending_pre_approval";
  reason?: string;
  planHash: string;
  elevatedSteps: string[];
  tokenMatched: boolean;
}

function sha256(input: unknown): string {
  return createHash("sha256")
    .update(typeof input === "string" ? input : JSON.stringify(input))
    .digest("hex");
}

function getApprovalSigningSecret(): string | null {
  return (
    process.env.QA_AC_APPROVAL_HMAC_SECRET ||
    process.env.QA_EVIDENCE_SIGNING_SECRET ||
    process.env.QA_RUNNER_HMAC_SECRET ||
    null
  );
}

function expectedSignature(planHash: string, secret: string): string {
  return createHmac("sha256", secret).update(planHash).digest("hex");
}

function verifyBroadScopeToken(planHash: string, token: string | undefined): boolean {
  if (!token) {
    return false;
  }

  const secret = getApprovalSigningSecret();
  if (!secret) {
    return false;
  }

  const trimmed = token.trim();
  const separator = trimmed.includes(".") ? "." : trimmed.includes(":") ? ":" : null;
  let tokenHash = planHash;
  let providedSignature = trimmed;

  if (separator) {
    const [maybeHash, maybeSig] = trimmed.split(separator, 2);
    tokenHash = maybeHash;
    providedSignature = maybeSig ?? "";
  }

  if (!providedSignature || tokenHash !== planHash) {
    return false;
  }

  const expected = expectedSignature(planHash, secret);

  try {
    const providedBuf = Buffer.from(providedSignature, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    return (
      providedBuf.length === expectedBuf.length &&
      timingSafeEqual(providedBuf, expectedBuf)
    );
  } catch {
    return false;
  }
}

export function approvePlan(plan: TestPlan): PlanApprovalDecision {
  const elevatedSteps = plan.steps
    .filter((step) => step.requiresElevation === true || step.scope === "broad_scope")
    .map((step) => step.id);
  const planHash = sha256(plan);

  if (elevatedSteps.length === 0) {
    return {
      approved: true,
      approvalStatus: "auto_self_scoped",
      planHash,
      elevatedSteps,
      tokenMatched: false,
    };
  }

  const tokenMatched = verifyBroadScopeToken(
    planHash,
    process.env.QA_AC_ALLOW_BROAD_SCOPE_TOKEN,
  );

  if (tokenMatched) {
    return {
      approved: true,
      approvalStatus: "human_pre_approved",
      planHash,
      elevatedSteps,
      tokenMatched: true,
    };
  }

  return {
    approved: false,
    approvalStatus: "pending_pre_approval",
    reason:
      "Broad-scope steps require explicit human approval. Re-run with a valid QA_AC_ALLOW_BROAD_SCOPE_TOKEN after review.",
    planHash,
    elevatedSteps,
    tokenMatched: false,
  };
}
