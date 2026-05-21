import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseGlobalUnifiedEnvelope,
  parseGlobalFromBlocks,
  parseInsightBuilderDraftFromBlocks,
  inferInsightBuilderPhase,
  dispatchResearchShellExpandIfNeeded,
  RESEARCH_SHELL_EXPAND_EVENT,
} from "./unifiedChatEnvelope";

describe("parseGlobalUnifiedEnvelope", () => {
  it("extracts navigation_hints from unified turn blocks", () => {
    const env = {
      conversationId: "c1",
      turn: {
        id: "t1",
        blocks: [
          { type: "text" as const, markdown: "Here are the pages." },
          {
            type: "navigation_hints" as const,
            items: [
              { label: "Company Scorecard", path: "/company-scorecard" },
            ],
          },
        ],
      },
      metadata: {},
    };
    const parsed = parseGlobalUnifiedEnvelope(env);
    expect(parsed.navigationHints?.[0]?.path).toBe("/company-scorecard");
  });

  it("parseGlobalFromBlocks restores visualization and hints", () => {
    const parsed = parseGlobalFromBlocks([
      { type: "text", markdown: "Chart ready" },
      {
        type: "visualization",
        artifactId: "art-1",
        config: { type: "bar", title: "T", data: [] },
      },
      {
        type: "navigation_hints",
        items: [{ label: "Workbench", path: "/workbench" }],
      },
    ]);
    expect(parsed.message).toContain("Chart ready");
    expect(parsed.visualization).toBeDefined();
    expect(parsed.visualizationArtifactId).toBe("art-1");
    expect(parsed.navigationHints?.[0]?.path).toBe("/workbench");
  });
});

describe("parseInsightBuilderDraftFromBlocks", () => {
  it("reads draft from artifacts meta", () => {
    const draft = parseInsightBuilderDraftFromBlocks([
      {
        type: "artifacts",
        items: [
          {
            kind: "file",
            ref: "insight_builder_preview",
            meta: {
              insightBuilderPreview: true,
              draft: {
                title: "Weekly pipeline",
                prompt_text: "Summarize pipeline health",
                schedule: "batch",
                specifiers: {},
              },
            },
          },
        ],
      },
    ]);
    expect(draft?.title).toBe("Weekly pipeline");
  });
});

describe("inferInsightBuilderPhase", () => {
  const approvedDraftBlock = {
    type: "artifacts" as const,
    items: [
      {
        kind: "file",
        ref: "insight_builder_preview",
        meta: {
          insightBuilderPreview: true,
          insightBuilderPhase: "approved",
          approved: true,
          draft: {
            title: "Weekly pipeline",
            prompt_text: "Summarize pipeline health",
            schedule: "batch",
            specifiers: {},
          },
        },
      },
    ],
  };

  it("reads approved phase from turn metadata", () => {
    expect(
      inferInsightBuilderPhase([], "", { insightBuilderPhase: "approved" }),
    ).toBe("approved");
  });

  it("reads approved phase from artifact block meta", () => {
    expect(
      inferInsightBuilderPhase(
        [approvedDraftBlock],
        "Your insight prompt **Weekly pipeline** has been saved to [My Prompts](/insights).",
      ),
    ).toBe("approved");
  });

  it("infers approved from saved-to-My-Prompts copy for legacy persisted turns", () => {
    expect(
      inferInsightBuilderPhase(
        [
          {
            type: "artifacts",
            items: [
              {
                kind: "file",
                ref: "insight_builder_preview",
                meta: {
                  insightBuilderPreview: true,
                  actions: ["approve", "request_changes"],
                  draft: {
                    title: "Legacy prompt",
                    prompt_text: "Legacy body",
                    schedule: "batch",
                    specifiers: {},
                  },
                },
              },
            ],
          },
        ],
        "Your insight prompt **Legacy prompt** has been saved to [My Prompts](/insights).",
      ),
    ).toBe("approved");
  });

  it("parseGlobalFromBlocks restores approved phase for history reload", () => {
    const parsed = parseGlobalFromBlocks(
      [
        {
          type: "text",
          markdown:
            "Your insight prompt **Weekly pipeline** has been saved to [My Prompts](/insights).",
        },
        approvedDraftBlock,
      ],
      { insightBuilderPhase: "approved" },
    );
    expect(parsed.insightBuilderPhase).toBe("approved");
    expect(parsed.insightBuilderDraft?.title).toBe("Weekly pipeline");
  });
});

describe("researchShellExpand event (COHI-404 prep)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches custom event when metadata requests expand", () => {
    const handler = vi.fn();
    window.addEventListener(RESEARCH_SHELL_EXPAND_EVENT, handler);
    dispatchResearchShellExpandIfNeeded({ researchShellExpand: true });
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(RESEARCH_SHELL_EXPAND_EVENT, handler);
  });
});
