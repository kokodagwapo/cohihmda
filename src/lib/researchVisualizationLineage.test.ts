import { describe, it, expect } from "vitest";
import {
  resolveResearchVisualizationLineage,
  shouldShowResearchSqlLineageLink,
} from "./researchVisualizationLineage";

describe("shouldShowResearchSqlLineageLink", () => {
  it("returns false when there is no resolved lineage", () => {
    expect(
      shouldShowResearchSqlLineageLink({
        resolvedLineage: null,
        registryDashboardPaths: ["/sales-scorecard"],
      }),
    ).toBe(false);
  });

  it("shows link when there are no registry widgets", () => {
    const lineage = resolveResearchVisualizationLineage({
      sql: "select 1",
      explanation: "LO tier distribution",
      findingTitle: "TTS",
    });
    expect(lineage).not.toBeNull();
    expect(
      shouldShowResearchSqlLineageLink({
        resolvedLineage: lineage,
        registryDashboardPaths: [],
      }),
    ).toBe(true);
  });

  it("suppresses when registry path matches resolved dashboard", () => {
    const lineage = resolveResearchVisualizationLineage({
      sql: "select 1",
      explanation: "LO tier distribution",
      findingTitle: "TTS",
    });
    expect(lineage).not.toBeNull();
    expect(
      shouldShowResearchSqlLineageLink({
        resolvedLineage: lineage,
        registryDashboardPaths: ["/sales-scorecard/"],
      }),
    ).toBe(false);
  });

  it("shows when registry widgets are on a different dashboard", () => {
    const lineage = resolveResearchVisualizationLineage({
      sql: "select 1",
      explanation: "LO tier distribution",
      findingTitle: "TTS",
    });
    expect(lineage).not.toBeNull();
    expect(
      shouldShowResearchSqlLineageLink({
        resolvedLineage: lineage,
        registryDashboardPaths: ["/company-scorecard"],
      }),
    ).toBe(true);
  });
});
