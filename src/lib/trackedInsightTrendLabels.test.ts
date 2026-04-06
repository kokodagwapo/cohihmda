import { describe, it, expect } from "vitest";
import { formatDualTrendSummary, effectiveTrendForBadge } from "./trackedInsightTrendLabels";

describe("effectiveTrendForBadge", () => {
  it("prefers improving when last is stable but baseline is improving", () => {
    expect(effectiveTrendForBadge("stable", "improving")).toBe("improving");
  });

  it("prefers worsening when either is worsening", () => {
    expect(effectiveTrendForBadge("stable", "worsening")).toBe("worsening");
    expect(effectiveTrendForBadge("improving", "worsening")).toBe("worsening");
  });

  it("returns new when trend is new", () => {
    expect(effectiveTrendForBadge("new", null)).toBe("new");
  });
});

describe("formatDualTrendSummary", () => {
  it("describes first evaluation", () => {
    expect(formatDualTrendSummary("new", null)).toContain("first evaluation");
  });

  it("combines when last and baseline match", () => {
    expect(formatDualTrendSummary("stable", "stable")).toBe(
      "Stable since last evaluation and since original evaluation"
    );
  });

  it("splits when last and baseline differ", () => {
    expect(formatDualTrendSummary("stable", "improving")).toBe(
      "Stable since last evaluation, Improving since original evaluation"
    );
  });

  it("falls back when baseline is missing", () => {
    expect(formatDualTrendSummary("improving", null)).toBe(
      "Improving since last evaluation"
    );
  });
});
