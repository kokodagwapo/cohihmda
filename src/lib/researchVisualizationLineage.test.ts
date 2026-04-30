import { describe, expect, it } from "vitest";
import { resolveResearchVisualizationLineage } from "./researchVisualizationLineage";

describe("resolveResearchVisualizationLineage", () => {
  it("prefers explicit registry widget id mention (high confidence)", () => {
    const r = resolveResearchVisualizationLineage({
      sql: "SELECT 1",
      explanation: "Matches the company-scorecard-units definition in the registry.",
      findingTitle: "Units trend",
    });
    expect(r).not.toBeNull();
    expect(r?.kind).toBe("registry_widget");
    expect(r?.definitionId).toBe("company-scorecard-units");
    expect(r?.matchConfidence).toBe("high");
    expect(r?.dashboardPath).toBe("/company-scorecard");
  });

  it("returns null when there is no strong keyword or id signal", () => {
    expect(
      resolveResearchVisualizationLineage({
        sql: "SELECT a, b FROM some_table",
        explanation: "Generic aggregate over dimensions.",
        findingTitle: "Q4",
      }),
    ).toBeNull();
  });

  it("maps known product phrases to a data-source home route (medium confidence)", () => {
    const r = resolveResearchVisualizationLineage({
      sql: "SELECT stage, count(*) AS n FROM pipeline GROUP BY 1",
      explanation:
        "Stage-level counts for the loan funnel in the selected period.",
      findingTitle: "",
    });
    expect(r).not.toBeNull();
    expect(r?.kind).toBe("dashboard");
    expect(r?.dashboardPath).toBe("/insights");
    expect(r?.matchConfidence).toBe("medium");
  });
});
