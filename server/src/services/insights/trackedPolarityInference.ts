/**
 * Single source of truth for tracked-metric polarity when not explicitly set
 * on metric_signature.polarities. Used at track-create normalization and
 * at evaluation time (resolvePolarityForKey fallback).
 */

export type TrackedMetricPolarity = "higher_better" | "lower_better" | "neutral";

const LOWER_IS_BETTER_SUBSTRINGS = [
  "cycle_time",
  "days_in",
  "dwell",
  "aging",
  "stale",
  "fallout",
  "backlog",
  "expired",
  "overdue",
  "delinquent",
  "condition",
  "defect",
  "error",
  "exception",
  "denied",
  "withdrawn",
  "cancell",
];

/** Snake_case token `age` / `aged` (e.g. loan_age), not substring "age" inside "percentage". */
function hasAgeSnakeToken(n: string): boolean {
  return n
    .split("_")
    .some((s) => s === "age" || s === "aged");
}

/** Day-based duration / latency style fields — lower elapsed time is better. */
function hasDaysLowerSignal(n: string): boolean {
  if (n.endsWith("_days")) return true;
  if (n.includes("_days_")) return true;
  if (n.startsWith("days_")) return true;
  if (n.includes("days_in") || n.includes("days_to")) return true;
  if (n.includes("_day_")) return true;
  return false;
}

function hasHigherBetterSignal(n: string): boolean {
  if (n.includes("unfunded")) return false;

  if (n.includes("revenue")) return true;
  if (n.includes("funded")) return true;
  if (n.includes("loan_amount") || n.includes("loanamount")) return true;
  if (n.includes("loan") && n.includes("amount")) return true;

  if (n.includes("active") && n.includes("loan")) return true;
  if (n.includes("total") && n.includes("loan")) return true;
  if (n.includes("loan_count") || n.includes("loans_count") || n.includes("num_loans"))
    return true;

  return false;
}

/**
 * Infer polarity from metric key naming. Explicit polarities from the caller win
 * (see resolvePolarityForKey in evaluator / merge on track-create).
 */
export function inferTrackedMetricPolarity(fieldName: string): TrackedMetricPolarity {
  const n = fieldName.toLowerCase().trim();
  if (!n) return "neutral";

  if (n.includes("pct_missing") || /^pct_missing_/.test(n)) return "lower_better";

  if (LOWER_IS_BETTER_SUBSTRINGS.some((p) => n.includes(p))) return "lower_better";
  if (hasAgeSnakeToken(n)) return "lower_better";
  if (hasDaysLowerSignal(n)) return "lower_better";

  if (hasHigherBetterSignal(n)) return "higher_better";

  return "neutral";
}
