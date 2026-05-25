import { describe, it, expect } from "vitest";
import { applyCreateDashboard } from "./applyCreateDashboard";

describe("applyCreateDashboard", () => {
  it("returns noop when groups and standalone are empty", () => {
    const items: any[] = [];
    const out = applyCreateDashboard(items, {
      type: "create_dashboard",
      title: "Dash",
      groups: [],
      explanation: "",
    });
    expect(out.result).toBe("noop");
    expect(out.items).toHaveLength(0);
  });

  it("appends widget_group for registry widgets", () => {
    const out = applyCreateDashboard([], {
      type: "create_dashboard",
      title: "Dash",
      groups: [
        {
          title: "Scorecard",
          widgets: [{ kind: "registry", defId: "company-scorecard-units" }],
        },
      ],
      explanation: "added",
    });
    expect(out.result).toBe("ok");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].payload.type).toBe("widget_group");
  });
});
