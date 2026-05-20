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
});
