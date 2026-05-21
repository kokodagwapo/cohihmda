/**
 * Fuzzy distinct-value suggestions for insight builder text filter clarification.
 */

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreValue(query: string, candidate: string): number {
  const q = normalizeForMatch(query);
  if (!q) return 0;
  const c = normalizeForMatch(candidate);
  if (c === q) return 100;
  if (c.startsWith(q) || q.startsWith(c)) return 85;
  if (c.includes(q) || q.includes(c)) return 70;
  const qTokens = q.split(/\s+/).filter(Boolean);
  let tokenHits = 0;
  for (const t of qTokens) {
    if (c.includes(t)) tokenHits += 1;
  }
  if (tokenHits > 0) return 45 + tokenHits * 12;
  return 0;
}

export function isExactDistinctValueMatch(query: string, candidate: string): boolean {
  return query.trim().toLowerCase() === candidate.trim().toLowerCase();
}

export function suggestLoanColumnValues(
  query: string,
  values: string[],
  limit = 5,
): string[] {
  const scored = values
    .map((v) => ({ value: v, score: scoreValue(query, v) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((x) => x.value);
}
