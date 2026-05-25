import { describe, it, expect } from "vitest";
import { applyCreateWidget } from "./applyCreateWidget";

describe("applyCreateWidget", () => {
  it("appends a widget_group wrapping the cohi widget", () => {
    const out = applyCreateWidget(
      [],
      {
        type: "create_widget",
        sql: "SELECT 1",
        title: "KPI",
        config: { type: "kpi" } as any,
        explanation: "",
      },
      { canvasWidth: 800 },
    );
    expect(out.result).toBe("ok");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].payload.type).toBe("widget_group");
    const group = out.items[0].payload as { items?: Array<{ kind: string }> };
    expect(group.items?.[0].kind).toBe("cohi");
  });

  it("places new widget below existing items", () => {
    const out = applyCreateWidget(
      [{ i: "a", x: 0, y: 0, w: 100, h: 200, type: "text", payload: { type: "text", content: "" } } as any],
      {
        type: "create_widget",
        sql: "SELECT 1",
        title: "Chart",
        config: { type: "chart" } as any,
        explanation: "",
      },
      { canvasWidth: 600 },
    );
    expect(out.items[1].y).toBeGreaterThan(200);
  });
});
