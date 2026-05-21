import { describe, expect, it } from "vitest";
import {
  consumePendingWorkbenchActions,
  deliverWorkbenchWidgetActions,
  EXECUTABLE_WORKBENCH_ACTION_TYPES,
  filterExecutableWorkbenchActions,
  generateWorkbenchDraftScopeId,
} from "./workbenchChatHandoff";
import { registerWorkbenchCanvasBridge } from "./workbenchCanvasBridge";
import type { WidgetAction } from "@/types/widgetActions";

describe("workbenchChatHandoff", () => {
  it("filterExecutableWorkbenchActions keeps known types only", () => {
    const actions = [
      { type: "create_widget", sql: "SELECT 1", title: "A", config: { type: "kpi", title: "A", data: [] } },
      { type: "teach", message: "hint" },
    ] as WidgetAction[];
    const filtered = filterExecutableWorkbenchActions(actions);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("create_widget");
  });

  it("generateWorkbenchDraftScopeId returns non-empty string", () => {
    expect(generateWorkbenchDraftScopeId().length).toBeGreaterThan(8);
  });

  it("EXECUTABLE_WORKBENCH_ACTION_TYPES includes create_widget", () => {
    expect(EXECUTABLE_WORKBENCH_ACTION_TYPES.has("create_widget")).toBe(true);
  });

  it("deliverWorkbenchWidgetActions stashes when canvas is not mounted", () => {
    registerWorkbenchCanvasBridge(null);
    const draftScopeId = "draft-deliver-test";
    const actions = [
      {
        type: "create_widget",
        sql: "SELECT 1",
        title: "A",
        config: { type: "kpi", title: "A", data: [] },
      },
    ] as WidgetAction[];
    deliverWorkbenchWidgetActions(draftScopeId, actions);
    expect(consumePendingWorkbenchActions(draftScopeId)).toHaveLength(1);
    expect(consumePendingWorkbenchActions(draftScopeId)).toHaveLength(0);
  });
});
