/**
 * Dashboard insights — programmatic deduplication after the curator.
 *
 * Pass 1 (primary): Compare filter_context per pageId using dashboard-specific keys.
 *   A key contributes only when BOTH insights have a present value; then values must match (normalized).
 *   If no key has both sides present, Pass 1 does not treat the pair as duplicates.
 *
 * Pass 2 (secondary): Token-set Jaccard similarity on headlines for pairs not collapsed by Pass 1,
 *   then merge components and keep highest judge_score per group.
 */

import type { DashboardInsight } from "./types.js";

/** Minimum Jaccard similarity (|A∩B|/|A∪B|) for headline-based merge in Pass 2. */
export const HEADLINE_JACCARD_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// General (all dashboards): normalization helpers
// ---------------------------------------------------------------------------

const SIMPLE_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "to",
  "of",
  "in",
  "on",
  "vs",
  "at",
]);

function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return !Number.isNaN(v);
  if (typeof v === "boolean") return true;
  return false;
}

function normalizeStringish(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}

/** Collapse whitespace and unify dashes for segment labels. */
function normalizeSegmentLabel(v: unknown): string {
  const s = normalizeStringish(v);
  return s.replace(/[→–—]/g, "→").replace(/\s+/g, " ").trim();
}

function normalizeDatePeriod(v: unknown): string {
  return normalizeStringish(v);
}

/** workflow-conversion: prefer calculationType; coerce bad LLM output from `conversion` key. */
function normalizeWorkflowCalculation(fc: Record<string, unknown>): string | undefined {
  const ct = fc.calculationType;
  if (typeof ct === "string") {
    const t = ct.trim().toLowerCase();
    if (t === "conversion" || t === "turn_time") return t;
  }
  const conv = fc.conversion;
  if (conv === true) return "conversion";
  if (typeof conv === "string") {
    const t = conv.trim().toLowerCase();
    if (t === "conversion" || t === "turn_time") return t;
  }
  return undefined;
}

function getFilterValueForKey(
  pageId: string,
  fc: Record<string, unknown>,
  key: string
): unknown {
  if (pageId === "leaderboard" && key === "leaderName") {
    if (isPresent(fc.leaderName)) return fc.leaderName;
    if (isPresent(fc.leader)) return fc.leader;
    return undefined;
  }
  if (pageId === "loan-complexity" && key === "actor") {
    // Loan-complexity actor dedupe is name-based (not actor type).
    // Only compare explicit actor name keys.
    if (isPresent(fc.actor)) return fc.actor;
    if (isPresent(fc.actorName)) return fc.actorName;
    return undefined;
  }
  return fc[key];
}

function normalizeDedupValue(pageId: string, fc: Record<string, unknown>, key: string): string {
  if (pageId === "workflow-conversion" && key === "calculationType") {
    return normalizeWorkflowCalculation(fc) ?? "";
  }
  if (pageId === "workflow-conversion" && key === "segmentLabel") {
    return normalizeSegmentLabel(fc.segmentLabel);
  }
  if (key === "datePeriod") {
    return normalizeDatePeriod(fc.datePeriod);
  }
  const raw = getFilterValueForKey(pageId, fc, key);
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  return normalizeStringish(raw);
}

function hasComparableValue(pageId: string, fc: Record<string, unknown>, key: string): boolean {
  if (pageId === "workflow-conversion" && key === "calculationType") {
    // Category-set matching should only consider the canonical key.
    // Legacy/noisy `conversion` field is tolerated in value normalization,
    // but does not create an extra comparison category.
    return isPresent(fc.calculationType);
  }
  const raw = getFilterValueForKey(pageId, fc, key);
  return isPresent(raw);
}

// ---------------------------------------------------------------------------
// Dashboard-specific: which filter_context keys may participate in Pass 1
// ---------------------------------------------------------------------------

const DEDUP_FILTER_KEYS: Record<string, readonly string[]> = {
  "company-scorecard": ["tier", "datePeriod", "branch", "loanOfficer"],
  "credit-risk-management": ["category", "datePeriod", "applicationType"],
  leaderboard: ["datePeriod", "leaderName", "branch"],
  "loan-complexity": ["datePeriod", "branch", "actor"],
  "workflow-conversion": ["datePeriod", "segmentLabel", "segmentIndex", "calculationType"],
};

/**
 * True iff for every key in the page's dedup list, whenever BOTH filter contexts have
 * a present value for that key, the normalized values are equal.
 * If no key has both sides present, returns false (Pass 1 cannot claim duplicate from filters alone).
 */
export function filterContextsAreDuplicate(
  pageId: string,
  fcA: Record<string, unknown> | undefined,
  fcB: Record<string, unknown> | undefined
): boolean {
  const keys = DEDUP_FILTER_KEYS[pageId];
  if (!keys || keys.length === 0) return false;

  const a = fcA ?? {};
  const b = fcB ?? {};

  // Category-set gate: only compare insights when the same dedupe key categories
  // are present on both filter_context objects.
  const presentA = new Set(keys.filter((k) => hasComparableValue(pageId, a, k)));
  const presentB = new Set(keys.filter((k) => hasComparableValue(pageId, b, k)));
  if (presentA.size === 0 || presentB.size === 0) return false;
  if (presentA.size !== presentB.size) return false;
  for (const k of presentA) {
    if (!presentB.has(k)) return false;
  }

  for (const key of presentA) {
    if (pageId === "workflow-conversion" && key === "calculationType") {
      const na = normalizeWorkflowCalculation(a);
      const nb = normalizeWorkflowCalculation(b);
      if (!na || !nb) return false;
      if (na !== nb) return false;
      continue;
    }

    const normA = normalizeDedupValue(pageId, a, key);
    const normB = normalizeDedupValue(pageId, b, key);
    if (normA !== normB) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Pass 2: headline token-set Jaccard (general)
// ---------------------------------------------------------------------------

function headlineTokenSet(headline: string): Set<string> {
  const tokens = headline
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !SIMPLE_STOPWORDS.has(t));
  return new Set(tokens);
}

export function headlineJaccard(a: string, b: string): number {
  const A = headlineTokenSet(a || "");
  const B = headlineTokenSet(b || "");
  /** Do not treat two empty headlines as identical (would over-merge in Pass 2). */
  if (A.size === 0 && B.size === 0) return 0;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) inter++;
  }
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

/**
 * Compare two insights using the same precedence as dedupe:
 * 1) filter_context match (page-specific rules) first
 * 2) headline token-set Jaccard as secondary check
 */
export function insightsMatchByFilterThenHeadline(
  pageId: string,
  a: Pick<DashboardInsight, "filter_context" | "headline">,
  b: Pick<DashboardInsight, "filter_context" | "headline">
): boolean {
  const fcA = a.filter_context as Record<string, unknown> | undefined;
  const fcB = b.filter_context as Record<string, unknown> | undefined;
  const keys = DEDUP_FILTER_KEYS[pageId] ?? [];
  const setA = new Set(keys.filter((k) => hasComparableValue(pageId, fcA ?? {}, k)));
  const setB = new Set(keys.filter((k) => hasComparableValue(pageId, fcB ?? {}, k)));
  if (setA.size === 0 || setB.size === 0) return false;
  if (setA.size !== setB.size) return false;
  for (const k of setA) {
    if (!setB.has(k)) return false;
  }
  if (filterContextsAreDuplicate(pageId, fcA, fcB)) return true;
  return headlineJaccard(a.headline ?? "", b.headline ?? "") >= HEADLINE_JACCARD_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Union-find for clustering
// ---------------------------------------------------------------------------

function makeUnionFind(n: number): { find: (i: number) => number; union: (i: number, j: number) => void } {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(i: number, j: number): void {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }
  return { find, union };
}

function pickBestByJudge<T extends { judge_score?: number }>(items: T[]): T {
  let best = items[0];
  let bestScore = best.judge_score ?? 0;
  for (let k = 1; k < items.length; k++) {
    const s = items[k].judge_score ?? 0;
    if (s > bestScore) {
      best = items[k];
      bestScore = s;
    }
  }
  return best;
}

/**
 * Merge duplicate insights: Pass 1 filter_context, Pass 2 headline Jaccard.
 * Returns the same shape as input (including judge_score); pipeline strips judge_score before persistence.
 */
export function deduplicateByFilterContextAndHeadline<
  T extends DashboardInsight & { judge_score?: number },
>(insights: T[], pageId: string): T[] {
  if (insights.length <= 1) {
    return insights;
  }

  // ----- Pass 1: filter_context (page-specific key lists; general comparison rules above) -----
  let working = [...insights];
  {
    const n = working.length;
    const { find, union } = makeUnionFind(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const fcA = working[i].filter_context as Record<string, unknown> | undefined;
        const fcB = working[j].filter_context as Record<string, unknown> | undefined;
        if (filterContextsAreDuplicate(pageId, fcA, fcB)) {
          union(i, j);
        }
      }
    }
    const groups = new Map<number, T[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const list = groups.get(r) ?? [];
      list.push(working[i]);
      groups.set(r, list);
    }
    working = Array.from(groups.values()).map((g) => pickBestByJudge(g));
  }

  // ----- Pass 2: headline Jaccard (secondary; same union-find + best judge_score) -----
  if (working.length <= 1) {
    return working;
  }
  {
    const n = working.length;
    const { find, union } = makeUnionFind(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (insightsMatchByFilterThenHeadline(pageId, working[i], working[j])) {
          union(i, j);
        }
      }
    }
    const groups = new Map<number, T[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const list = groups.get(r) ?? [];
      list.push(working[i]);
      groups.set(r, list);
    }
    working = Array.from(groups.values()).map((g) => pickBestByJudge(g));
  }

  return working;
}
