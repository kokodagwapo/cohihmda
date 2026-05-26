/**
 * Canonical metric terminology for LLM prompts and user-facing copy.
 */

export const METRIC_LANGUAGE_RULES = `LANGUAGE AND METRIC NAMING:
- Use plain-language metric names in user-facing text.
- Avoid undefined shorthand: do not use "Pct", "pp", "PT", "Vol", "GOS", or "bps" without defining them inline on first use.
- "percentage points" (not "pp") when describing the change between two rates.
- Use "%" for rates and proportions (e.g. "pull-through is 74%").
- Preferred terms: "pull-through rate", "funded volume", "gain-on-sale revenue", "cycle time", "fallout rate", "loan officer".`;

/** Expand common abbreviations in generated context strings (not SQL). */
export function expandMetricAbbreviations(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b(\d+(?:\.\d+)?)\s*pp\b/gi, "$1 percentage points")
    .replace(/\bpp\b/gi, "percentage points")
    .replace(/\bPT\b/g, "pull-through rate")
    .replace(/\bVol\b/g, "funded volume")
    .replace(/\bGOS\b/g, "gain-on-sale revenue");
}

export function metricLabel(key: string): string {
  const map: Record<string, string> = {
    pullThrough: "pull-through rate",
    pull_through_rate: "pull-through rate",
    fallout: "fallout rate",
    falloutRate: "fallout rate",
    volume: "funded volume",
    revenue: "gain-on-sale revenue",
    cycleTime: "cycle time",
    avgCycleTime: "average cycle time",
    loan_officer: "loan officer",
    lo: "loan officer",
  };
  return map[key] ?? key.replace(/_/g, " ");
}
