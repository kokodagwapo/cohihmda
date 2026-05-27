/**
 * Lightweight metric intent routing — keyword + catalog category heuristics.
 * Reduces injected metric count for planner prompts.
 */

import { METRICS_CATALOG } from "./metricsService.js";

const PT_TERMS = /pull[\s-]?through|pullthrough|funded\s*\/|conversion/i;
const VOL_TERMS = /volume|units|loan count|how many loans/i;
const REV_TERMS = /revenue|margin|income|basis/i;
const TT_TERMS = /turn[\s-]?time|cycle|days to|speed/i;
const TIER_TERMS =
  /top[\s-]?tier|second[\s-]?tier|bottom[\s-]?tier|\btts\b|scorecard|tiering|pareto/i;
const PIPELINE_TERMS = /pipeline health|active pipeline|stale active/i;

export function selectRelevantMetricIds(question: string, max = 14): string[] {
  const q = question.toLowerCase();
  const ids = Object.keys(METRICS_CATALOG);
  const scored: { id: string; score: number }[] = [];

  for (const id of ids) {
    const def = METRICS_CATALOG[id];
    let score = 0;
    if (q.includes(id.replace(/_/g, " "))) score += 5;
    if (def.name && q.includes(def.name.toLowerCase().slice(0, 8))) score += 3;
    if (def.category === "pull_through" && PT_TERMS.test(q)) score += 4;
    if (def.category === "volume" && VOL_TERMS.test(q)) score += 3;
    if (def.category === "revenue" && REV_TERMS.test(q)) score += 3;
    if (def.category === "turn_time" && TT_TERMS.test(q)) score += 3;
    if (def.category === "status" && /\bactive\b|\blocked\b|\bclosed\b/i.test(q))
      score += 2;
    if (TIER_TERMS.test(q) && id === "active_loans") score -= 3;
    if (TIER_TERMS.test(q) && def.category === "pull_through") score += 1;
    if (PIPELINE_TERMS.test(q) && id === "active_loans") score += 4;
    if (PIPELINE_TERMS.test(q) && def.category === "pull_through") score += 3;
    scored.push({ id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const picked = scored
    .filter((s) => s.score > 0)
    .slice(0, max)
    .map((s) => s.id);

  if (picked.length >= 8) return picked;

  const fallback = [
    "pull_through_rate",
    "active_loans",
    "closed_loans",
    "avg_cycle_time",
    "total_volume",
    "locked_loans",
    "funded_volume",
    "avg_app_fund_days",
  ].filter((id) => ids.includes(id));

  const merged = [...new Set([...picked, ...fallback])];
  return merged.slice(0, max);
}
