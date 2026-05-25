import { describe, it, expect, beforeEach } from "vitest";
import {
  pushReconcileTraceEntry,
  getReconcileTraceBuffer,
  clearReconcileTraceBuffer,
} from "./workbenchWidgetPeriodReconcile.js";

describe("reconcile trace buffer", () => {
  beforeEach(() => clearReconcileTraceBuffer());

  it("records and returns last entry with set_period op", () => {
    pushReconcileTraceEntry("Switch to last 6 months", [
      {
        type: "modify_group",
        groupId: "g1",
        operations: [{ op: "set_period", preset: "L6M" }],
      },
    ]);
    const entries = getReconcileTraceBuffer(5);
    expect(entries).toHaveLength(1);
    expect(entries[0].actions[0].op).toBe("set_period:L6M");
  });
});
