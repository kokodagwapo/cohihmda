import { describe, it, expect } from "vitest";
import {
  extractMetricValues,
  readTrackedMetricScalar,
  deriveComparisonKeyFieldsFromMetricValues,
} from "./trackedInsightEvaluator.js";

describe("extractMetricValues", () => {
  it("aggregates numeric keyFields across multiple GROUP BY rows under the base field name", () => {
    const rows = [
      { age_bucket: "180d+", current_milestone: "A", loans: 10, loan_amount: 1_000_000 },
      { age_bucket: "180d+", current_milestone: "B", loans: 20, loan_amount: 2_000_000 },
    ];
    const r = extractMetricValues(rows, [
      "age_bucket",
      "current_milestone",
      "loans",
      "loan_amount",
    ]);
    expect(r.loans).toBe(30);
    expect(r.loan_amount).toBe(3_000_000);
    expect(r.loans_sum).toBe(30);
    expect(r.loan_amount_sum).toBe(3_000_000);
  });

  it("does not treat age bucket labels like 180d+ as numbers", () => {
    const rows = [
      { age_bucket: "180d+", loans: 1 },
      { age_bucket: "90-179d", loans: 2 },
    ];
    const r = extractMetricValues(rows, ["age_bucket", "loans"]);
    expect(r.loans).toBe(3);
    expect(r.age_bucket).toBeUndefined();
  });

  it("sets a categorical field when a single distinct value", () => {
    const rows = [
      { age_bucket: "180d+", loans: 5 },
      { age_bucket: "180d+", loans: 5 },
    ];
    const r = extractMetricValues(rows, ["age_bucket", "loans"]);
    expect(r.age_bucket).toBe("180d+");
    expect(r.loans).toBe(10);
  });
});

describe("readTrackedMetricScalar", () => {
  it("reads base field or legacy _sum suffix", () => {
    expect(readTrackedMetricScalar({ loans: 12 }, "loans")).toBe(12);
    expect(readTrackedMetricScalar({ loans_sum: 12 }, "loans")).toBe(12);
    expect(readTrackedMetricScalar({ loans_avg: 4 }, "loans")).toBe(4);
  });
});

describe("deriveComparisonKeyFieldsFromMetricValues", () => {
  it("keeps only keys that resolve to strict numeric scalars", () => {
    const mv = { age_bucket: "180d+", loans: 5, loan_amount_sum: 1_000_000 };
    expect(
      deriveComparisonKeyFieldsFromMetricValues(mv, [
        "age_bucket",
        "loans",
        "loan_amount",
      ])
    ).toEqual(["loans", "loan_amount"]);
  });
});
