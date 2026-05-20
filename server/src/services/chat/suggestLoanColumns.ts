/**
 * Fuzzy column suggestions for insight builder specifier clarification.
 */

import { columnToLabel } from "../ai/schemaContextService.js";

export interface LoanColumnSuggestion {
  name: string;
  label: string;
  type?: string;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreColumn(query: string, name: string, label: string): number {
  const q = normalizeForMatch(query);
  if (!q) return 0;
  const n = normalizeForMatch(name);
  const l = normalizeForMatch(label);
  if (n === q || l === q) return 100;
  if (n.startsWith(q) || l.startsWith(q)) return 80;
  if (n.includes(q) || l.includes(q)) return 60;
  const qTokens = q.split(/\s+/).filter(Boolean);
  let tokenHits = 0;
  for (const t of qTokens) {
    if (n.includes(t) || l.includes(t)) tokenHits += 1;
  }
  if (tokenHits > 0) return 40 + tokenHits * 10;
  return 0;
}

export function suggestLoanColumns(
  query: string,
  columns: { name: string; type?: string }[],
  limit = 5,
): LoanColumnSuggestion[] {
  const scored = columns
    .map((c) => ({
      name: c.name,
      label: columnToLabel(c.name),
      type: c.type,
      score: scoreColumn(query, c.name, columnToLabel(c.name)),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ name, label, type }) => ({ name, label, type }));
}
