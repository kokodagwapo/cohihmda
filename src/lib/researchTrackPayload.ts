/**
 * Build optional SQL + keyFields for Research Lab watchlist tracking from
 * ranked-insight supporting findings (COHI-362).
 */
import type { Finding, RankedInsight } from "@/hooks/useResearchSession";

export type ResearchTrackSqlExtras = {
  sql: string;
  keyFields: string[];
};

/** First SQL-backed evidence among supporting findings, if any. */
export function primarySqlEvidenceForRankedInsight(
  insight: Pick<RankedInsight, "supportingFindingIds">,
  findings: Finding[]
): ResearchTrackSqlExtras | undefined {
  const related = findings.filter((f) =>
    insight.supportingFindingIds.includes(f.questionId)
  );
  const firstFinding = related.find((f) => f.evidence?.length);
  const ev = firstFinding?.evidence?.[0];
  const sql = typeof ev?.sql === "string" ? ev.sql.trim() : "";
  if (!sql) return undefined;
  const keyFields = (ev.fields || [])
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim());
  return { sql, keyFields };
}
