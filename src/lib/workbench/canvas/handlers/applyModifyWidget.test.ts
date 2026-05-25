import { describe, it, expect } from "vitest";
import {
  applyModifyWidget,
  mergeVizConfigForModify,
} from "./applyModifyWidget";

describe("mergeVizConfigForModify", () => {
  it("drops table columns when SQL changes on table widget", () => {
    const { mergedViz, shouldPersistVizConfig } = mergeVizConfigForModify(
      { type: "table", tableConfig: { columns: [{ key: "a" }] } },
      { sql: "SELECT b FROM t", changes: {} },
    );
    expect(shouldPersistVizConfig).toBe(true);
    expect(
      (mergedViz as { tableConfig?: { columns?: unknown } }).tableConfig?.columns,
    ).toBeUndefined();
  });
});

describe("applyModifyWidget", () => {
  it("returns invalid when no sql, changes, or title", () => {
    const out = applyModifyWidget(
      [],
      {
        type: "modify_widget",
        instanceId: "w1",
        changes: {},
        explanation: "",
      },
    );
    expect(out.result).toBe("invalid");
  });

  it("updates top-level cohi_widget sql", () => {
    const items = [
      {
        i: "w1",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        type: "cohi_widget" as const,
        payload: {
          type: "cohi_widget" as const,
          sql: "SELECT 1",
          title: "Old",
          vizConfig: { type: "kpi" },
        },
      },
    ];
    const out = applyModifyWidget(items as any, {
      type: "modify_widget",
      instanceId: "w1",
      sql: "SELECT 2",
      changes: {},
      explanation: "updated",
    });
    expect(out.result).toBe("ok");
    expect((out.items[0].payload as { sql: string }).sql).toBe("SELECT 2");
  });

  it("returns not_found when instance id is missing", () => {
    const out = applyModifyWidget([], {
      type: "modify_widget",
      instanceId: "missing",
      sql: "SELECT 1",
      changes: {},
      explanation: "",
    });
    expect(out.result).toBe("not_found");
  });
});
