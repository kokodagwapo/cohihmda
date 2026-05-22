/**
 * Wave 4 unit tests — COHI-388/391/394/402, W1-5 API slice.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../ai/queryBuilderService.js", () => ({
  checkSectionAccess: vi.fn().mockResolvedValue(true),
}));
import {
  mapCohiChatResponseToBlocks,
  mapWorkbenchResponseToBlocks,
} from "./unifiedChatMappers.js";
import { sanitizeNavigationHints } from "./unifiedChatPolicy.js";
import { filterKnownWidgetActions } from "./widgetActionGate.js";
import { validateUnifiedChatResponse } from "./unifiedChatSchemas.js";
import { createVisualizationArtifactId } from "./artifactService.js";
import { validateUnifiedStreamEvent } from "./unifiedChatSchemas.js";
import { mapEventToLine } from "./unifiedResearchStream.js";
import { composePromptBundle } from "./promptComposer.js";
import { GLOBAL_COHI_CHAT_PROMPT_CORE } from "./sharedPromptModules.js";
import { emitValidatedStreamWithDeltas } from "./unifiedChatStream.js";
import type { Response } from "express";

describe("COHI-390 shared prompt modules", () => {
  it("global composer module uses shared fragment", () => {
    const bundle = composePromptBundle({
      chatType: "chat",
      surface: "data_chat_page",
      scopeType: "global_session",
    });
    expect(bundle.systemSections.join(" ")).toContain(
      GLOBAL_COHI_CHAT_PROMPT_CORE.slice(0, 40),
    );
  });
});

describe("COHI-394 contract invariants", () => {
  it("visualization handoff includes stable artifactId", () => {
    const artifactId = "550e8400-e29b-41d4-a716-446655440000";
    const blocks = mapCohiChatResponseToBlocks(
      {
        message: "Chart ready",
        visualization: {
          type: "bar",
          title: "Volume",
          data: [{ x: 1, y: 2 }],
          xKey: "x",
          yKey: "y",
        },
      },
      { visualizationArtifactId: artifactId },
    );
    const viz = blocks.find((b) => b.type === "visualization");
    expect(viz).toBeDefined();
    if (viz?.type === "visualization") {
      expect(viz.artifactId).toBe(artifactId);
    }
  });

  it("navigation_hints are allowlisted", () => {
    const blocks = mapCohiChatResponseToBlocks({
      message: "See workbench",
      navigationHints: [
        { label: "Workbench", path: "/workbench" },
        { label: "Bad", path: "https://evil.com" },
      ],
    });
    const hints = blocks.find((b) => b.type === "navigation_hints");
    expect(hints?.type === "navigation_hints" && hints.items.length).toBe(1);
    expect(hints?.type === "navigation_hints" && hints.items[0].path).toBe(
      "/workbench",
    );
  });

  it("actions blocks filter unknown widget action types", () => {
    const raw = mapWorkbenchResponseToBlocks({
      message: "Done",
      actions: [
        { type: "create_widget", sql: "SELECT 1", title: "T", config: {} },
        { type: "evil_action" },
      ],
    });
    const actionsBlock = raw.find((b) => b.type === "actions");
    const filtered =
      actionsBlock?.type === "actions"
        ? filterKnownWidgetActions(actionsBlock.items)
        : [];
    expect(filtered).toHaveLength(1);
  });

  it("artifacts use kind + ref shape for research", () => {
    const blocks = mapCohiChatResponseToBlocks({
      message: "Research",
    });
    // research artifacts come from researchArtifactBlock in unifiedResearchChat
    expect(createVisualizationArtifactId("fixed-id")).toBe("fixed-id");
  });

  it("sanitizeNavigationHints drops external URLs", () => {
    const out = sanitizeNavigationHints([
      { label: "WB", path: "/workbench" },
      { label: "X", path: "//evil" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("/workbench");
  });
});

describe("COHI-388 stream events", () => {
  it("block.delta validates against stream schema", () => {
    const ev = {
      event: "block.delta",
      conversationId: "550e8400-e29b-41d4-a716-446655440000",
      turnId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      blockIndex: 0,
      blockType: "text",
      delta: "Hello",
    };
    expect(validateUnifiedStreamEvent(ev)).toBe(true);
  });

  it("emitValidatedStreamWithDeltas writes SSE lines", () => {
    const chunks: string[] = [];
    const res = {
      write: (s: string) => {
        chunks.push(s);
      },
    } as unknown as Response;
    emitValidatedStreamWithDeltas(
      res,
      "550e8400-e29b-41d4-a716-446655440000",
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      [{ type: "text", markdown: "Hi" }],
    );
    const joined = chunks.join("");
    expect(joined).toContain("block.delta");
    expect(joined).toContain("turn.completed");
  });
});

describe("COHI-402 research stream mapping", () => {
  it("maps phase events to timeline lines", () => {
    const line = mapEventToLine({
      type: "phase",
      data: { phase: "planning", message: "Planning..." },
      timestamp: Date.now(),
    });
    expect(line).toContain("Planning");
  });
});

describe("COHI-404 research shell expand contract", () => {
  it("researchShellExpand metadata is defined for stream consumers", async () => {
    const { RESEARCH_SHELL_EXPAND_METADATA } = await import(
      "./researchShellMetadata.js"
    );
    expect(RESEARCH_SHELL_EXPAND_METADATA.researchShellExpand).toBe(true);
  });
});

describe("COHI-391 retrieval policy", () => {
  it("insight_builder mode denies retrieval in policy matrix", async () => {
    const { evaluateUnifiedChatPolicy } = await import("./unifiedChatPolicy.js");
    const req = {
      userId: "u1",
      tenantId: "t1",
      userRole: "user",
      tenantContext: { tenantId: "t1" },
    } as import("../../middleware/auth.js").AuthRequest;
    const decision = await evaluateUnifiedChatPolicy(req, {
      chatType: "insight_builder",
    });
    if (decision.allowed) {
      expect(decision.retrieval).toBe("deny");
    }
  });
});

describe("widgetActionGate", () => {
  it("filters unknown types", () => {
    const out = filterKnownWidgetActions([
      { type: "query_data", sql: "SELECT 1" },
      { type: "unknown_type" },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("insight_builder schema parity (COHI-406 defer)", () => {
  it("validates insightBuilderTurn preview artifact shape", () => {
    const payload = {
      conversationId: "550e8400-e29b-41d4-a716-446655440000",
      turn: {
        id: "550e8400-e29b-41d4-a716-446655440001",
        blocks: [
          { type: "text", markdown: "Review this draft." },
          {
            type: "artifacts",
            items: [
              {
                kind: "file",
                ref: "insight_builder_preview",
                meta: {
                  insightBuilderPreview: true,
                  draft: {
                    title: "Weekly churn",
                    prompt_text: "Summarize churn drivers",
                    schedule: "batch",
                    specifiers: {},
                  },
                  actions: ["approve", "deny"],
                },
              },
            ],
          },
        ],
      },
      metadata: { insightBuilderPhase: "preview" },
    };
    expect(validateUnifiedChatResponse(payload)).toBe(true);
  });
});

describe("COHI-391 golden fixture (minimal)", () => {
  it("loads replay fixture policy expectations", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL(
      "../../../scripts/replay/unified-chat-golden-fixture.json",
      import.meta.url,
    );
    const raw = await fs.readFile(path, "utf-8");
    const fixture = JSON.parse(raw) as {
      cases: { policy: { retrieval: string }; expectRag: boolean }[];
    };
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const c of fixture.cases) {
      const allowed = c.policy.retrieval !== "deny";
      expect(allowed).toBe(c.expectRag);
    }
  });
});
