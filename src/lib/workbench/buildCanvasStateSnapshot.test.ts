import { describe, expect, it } from "vitest";
import { buildCanvasStateSnapshot } from "./buildCanvasStateSnapshot";
import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";

describe("buildCanvasStateSnapshot", () => {
  it("marks the selected standalone widget", () => {
    const items: CanvasLayoutItem[] = [
      {
        i: "w1",
        x: 0,
        y: 0,
        w: 4,
        h: 4,
        type: "cohi_widget",
        payload: {
          type: "cohi_widget",
          title: "Revenue",
          sql: "SELECT 1",
          vizConfig: { type: "kpi", title: "Revenue", data: [] },
        },
      },
      {
        i: "w2",
        x: 4,
        y: 0,
        w: 4,
        h: 4,
        type: "cohi_widget",
        payload: {
          type: "cohi_widget",
          title: "Pipeline",
          sql: "SELECT 2",
          vizConfig: { type: "kpi", title: "Pipeline", data: [] },
        },
      },
    ];

    const snapshot = buildCanvasStateSnapshot(items, "w2");
    expect(snapshot.totalItems).toBe(2);
    expect(snapshot.standaloneWidgets).toHaveLength(2);
    expect(snapshot.standaloneWidgets?.find((w) => w.id === "w1")?.selected).toBe(
      false,
    );
    expect(snapshot.standaloneWidgets?.find((w) => w.id === "w2")?.selected).toBe(
      true,
    );
  });

  it("assigns stable cohi__ keys for group SQL widgets", () => {
    const items: CanvasLayoutItem[] = [
      {
        i: "g1",
        x: 0,
        y: 0,
        w: 12,
        h: 8,
        type: "widget_group",
        payload: {
          type: "widget_group",
          groupId: "grp-1",
          title: "Executive",
          sectionType: "executive-dashboard",
          widgetIds: [],
          items: [
            {
              kind: "cohi",
              id: "abc",
              sql: "SELECT 1",
              title: "Pull-Through Rate",
              vizConfig: { type: "kpi", yKey: "rate" },
            },
          ],
        },
      },
    ];
    const snapshot = buildCanvasStateSnapshot(items);
    expect(snapshot.groups[0].widgets?.[0].id).toBe("cohi__abc__0");
  });
});
