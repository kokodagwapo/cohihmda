import { describe, it, expect } from "vitest";
import { applyModifyRegistryWidget } from "./applyModifyRegistryWidget";

describe("applyModifyRegistryWidget", () => {
  it("merges configOverrides on matching registry widget", () => {
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
      widgetId: "company-scorecard-pullthrough-by-branch__0",
      configOverrides: { chartType: "line" },
    });
    expect(found).toBe(true);
    expect(isRegistry).toBe(true);
    expect(next.items?.[0]).toMatchObject({
      configOverrides: { chartType: "line" },
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
      widgetId: "missing__9",
      configOverrides: { chartType: "bar" },
    });
    expect(found).toBe(false);
  });
});
