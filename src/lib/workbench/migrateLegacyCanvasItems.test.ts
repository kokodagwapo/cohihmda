import { describe, it, expect } from "vitest";
import { createLayoutItem } from "@/components/workbench/canvas/types";
import {
  migrateLegacyCanvasItem,
  migrateLegacyCanvasItems,
} from "@/lib/workbench/migrateLegacyCanvasItems";
import { WORKBENCH_LEGACY_CHART_ID } from "@/components/widgets/registry/legacyWorkbenchWidgets";

describe("migrateLegacyCanvasItems", () => {
  it("migrates legacy chart payload to registry_widget", () => {
    const item = createLayoutItem("c1", "chart", {
      type: "chart",
      config: { type: "bar", title: "T", data: [] },
    });
    const next = migrateLegacyCanvasItem(item);
    expect(next.type).toBe("registry_widget");
    expect(next.payload).toMatchObject({
      type: "registry_widget",
      definitionId: WORKBENCH_LEGACY_CHART_ID,
      config: { vizConfig: { type: "bar", title: "T", data: [] } },
    });
  });

  it("leaves widget_group payloads unchanged", () => {
    const item = createLayoutItem("g1", "widget_group", {
      type: "widget_group",
      groupId: "g1",
      title: "G",
      sectionType: "company-scorecard",
      widgetIds: [],
    });
    expect(migrateLegacyCanvasItem(item)).toEqual(item);
  });

  it("migrateLegacyCanvasItems maps all items", () => {
    const items = [
      createLayoutItem("k1", "kpi", {
        type: "kpi",
        label: "X",
        value: 1,
      }),
    ];
    const out = migrateLegacyCanvasItems(items);
    expect(out[0].type).toBe("registry_widget");
  });
});
