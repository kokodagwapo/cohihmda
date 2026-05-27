import { describe, expect, it, vi } from "vitest";

vi.mock("../research/tools.js", () => ({
  getOpenAIKey: vi
    .fn()
    .mockRejectedValue(new Error("OpenAI API key not configured.")),
}));

import {
  detectPresentationExportIntent,
  fallbackResearchTopicFromMessage,
  presentationExportPrefilter,
  resolvePresentationExportAction,
} from "./presentationExportIntent.js";

describe("presentationExportPrefilter", () => {
  it("matches slide deck vocabulary", () => {
    expect(presentationExportPrefilter("Make a slideshow of this")).toBe(true);
    expect(presentationExportPrefilter("power point deck please")).toBe(true);
    expect(presentationExportPrefilter("slide deck for the board")).toBe(true);
    expect(presentationExportPrefilter("put that into slides")).toBe(true);
    expect(presentationExportPrefilter("export as ppt")).toBe(true);
    expect(presentationExportPrefilter("keynote style deck")).toBe(true);
  });

  it("matches multi-word phrases", () => {
    expect(presentationExportPrefilter("make a slide show")).toBe(true);
    expect(presentationExportPrefilter("need a power point")).toBe(true);
  });

  it("misses unrelated questions", () => {
    expect(presentationExportPrefilter("What is pull-through?")).toBe(false);
    expect(presentationExportPrefilter("show funded units YTD")).toBe(false);
  });
});

describe("resolvePresentationExportAction", () => {
  it("maps chat types when classifier wants export", () => {
    const base = {
      wantsPresentationExport: true,
      mode: "create" as const,
      confidence: 0.9,
    };
    expect(
      resolvePresentationExportAction("chat", base).action,
    ).toBe("export_viz");
    expect(
      resolvePresentationExportAction("research", base).action,
    ).toBe("export_research_report");
    expect(
      resolvePresentationExportAction("workbench", base).action,
    ).toBe("open_workbench_editor");
  });

  it("fallbackResearchTopicFromMessage strips slide-deck phrasing", () => {
    const topic = fallbackResearchTopicFromMessage(
      "Can you make a powerpoint presentation on overall pipeline health and conversion performance?",
    );
    expect(topic.toLowerCase()).toContain("pipeline health");
    expect(topic.toLowerCase()).not.toContain("powerpoint");
  });

  it("rejects low confidence", () => {
    const meta = resolvePresentationExportAction("chat", {
      wantsPresentationExport: true,
      mode: "create",
      confidence: 0.3,
    });
    expect(meta.wantsPresentationExport).toBe(false);
    expect(meta.action).toBe("none");
  });
});

describe("detectPresentationExportIntent research fallback", () => {
  it("treats prefilter presentation asks as deferred research export when classifier declines", async () => {
    const meta = await detectPresentationExportIntent({
      message:
        "Can you make me a presentation of loan officer scorecard: volume, tiers, and performance outliers",
      chatType: "research",
      tenantId: "no-key-tenant",
    });
    expect(meta?.wantsPresentationExport).toBe(true);
    expect(meta?.action).toBe("export_research_report");
    expect(meta?.researchTopic?.toLowerCase()).toContain("loan officer");
  });
});
