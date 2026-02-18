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

// ============================================================================
// Types
// ============================================================================

interface TrackedInsight {
  id: string;
  headline: string;
  understory: string;
  metric_signature: {
    sql: string;
    keyFields: string[];
  };
}

interface PreviousSnapshot {
  metric_values: Record<string, any>;
  evaluated_at: string;
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
  const result = await tenantPool.query(
    `SELECT id, headline, understory, metric_signature
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

  let apiKey: string | null = null;

  for (const insight of insights) {
    try {
      if (!insight.metric_signature?.sql) {
        logWarn(
          `[TrackedEvaluator] Skipping "${insight.headline}" — no metric_signature SQL`
        );
        continue;
      }

      // Execute the metric signature SQL
      const queryResult = await safeExecuteSQL(
        insight.metric_signature.sql,
        tenantPool
      );

      // Extract metric values from the result
      const metricValues = extractMetricValues(
        queryResult.rows,
        insight.metric_signature.keyFields
      );

      // Fetch previous snapshot for comparison
      const prevSnapshot = await fetchPreviousSnapshot(
        tenantPool,
        insight.id
      );

      // Determine trend
      const trend = determineTrend(metricValues, prevSnapshot?.metric_values);

      // Generate change summary
      let changeSummary: string;
      if (!prevSnapshot) {
        changeSummary = "Initial evaluation — baseline established.";
      } else if (trend === "stable") {
        changeSummary = "No significant change since last evaluation.";
      } else {
        changeSummary = await generateChangeSummary(
          tenantId,
          insight.headline,
          metricValues,
          prevSnapshot.metric_values,
          trend,
          apiKey
        );
        if (!apiKey) {
          // Cache the key after first use
          try { apiKey = await getOpenAIKey(tenantId); } catch { /* fallback used */ }
        }
      }

      // Store snapshot
      await tenantPool.query(
        `INSERT INTO tracked_insight_snapshots
           (tracked_insight_id, metric_values, previous_values, change_summary, trend)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          insight.id,
          JSON.stringify(metricValues),
          prevSnapshot ? JSON.stringify(prevSnapshot.metric_values) : null,
          changeSummary,
          trend,
        ]
      );

      // Update the tracked insight's updated_at
      await tenantPool.query(
        `UPDATE tracked_insights SET updated_at = NOW() WHERE id = $1`,
        [insight.id]
      );

      evaluated++;
    } catch (err: any) {
      logError(
        `[TrackedEvaluator] Error evaluating "${insight.headline}": ${err.message}`
      );
      errors++;
    }
  }

  logInfo(
    `[TrackedEvaluator] Completed: ${evaluated} evaluated, ${errors} errors in ${Date.now() - startTime}ms`
  );

  return { evaluated, errors };
}

// ============================================================================
// Helpers
// ============================================================================

function extractMetricValues(
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

  // Multiple rows: create a summary
  const result: Record<string, any> = {
    _rowCount: rows.length,
  };
  if (keyFields && keyFields.length > 0) {
    for (const f of keyFields) {
      const values = rows.map((r) => r[f]).filter((v) => v != null);
      if (values.length > 0) {
        const numericValues = values.filter((v) => typeof v === "number" || !isNaN(parseFloat(v)));
        if (numericValues.length > 0) {
          const nums = numericValues.map((v) => parseFloat(v));
          result[`${f}_sum`] = nums.reduce((a, b) => a + b, 0);
          result[`${f}_avg`] = result[`${f}_sum`] / nums.length;
          result[`${f}_count`] = nums.length;
        } else {
          result[`${f}_count`] = values.length;
        }
      }
    }
  }
  return result;
}

function determineTrend(
  current: Record<string, any>,
  previous?: Record<string, any>
): "improving" | "worsening" | "stable" | "new" {
  if (!previous) return "new";

  const currentKeys = Object.keys(current).filter((k) => !k.startsWith("_"));
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
      significantChanges++;
      if (curVal > prevVal) positiveChanges++;
      else negativeChanges++;
    }
  }

  if (significantChanges === 0) return "stable";
  if (positiveChanges > negativeChanges) return "improving";
  if (negativeChanges > positiveChanges) return "worsening";
  return "stable";
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

async function generateChangeSummary(
  tenantId: string,
  headline: string,
  current: Record<string, any>,
  previous: Record<string, any>,
  trend: string,
  cachedApiKey: string | null
): Promise<string> {
  // Try LLM for nuanced summary; fall back to rule-based
  try {
    const apiKey = cachedApiKey || (await getOpenAIKey(tenantId));
    const messages: LLMMessage[] = [
      {
        role: "system",
        content:
          "Generate a single concise sentence summarizing how a tracked metric has changed. Be specific with numbers. Do not use markdown.",
      },
      {
        role: "user",
        content: `Insight: "${headline}"\nPrevious values: ${JSON.stringify(previous)}\nCurrent values: ${JSON.stringify(current)}\nTrend: ${trend}`,
      },
    ];
    return await callLLM(messages, apiKey, {
      temperature: 0.2,
      maxTokens: 150,
    });
  } catch {
    // Rule-based fallback
    const changes: string[] = [];
    for (const key of Object.keys(current).filter((k) => !k.startsWith("_"))) {
      const cur = parseFloat(current[key]);
      const prev = parseFloat(previous[key]);
      if (!isNaN(cur) && !isNaN(prev) && prev !== 0) {
        const pct = ((cur - prev) / prev * 100).toFixed(1);
        changes.push(`${key}: ${prev} → ${cur} (${parseFloat(pct) > 0 ? "+" : ""}${pct}%)`);
      }
    }
    return changes.length > 0
      ? `Changes: ${changes.join(", ")}`
      : "Metric values updated.";
  }
}
