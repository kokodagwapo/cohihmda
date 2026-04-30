import { describe, expect, it } from "vitest";
import { primarySqlEvidenceForRankedInsight } from "./researchTrackPayload";

describe("primarySqlEvidenceForRankedInsight", () => {
  it("returns sql and keyFields from first supporting finding with evidence", () => {
    const findings = [
      {
        questionId: 1,
        title: "Q1",
        summary: "s",
        confidence: "high" as const,
        evidence: [
          {
            sql: " SELECT 1 AS a ",
            explanation: "e",
            rows: [{ a: 1 }],
            rowCount: 1,
            fields: ["a", "b"],
          },
        ],
        keyMetrics: {},
      },
    ];
    const out = primarySqlEvidenceForRankedInsight(
      { supportingFindingIds: [1] },
      findings
    );
    expect(out?.sql).toBe("SELECT 1 AS a");
    expect(out?.keyFields).toEqual(["a", "b"]);
  });

  it("returns undefined when no SQL evidence", () => {
    const findings = [
      {
        questionId: 2,
        title: "Q2",
        summary: "s",
        confidence: "high" as const,
        evidence: [],
        keyMetrics: {},
      },
    ];
    expect(
      primarySqlEvidenceForRankedInsight({ supportingFindingIds: [2] }, findings)
    ).toBeUndefined();
  });
});
