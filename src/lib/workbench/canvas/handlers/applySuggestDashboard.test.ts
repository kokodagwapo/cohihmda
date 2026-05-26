import { describe, expect, it } from "vitest";
import { applySuggestDashboard } from "./applySuggestDashboard";
import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";

const sectionToWidgets = {
  salesScorecard: {
    sectionType: "sales-scorecard",
    widgetIds: ["sales-scorecard-units", "sales-scorecard-tabbed-table"],
  },
  actors: {
    sectionType: "actors",
    widgetIds: ["actors-kpis", "actors-table-0"],
  },
};

describe("applySuggestDashboard", () => {
  it("appends a second section without dropping the first", () => {
    const existing: CanvasLayoutItem[] = [
      {
        i: "g1",
        x: 0,
        y: 20,
        w: 800,
        h: 400,
        type: "widget_group",
        payload: {
          type: "widget_group",
          groupId: "sales-1",
          title: "Sales Scorecard",
          sectionType: "sales-scorecard",
          widgetIds: ["sales-scorecard-units"],
        },
      },
    ];

    const first = applySuggestDashboard(
      existing,
      {
        type: "suggest_dashboard",
        sectionKey: "actors",
        explanation: "Actors",
      },
      { defaultGroupWidth: 800, sectionToWidgets, standaloneWidgets: {} },
    );
    expect(first.result).toBe("ok");
    expect(first.items).toHaveLength(2);
    expect(first.items[0].i).toBe("g1");
    expect(first.items[1].payload.type).toBe("widget_group");
    expect(
      first.items[1].payload.type === "widget_group" &&
        first.items[1].payload.sectionType,
    ).toBe("actors");
  });
});
