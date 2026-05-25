import { describe, it, expect } from "vitest";
import { applyConvertToSqlWidget } from "./applyConvertToSqlWidget";

describe("applyConvertToSqlWidget", () => {
  it("returns not_found when group id is missing", () => {
    const items = [
      {
        i: "g1",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        type: "widget_group" as const,
        payload: {
          type: "widget_group" as const,
          groupId: "group-a",
          title: "A",
          sectionType: "company-scorecard",
          widgetIds: ["company-scorecard-units"],
          items: [{ kind: "registry" as const, defId: "company-scorecard-units" }],
        },
      },
      {
        i: "g2",
        x: 0,
        y: 120,
        w: 100,
        h: 100,
        type: "widget_group" as const,
        payload: {
          type: "widget_group" as const,
          groupId: "group-b",
          title: "B",
          sectionType: "company-scorecard",
          widgetIds: ["company-scorecard-volume"],
          items: [{ kind: "registry" as const, defId: "company-scorecard-volume" }],
        },
      },
    ];
    const out = applyConvertToSqlWidget(items as any, {
      type: "convert_to_sql_widget",
      groupId: "missing",
      widgetId: "company-scorecard-units",
      sql: "SELECT 1",
      title: "SQL",
      vizConfig: { type: "kpi" } as any,
      explanation: "",
    });
    expect(out.result).toBe("not_found");
    expect(out.items).toBe(items);
  });

  it("converts registry widget to cohi in group", () => {
    const items = [
      {
        i: "g1",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        type: "widget_group" as const,
        payload: {
          type: "widget_group" as const,
          groupId: "dash-1",
          title: "G",
          sectionType: "company-scorecard",
          widgetIds: ["company-scorecard-units"],
          items: [{ kind: "registry" as const, defId: "company-scorecard-units" }],
        },
      },
    ];
    const out = applyConvertToSqlWidget(items as any, {
      type: "convert_to_sql_widget",
      groupId: "dash-1",
      widgetId: "company-scorecard-units",
      sql: "SELECT 1",
      title: "SQL Widget",
      vizConfig: { type: "kpi" } as any,
      explanation: "converted",
    });
    expect(out.result).toBe("ok");
    const group = out.items[0].payload as { items?: Array<{ kind: string; sql?: string }> };
    expect(group.items?.[0].kind).toBe("cohi");
    expect(group.items?.[0].sql).toBe("SELECT 1");
  });
});
