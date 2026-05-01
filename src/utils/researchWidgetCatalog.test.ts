import { describe, it, expect } from "vitest";
import { serializeResearchWidgetCatalog } from "./researchWidgetCatalog";

describe("serializeResearchWidgetCatalog", () => {
  it("returns a non-empty catalog and meta aligned with ids", () => {
    const snap = serializeResearchWidgetCatalog(undefined);
    expect(snap.catalog).toContain("AVAILABLE DASHBOARD WIDGETS");
    expect(snap.meta.length).toBeGreaterThan(0);
    for (const m of snap.meta) {
      expect(m.id).toBeTruthy();
      expect(m.dashboardPath.startsWith("/")).toBe(true);
    }
  });
});
