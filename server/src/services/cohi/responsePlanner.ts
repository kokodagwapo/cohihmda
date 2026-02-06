/**
 * COHI Response Planner – intent → dataset selection → fetch → build ResponsePlan + dataPayloads.
 */

import type { ResponsePlan, ResponsePlanSection, CohiQueryAudit, CohiQueryContext } from "./types.js";
import type { FetchedDataset } from "./dataFetcher.js";
import { intentDetector } from "./intentDetector.js";
import { datasetSelector } from "./datasetSelector.js";
import { dataFetcher } from "./dataFetcher.js";

export interface ResponsePlannerResult {
  responsePlan: ResponsePlan;
  dataPayloads: Record<string, unknown[]>;
  audit: CohiQueryAudit;
}

/** Heuristic: does the question ask for a table, chart, list, or numbers? If not, keep response to briefing only. */
function questionAsksForTableOrChart(question: string): boolean {
  const q = question.toLowerCase();
  const tableChartTriggers = [
    "table", "chart", "graph", "list", "breakdown", "numbers", "kpi",
    "who are the top", "top 10", "top 5", "bottom", "rank", "by loan officer",
    "by branch", "show me", "compare", "volume by", "pull-through by",
  ];
  return tableChartTriggers.some((t) => q.includes(t));
}

export async function responsePlanner(ctx: CohiQueryContext): Promise<ResponsePlannerResult> {
  const start = Date.now();
  const { tenantId, userId, question, context } = ctx;
  const contextInput = context ?? {};
  const includeTableOrChart = questionAsksForTableOrChart(question);

  const intentResult = intentDetector(question);
  const sources = datasetSelector(intentResult, {
    referencedUploadIds: contextInput.referencedUploadIds,
    selectedDatasetIds: contextInput.selectedDatasetIds,
  });
  const datasets = await dataFetcher(sources, tenantId, userId);

  const sections: ResponsePlanSection[] = [];
  const dataPayloads: Record<string, unknown[]> = {};

  for (const [key, ds] of Object.entries(datasets)) {
    const rows = ds.rows ?? [];
    dataPayloads[key] = rows;

    if (key === "toptiering" && rows.length > 0) {
      const count = rows.length;
      const actorLabel = intentResult.params?.actor === "loan_officer" ? "loan officers" : "branches";
      sections.push({
        type: "header_summary",
        props: {
          whatYouAsked: question,
          whatIFound: `Found ${count} ${actorLabel} in the selected period.${includeTableOrChart ? "" : " Key takeaway: use the data for pipeline and pull-through focus."}`,
          whyItMatters: includeTableOrChart ? "Table below shows volume and units." : "Prioritize pull-through and pipeline health.",
        },
      });
      if (includeTableOrChart) {
        sections.push({
          type: "ranked_table",
          props: {
            columns: [
              { key: "name", label: intentResult.params?.actor === "loan_officer" ? "Loan Officer" : "Branch", format: "text" },
              { key: "units", label: "Units", format: "number" },
              { key: "volume", label: "Volume", format: "currency" },
            ],
            rows: rows as Record<string, unknown>[],
          },
        });
      }
    } else if (key === "dashboard" && rows.length > 0) {
      const row = rows[0] as Record<string, unknown>;
      const totalLoans = Number(row?.total_loans ?? 0);
      const totalVolume = Number(row?.total_volume ?? 0);
      sections.push({
        type: "header_summary",
        props: {
          whatYouAsked: question,
          whatIFound: includeTableOrChart
            ? "Summary of loan activity in the last 90 days. KPIs below."
            : `Last 90 days: ${totalLoans} loans, $${(totalVolume / 1e6).toFixed(2)}M volume. Focus on pipeline and pull-through.`,
          whyItMatters: includeTableOrChart ? "Use the KPIs below for a quick overview." : "Pipeline and fundings drive targets.",
        },
      });
      if (includeTableOrChart) {
        sections.push({
          type: "kpi_cards",
          props: {
            cards: [
              { label: "Total Loans", value: totalLoans, format: "number" },
              { label: "Total Volume", value: totalVolume, format: "currency" },
            ],
          },
        });
      }
    }
  }

  if (sections.length === 0) {
    sections.push({
      type: "header_summary",
      props: {
        whatYouAsked: question,
        whatIFound: "No data matched your question for this tenant. Try top performers, bottom performers, or executive summary.",
        whyItMatters: "Add loan data or check date range and filters.",
      },
    });
    sections.push({
      type: "bullet_insights",
      props: {
        bullets: [
          { text: "Try: \"Who are the top performers?\" or \"What do I need to know today?\"", icon: "info" },
        ],
      },
    });
  }

  const responsePlan: ResponsePlan = {
    layout_type: "mixed",
    title: sections.length > 1 ? "Here's what I found" : "No data available",
    subtitle: intentResult.intent !== "generic_data" ? `Intent: ${intentResult.intent}` : undefined,
    confidence_level: Object.keys(datasets).length > 0 ? "high" : "low",
    sections,
    missing_data_requests:
      Object.keys(datasets).length === 0
        ? [{ question: "Do you have loan data loaded for this tenant?", options: ["Yes, refresh", "No, I'll add data"] }]
        : undefined,
  };

  const audit: CohiQueryAudit = {
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - start,
    datasetsUsed: Object.keys(datasets),
  };

  return { responsePlan, dataPayloads, audit };
}
