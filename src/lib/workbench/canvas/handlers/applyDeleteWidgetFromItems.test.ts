import { describe, it, expect } from "vitest";
import { applyDeleteWidgetFromItems } from "./applyDeleteWidgetFromItems";

describe("applyDeleteWidgetFromItems", () => {
  it("removes top-level layout item by instance id", () => {
    const items = [
      { i: "a", payload: { type: "registry_widget" } },
      { i: "b", payload: { type: "registry_widget" } },
    ];
    const { items: next, removed } = applyDeleteWidgetFromItems(items, "a");
    expect(removed).toBe(true);
    expect(next).toHaveLength(1);
    expect(next[0].i).toBe("b");
  });

  it("removes widget inside widget_group and rekeys layouts", () => {
    const items = [
      {
        i: "group-1",
        payload: {
          type: "widget_group",
          widgetIds: ["company-scorecard-units", "company-scorecard-volume"],
          items: [
            { kind: "registry", defId: "company-scorecard-units" },
            { kind: "registry", defId: "company-scorecard-volume" },
          ],
          widgetLayouts: {
            "company-scorecard-units__0": { x: 0, y: 0, w: 4, h: 2 },
            "company-scorecard-volume__1": { x: 4, y: 0, w: 4, h: 2 },
          },
        },
      },
    ];
    const { items: next, removed } = applyDeleteWidgetFromItems(
      items,
      "company-scorecard-units__0",
    );
    expect(removed).toBe(true);
    const group = next[0].payload as {
      items?: Array<{ defId: string }>;
      widgetLayouts?: Record<string, unknown>;
    };
    expect(group.items).toHaveLength(1);
    expect(group.items?.[0].defId).toBe("company-scorecard-volume");
    expect(group.widgetLayouts?.["company-scorecard-volume__0"]).toBeDefined();
  });
});
