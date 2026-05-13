/**
 * Tracked Insight Evaluator
 *
 * Re-evaluates all active tracked insights by executing their
 * metric_signature SQL and comparing to the previous snapshot.
 * Stores new snapshots with trend detection and change summaries.
 *
 * Runs as a post-sync hook after each data load (4hr cycle)
 * and also as part of the insight orchestrator pipeline.
 */

import pg from "pg";
import { safeExecuteSQL, callLLM, getOpenAIKey, type LLMMessage } from "../research/tools.js";
import { logInfo, logError, logWarn } from "../logger.js";
import {
  resolvePolarityForKey,
  type MetricPolarity,
} from "./trackedPolarityResolve.js";
import {
  applyLlmPolarityInferenceToTrackedInsight,
  isTrackedInsightPolarityLlmEnabled,
  isTrackedInsightPolarityLlmShadow,
  runTrackedPolarityLlmInference,
} from "./trackedPolarityLlmResolution.js";
import { resolveTrackedInsightSqlParams } from "./trackedInsightParamResolution.js";
import {
  isRegisteredTrackedInsightHandler,
  runTrackedInsightHandler,
} from "./trackedInsightHandlers.js";

// ============================================================================
// Types
// ============================================================================

export interface TrackedInsightEvaluationInput {
  id: string;
  headline: string;
  understory: string;
  source_type: string;
  source_insight_id: string | number | null;
  alert_threshold: AlertThreshold | null;
  metric_signature: {
    sql: string;
    keyFields: string[];
    /** Agent-only: subset of keyFields used for trends / deltas / comparisons. Omitted for other source types. */
    comparisonKeyFields?: string[];
    polarities?: Record<string, MetricPolarity>;
    params?: unknown[];
    param_resolution?: string;
    refresh_kind?: "sql" | "handler";
    handler_id?: string;
  };
  /** Full JSON from DB — handlers + param resolution use extended shapes. */
  display_metadata?: Record<string, unknown> | null;
}

type TrackedInsight = TrackedInsightEvaluationInput;

interface AlertThreshold {
  field: string;
  operator: "gt" | "lt" | "gte" | "lte";
  value: number;
  triggered?: boolean;
  last_triggered_at?: string | null;
}

interface PreviousSnapshot {
  metric_values: Record<string, any>;
  evaluated_at: string;
}

export type EvaluateSingleTrackedInsightResult =
  | { status: "evaluated" }
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string };

/**
 * Run one evaluation cycle for a single tracked insight (SQL or handler),
 * append a snapshot, and apply alert_threshold side effects.
 * Used by the batch evaluator and immediately after creating a tracked insight.
 */
export async function evaluateSingleTrackedInsight(
  tenantId: string,
  tenantPool: pg.Pool,
  insight: TrackedInsightEvaluationInput,
  options?: { llmApiKeyHolder?: { key: string | null } }
): Promise<EvaluateSingleTrackedInsightResult> {
  try {
    const sig = insight.metric_signature;
    const refreshKind = sig.refresh_kind ?? "sql";

    let metricValues: Record<string, any>;

    if (refreshKind === "handler" && sig.handler_id) {
      if (!isRegisteredTrackedInsightHandler(sig.handler_id)) {
        logWarn(
          `[TrackedEvaluator] Skipping "${insight.headline}" — unknown handler_id ${sig.handler_id}`
        );
        return { status: "skipped", reason: "unknown_handler" };
      }
      const rows = await runTrackedInsightHandler(
        sig.handler_id,
        tenantPool,
        insight.display_metadata ?? null
      );
      metricValues = extractMetricValues(rows, sig.keyFields);
    } else {
      if (!sig.sql?.trim()) {
        logWarn(
          `[TrackedEvaluator] Skipping "${insight.headline}" — no metric_signature SQL`
        );
        return { status: "skipped", reason: "no_sql" };
      }

      const params = resolveTrackedInsightSqlParams({
        source_type: insight.source_type,
        metric_signature: sig,
        display_metadata: insight.display_metadata ?? null,
      });
      const queryResult = await safeExecuteSQL(sig.sql, tenantPool, params);

      metricValues = extractMetricValues(queryResult.rows, sig.keyFields);
    }

    const prevSnapshot = await fetchPreviousSnapshot(tenantPool, insight.id);

    const comparisonFields = resolveComparisonFieldsForEvaluation(
      insight.source_type,
      sig,
      metricValues
    );

    const comparedKeys = resolveComparableKeys(
      metricValues,
      prevSnapshot?.metric_values,
      comparisonFields
    );

    let polaritiesForEvaluation: Record<string, MetricPolarity> | undefined =
      insight.metric_signature.polarities;

    if (isTrackedInsightPolarityLlmEnabled()) {
      const neutralCompared = comparedKeys.filter(
        (k) => resolvePolarityForKey(k, polaritiesForEvaluation) === "neutral"
      );
      if (neutralCompared.length > 0) {
        let apiKeyPolarity = options?.llmApiKeyHolder?.key ?? null;
        if (!apiKeyPolarity) {
          try {
            apiKeyPolarity = await getOpenAIKey(tenantId);
          } catch {
            /* skip LLM polarity */
          }
          if (options?.llmApiKeyHolder) options.llmApiKeyHolder.key = apiKeyPolarity;
        }
        if (apiKeyPolarity) {
          const llmResult = await runTrackedPolarityLlmInference({
            tenantId,
            trackedInsightId: insight.id,
            headline: insight.headline,
            understory: insight.understory,
            sourceType: insight.source_type,
            displayMetadata: insight.display_metadata,
            metricValues,
            comparedKeys,
            existingPolarities: polaritiesForEvaluation,
            apiKey: apiKeyPolarity,
          });
          if (llmResult) {
            const shouldPersist =
              Object.keys(llmResult.polaritiesToMerge).length > 0 ||
              llmResult.polarityInferenceAudit.length > 0;
            if (shouldPersist) {
              await applyLlmPolarityInferenceToTrackedInsight(
                tenantPool,
                insight.id,
                insight.metric_signature as Record<string, unknown>,
                insight.display_metadata as Record<string, unknown> | null | undefined,
                llmResult,
                { shadow: isTrackedInsightPolarityLlmShadow() }
              );
            }
            if (!isTrackedInsightPolarityLlmShadow()) {
              polaritiesForEvaluation = {
                ...(polaritiesForEvaluation || {}),
                ...llmResult.polaritiesToMerge,
              };
              insight.metric_signature = {
                ...insight.metric_signature,
                polarities: polaritiesForEvaluation,
              };
            }
          }
        }
      }
    }

    const trend = determineTrend(
      metricValues,
      prevSnapshot?.metric_values,
      comparedKeys,
      polaritiesForEvaluation
    );

    let trendVsBaseline: "improving" | "worsening" | "stable" | "new" | null = null;
    if (prevSnapshot) {
      const baselineSnap = await fetchBaselineSnapshot(tenantPool, insight.id);
      if (baselineSnap?.metric_values) {
        trendVsBaseline = determineTrend(
          metricValues,
          baselineSnap.metric_values,
          comparedKeys,
          polaritiesForEvaluation
        );
      }
    }

    const dualTrendLine = formatDualTrendSummary(trend, trendVsBaseline);

    let changeSummary: string;
    if (!prevSnapshot) {
      changeSummary = "Initial evaluation — baseline established.";
    } else if (trend === "stable") {
      changeSummary = `${dualTrendLine}. No significant change vs the immediately prior snapshot (within threshold).`;
    } else {
      let apiKey = options?.llmApiKeyHolder?.key ?? null;
      if (!apiKey) {
        try {
          apiKey = await getOpenAIKey(tenantId);
        } catch {
          /* fallback inside generateChangeSummary */
        }
        if (options?.llmApiKeyHolder) options.llmApiKeyHolder.key = apiKey;
      }
      changeSummary = await generateChangeSummary(
        tenantId,
        insight.headline,
        insight.understory,
        metricValues,
        prevSnapshot.metric_values,
        trend,
        comparedKeys,
        polaritiesForEvaluation,
        insight.display_metadata || null,
        apiKey,
        dualTrendLine,
        trendVsBaseline
      );
    }

    if (insight.alert_threshold?.field && insight.alert_threshold.operator) {
      const alertTriggered = checkAlertThreshold(
        metricValues,
        insight.alert_threshold
      );
      if (alertTriggered && !insight.alert_threshold.triggered) {
        await tenantPool.query(
          `UPDATE tracked_insights
             SET alert_threshold = alert_threshold || $1::jsonb, updated_at = NOW()
           WHERE id = $2`,
          [
            JSON.stringify({
              triggered: true,
              last_triggered_at: new Date().toISOString(),
            }),
            insight.id,
          ]
        );
        logInfo(
          `[TrackedEvaluator] Alert triggered for "${insight.headline}" (${insight.alert_threshold.field} ${insight.alert_threshold.operator} ${insight.alert_threshold.value})`
        );
      } else if (!alertTriggered && insight.alert_threshold.triggered) {
        await tenantPool.query(
          `UPDATE tracked_insights
             SET alert_threshold = alert_threshold || $1::jsonb, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify({ triggered: false }), insight.id]
        );
      }
    }

    const snapshotMetricValues = {
      ...metricValues,
      _compared_keys: comparedKeys,
      _polarities: buildPolarityContext(comparedKeys, polaritiesForEvaluation),
    };
    try {
      await tenantPool.query(
        `INSERT INTO tracked_insight_snapshots
           (tracked_insight_id, metric_values, previous_values, change_summary, trend, trend_vs_baseline)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          insight.id,
          JSON.stringify(snapshotMetricValues),
          prevSnapshot ? JSON.stringify(prevSnapshot.metric_values) : null,
          changeSummary,
          trend,
          trendVsBaseline,
        ]
      );
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("trend_vs_baseline") || msg.includes("does not exist")) {
        await tenantPool.query(
          `INSERT INTO tracked_insight_snapshots
             (tracked_insight_id, metric_values, previous_values, change_summary, trend)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            insight.id,
            JSON.stringify(snapshotMetricValues),
            prevSnapshot ? JSON.stringify(prevSnapshot.metric_values) : null,
            changeSummary,
            trend,
          ]
        );
      } else {
        throw err;
      }
    }

    await tenantPool.query(
      `UPDATE tracked_insights SET updated_at = NOW() WHERE id = $1`,
      [insight.id]
    );

    // Pattern B: persist derived numeric comparison keys once for agent insights (UI + alerts).
    if (insight.source_type === "agent" || insight.source_type === "user_insights") {
      const ms = insight.metric_signature;
      const explicit = (ms.comparisonKeyFields || []).filter((k) =>
        ms.keyFields.includes(k)
      );
      if (explicit.length === 0) {
        const derived = deriveComparisonKeyFieldsFromMetricValues(
          metricValues,
          ms.keyFields
        );
        if (derived.length > 0) {
          const nextSig = { ...ms, comparisonKeyFields: derived };
          await tenantPool.query(
            `UPDATE tracked_insights SET metric_signature = $1::jsonb, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(nextSig), insight.id]
          );
        }
      }
    }

    return { status: "evaluated" };
  } catch (err: any) {
    logError(
      `[TrackedEvaluator] Error evaluating "${insight.headline}": ${err.message}`
    );
    return { status: "error", message: err.message || String(err) };
  }
}

// ============================================================================
// Main entry point
// ============================================================================

export async function evaluateTrackedInsights(
  tenantId: string,
  tenantPool: pg.Pool
): Promise<{ evaluated: number; errors: number }> {
  const startTime = Date.now();
  let evaluated = 0;
  let errors = 0;

  // Check if the table exists (pre-migration guard)
  try {
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'tracked_insights'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) {
      return { evaluated: 0, errors: 0 };
    }
  } catch {
    return { evaluated: 0, errors: 0 };
  }

  // Fetch all active tracked insights
  let hasDisplayMetaCol = false;
  try {
    const colCheck = await tenantPool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tracked_insights' AND column_name = 'display_metadata'
    `);
    hasDisplayMetaCol = colCheck.rows.length > 0;
  } catch { /* pre-migration */ }

  const displayMetaSelect = hasDisplayMetaCol
    ? ", display_metadata"
    : ", NULL::jsonb AS display_metadata";
  const result = await tenantPool.query(
    `SELECT id, headline, understory, source_type, source_insight_id, metric_signature, alert_threshold
     ${displayMetaSelect}
     FROM tracked_insights
     WHERE status = 'active'
     ORDER BY created_at`
  );

  const insights: TrackedInsight[] = result.rows;
  if (insights.length === 0) {
    logInfo(`[TrackedEvaluator] No active tracked insights for tenant ${tenantId}`);
    return { evaluated: 0, errors: 0 };
  }

  logInfo(
    `[TrackedEvaluator] Evaluating ${insights.length} tracked insights for tenant ${tenantId}`
  );

  const llmApiKeyHolder = { key: null as string | null };

  for (const insight of insights) {
    const one = await evaluateSingleTrackedInsight(
      tenantId,
      tenantPool,
      insight,
      { llmApiKeyHolder }
    );
    if (one.status === "evaluated") evaluated++;
    else if (one.status === "error") errors++;
  }

  logInfo(
    `[TrackedEvaluator] Completed: ${evaluated} evaluated, ${errors} errors in ${Date.now() - startTime}ms`
  );

  return { evaluated, errors };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Strict numeric parsing for SQL result cells. Avoids parseFloat("180d+") === 180.
 */
function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "") {
    const t = v.trim();
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Keys in `keyFields` that resolve to a strict numeric scalar in `metricValues`
 * (same rules as alerts / trend deltas). Used to derive agent comparison keys when omitted.
 */
export function deriveComparisonKeyFieldsFromMetricValues(
  metricValues: Record<string, any>,
  keyFields: string[]
): string[] {
  const out: string[] = [];
  for (const f of keyFields) {
    if (readTrackedMetricScalar(metricValues, f) !== null) out.push(f);
  }
  return out;
}

function resolveComparisonFieldsForEvaluation(
  sourceType: string,
  sig: TrackedInsightEvaluationInput["metric_signature"],
  metricValues: Record<string, any>
): string[] {
  if (sourceType !== "agent") {
    return sig.keyFields?.length ? sig.keyFields : [];
  }
  const subset = (sig.comparisonKeyFields || []).filter((k) =>
    sig.keyFields.includes(k)
  );
  if (subset.length > 0) return subset;
  return deriveComparisonKeyFieldsFromMetricValues(metricValues, sig.keyFields);
}

/** Read a scalar from snapshot metric values using keyFields + legacy suffixed keys. */
export function readTrackedMetricScalar(
  metricValues: Record<string, any>,
  field: string
): number | null {
  const v =
    metricValues[field] ?? metricValues[`${field}_sum`] ?? metricValues[`${field}_avg`];
  if (v === null || v === undefined) return null;
  const n = coerceFiniteNumber(v);
  return n;
}

export function extractMetricValues(
  rows: Record<string, any>[],
  keyFields?: string[]
): Record<string, any> {
  if (rows.length === 0) return {};

  // If single row, use all fields (or just key fields)
  if (rows.length === 1) {
    const row = rows[0];
    if (keyFields && keyFields.length > 0) {
      const result: Record<string, any> = {};
      for (const f of keyFields) {
        if (f in row) result[f] = row[f];
      }
      return result;
    }
    return { ...row };
  }

  // Multiple rows (e.g. GROUP BY): roll up numerics to the same keys as keyFields
  // so UI + alerts can read metric_values[field]. Dimensions with multiple
  // distinct values are omitted (UI shows "—").
  const result: Record<string, any> = {
    _rowCount: rows.length,
  };
  if (keyFields && keyFields.length > 0) {
    for (const f of keyFields) {
      const values = rows.map((r) => r[f]).filter((v) => v != null);
      if (values.length === 0) continue;

      const nums = values.map((v) => coerceFiniteNumber(v));
      const allNumeric = nums.every((n) => n !== null);

      if (allNumeric) {
        const numberList = nums as number[];
        const sum = numberList.reduce((a, b) => a + b, 0);
        const avg = sum / numberList.length;
        result[f] = sum;
        result[`${f}_sum`] = sum;
        result[`${f}_avg`] = avg;
        result[`${f}_count`] = numberList.length;
        continue;
      }

      const strVals = values.map((v) => String(v));
      const distinct = Array.from(new Set(strVals));
      if (distinct.length === 1) {
        result[f] = distinct[0];
      }
    }
  }
  return result;
}

/** Human-readable stability line: vs last snapshot vs original (first) snapshot. */
export function formatDualTrendSummary(
  sinceLast: "improving" | "worsening" | "stable" | "new",
  sinceBaseline: "improving" | "worsening" | "stable" | "new" | null | undefined
): string {
  const label = (t: string) =>
    t === "improving"
      ? "Improving"
      : t === "worsening"
        ? "Worsening"
        : t === "new"
          ? "New baseline"
          : "Stable";
  if (sinceLast === "new") {
    return "New baseline — first evaluation (no prior snapshot).";
  }
  if (sinceBaseline == null || sinceBaseline === undefined) {
    return `${label(sinceLast)} since last evaluation`;
  }
  if (sinceLast === sinceBaseline) {
    return `${label(sinceLast)} since last evaluation and since original evaluation`;
  }
  return `${label(sinceLast)} since last evaluation, ${label(sinceBaseline)} since original evaluation`;
}

function determineTrend(
  current: Record<string, any>,
  previous?: Record<string, any>,
  comparedKeys?: string[],
  polarities?: Record<string, MetricPolarity>
): "improving" | "worsening" | "stable" | "new" {
  if (!previous) return "new";

  const currentKeys = (comparedKeys && comparedKeys.length > 0)
    ? comparedKeys.filter((k) => k in current)
    : Object.keys(current).filter((k) => !k.startsWith("_"));

  if (currentKeys.length === 0) return "stable";

  let significantChanges = 0;
  let positiveChanges = 0;
  let negativeChanges = 0;

  for (const key of currentKeys) {
    const curVal = parseFloat(current[key]);
    const prevVal = parseFloat(previous[key]);
    if (isNaN(curVal) || isNaN(prevVal) || prevVal === 0) continue;

    const pctChange = Math.abs((curVal - prevVal) / prevVal) * 100;
    if (pctChange > 5) {
      const polarity = resolvePolarityForKey(key, polarities);
      // Ambiguous / context-dependent: no directional signal for trend voting
      if (polarity === "neutral") continue;

      significantChanges++;
      const rawIncrease = curVal > prevVal;
      const isImproving = polarity === "lower_better" ? !rawIncrease : rawIncrease;
      if (isImproving) positiveChanges++;
      else negativeChanges++;
    }
  }

  if (significantChanges === 0) return "stable";
  if (positiveChanges > negativeChanges) return "improving";
  if (negativeChanges > positiveChanges) return "worsening";
  return "stable";
}

function resolveComparableKeys(
  current: Record<string, any>,
  previous: Record<string, any> | undefined,
  keyFields?: string[]
): string[] {
  const keys = keyFields && keyFields.length > 0
    ? keyFields
    : Object.keys(current).filter((k) => !k.startsWith("_"));

  const resolved: string[] = [];
  for (const key of keys) {
    if (key in current && (!previous || key in previous)) {
      resolved.push(key);
      continue;
    }
    const candidates = [`${key}_avg`, `${key}_sum`, `${key}_count`];
    const found = candidates.find(
      (c) => c in current && (!previous || c in previous)
    );
    if (found) resolved.push(found);
  }
  return Array.from(new Set(resolved));
}

function buildPolarityContext(
  comparedKeys: string[],
  explicitPolarities?: Record<string, MetricPolarity>
): Record<string, MetricPolarity> {
  const out: Record<string, MetricPolarity> = {};
  for (const key of comparedKeys) {
    out[key] = resolvePolarityForKey(key, explicitPolarities);
  }
  return out;
}

async function fetchPreviousSnapshot(
  tenantPool: pg.Pool,
  trackedInsightId: string
): Promise<PreviousSnapshot | null> {
  const result = await tenantPool.query(
    `SELECT metric_values, evaluated_at
     FROM tracked_insight_snapshots
     WHERE tracked_insight_id = $1
     ORDER BY evaluated_at DESC
     LIMIT 1`,
    [trackedInsightId]
  );
  return result.rows[0] || null;
}

/** Earliest snapshot for this insight — "original" baseline for trend_vs_baseline. */
async function fetchBaselineSnapshot(
  tenantPool: pg.Pool,
  trackedInsightId: string
): Promise<PreviousSnapshot | null> {
  const result = await tenantPool.query(
    `SELECT metric_values, evaluated_at
     FROM tracked_insight_snapshots
     WHERE tracked_insight_id = $1
     ORDER BY evaluated_at ASC
     LIMIT 1`,
    [trackedInsightId]
  );
  return result.rows[0] || null;
}

async function generateChangeSummary(
  tenantId: string,
  headline: string,
  understory: string,
  current: Record<string, any>,
  previous: Record<string, any>,
  trend: string,
  keyFields?: string[],
  polarities?: Record<string, MetricPolarity>,
  displayMetadata?: {
    original_bucket?: string;
    original_priority?: string;
    original_severity_score?: number | null;
  } | null,
  cachedApiKey?: string | null,
  dualTrendLine?: string,
  trendVsBaseline?: "improving" | "worsening" | "stable" | "new" | null
): Promise<string> {
  // Build polarity context for the LLM
  const polarityLines: string[] = [];
  const relevantKeys = (keyFields && keyFields.length > 0)
    ? keyFields
    : Object.keys(current).filter((k) => !k.startsWith("_"));
  for (const key of relevantKeys) {
    const polarity = resolvePolarityForKey(key, polarities);
    const label =
      polarity === "lower_better"
        ? "lower is better"
        : polarity === "higher_better"
          ? "higher is better"
          : "neutral (no directional signal)";
    polarityLines.push(`${key}: ${label}`);
  }

  // Build numeric change lines for the rule-based fallback and LLM context
  const changeParts: string[] = [];
  for (const key of relevantKeys) {
    const cur = readTrackedMetricScalar(current, key);
    const prev = readTrackedMetricScalar(previous, key);
    if (cur !== null && prev !== null && prev !== 0) {
      const pct = ((cur - prev) / Math.abs(prev) * 100).toFixed(1);
      changeParts.push(`${key}: ${prev} → ${cur} (${parseFloat(pct) > 0 ? "+" : ""}${pct}%)`);
    }
  }

  try {
    const apiKey = cachedApiKey || (await getOpenAIKey(tenantId));
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: `You are an expert mortgage banking analyst reviewing tracked performance metrics for a mortgage lender. 
Generate a single concise sentence (max 25 words) summarizing how the tracked metric has changed. 
Rules:
- Be specific with numbers and percentages
- Interpret the change in terms of business impact (e.g. "improving pull-through" or "cycle time worsening")
- Account for metric polarity: lower-is-better (cycle time, aged loans, day counts), higher-is-better (revenue, funded, loan counts/amounts); neutral — no good/bad direction
- Do NOT use markdown
- Write from the perspective of an operations or risk manager`,
      },
      {
        role: "user",
        content: [
          `Tracked insight: "${headline}"`,
          understory ? `Context: ${understory}` : "",
          displayMetadata?.original_bucket
            ? `Original bucket: ${displayMetadata.original_bucket}`
            : "",
          displayMetadata?.original_priority
            ? `Original priority: ${displayMetadata.original_priority}`
            : "",
          displayMetadata?.original_severity_score != null
            ? `Original severity score: ${displayMetadata.original_severity_score}`
            : "",
          `Trend vs last snapshot: ${trend}`,
          trendVsBaseline != null
            ? `Trend vs original (first) evaluation: ${trendVsBaseline}`
            : "",
          dualTrendLine
            ? `Stability summary: ${dualTrendLine}`
            : "",
          changeParts.length > 0 ? `Metric changes: ${changeParts.join("; ")}` : "",
          polarityLines.length > 0 ? `Metric polarity: ${polarityLines.join("; ")}` : "",
        ].filter(Boolean).join("\n"),
      },
    ];
    return await callLLM(messages, apiKey, {
      temperature: 0.2,
      maxTokens: 80,
    });
  } catch {
    // Rule-based fallback
    return changeParts.length > 0
      ? `Changes: ${changeParts.join(", ")}`
      : "Metric values updated.";
  }
}

function checkAlertThreshold(
  metricValues: Record<string, any>,
  threshold: AlertThreshold
): boolean {
  const val = readTrackedMetricScalar(metricValues, threshold.field);
  if (val === null) return false;
  switch (threshold.operator) {
    case "gt":  return val > threshold.value;
    case "lt":  return val < threshold.value;
    case "gte": return val >= threshold.value;
    case "lte": return val <= threshold.value;
    default:    return false;
  }
}
