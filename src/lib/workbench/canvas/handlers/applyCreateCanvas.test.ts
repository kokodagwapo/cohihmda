import { describe, it, expect } from "vitest";
import { applyCreateCanvas } from "./applyCreateCanvas";

const sectionToWidgets = {
  companyScorecard: {
    sectionType: "company-scorecard" as const,
    widgetIds: ["company-scorecard-units"],
  },
};

describe("applyCreateCanvas", () => {
  it("returns invalid when sectionKeys is empty", () => {
    const out = applyCreateCanvas(
      [],
      { type: "create_canvas", title: "T", sectionKeys: [], explanation: "" },
      { canvasWidth: 800, sectionToWidgets, standaloneWidgets: {} },
    );
    expect(out.result).toBe("invalid");
  });

  it("appends widget_group for known section key", () => {
    const out = applyCreateCanvas(
      [],
      {
        type: "create_canvas",
        title: "My Canvas",
        sectionKeys: ["companyScorecard"],
        explanation: "",
      },
      { canvasWidth: 800, sectionToWidgets, standaloneWidgets: {} },
    );
    expect(out.result).toBe("ok");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].payload.type).toBe("widget_group");
  });

  it("adds standalone registry_widget when key matches", () => {
    const out = applyCreateCanvas(
      [],
      {
        type: "create_canvas",
        title: "T",
        sectionKeys: ["CohiInsights"],
        explanation: "",
      },
      {
        canvasWidth: 800,
        sectionToWidgets,
        standaloneWidgets: {
          CohiInsights: { defId: "Cohi-insights-embed", w: 600, h: 500 },
        },
      },
    );
    expect(out.result).toBe("ok");
    expect(out.items[0].payload.type).toBe("registry_widget");
  });
});
