/**
 * Aggregation of retrieved similar historical loans (pre-LLM).
 * Produces compact summaries: outcome counts and optional pattern signals.
 */

import type { SimilarLoan } from './loanEmbeddingStore.js';

export type AggregatedSimilar = {
  totalCount: number;
  outcomeCounts: { withdraw: number; deny: number; originate: number };
  summaryText: string;
};

/** Outcome labels for display. */
const LABELS: Record<string, string> = {
  withdraw: 'Withdrawn',
  deny: 'Denied',
  originate: 'Originated',
};

/**
 * Aggregate retrieved similar loans into outcome counts and a short summary.
 * Do not pass raw rows to the LLM; keep it compact.
 */
export function aggregateRetrieved(results: SimilarLoan[]): AggregatedSimilar {
  const outcomeCounts = { withdraw: 0, deny: 0, originate: 0 };
  for (const r of results) {
    const k = r.outcome as keyof typeof outcomeCounts;
    if (k in outcomeCounts) outcomeCounts[k]++;
  }
  const totalCount = results.length;
  const parts: string[] = [];
  if (totalCount > 0) {
    const pct = (n: number) => Math.round((n / totalCount) * 100);
    parts.push(
      `Of ${totalCount} historically similar loans: ` +
        `${LABELS.originate} ${pct(outcomeCounts.originate)}%, ` +
        `${LABELS.deny} ${pct(outcomeCounts.deny)}%, ` +
        `${LABELS.withdraw} ${pct(outcomeCounts.withdraw)}%`
    );
  }
  return {
    totalCount,
    outcomeCounts,
    summaryText: parts.join('. ') || `No similar historical loans (${totalCount} retrieved).`,
  };
}
