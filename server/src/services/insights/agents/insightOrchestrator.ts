/**
 * Insight Generation Orchestrator
 *
 * Coordinates the agent-driven insight pipeline:
 *   1. Planner agent -> investigation questions
 *   2. Investigator agents (parallel) -> findings with evidence
 *   3. Evaluator agent -> categorized, ranked insights
 *   4. Persist to generated_insights (same schema as old pipeline)
 *   5. Re-evaluate tracked insights
 *
 * Writes to the same table as the legacy pipeline with
 * generation_method = 'agent' for parallel-run comparison.
 */

import pg from "pg";
import { v4 as uuidv4 } from "uuid";
import {
  getOpenAIKey,
  getSchemaContext,
  getMetricDefinitions,
  getKnowledgeContext,
} from "../../research/tools.js";
import {
  runInsightPlannerAgent,
  type InsightPlannerContext,
} from "./insightPlannerAgent.js";
import {
  runInsightInvestigator,
  type InsightFinding,
  type InvestigatorStep,
} from "./insightInvestigatorAgent.js";
import {
  runInsightEvaluator,
  type EvaluatedInsight,
} from "./insightEvaluatorAgent.js";
import { logInfo, logError, logWarn } from "../../logger.js";

// ============================================================================
// Types
// ============================================================================

export interface InsightGenerationResult {
  success: boolean;
  insightCount: number;
  generationBatch: string;
  durationMs: number;
  planSummary?: string;
  questionsCount?: number;
  findingsCount?: number;
  droppedCount?: number;
  error?: string;
}

export type OnProgress = (event: {
  phase: string;
  detail: string;
  timestamp: number;
}) => void;

// ============================================================================
// Constants
// ============================================================================

const MAX_CONCURRENT_INVESTIGATORS = 5;

// Per-tenant concurrency lock — prevents duplicate runs
const activeGenerations = new Map<string, { startedAt: number; batch: string }>();

export function isGenerationRunning(tenantId: string): { running: boolean; startedAt?: number; batch?: string } {
  const active = activeGenerations.get(tenantId);
  if (!active) return { running: false };
  // Auto-expire after 10 minutes as a safety valve
  if (Date.now() - active.startedAt > 10 * 60 * 1000) {
    activeGenerations.delete(tenantId);
    logWarn(`[InsightOrchestrator] Expired stale lock for tenant ${tenantId} (started ${Math.round((Date.now() - active.startedAt) / 1000)}s ago)`);
    return { running: false };
  }
  return { running: true, startedAt: active.startedAt, batch: active.batch };
}

// ============================================================================
// Orchestrator
// ============================================================================

export async function runInsightGeneration(
  tenantId: string,
  tenantPool: pg.Pool,
  onProgress?: OnProgress
): Promise<InsightGenerationResult> {
  // Concurrency guard — reject if already running for this tenant
  const existing = isGenerationRunning(tenantId);
  if (existing.running) {
    const elapsed = Math.round((Date.now() - existing.startedAt!) / 1000);
    logWarn(`[InsightOrchestrator] Rejected duplicate run for tenant ${tenantId} — already running for ${elapsed}s (batch: ${existing.batch})`);
    return {
      success: false,
      insightCount: 0,
      generationBatch: existing.batch!,
      durationMs: 0,
      error: `Generation already in progress (running for ${elapsed}s)`,
    };
  }

  const startTime = Date.now();
  const generationBatch = uuidv4();

  // Acquire lock
  activeGenerations.set(tenantId, { startedAt: startTime, batch: generationBatch });

  const emit = (phase: string, detail: string) => {
    logInfo(`[InsightOrchestrator] [${phase}] ${detail}`);
    onProgress?.({ phase, detail, timestamp: Date.now() });
  };

  try {
    emit("init", `Starting agent-driven insight generation for tenant ${tenantId}`);

    // Resolve API key
    const apiKey = await getOpenAIKey(tenantId);

    // Gather context
    emit("context", "Gathering schema, metrics, and tenant context...");
    const [schemaContext, metricDefinitions, knowledgeContext] = await Promise.all([
      getSchemaContext(tenantId),
      Promise.resolve(getMetricDefinitions()),
      getKnowledgeContext(tenantPool, tenantId, "mortgage pipeline performance and risk analysis"),
    ]);
    if (knowledgeContext) {
      emit("context", `Knowledge base context loaded (${knowledgeContext.length} chars)`);
    }

    // Fetch previous insight headlines (to avoid repetition)
    const previousHeadlines = await fetchPreviousHeadlines(tenantPool);

    // Fetch tracked insights (so planner knows what users care about)
    const trackedInsights = await fetchTrackedInsights(tenantPool);

    // Fetch field population stats summary
    const fieldPopStats = await fetchFieldPopulationSummary(tenantPool);

    // ----- Phase 1: Planning -----
    emit("planning", "Running insight planner agent...");
    const plannerContext: InsightPlannerContext = {
      schemaContext,
      metricDefinitions,
      fieldPopulationStats: fieldPopStats,
      previousInsightHeadlines: previousHeadlines,
      trackedInsights,
      knowledgeContext: knowledgeContext || undefined,
    };

    const plan = await runInsightPlannerAgent(apiKey, plannerContext);
    emit("planning", `Plan: "${plan.summary}" — ${plan.questions.length} questions`);

    // ----- Phase 2: Investigation (parallel batches) -----
    emit("investigating", `Running ${plan.questions.length} investigator agents...`);
    const allFindings: InsightFinding[] = [];
    const questions = plan.questions;

    for (let i = 0; i < questions.length; i += MAX_CONCURRENT_INVESTIGATORS) {
      const batch = questions.slice(i, i + MAX_CONCURRENT_INVESTIGATORS);
      const batchLabel = `batch ${Math.floor(i / MAX_CONCURRENT_INVESTIGATORS) + 1}`;

      emit("investigating", `Running ${batchLabel}: ${batch.map((q) => q.topic).join(", ")}`);

      const results = await Promise.allSettled(
        batch.map((question) =>
          runInsightInvestigator(
            question,
            schemaContext,
            metricDefinitions,
            tenantPool,
            apiKey,
            (step: InvestigatorStep) => {
              if (step.type === "finding") {
                emit("investigating", `Finding: ${step.content}`);
              }
            }
          )
        )
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          allFindings.push(result.value);
        } else {
          logWarn(`[InsightOrchestrator] Investigator failed: ${result.reason?.message}`);
        }
      }
    }

    emit("investigating", `Collected ${allFindings.length} findings from ${questions.length} questions`);

    if (allFindings.length === 0) {
      emit("complete", "No findings produced — skipping evaluation and persistence.");
      return {
        success: true,
        insightCount: 0,
        generationBatch,
        durationMs: Date.now() - startTime,
        planSummary: plan.summary,
        questionsCount: questions.length,
        findingsCount: 0,
        droppedCount: 0,
      };
    }

    // ----- Phase 3: Evaluation -----
    emit("evaluating", `Running evaluator on ${allFindings.length} findings...`);
    const evaluation = await runInsightEvaluator(allFindings, apiKey, previousHeadlines);

    emit(
      "evaluating",
      `Evaluator: ${evaluation.insights.length} insights kept, ${evaluation.dropped.length} dropped`
    );

    // ----- Phase 4: Persist -----
    if (evaluation.insights.length > 0) {
      emit("persisting", `Persisting ${evaluation.insights.length} insights...`);
      await persistAgentInsights(tenantPool, evaluation.insights, allFindings, generationBatch);
      emit("persisting", "Done.");
    }

    const duration = Date.now() - startTime;
    emit("complete", `Finished in ${Math.round(duration / 1000)}s — ${evaluation.insights.length} insights`);

    activeGenerations.delete(tenantId);
    return {
      success: true,
      insightCount: evaluation.insights.length,
      generationBatch,
      durationMs: duration,
      planSummary: plan.summary,
      questionsCount: questions.length,
      findingsCount: allFindings.length,
      droppedCount: evaluation.dropped.length,
    };
  } catch (err: any) {
    activeGenerations.delete(tenantId);
    logError(`[InsightOrchestrator] Failed: ${err.message}`, err);
    return {
      success: false,
      insightCount: 0,
      generationBatch,
      durationMs: Date.now() - startTime,
      error: err.message,
    };
  }
}

// ============================================================================
// Persistence — writes to the same generated_insights table
// ============================================================================

async function persistAgentInsights(
  tenantPool: pg.Pool,
  insights: EvaluatedInsight[],
  findings: InsightFinding[],
  generationBatch: string
): Promise<void> {
  // Check which columns exist
  let hasDetailDataCol = false;
  let hasGenerationMethodCol = false;
  try {
    const colCheck = await tenantPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'generated_insights'
        AND column_name IN ('detail_data', 'generation_method')
    `);
    for (const row of colCheck.rows) {
      if (row.column_name === "detail_data") hasDetailDataCol = true;
      if (row.column_name === "generation_method") hasGenerationMethodCol = true;
    }
  } catch { /* pre-migration tenant */ }

  // Delete previous agent-generated insights (don't touch pipeline insights)
  if (hasGenerationMethodCol) {
    await tenantPool.query(
      `DELETE FROM generated_insights WHERE generation_method = 'agent'`
    );
  }

  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const ins of insights) {
    const finding = findings[ins.findingIndex];

    // Build detail_data from finding evidence (simplified hydration)
    const detailData = finding
      ? buildDetailDataFromFinding(ins, finding)
      : null;

    const baseCount = 16; // 15 standard + generation_method
    const extraCount = hasDetailDataCol ? 1 : 0;
    const totalParams = baseCount + extraCount;
    const ph = Array.from({ length: totalParams }, () => `$${paramIdx++}`);
    placeholders.push(`(${ph.join(", ")})`);

    values.push(
      ins.bucket,                                    // bucket
      ins.priority,                                  // priority
      ins.headline,                                  // headline
      ins.understory,                                // understory
      ins.insight_type,                              // insight_type
      ins.source,                                    // source
      ins.severity_score,                            // severity_score
      JSON.stringify(ins.impact || {}),              // impact
      JSON.stringify(ins.evidence || {}),            // evidence
      false,                                         // for_podcast
      "ytd",                                         // date_filter (agent insights are timeframe-agnostic)
      null,                                          // channel_group
      generationBatch,                               // generation_batch
      new Date().toISOString(),                      // generated_at
      null,                                          // detail_query
      hasGenerationMethodCol ? "agent" : "pipeline", // generation_method
    );

    if (hasDetailDataCol) {
      values.push(detailData ? JSON.stringify(detailData) : null);
    }
  }

  let columnList = `bucket, priority, headline, understory, insight_type, source,
       severity_score, impact, evidence, for_podcast,
       date_filter, channel_group, generation_batch, generated_at, detail_query,
       generation_method`;
  if (hasDetailDataCol) columnList += `, detail_data`;
  const columns = `(${columnList})`;

  await tenantPool.query(
    `INSERT INTO generated_insights ${columns}
     VALUES ${placeholders.join(", ")}`,
    values
  );

  logInfo(
    `[InsightOrchestrator] Persisted ${insights.length} agent insights (batch: ${generationBatch})`
  );
}

// ============================================================================
// Detail data builder (simplified hydration from finding evidence)
// ============================================================================

function buildDetailDataFromFinding(
  insight: EvaluatedInsight,
  finding: InsightFinding
): any {
  return {
    type: "agent_finding",
    title: finding.title,
    summary: finding.summary,
    confidence: finding.confidence,
    keyMetrics: finding.keyMetrics || {},
    keyMetricDescriptions: finding.keyMetricDescriptions || {},
    suggestedBucket: finding.suggestedBucket,
    impactEstimate: finding.impactEstimate,
    metricSignature: finding.metricSignature,
    evidence: (finding.evidence || []).map((e) => ({
      sql: e.sql,
      explanation: e.explanation,
      rows: (e.rows || []).slice(0, 200),
      rowCount: e.rowCount,
      fields: e.fields,
    })),
  };
}

// ============================================================================
// Context fetchers
// ============================================================================

async function fetchPreviousHeadlines(tenantPool: pg.Pool): Promise<string[]> {
  try {
    const result = await tenantPool.query(
      `SELECT headline FROM generated_insights
       ORDER BY generated_at DESC LIMIT 30`
    );
    return result.rows.map((r: any) => r.headline);
  } catch {
    return [];
  }
}

async function fetchTrackedInsights(
  tenantPool: pg.Pool
): Promise<Array<{ headline: string; metric_signature: any }>> {
  try {
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'tracked_insights'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) return [];

    const result = await tenantPool.query(
      `SELECT headline, metric_signature FROM tracked_insights
       WHERE status = 'active'
       ORDER BY created_at DESC LIMIT 20`
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function fetchFieldPopulationSummary(tenantPool: pg.Pool): Promise<string> {
  try {
    // Quick population check on key fields
    const result = await tenantPool.query(`
      SELECT
        COUNT(*) as total_loans,
        ROUND(100.0 * COUNT(funding_date) / NULLIF(COUNT(*), 0), 1) as funding_date_pct,
        ROUND(100.0 * COUNT(closing_date) / NULLIF(COUNT(*), 0), 1) as closing_date_pct,
        ROUND(100.0 * COUNT(application_date) / NULLIF(COUNT(*), 0), 1) as app_date_pct,
        ROUND(100.0 * COUNT(lock_date) / NULLIF(COUNT(*), 0), 1) as lock_date_pct,
        ROUND(100.0 * COUNT(clear_to_close_date) / NULLIF(COUNT(*), 0), 1) as ctc_pct,
        ROUND(100.0 * COUNT(loan_officer) / NULLIF(COUNT(*), 0), 1) as lo_pct,
        ROUND(100.0 * COUNT(underwriter) / NULLIF(COUNT(*), 0), 1) as uw_pct,
        ROUND(100.0 * COUNT(rate_lock_buy_side_base_price_rate) / NULLIF(COUNT(*), 0), 1) as base_price_pct,
        ROUND(100.0 * COUNT(fico_score) / NULLIF(COUNT(*), 0), 1) as fico_pct
      FROM public.loans
    `);

    if (result.rows.length === 0) return "No loans in database.";

    const r = result.rows[0];
    const lines = [
      `Total loans: ${r.total_loans}`,
      `Key field populations:`,
      `  application_date: ${r.app_date_pct}%`,
      `  funding_date: ${r.funding_date_pct}%`,
      `  closing_date: ${r.closing_date_pct}%`,
      `  lock_date: ${r.lock_date_pct}%`,
      `  clear_to_close_date: ${r.ctc_pct}%`,
      `  loan_officer: ${r.lo_pct}%`,
      `  underwriter: ${r.uw_pct}%`,
      `  rate_lock_buy_side_base_price_rate: ${r.base_price_pct}%`,
      `  fico_score: ${r.fico_pct}%`,
    ];

    // Flag low-population fields
    const low: string[] = [];
    if (parseFloat(r.ctc_pct) < 30) low.push(`clear_to_close_date (${r.ctc_pct}%)`);
    if (parseFloat(r.uw_pct) < 30) low.push(`underwriter (${r.uw_pct}%)`);
    if (parseFloat(r.base_price_pct) < 30) low.push(`base_price_rate (${r.base_price_pct}%)`);
    if (parseFloat(r.fico_pct) < 30) low.push(`fico_score (${r.fico_pct}%)`);

    if (low.length > 0) {
      lines.push(`\nWARNING — Low population fields (< 30%): ${low.join(", ")}`);
      lines.push(`Avoid basing insights on these fields.`);
    }

    return lines.join("\n");
  } catch {
    return "Could not retrieve field population stats.";
  }
}
