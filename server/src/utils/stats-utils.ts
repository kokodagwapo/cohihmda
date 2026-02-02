/**
 * Statistical Utility Functions
 * Shared functions for calculating statistical measures across the codebase.
 * Used in TopTiering analysis, Operations Scorecard, and other dashboards.
 *
 * All functions handle edge cases like empty arrays and return 0 or appropriate defaults.
 */

/**
 * Calculate the arithmetic mean (average) of a numeric array.
 * @param values - Array of numbers
 * @returns Mean value, or 0 if array is empty
 */
export function mean(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate the median (middle value) of a numeric array.
 * For even-length arrays, returns the average of the two middle values.
 * @param values - Array of numbers
 * @returns Median value, or 0 if array is empty
 */
export function median(values: number[]): number {
  if (!values || values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Calculate the standard deviation of a numeric array.
 * Uses the population standard deviation formula (n, not n-1).
 * @param values - Array of numbers
 * @returns Standard deviation, or 0 if array is empty or has one element
 */
export function standardDeviation(values: number[]): number {
  if (!values || values.length <= 1) return 0;

  const avg = mean(values);
  const squaredDiffs = values.map((val) => Math.pow(val - avg, 2));
  const avgSquaredDiff = mean(squaredDiffs);

  return Math.sqrt(avgSquaredDiff);
}

/**
 * Alias for standardDeviation
 */
export const stdDev = standardDeviation;

/**
 * Calculate quartiles (Q1, Q2/median, Q3) of a numeric array.
 * Uses the method of dividing at the median (exclusive).
 * @param values - Array of numbers
 * @returns Object with q1, median (q2), q3, and iqr (interquartile range)
 */
export function quartiles(values: number[]): {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
} {
  if (!values || values.length === 0) {
    return { q1: 0, median: 0, q3: 0, iqr: 0, min: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const min = sorted[0];
  const max = sorted[n - 1];
  const med = median(sorted);

  // Split the array at the median to find Q1 and Q3
  const lowerHalf = sorted.slice(0, Math.floor(n / 2));
  const upperHalf =
    n % 2 === 0
      ? sorted.slice(Math.floor(n / 2))
      : sorted.slice(Math.floor(n / 2) + 1);

  const q1 = median(lowerHalf);
  const q3 = median(upperHalf);
  const iqr = q3 - q1;

  return { q1, median: med, q3, iqr, min, max };
}

/**
 * Calculate percentile value from a numeric array.
 * Uses linear interpolation between closest ranks.
 * @param values - Array of numbers
 * @param percentile - Percentile to calculate (0-100)
 * @returns Percentile value, or 0 if array is empty
 */
export function percentile(values: number[], p: number): number {
  if (!values || values.length === 0) return 0;
  if (p < 0 || p > 100) {
    throw new Error("Percentile must be between 0 and 100");
  }

  const sorted = [...values].sort((a, b) => a - b);

  if (p === 0) return sorted[0];
  if (p === 100) return sorted[sorted.length - 1];

  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  if (lower === upper) {
    return sorted[lower];
  }

  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

/**
 * Calculate summary statistics for a numeric array.
 * Combines mean, median, stdDev, quartiles, min, and max.
 * @param values - Array of numbers
 * @returns Object with all summary statistics
 */
export function summaryStats(values: number[]): {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
} {
  if (!values || values.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      q1: 0,
      q3: 0,
      iqr: 0,
    };
  }

  const q = quartiles(values);

  return {
    count: values.length,
    mean: mean(values),
    median: q.median,
    stdDev: standardDeviation(values),
    min: q.min,
    max: q.max,
    q1: q.q1,
    q3: q.q3,
    iqr: q.iqr,
  };
}

/**
 * Calculate variance of a numeric array.
 * Uses the population variance formula (n, not n-1).
 * @param values - Array of numbers
 * @returns Variance, or 0 if array is empty or has one element
 */
export function variance(values: number[]): number {
  if (!values || values.length <= 1) return 0;

  const avg = mean(values);
  const squaredDiffs = values.map((val) => Math.pow(val - avg, 2));
  return mean(squaredDiffs);
}

/**
 * Calculate coefficient of variation (CV) as a percentage.
 * CV = (stdDev / mean) * 100
 * @param values - Array of numbers
 * @returns CV as percentage, or 0 if mean is 0
 */
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return (standardDeviation(values) / m) * 100;
}

/**
 * Calculate z-scores (standard scores) for each value in an array.
 * z = (value - mean) / stdDev
 * @param values - Array of numbers
 * @returns Array of z-scores, or empty array if stdDev is 0
 */
export function zScores(values: number[]): number[] {
  if (!values || values.length === 0) return [];

  const m = mean(values);
  const s = standardDeviation(values);

  if (s === 0) {
    return values.map(() => 0);
  }

  return values.map((val) => (val - m) / s);
}
