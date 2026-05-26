import { describe, it, expect } from "vitest";
import {
  resolveResearchStructuralHandoff,
  resolveInsightBuilderStructuralHandoff,
  applyResearchHandoffToSession,
} from "./handoffResolver.js";
import type { ModeHandoffContextPayload } from "./modeHandoff.js";
import type { ResearchSession } from "../research/orchestrator.js";

const sampleCanvas = {
  groups: [
    {
      groupId: "g1",
      title: "Pipeline",
      sectionType: "default",
      widgetIds: ["w1"],
      widgets: [
        {
          id: "w1",
          kind: "registry" as const,
          defId: "loan_volume",
          title: "Loan Volume",
        },
      ],
    },
  ],
  standaloneWidgets: [],
  totalItems: 1,
};

function sampleHandoff(): ModeHandoffContextPayload {
  return {
    fromChatType: "workbench",
    fromConversationId: "conv-1",
    fromTitle: "My board",
    canvasState: sampleCanvas,
    widgetCatalog: "- loan_volume: Loan Volume",
    canvasTitle: "Q1 Board",
  };
}

describe("handoffResolver", () => {
  it("returns empty research handoff when payload is null", async () => {
    const resolved = await resolveResearchStructuralHandoff(null, null);
    expect(resolved.steeringDirectives).toEqual([]);
    expect(resolved.widgetContext).toBeUndefined();
    expect(resolved.manifest).toEqual([]);
  });

  it("builds research steering and registry from canvas handoff", async () => {
    const resolved = await resolveResearchStructuralHandoff(
      sampleHandoff(),
      null,
    );
    expect(resolved.widgetContext?.catalog).toContain("loan_volume");
    expect(resolved.steeringDirectives.length).toBeGreaterThan(0);
    expect(resolved.steeringDirectives[0]).toContain("OPEN WORKBENCH CANVAS");
    expect(resolved.manifest.some((m) => m.tier === "workbench_snapshot")).toBe(
      true,
    );
  });

  it("builds insight builder history prefix from canvas", () => {
    const resolved = resolveInsightBuilderStructuralHandoff(sampleHandoff());
    expect(resolved.historyPrefix).toContain("Workbench canvas context");
    expect(resolved.historyPrefix).toContain("loan_volume");
    expect(resolved.manifest[0]?.tier).toBe("workbench_snapshot_ib");
  });

  it("applyResearchHandoffToSession merges widget context and directives", () => {
    const session = {
      phase: "planning",
      steeringDirectives: [] as string[],
      widgetContext: undefined,
    } as unknown as ResearchSession;

    applyResearchHandoffToSession(session, {
      steeringDirectives: ["directive-a"],
      widgetContext: { catalog: "cat", meta: [] },
      manifest: [],
    });

    expect(session.widgetContext?.catalog).toBe("cat");
    expect(session.steeringDirectives).toContain("directive-a");
  });
});
