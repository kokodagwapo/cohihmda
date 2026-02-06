/**
 * COHI Dataset Selector – chooses which data sources to use for the intent.
 */

import type { IntentResult, SelectedSource } from "./types.js";

export function datasetSelector(
  intentResult: IntentResult,
  context: { referencedUploadIds?: string[]; selectedDatasetIds?: string[] }
): SelectedSource[] {
  const { intent, params } = intentResult;
  const sources: SelectedSource[] = [];

  if (
    intent === "toptiering_top" ||
    intent === "toptiering_bottom" ||
    intent === "toptiering_mid_trend" ||
    intent === "toptiering_compare"
  ) {
    sources.push({
      type: "toptiering",
      params: {
        actor: params.actor ?? "branch",
        startDate: params.startDate,
        endDate: params.endDate,
        tier: params.tier,
      },
    });
  }

  if (intent === "exec_summary") {
    sources.push({ type: "dashboard", params: {} });
  }

  if (intent === "upload_ranking" && context.referencedUploadIds?.length) {
    for (const id of context.referencedUploadIds) {
      sources.push({ type: "upload", id, params: {} });
    }
  }

  if (sources.length === 0 && intent === "generic_data") {
    sources.push({ type: "dashboard", params: {} });
  }

  return sources;
}
