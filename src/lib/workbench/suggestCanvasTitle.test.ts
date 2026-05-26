import { describe, expect, it } from "vitest";
import {
  isDefaultWorkbenchCanvasTitle,
  suggestCanvasTitleFromLayout,
} from "./suggestCanvasTitle";
import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";

describe("suggestCanvasTitle", () => {
  it("detects default titles", () => {
    expect(isDefaultWorkbenchCanvasTitle("Untitled canvas")).toBe(true);
    expect(isDefaultWorkbenchCanvasTitle("New Canvas")).toBe(true);
    expect(isDefaultWorkbenchCanvasTitle("Q1 LO Scorecard")).toBe(false);
  });

  it("names canvas from widget group titles", () => {
    const items: CanvasLayoutItem[] = [
      {
        i: "1",
        x: 0,
        y: 0,
        w: 800,
        h: 400,
        type: "widget_group",
        payload: {
          type: "widget_group",
          groupId: "g1",
          title: "Sales Scorecard",
          sectionType: "sales-scorecard",
          widgetIds: ["sales-scorecard-units"],
        },
      },
    ];
    expect(suggestCanvasTitleFromLayout(items)).toBe("Sales Scorecard");
  });

  it("combines two section names", () => {
    const items: CanvasLayoutItem[] = [
      {
        i: "1",
        x: 0,
        y: 0,
        w: 800,
        h: 400,
        type: "widget_group",
        payload: {
          type: "widget_group",
          groupId: "g1",
          title: "Sales Scorecard",
          sectionType: "sales-scorecard",
          widgetIds: [],
        },
      },
      {
        i: "2",
        x: 0,
        y: 500,
        w: 800,
        h: 400,
        type: "widget_group",
        payload: {
          type: "widget_group",
          groupId: "g2",
          title: "Actors",
          sectionType: "actors",
          widgetIds: [],
        },
      },
    ];
    expect(suggestCanvasTitleFromLayout(items)).toBe("Sales Scorecard & Actors");
  });
});
