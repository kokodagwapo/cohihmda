import { describe, expect, it } from "vitest";
import {
  augmentPresentationFromCanvas,
  buildFallbackReportFromCanvas,
  extractPrimaryValue,
  isReportRequest,
} from "./workbenchPresentationAugment.js";

describe("workbenchPresentationAugment", () => {
  it("isReportRequest detects presentation prompts", () => {
    expect(isReportRequest("Turn this into a PowerPoint presentation")).toBe(true);
    expect(isReportRequest("show me funded units")).toBe(false);
  });

  it("extractPrimaryValue reads first numeric column", () => {
    expect(extractPrimaryValue([{ funded_units: 134 }])).toBe(134);
  });

  it("buildFallbackReportFromCanvas includes KPI slides", () => {
    const def = buildFallbackReportFromCanvas({
      widgetData: [
        { widgetName: "Funded Units", category: "kpi", data: [{ funded_units: 100 }] },
      ],
    });
    expect((def.slides as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("augmentPresentationFromCanvas injects generate_report", () => {
    const actions: unknown[] = [{ type: "teach", message: "need live values" }];
    const injected = augmentPresentationFromCanvas(actions, {
      userQuestion: "Create a board-ready presentation",
      canvasState: {
        totalItems: 3,
        widgetData: [
          { widgetName: "Funded Units", category: "kpi", data: [{ funded_units: 50 }] },
        ],
      },
    });
    expect(injected).toBe(true);
    expect((actions[0] as { type: string }).type).toBe("generate_report");
  });
});
