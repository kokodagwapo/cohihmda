/**
 * Wave 3 unit tests (COHI-388/389/390/392/395/402).
 * Pragmatic bar per locked decision #8 — covers the contracts that don't
 * require a live tenant DB. End-to-end stream / persistence is verified
 * manually via browser console.
 */

import { describe, it, expect } from "vitest";
import { composePromptBundle } from "./promptComposer.js";
import {
  evaluateUnifiedChatPolicy,
  assertPlatformTenantScope,
} from "./unifiedChatPolicy.js";
import { mergeHistoryRows, type CanonicalHistoryRow } from "./historyRepository.js";
import { mapEventToLine } from "./unifiedResearchStream.js";
import type { AuthRequest } from "../../middleware/auth.js";

function buildReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    userId: "u1",
    tenantId: "t1",
    userRole: "user",
    tenantContext: { tenantId: "t1" },
    ...overrides,
  } as AuthRequest;
}

describe("COHI-390 prompt composer — research module catalog", () => {
  it("research chat type includes planner/analyst/synthesis module ids", () => {
    const bundle = composePromptBundle({
      chatType: "research",
      surface: "site",
      scopeType: "global_session",
      deepAnalysis: true,
    });
    expect(bundle.moduleIds).toEqual(
      expect.arrayContaining([
        "research.lab",
        "research.planner",
        "research.analyst",
        "research.synthesis",
      ]),
    );
  });

  it("research bundleHash flips when deepAnalysis flips", () => {
    const off = composePromptBundle({
      chatType: "research",
      surface: "site",
      scopeType: "global_session",
      deepAnalysis: false,
    });
    const on = composePromptBundle({
      chatType: "research",
      surface: "site",
      scopeType: "global_session",
      deepAnalysis: true,
    });
    expect(off.bundleHash).not.toBe(on.bundleHash);
  });

  // Deferred until unified chat merge — restore with promptComposer planningMode routing.
  // it("research ignores planningMode — full pipeline always (Locked #2 / COHI-388 AC5)", () => {
  //   const auto = composePromptBundle({
  //     chatType: "research",
  //     surface: "site",
  //     scopeType: "global_session",
  //     planningMode: "auto",
  //   });
  //   const never = composePromptBundle({
  //     chatType: "research",
  //     surface: "site",
  //     scopeType: "global_session",
  //     planningMode: "never",
  //   });
  //   expect(auto.moduleIds).not.toContain("orchestrator.planning");
  //   expect(never.moduleIds).not.toContain("orchestrator.planning");
  // });

  // it("chat planningMode=always still adds planning hint (AC5 applies to chat)", () => {
  //   const planned = composePromptBundle({
  //     chatType: "chat",
  //     surface: "site",
  //     scopeType: "global_session",
  //     planningMode: "always",
  //   });
  //   expect(planned.moduleIds).toContain("orchestrator.planning");
  // });
});

describe("COHI-389 policy engine — research + platform tenant", () => {
  it("evaluates research-mode policy with sqlExecution scoped", async () => {
    const decision = await evaluateUnifiedChatPolicy(buildReq(), {
      chatType: "research",
      deepAnalysis: true,
    });
    expect(decision.chatType).toBe("research");
    if (decision.allowed) {
      expect(decision.sqlExecution).toBe("scoped");
      expect(decision.research?.deepAnalysisAllowed).toBe(true);
    }
  });

  it("denies research deepAnalysis on non-research chat_type", async () => {
    const decision = await evaluateUnifiedChatPolicy(buildReq(), {
      chatType: "chat",
      deepAnalysis: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("deep_analysis_research_only");
  });

  it("assertPlatformTenantScope blocks cross-tenant for standard users", () => {
    const r = assertPlatformTenantScope(buildReq(), "other-tenant");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("tenant_scope_forbidden");
  });

  it("assertPlatformTenantScope allows same-tenant", () => {
    const r = assertPlatformTenantScope(buildReq(), "t1");
    expect(r.ok).toBe(true);
  });

  it("assertPlatformTenantScope allows platform admin cross-tenant", () => {
    const r = assertPlatformTenantScope(
      buildReq({ isSuperAdmin: true }),
      "other-tenant",
    );
    expect(r.ok).toBe(true);
  });
});

describe("COHI-395/402 history dual-read — merge + dedupe", () => {
  const baseLegacy: CanonicalHistoryRow = {
    conversation_id: "legacy-1",
    title: "Legacy thread",
    chat_type: "research",
    updated_at: "2024-01-01T00:00:00.000Z",
    legacy_source: "research_lab",
    legacy_ref: "legacy-1",
  };

  it("legacy rows surface when no unified row references them", () => {
    const merged = mergeHistoryRows([], [baseLegacy]);
    expect(merged).toHaveLength(1);
    expect(merged[0].conversation_id).toBe("legacy-1");
  });

  it("unified wins over legacy when legacy_ref matches", () => {
    const unified: CanonicalHistoryRow = {
      conversation_id: "uni-1",
      title: "Backfilled thread",
      chat_type: "research",
      updated_at: "2024-02-01T00:00:00.000Z",
      legacy_ref: "legacy-1",
      legacy_source: "research_lab",
    };
    const merged = mergeHistoryRows([unified], [baseLegacy]);
    expect(merged).toHaveLength(1);
    expect(merged[0].conversation_id).toBe("uni-1");
  });

  it("sorts merged rows by updated_at desc", () => {
    const older: CanonicalHistoryRow = {
      conversation_id: "a",
      title: "older",
      chat_type: "chat",
      updated_at: "2023-01-01T00:00:00.000Z",
    };
    const newer: CanonicalHistoryRow = {
      conversation_id: "b",
      title: "newer",
      chat_type: "chat",
      updated_at: "2024-06-01T00:00:00.000Z",
    };
    const merged = mergeHistoryRows([older], [newer]);
    expect(merged.map((r) => r.conversation_id)).toEqual(["b", "a"]);
  });
});

describe("COHI-402 research stream mapping", () => {
  it("phase events render as bolded headers", () => {
    const line = mapEventToLine({
      type: "phase",
      data: { phase: "planning", message: "Planner is creating an investigation plan..." },
      timestamp: Date.now(),
    });
    expect(line).toContain("**Planning**");
    expect(line).toContain("Planner is creating");
  });

  it("complete events report finding count", () => {
    const line = mapEventToLine({
      type: "complete",
      data: { findingCount: 4 },
      timestamp: Date.now(),
    });
    expect(line).toContain("4 findings");
  });

  it("returns null for unknown event types (no leaked noise)", () => {
    expect(mapEventToLine({ type: "heartbeat", data: {}, timestamp: 0 })).toBeNull();
  });
});
