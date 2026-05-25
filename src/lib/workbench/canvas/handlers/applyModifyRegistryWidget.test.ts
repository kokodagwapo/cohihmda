import { describe, it, expect } from "vitest";
import { applyModifyRegistryWidget } from "./applyModifyRegistryWidget";
import { normalizeRegistryModifyAction } from "@/lib/workbench/normalizeModifyWidgetAction";

describe("applyModifyRegistryWidget", () => {
  it("merges configPatch on matching registry widget", () => {
    const payload = {
      type: "widget_group" as const,
      groupId: "g1",
      widgetIds: ["company-scorecard-pullthrough-by-branch"],
      items: [
        {
          kind: "registry" as const,
          defId: "company-scorecard-pullthrough-by-branch",
        },
      ],
    };
    const { payload: next, found, isRegistry } = applyModifyRegistryWidget(payload, {
      type: "modify_widget",
      target: "registry",
      groupId: "g1",
      widgetId: "company-scorecard-pullthrough-by-branch__0",
      configPatch: { chartType: "line" },
      explanation: "line chart",
    });
    expect(found).toBe(true);
    expect(isRegistry).toBe(true);
    expect(next.items?.[0]).toMatchObject({
      config: { chartType: "line" },
    });
  });

  it("returns found=false when widget id missing", () => {
    const payload = {
      type: "widget_group" as const,
      groupId: "g1",
      widgetIds: ["company-scorecard-units"],
      items: [{ kind: "registry" as const, defId: "company-scorecard-units" }],
    };
    const { found } = applyModifyRegistryWidget(payload, {
      type: "modify_widget",
      target: "registry",
      groupId: "g1",
      widgetId: "missing__9",
      configPatch: { chartType: "bar" },
      explanation: "test",
    });
    expect(found).toBe(false);
  });

  it("legacy modify_registry_widget normalizes to configPatch", () => {
    const normalized = normalizeRegistryModifyAction({
      type: "modify_registry_widget",
      groupId: "g1",
      widgetId: "w__0",
      configOverrides: { chartType: "pie" },
      explanation: "pie",
    });
    expect(normalized.target).toBe("registry");
    expect(normalized.configPatch).toEqual({ chartType: "pie" });
  });
});
