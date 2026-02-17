/**
 * insightDetailHydrator.ts
 *
 * Simplified hydrator that converts evidence_table (now populated with real SQL
 * query results from the Evidence Agent) directly into detail_data snapshots.
 *
 * The Evidence Agent already executes SQL and populates rows, so this hydrator
 * is now a thin pass-through that structures the data for the frontend.
 */

import pg from "pg";
import {
  CategorizedInsight,
  InsightDetailSnapshot,
} from "./llmInsightGenerator.js";
import { InsightMetricsPayload } from "./insightMetricsCollector.js";

// ============================================================================
// Main entry point
// ============================================================================

export async function hydrateInsightDetails(
  insights: CategorizedInsight[],
  _metrics: InsightMetricsPayload,
  _tenantPool: pg.Pool,
  _channelGroup?: string,
): Promise<void> {
  if (insights.length === 0) return;

  const t0 = Date.now();

  for (const ins of insights) {
    try {
      ins.detail_data = buildDetailFromEvidence(ins);
    } catch (err) {
      console.warn(`[Hydrator] Failed to hydrate ${ins.source} insight: ${(err as Error).message}`);
      ins.detail_data = null;
    }
  }

  const hydrated = insights.filter(i => i.detail_data != null).length;
  console.log(
    `[Hydrator] Hydrated ${hydrated}/${insights.length} insights in ${Date.now() - t0}ms`,
  );
}

// ============================================================================
// Build detail_data from evidence_table (single-path: rows already populated)
// ============================================================================

function buildDetailFromEvidence(
  insight: CategorizedInsight,
): InsightDetailSnapshot | null {
  const ev = insight.evidence_table;
  if (!ev || ev.columns.length === 0) return null;

  // Build ETM section for the detail view
  const etm = (insight.what_changed || insight.why || insight.business_impact) ? {
    what_changed: insight.what_changed,
    why: insight.why,
    business_impact: insight.business_impact,
    risk_if_ignored: insight.risk_if_ignored,
    recommended_action: insight.recommended_action,
    owner: insight.owner,
  } : undefined;

  // Build summary object from evidence summary_defs
  const summaryObj: Record<string, any> = {};
  for (const s of ev.summary) {
    summaryObj[s.key] = s.value;
  }

  // Build comparison section if present
  const comparison = ev.comparison ? {
    label: ev.comparison.label,
    currentLabel: ev.comparison.currentLabel,
    rows: ev.comparison.rows,
    summary: Object.fromEntries(ev.comparison.summary.map(s => [s.key, s.value])),
    summary_defs: ev.comparison.summary,
  } : undefined;

  return {
    title: ev.title,
    summary: summaryObj,
    rows: ev.rows,
    displayConfig: {
      columns: ev.columns.map(c => c.key),
      summaryMetrics: ev.summary.map(s => s.key),
      column_defs: ev.columns,
      summary_defs: ev.summary,
    },
    etm,
    comparison,
    audit: ev.audit,
  };
}
