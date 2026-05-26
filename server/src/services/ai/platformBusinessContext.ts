/**
 * Platform-derived metrics and tenant scoring configuration for LLM prompts.
 * Shared by global chat, workbench, and research flows.
 */

import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import {
  OPS_TTS_WEIGHTS,
  SALES_TTS_WEIGHTS,
} from "../../utils/scorecard-utils.js";
import { getDerivedMetricContext } from "../research/tools.js";

export async function getTopTieringWeightsContext(
  tenantId: string,
): Promise<string> {
  try {
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    const result = await tenantPool.query<{
      scorecard_type: "sales" | "operations";
      metric_name: string;
      weight: string | number;
    }>(
      `SELECT scorecard_type, metric_name, weight
       FROM public.scoring_weights
       WHERE is_active = true
         AND persona_id IS NULL
         AND scorecard_type IN ('sales', 'operations')`,
    );

    const sales: {
      volume: number;
      margin: number;
      unit: number;
      pullThrough: number;
      turnTime: number;
      concession: number;
    } = { ...SALES_TTS_WEIGHTS };
    const operations: {
      units: number;
      turnTime: number;
      complexity: number;
    } = { ...OPS_TTS_WEIGHTS };
    let foundDbWeights = false;

    for (const row of result.rows) {
      const w = Number(row.weight);
      if (!Number.isFinite(w)) continue;
      foundDbWeights = true;

      if (row.scorecard_type === "sales") {
        const metricMap: Record<string, keyof typeof sales> = {
          volume: "volume",
          margin: "margin",
          unit: "unit",
          pull_through: "pullThrough",
          turn_time: "turnTime",
          concession: "concession",
        };
        const key = metricMap[row.metric_name];
        if (key) sales[key] = w;
      } else if (row.scorecard_type === "operations") {
        const metricMap: Record<string, keyof typeof operations> = {
          units: "units",
          turn_time: "turnTime",
          complexity: "complexity",
        };
        const key = metricMap[row.metric_name];
        if (key) operations[key] = w;
      }
    }

    return [
      "## Top Tiering Score Configuration",
      "Use the term Top Tiering Score (TTS alias in code), not Total Team Score.",
      foundDbWeights
        ? "These weights were loaded from this tenant's Admin Scoring & Weights configuration."
        : "No tenant-specific rows were found in scoring_weights; defaults are shown.",
      `Sales weights: volume=${sales.volume}, margin=${sales.margin}, unit=${sales.unit}, pullThrough=${sales.pullThrough}, turnTime=${sales.turnTime}, concession=${sales.concession}`,
      `Operations weights: units=${operations.units}, turnTime=${operations.turnTime}, complexity=${operations.complexity}`,
      "If a user asks where to change this, direct them to Admin > Scoring & Weights.",
    ].join("\n");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[PlatformBusinessContext] Failed to load TTS weights:", message);
    return [
      "## Top Tiering Score Configuration",
      "Use the term Top Tiering Score (TTS alias in code), not Total Team Score.",
      "Could not load tenant-specific weights from scoring_weights.",
      "Direct the user to Admin > Scoring & Weights to view/update current weights.",
    ].join("\n");
  }
}

/**
 * Derived metric formulas (TTS, tiers, complexity) plus tenant scoring weights.
 */
export async function buildPlatformBusinessContext(
  tenantId?: string,
): Promise<string> {
  const parts = [getDerivedMetricContext()];
  if (tenantId) {
    parts.push(await getTopTieringWeightsContext(tenantId));
  }
  return parts.join("\n\n");
}
