import { describe, it, expect } from "vitest";
import { safeParseMetricSpec, metricSpecSchema } from "./metricSpec.js";
import { composeMetricSql } from "./metricQueryComposer.js";

describe("metricSpec Zod", () => {
  it("accepts minimal valid spec", () => {
    const r = safeParseMetricSpec({
      metricIds: ["active_loans"],
      dimensions: [],
      window: "ytd",
      comparison: "none",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.metricIds).toEqual(["active_loans"]);
    }
  });

  it("rejects custom window without range", () => {
    const r = metricSpecSchema.safeParse({
      metricIds: ["active_loans"],
      window: "custom",
    });
    expect(r.success).toBe(false);
  });
});

describe("composeMetricSql", () => {
  it("composes pull-through segmented SQL", () => {
    const spec = safeParseMetricSpec({
      metricIds: ["pull_through_rate"],
      pullThroughSegment: "branch",
      window: "this_quarter",
      comparison: "segment",
    });
    expect(spec.success).toBe(true);
    if (!spec.success) return;
    const out = composeMetricSql(spec.data, null);
    expect(out.sql).toContain("FROM public.loans l");
    expect(out.sql).toContain("pull_through_rate");
  });
});
