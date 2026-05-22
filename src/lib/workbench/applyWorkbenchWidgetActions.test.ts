import { describe, expect, it, vi } from "vitest";
import { applyWorkbenchWidgetActions } from "./applyWorkbenchWidgetActions";
import type { WidgetAction } from "@/types/widgetActions";

describe("applyWorkbenchWidgetActions", () => {
  it("dedupes modify_widget by instanceId", () => {
    const executed: string[] = [];
    const actions: WidgetAction[] = [
      { type: "modify_widget", instanceId: "w1", sql: "SELECT 1", title: "First" },
      { type: "modify_widget", instanceId: "w1", sql: "SELECT 2", title: "Second" },
    ] as WidgetAction[];

    applyWorkbenchWidgetActions({
      actions,
      executeAction: (a) => {
        if (a.type === "modify_widget") executed.push(a.title);
      },
      setItemsWithHistory: vi.fn(),
      canvasWidth: 800,
      defaultGroupWidth: 700,
    });

    expect(executed).toEqual(["Second"]);
  });

  it("multi create_widget sets group savedFilters and filterSync when presets match", () => {
    const items: unknown[] = [];
    const actions = [
      {
        type: "create_widget",
        sql: "SELECT 1 AS v",
        title: "Funded Units",
        config: { type: "kpi" },
        filterConfig: { filterable: true, dateColumn: "funding_date", defaultPreset: "MTD" },
      },
      {
        type: "create_widget",
        sql: "SELECT 2 AS v",
        title: "Funded Volume",
        config: { type: "kpi" },
        filterConfig: { filterable: true, dateColumn: "funding_date", defaultPreset: "MTD" },
      },
    ] as import("@/types/widgetActions").WidgetAction[];

    applyWorkbenchWidgetActions({
      actions,
      executeAction: vi.fn(),
      setItemsWithHistory: (updater) => {
        const next = typeof updater === "function" ? updater([]) : updater;
        items.push(...next);
      },
      canvasWidth: 800,
      defaultGroupWidth: 700,
    });

    expect(items).toHaveLength(1);
    const group = items[0] as { payload: Record<string, unknown> };
    expect(group.payload.filterSync).toBe(true);
    const saved = group.payload.savedFilters as {
      periodSelection?: { preset?: string };
    };
    expect(saved?.periodSelection?.preset).toBe("mtd");
    const cohiItems = group.payload.items as Array<{ savedFilters?: { preset?: string } }>;
    expect(cohiItems[0]?.savedFilters?.preset).toBe("mtd");
  });
});
