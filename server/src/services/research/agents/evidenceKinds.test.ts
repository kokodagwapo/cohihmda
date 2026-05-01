import { describe, it, expect } from "vitest";
import { isSqlEvidenceItem, type EvidenceItem } from "./dataAnalystAgent.js";

describe("EvidenceItem discrimination", () => {
  it("treats legacy persisted SQL evidence (no kind) as sql", () => {
    const e: EvidenceItem = {
      sql: "select 1",
      explanation: "test",
      rows: [],
      rowCount: 0,
      fields: [],
    };
    expect(isSqlEvidenceItem(e)).toBe(true);
  });

  it("detects registry_widget", () => {
    const e: EvidenceItem = {
      kind: "registry_widget",
      definitionId: "x",
      definitionName: "X",
      dataSourceId: "sales-scorecard",
      dashboardPath: "/sales-scorecard",
      dashboardLabel: "Sales Scorecard",
      confidence: "high",
      explanation: "widget",
    };
    expect(isSqlEvidenceItem(e)).toBe(false);
  });
});
