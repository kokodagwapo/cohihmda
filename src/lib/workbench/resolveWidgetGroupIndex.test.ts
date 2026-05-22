import { describe, expect, it } from "vitest";
import { resolveWidgetGroupIndex } from "./resolveWidgetGroupIndex";
import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";

function groupItem(
  layoutId: string,
  groupId: string,
  title: string,
): CanvasLayoutItem {
  return {
    i: layoutId,
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    type: "widget_group",
    payload: {
      type: "widget_group",
      groupId,
      title,
      sectionType: "company-scorecard",
      widgetIds: [],
    },
  };
}

describe("resolveWidgetGroupIndex", () => {
  const items = [
    groupItem("layout-abc", "cohi-group-1", "Production"),
    groupItem("layout-xyz", "cohi-group-2", "Pipeline"),
  ];

  it("matches payload groupId", () => {
    expect(resolveWidgetGroupIndex(items, "cohi-group-1")).toBe(0);
  });

  it("matches layout item id", () => {
    expect(resolveWidgetGroupIndex(items, "layout-xyz")).toBe(1);
  });

  it("matches group title", () => {
    expect(resolveWidgetGroupIndex(items, "Production")).toBe(0);
  });

  it("falls back to the only group on canvas", () => {
    const single = [groupItem("only-layout", "only-group", "Solo")];
    expect(resolveWidgetGroupIndex(single, "wrong-id")).toBe(0);
  });

  it("returns -1 when no group matches", () => {
    expect(resolveWidgetGroupIndex(items, "missing")).toBe(-1);
  });
});
