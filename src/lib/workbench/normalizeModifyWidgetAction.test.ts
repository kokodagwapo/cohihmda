import { describe, it, expect } from "vitest";
import {
  isRegistryModifyAction,
  normalizeRegistryModifyAction,
  normalizeWidgetActionsForExecution,
} from "@/lib/workbench/normalizeModifyWidgetAction";

describe("normalizeModifyWidgetAction", () => {
  it("detects legacy modify_registry_widget", () => {
    expect(
      isRegistryModifyAction({
        type: "modify_registry_widget",
        groupId: "g",
        widgetId: "w",
        configOverrides: {},
        explanation: "x",
      }),
    ).toBe(true);
  });

  it("detects unified modify_widget target registry", () => {
    expect(
      isRegistryModifyAction({
        type: "modify_widget",
        target: "registry",
        groupId: "g",
        widgetId: "w",
        configPatch: { chartType: "line" },
        explanation: "x",
      }),
    ).toBe(true);
  });

  it("normalizeWidgetActionsForExecution converts legacy actions", () => {
    const out = normalizeWidgetActionsForExecution([
      {
        type: "modify_registry_widget",
        groupId: "g1",
        widgetId: "w__0",
        configOverrides: { chartType: "pie" },
        explanation: "pie",
      },
    ]);
    expect(out[0]).toMatchObject({
      type: "modify_widget",
      target: "registry",
      configPatch: { chartType: "pie" },
    });
  });

  it("normalizeRegistryModifyAction maps chartType fallback", () => {
    const n = normalizeRegistryModifyAction({
      type: "modify_registry_widget",
      groupId: "g",
      widgetId: "w",
      configOverrides: {},
      chartType: "area",
      explanation: "e",
    } as Parameters<typeof normalizeRegistryModifyAction>[0]);
    expect(n.configPatch).toEqual({ chartType: "area" });
  });
});
