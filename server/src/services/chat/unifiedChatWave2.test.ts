import { describe, it, expect } from "vitest";
import { composePromptBundle, hashPromptModules } from "./promptComposer.js";
import { assertSqlAllowedByPolicy } from "./sqlAndMetricsRouter.js";
import { evaluateUnifiedChatPolicy } from "./unifiedChatPolicy.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { createVisualizationArtifactId } from "./artifactService.js";

describe("COHI-388/389/390/392 wave-2 units", () => {
  it("composePromptBundle returns stable bundleHash for same inputs", () => {
    const ctx = {
      chatType: "chat" as const,
      surface: "site",
      scopeType: "global_session",
    };
    const a = composePromptBundle(ctx);
    const b = composePromptBundle(ctx);
    expect(a.bundleHash).toBe(b.bundleHash);
    expect(a.moduleIds.length).toBeGreaterThan(0);
    expect(a.systemSections.join(" ")).toMatch(/Cohi/);
  });

  it("insight_builder bundle includes author module", () => {
    const b = composePromptBundle({
      chatType: "insight_builder",
      surface: "site",
      scopeType: "global_session",
    });
    expect(b.moduleIds).toContain("insight_builder.author");
  });

  it("hashPromptModules is deterministic", () => {
    expect(hashPromptModules(["a", "b"])).toBe(hashPromptModules(["b", "a"]));
  });

  it("sql router denies when policy disallows", () => {
    const r = assertSqlAllowedByPolicy({
      allowed: false,
      code: "denied",
      message: "nope",
      decisionId: "x",
      chatType: "chat",
      sqlExecution: "deny",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("denied");
  });

  it("sql router allows when policy allows", () => {
    const r = assertSqlAllowedByPolicy({
      allowed: true,
      decisionId: "x",
      chatType: "chat",
      sqlExecution: "allow",
    });
    expect(r.ok).toBe(true);
  });

  it("evaluateUnifiedChatPolicy rejects deepAnalysis outside research", async () => {
    const req = {
      userId: "u1",
      tenantId: "t1",
      userRole: "user",
      tenantContext: { tenantId: "t1" },
    } as AuthRequest;
    const decision = await evaluateUnifiedChatPolicy(req, {
      chatType: "chat",
      deepAnalysis: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("deep_analysis_research_only");
  });

  it("artifactService returns stable id when provided", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(createVisualizationArtifactId(id)).toBe(id);
  });
});
