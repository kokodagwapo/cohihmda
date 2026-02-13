import { describe, it, expect } from "vitest";
import {
  mean,
  median,
  standardDeviation,
  stdDev,
  quartiles,
  percentile,
  summaryStats,
  variance,
  coefficientOfVariation,
  zScores,
} from "./stats-utils.js";

// ============================================================================
// mean
// ============================================================================
describe("mean", () => {
  it("should calculate the mean of an array", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(mean([10, 20, 30])).toBe(20);
  });

  it("should handle single element", () => {
    expect(mean([42])).toBe(42);
  });

  it("should return 0 for empty array", () => {
    expect(mean([])).toBe(0);
  });

  it("should handle negative numbers", () => {
    expect(mean([-10, 10])).toBe(0);
  });
});

// ============================================================================
// median
// ============================================================================
describe("median", () => {
  it("should find median of odd-length array", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([5, 1, 3])).toBe(3); // unsorted input
  });

  it("should find median of even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 20])).toBe(15);
  });

  it("should return 0 for empty array", () => {
    expect(median([])).toBe(0);
  });

  it("should handle single element", () => {
    expect(median([7])).toBe(7);
  });
});

// ============================================================================
// standardDeviation / variance
// ============================================================================
describe("standardDeviation", () => {
  it("should return 0 for single element", () => {
    expect(standardDeviation([5])).toBe(0);
  });

  it("should return 0 for empty array", () => {
    expect(standardDeviation([])).toBe(0);
  });

  it("should calculate population standard deviation", () => {
    // Values: [2, 4, 4, 4, 5, 5, 7, 9] → mean = 5, stddev = 2
    const result = standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2, 0);
  });

  it("should be same as stdDev alias", () => {
    const values = [1, 2, 3, 4, 5];
    expect(stdDev(values)).toBe(standardDeviation(values));
  });
});

describe("variance", () => {
  it("should return 0 for single element or empty", () => {
    expect(variance([])).toBe(0);
    expect(variance([5])).toBe(0);
  });

  it("should equal stdDev squared", () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const sd = standardDeviation(values);
    expect(variance(values)).toBeCloseTo(sd * sd, 10);
  });
});

// ============================================================================
// quartiles
// ============================================================================
describe("quartiles", () => {
  it("should calculate quartiles for a dataset", () => {
    const result = quartiles([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.min).toBe(1);
    expect(result.max).toBe(8);
    expect(result.median).toBe(4.5);
    expect(result.q1).toBe(2.5);
    expect(result.q3).toBe(6.5);
    expect(result.iqr).toBe(4);
  });

  it("should return zeros for empty array", () => {
    const result = quartiles([]);
    expect(result.q1).toBe(0);
    expect(result.median).toBe(0);
    expect(result.q3).toBe(0);
    expect(result.iqr).toBe(0);
  });

  it("should handle odd-length array", () => {
    const result = quartiles([1, 2, 3, 4, 5]);
    expect(result.median).toBe(3);
    expect(result.q1).toBe(1.5);
    expect(result.q3).toBe(4.5);
  });
});

// ============================================================================
// percentile
// ============================================================================
describe("percentile", () => {
  it("should calculate p0 and p100", () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  it("should calculate p50 (median)", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("should interpolate between values", () => {
    const result = percentile([10, 20, 30, 40], 25);
    expect(result).toBeCloseTo(17.5);
  });

  it("should return 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("should throw for out-of-range percentile", () => {
    expect(() => percentile([1, 2, 3], -1)).toThrow();
    expect(() => percentile([1, 2, 3], 101)).toThrow();
  });
});

// ============================================================================
// summaryStats
// ============================================================================
describe("summaryStats", () => {
  it("should compute all summary statistics", () => {
    const result = summaryStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.count).toBe(10);
    expect(result.mean).toBe(5.5);
    expect(result.median).toBe(5.5);
    expect(result.min).toBe(1);
    expect(result.max).toBe(10);
    expect(result.stdDev).toBeGreaterThan(0);
    expect(result.iqr).toBeGreaterThan(0);
  });

  it("should return zeros for empty array", () => {
    const result = summaryStats([]);
    expect(result.count).toBe(0);
    expect(result.mean).toBe(0);
    expect(result.stdDev).toBe(0);
  });
});

// ============================================================================
// coefficientOfVariation
// ============================================================================
describe("coefficientOfVariation", () => {
  it("should return 0 when mean is 0", () => {
    expect(coefficientOfVariation([-1, 1])).toBe(0);
  });

  it("should calculate CV as percentage", () => {
    // stdDev / mean * 100
    const cv = coefficientOfVariation([10, 20, 30]);
    expect(cv).toBeGreaterThan(0);
  });
});

// ============================================================================
// zScores
// ============================================================================
describe("zScores", () => {
  it("should return empty for empty array", () => {
    expect(zScores([])).toEqual([]);
  });

  it("should return all zeros when all values are the same", () => {
    expect(zScores([5, 5, 5])).toEqual([0, 0, 0]);
  });

  it("should calculate z-scores with mean 0 and values close to expected", () => {
    const values = [10, 20, 30];
    const z = zScores(values);
    // mean = 20, each z should reflect distance from mean
    expect(z[0]).toBeLessThan(0); // below mean
    expect(z[1]).toBeCloseTo(0); // at mean
    expect(z[2]).toBeGreaterThan(0); // above mean
  });
});
