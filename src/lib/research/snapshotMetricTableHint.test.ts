import { describe, expect, it } from "vitest";
import { detectSnapshotColumnsInTimeframeTable } from "./snapshotMetricTableHint";

describe("detectSnapshotColumnsInTimeframeTable", () => {
  it("flags active_loans when identical across periods", () => {
    const cols = detectSnapshotColumnsInTimeframeTable(
      ["Timeframe", "Active Loans", "Applications"],
      [
        { Timeframe: "YTD", "Active Loans": 496, Applications: 1402 },
        { Timeframe: "90D", "Active Loans": 496, Applications: 829 },
      ],
    );
    expect(cols).toContain("Active Loans");
  });
});
