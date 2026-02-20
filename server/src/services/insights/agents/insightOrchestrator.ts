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
import {
  insightLogStart,
  insightLog,
  insightLogWarn,
  insightLogError,
  insightLogEnd,
  getInsightLogPath,
} from "../insightLogger.js";
import {
  getMarketRateForDate,
  getMostRecentMarketRate,
  initializeMarketRateCache,
} from "../../dashboard/marketRateService.js";
import { getIndustryNews } from "../../newsService.js";

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
  onProgress?: OnProgress,
  options?: { forceFresh?: boolean }
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
  insightLogStart(tenantId, "ytd");
  insightLog(`[Agent] Starting agentic insight generation (batch: ${generationBatch}, tenant: ${tenantId})`);
  insightLog(`[Agent] Log file: ${getInsightLogPath()}`);

  // Acquire lock
  activeGenerations.set(tenantId, { startedAt: startTime, batch: generationBatch });

  const emit = (phase: string, detail: string) => {
    logInfo(`[InsightOrchestrator] [${phase}] ${detail}`);
    insightLog(`[Agent] [${phase}] ${detail}`);
    onProgress?.({ phase, detail, timestamp: Date.now() });
  };

  try {
    emit("init", `Starting agent-driven insight generation for tenant ${tenantId}${options?.forceFresh ? " (force-fresh — ignoring previous headlines)" : ""}`);

    // Resolve API key
    const apiKey = await getOpenAIKey(tenantId);

    // Gather context
    emit("context", "Gathering schema, metrics, and tenant context...");
    const [schemaContext, metricDefinitions, knowledgeContext, marketContext, industryNewsContext, staleLoanStats] = await Promise.all([
      getSchemaContext(tenantId),
      Promise.resolve(getMetricDefinitions()),
      getKnowledgeContext(tenantPool, tenantId, "mortgage pipeline performance and risk analysis"),
      fetchMarketContext(),
      fetchIndustryNewsContext(),
      fetchStaleLoanStats(tenantPool),
    ]);
    if (knowledgeContext) {
      emit("context", `Knowledge base context loaded (${knowledgeContext.length} chars)`);
    }
    if (marketContext) {
      emit("context", `Market rate context loaded (${marketContext.length} chars)`);
    }
    if (industryNewsContext) {
      emit("context", `Industry news context loaded (${industryNewsContext.length} chars)`);
    }

    const staleLoanContext = buildStaleLoanContext(staleLoanStats);
    if (staleLoanContext) {
      emit("context", `Stale loan context: ${staleLoanStats.staleCount}/${staleLoanStats.totalActive} (${staleLoanStats.stalePct.toFixed(1)}%)`);
    }

    // Fetch previous insight headlines (to avoid repetition) — skip when force-fresh
    const previousHeadlines = options?.forceFresh
      ? []
      : await fetchPreviousHeadlines(tenantPool);

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
      marketContext: marketContext || undefined,
      industryNewsContext: industryNewsContext || undefined,
      staleLoanContext: staleLoanContext || undefined,
    };

    const plan = await runInsightPlannerAgent(apiKey, plannerContext);
    plan.questions = augmentPlanQuestions(
      plan.questions,
      !!marketContext,
      !!industryNewsContext
    );
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
            },
            marketContext || undefined,
            industryNewsContext || undefined
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
    enforceCoverage(evaluation.insights, allFindings);

    emit(
      "evaluating",
      `Evaluator: ${evaluation.insights.length} insights kept, ${evaluation.dropped.length} dropped`
    );

    // ----- Phase 3b: Value scoring -----
    for (const ins of evaluation.insights) {
      const finding = allFindings[ins.findingIndex];
      if (finding) {
        ins.value_score = computeValueScore(ins, finding);
      } else {
        ins.value_score = ins.severity_score;
      }
    }
    // Re-sort insights by value_score descending within each bucket
    evaluation.insights.sort((a, b) => {
      const bucketOrder: Record<string, number> = { critical: 0, attention: 1, working: 2, context: 3 };
      const bucketDiff = (bucketOrder[a.bucket] ?? 4) - (bucketOrder[b.bucket] ?? 4);
      if (bucketDiff !== 0) return bucketDiff;
      return (b.value_score ?? b.severity_score) - (a.value_score ?? a.severity_score);
    });
    const bucketCounts = evaluation.insights.reduce<Record<string, number>>((acc, ins) => {
      acc[ins.bucket] = (acc[ins.bucket] || 0) + 1;
      return acc;
    }, {});
    emit("evaluating", `Bucket distribution: ${JSON.stringify(bucketCounts)}`);
    emit("evaluating", `Value scores computed (range: ${Math.min(...evaluation.insights.map(i => i.value_score ?? 0)).toFixed(2)} - ${Math.max(...evaluation.insights.map(i => i.value_score ?? 1)).toFixed(2)})`);

    // ----- Phase 4: Persist -----
    if (evaluation.insights.length > 0) {
      emit("persisting", `Persisting ${evaluation.insights.length} insights...`);
      await persistAgentInsights(tenantPool, evaluation.insights, allFindings, generationBatch);
      emit("persisting", "Done.");
    }

    const duration = Date.now() - startTime;
    emit("complete", `Finished in ${Math.round(duration / 1000)}s — ${evaluation.insights.length} insights`);
    insightLogEnd(
      `[Agent] Complete: ${evaluation.insights.length} insights persisted (batch: ${generationBatch}, durationMs: ${duration})`
    );

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
    insightLogError(`[Agent] Failed: ${err.message}`);
    insightLogEnd(`[Agent] Failed batch ${generationBatch}`);
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
  let hasValueScoreCol = false;
  try {
    const colCheck = await tenantPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'generated_insights'
        AND column_name IN ('detail_data', 'generation_method', 'value_score')
    `);
    for (const row of colCheck.rows) {
      if (row.column_name === "detail_data") hasDetailDataCol = true;
      if (row.column_name === "generation_method") hasGenerationMethodCol = true;
      if (row.column_name === "value_score") hasValueScoreCol = true;
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
    const extraCount = (hasDetailDataCol ? 1 : 0) + (hasValueScoreCol ? 1 : 0);
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
    if (hasValueScoreCol) {
      values.push(ins.value_score ?? ins.severity_score);
    }
  }

  let columnList = `bucket, priority, headline, understory, insight_type, source,
       severity_score, impact, evidence, for_podcast,
       date_filter, channel_group, generation_batch, generated_at, detail_query,
       generation_method`;
  if (hasDetailDataCol) columnList += `, detail_data`;
  if (hasValueScoreCol) columnList += `, value_score`;
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
    keyMetricFormats: finding.keyMetricFormats || {},
    suggestedBucket: finding.suggestedBucket,
    impactEstimate: finding.impactEstimate,
    metricSignature: finding.metricSignature,
    evidence: (finding.evidence || []).map((e) => ({
      sql: e.sql,
      explanation: e.explanation,
      rows: (e.rows || []).slice(0, 200),
      rowCount: e.rowCount,
      fields: e.fields,
      columnFormats: e.columnFormats || undefined,
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

async function fetchMarketContext(): Promise<string> {
  try {
    await initializeMarketRateCache();

    const currentRate = await getMostRecentMarketRate();
    if (currentRate === null) return "";

    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split("T")[0];

    const d30 = new Date(today);
    d30.setDate(d30.getDate() - 30);
    const d90 = new Date(today);
    d90.setDate(d90.getDate() - 90);
    const d365 = new Date(today);
    d365.setFullYear(d365.getFullYear() - 1);

    const [rate30, rate90, rate1y] = await Promise.all([
      getMarketRateForDate(fmt(d30)),
      getMarketRateForDate(fmt(d90)),
      getMarketRateForDate(fmt(d365)),
    ]);

    const lines: string[] = [
      `Current 30-Year Conforming Rate (OBMMIC30YF): ${currentRate.toFixed(3)}%`,
    ];

    if (rate30 !== null) {
      const delta30 = currentRate - rate30;
      const dir30 = delta30 > 0 ? "up" : delta30 < 0 ? "down" : "flat";
      lines.push(
        `30-day change: ${delta30 > 0 ? "+" : ""}${delta30.toFixed(3)}% (${dir30} from ${rate30.toFixed(3)}%)`
      );
    }
    if (rate90 !== null) {
      const delta90 = currentRate - rate90;
      const dir90 = delta90 > 0 ? "up" : delta90 < 0 ? "down" : "flat";
      lines.push(
        `90-day change: ${delta90 > 0 ? "+" : ""}${delta90.toFixed(3)}% (${dir90} from ${rate90.toFixed(3)}%)`
      );
    }
    if (rate1y !== null) {
      const deltaY = currentRate - rate1y;
      const dirY = deltaY > 0 ? "up" : deltaY < 0 ? "down" : "flat";
      lines.push(
        `Year-over-year change: ${deltaY > 0 ? "+" : ""}${deltaY.toFixed(3)}% (${dirY} from ${rate1y.toFixed(3)}%)`
      );
    }

    // Determine overall trend direction for pipeline impact
    if (rate30 !== null) {
      const delta30 = currentRate - rate30;
      if (delta30 > 0.05) {
        lines.push(
          "Pipeline impact: Rising rates increase withdrawal risk (borrowers may shop for better rates) and reduce refinance demand."
        );
      } else if (delta30 < -0.05) {
        lines.push(
          "Pipeline impact: Falling rates are generally favorable — may boost refi activity, but loans locked at higher rates may see borrower regret."
        );
      } else {
        lines.push("Pipeline impact: Rates are relatively stable over the last 30 days.");
      }
    }

    return lines.join("\n");
  } catch (err: any) {
    logWarn(`[InsightOrchestrator] Failed to fetch market context: ${err.message}`);
    return "";
  }
}

async function fetchStaleLoanStats(
  tenantPool: pg.Pool
): Promise<{ staleCount: number; totalActive: number; stalePct: number }> {
  try {
    const result = await tenantPool.query(`
      SELECT
        COUNT(*) FILTER (WHERE application_date < CURRENT_DATE - INTERVAL '180 days') AS stale_count,
        COUNT(*) AS total_active
      FROM public.loans
      WHERE current_loan_status = 'Active Loan' AND application_date IS NOT NULL
    `);
    const staleCount = parseInt(result.rows[0]?.stale_count) || 0;
    const totalActive = parseInt(result.rows[0]?.total_active) || 0;
    const stalePct = totalActive > 0 ? (staleCount / totalActive) * 100 : 0;
    return { staleCount, totalActive, stalePct };
  } catch {
    return { staleCount: 0, totalActive: 0, stalePct: 0 };
  }
}

function buildStaleLoanContext(stats: { staleCount: number; totalActive: number; stalePct: number }): string {
  if (stats.totalActive === 0) return "";
  if (stats.stalePct < 5) {
    return `STALE LOAN DATA: This tenant has virtually no stale loans (${stats.staleCount} of ${stats.totalActive} active loans are 6+ months old, ${stats.stalePct.toFixed(1)}%). Do NOT generate questions about stale/abandoned pipeline — there is nothing to find. Focus investigation budget on higher-value areas.`;
  }
  if (stats.stalePct >= 10) {
    return `STALE LOAN DATA: ${stats.staleCount} of ${stats.totalActive} active loans (${stats.stalePct.toFixed(1)}%) have application dates 6+ months old and are likely abandoned. This is a significant data quality issue worth investigating.`;
  }
  // 5-10%: moderate, mention but don't emphasize
  return `STALE LOAN DATA: ${stats.staleCount} of ${stats.totalActive} active loans (${stats.stalePct.toFixed(1)}%) are 6+ months old. Minor issue — include at most one question about this if other areas are covered.`;
}

// ============================================================================
// Value Score — post-evaluation business-impact adjustment
// ============================================================================

function isAbsenceInsight(insight: EvaluatedInsight): boolean {
  const text = `${insight.headline} ${insight.understory}`.toLowerCase();
  const absencePatterns = [
    /\bno\s+(stale|abandoned|expired|missing)\b/,
    /\b0\s+(stale|abandoned|expired|overdue)\b/,
    /\bzero\s+(stale|abandoned|expired|overdue)\b/,
    /\bnone\s+(found|detected|identified)\b/,
    /\bno\s+(issues?|problems?|concerns?)\s+(found|detected|identified)\b/,
    /\bdoes\s+not\s+(have|show|exhibit)\b/,
  ];
  return absencePatterns.some((p) => p.test(text));
}

function computeValueScore(
  insight: EvaluatedInsight,
  finding: InsightFinding
): number {
  let score = insight.severity_score;

  if (insight.impact?.estimated_dollars) {
    if (insight.impact.estimated_dollars > 1_000_000) score += 0.15;
    else if (insight.impact.estimated_dollars > 100_000) score += 0.10;
    else if (insight.impact.estimated_dollars > 10_000) score += 0.05;
  }

  if (finding.confidence === "high" && finding.evidence.length >= 2) score += 0.10;
  if (finding.confidence === "low") score -= 0.15;

  if (insight.impact?.units_affected && insight.impact.units_affected > 50) score += 0.05;

  if (isAbsenceInsight(insight)) score -= 0.20;

  return Math.min(1, Math.max(0, score));
}

function enforceCoverage(
  insights: EvaluatedInsight[],
  findings: InsightFinding[]
): void {
  const used = new Set(insights.map((i) => i.findingIndex));
  const hasWorking = insights.some((i) => i.bucket === "working");
  const hasMarketOrNews = insights.some((i) => isMarketOrNewsText(`${i.headline} ${i.understory}`));

  if (!hasWorking) {
    const idx = findings.findIndex(
      (f, i) =>
        !used.has(i) &&
        (f.suggestedBucket === "working" || isPositiveFindingText(`${f.title} ${f.summary}`))
    );
    if (idx >= 0) {
      insights.push(buildCoverageInsight(findings[idx], idx, "working"));
      used.add(idx);
    }
  }

  if (!hasMarketOrNews) {
    const idx = findings.findIndex(
      (f, i) => !used.has(i) && isMarketOrNewsText(`${f.title} ${f.summary}`)
    );
    if (idx >= 0) {
      const bucket =
        findings[idx].suggestedBucket === "critical" || findings[idx].suggestedBucket === "attention"
          ? findings[idx].suggestedBucket
          : "attention";
      insights.push(buildCoverageInsight(findings[idx], idx, bucket as any));
      used.add(idx);
    }
  }

  // Final fallback: if no "working" bucket exists after finding-based coverage,
  // repurpose the lowest-severity non-critical insight into working so UI always has
  // a strategic review lane populated.
  if (!insights.some((i) => i.bucket === "working") && insights.length > 0) {
    const candidate = [...insights]
      .filter((i) => i.bucket !== "critical")
      .sort((a, b) => (a.severity_score ?? 0.5) - (b.severity_score ?? 0.5))[0];
    if (candidate) {
      candidate.bucket = "working";
      candidate.priority = "BLUE";
      candidate.insight_type = "success";
      if (candidate.severity_score > 0.75) candidate.severity_score = 0.75;
    }
  }

  // Normalize a market/news source label when applicable so UI and filters can
  // reliably identify these insights.
  for (const ins of insights) {
    if (isMarketOrNewsText(`${ins.headline} ${ins.understory}`)) {
      ins.source = "market_news";
    }
  }
}

function buildCoverageInsight(
  finding: InsightFinding,
  findingIndex: number,
  bucket: "critical" | "attention" | "working" | "context"
): EvaluatedInsight {
  const priorityMap = {
    critical: "RED",
    attention: "YELLOW",
    working: "BLUE",
    context: "GRAY",
  } as const;
  const typeMap = {
    critical: "critical",
    attention: "warning",
    working: "success",
    context: "info",
  } as const;
  const baseSeverity = bucket === "critical" ? 0.85 : bucket === "attention" ? 0.7 : bucket === "working" ? 0.6 : 0.45;

  return {
    headline: finding.title,
    understory: finding.summary,
    bucket,
    priority: priorityMap[bucket],
    insight_type: typeMap[bucket],
    severity_score: baseSeverity,
    source: finding.metricSignature?.keyFields?.[0] || "agent_coverage",
    impact: {
      type: finding.impactEstimate?.type || (bucket === "working" ? "performance" : "operational"),
      estimated_dollars: finding.impactEstimate?.estimated_dollars,
      units_affected: finding.impactEstimate?.units_affected,
    },
    evidence: {
      metrics: Object.entries(finding.keyMetrics || {}).map(([label, value]) => ({ label, value })),
      evidenceQueries: (finding.evidence || []).map((e) => ({
        sql: e.sql,
        explanation: e.explanation,
        rowCount: e.rowCount,
      })),
    },
    metricSignature: finding.metricSignature,
    confidence: finding.confidence || "medium",
    findingIndex,
  };
}

function isMarketOrNewsText(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "market",
    "rate",
    "obmmi",
    "obmmic30yf",
    "news",
    "mortgage bankers association",
    "mba",
    "fannie",
    "freddie",
    "cfpb",
    "fhfa",
    "regulatory",
  ].some((k) => normalized.includes(k));
}

function isPositiveFindingText(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "improv",
    "increase",
    "strong",
    "faster",
    "shorter",
    "outperform",
    "gain",
    "opportunity",
    "better",
    "up ",
  ].some((k) => normalized.includes(k));
}

async function fetchIndustryNewsContext(): Promise<string> {
  try {
    const news = await getIndustryNews();
    const headlines = (news.newsFeed || [])
      .filter((source) => (source.items || []).length > 0)
      .slice(0, 5)
      .map((source) => {
        const topItems = (source.items || []).slice(0, 2).map((i) => i.title).filter(Boolean);
        return topItems.map((title) => `- ${source.source}: ${title}`).join("\n");
      })
      .filter(Boolean);

    if (headlines.length === 0) return "";

    return [
      "Recent mortgage industry headlines:",
      headlines.join("\n"),
      "Use these headlines only as external context. Validate impact using tenant loan data before concluding.",
    ].join("\n");
  } catch (err: any) {
    logWarn(`[InsightOrchestrator] Failed to fetch industry news context: ${err.message}`);
    return "";
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

function augmentPlanQuestions(
  questions: Array<{
    id: number;
    topic: string;
    hypothesis: string;
    approach: string;
    priority: "high" | "medium" | "low";
    category: string;
  }>,
  hasMarketContext: boolean,
  hasIndustryNewsContext: boolean
) {
  const out = [...questions];
  const text = out.map((q) => `${q.topic} ${q.hypothesis} ${q.category}`.toLowerCase()).join(" ");
  const hasMarketQuestion = /market|rate|lock|obmmi|obmmic30yf|refi|withdraw/.test(text);
  const hasPositiveQuestion = /improv|best|strong|faster|shorter|outperform|what's working|whats working/.test(text);

  if (hasMarketContext && !hasMarketQuestion) {
    out.push({
      id: out.length + 1,
      topic: "Market-rate sensitivity in active pipeline",
      hypothesis: "Recent mortgage rate movement is affecting withdrawal behavior, lock outcomes, or product mix.",
      approach:
        "Compare rolling 30/90 day trends in withdrawals, lock expirations, and purchase vs refinance mix; correlate with lock_rate and rate_lock_buy_side_base_price_rate where populated.",
      priority: "high",
      category: "market_rate_sensitivity",
    });
  }

  if (hasIndustryNewsContext && !hasMarketQuestion) {
    out.push({
      id: out.length + 1,
      topic: "External news impact on pipeline behavior",
      hypothesis: "Recent industry headlines may be reflected in measurable shifts in applications, conversion, or cycle-time distribution.",
      approach:
        "Check recent 30/90 day movement in applications, funded units, pull-through, and cycle time by channel and loan type; identify statistically meaningful directional shifts.",
      priority: "medium",
      category: "industry_news_correlation",
    });
  }

  if (!hasPositiveQuestion) {
    out.push({
      id: out.length + 1,
      topic: "What's working: strongest improving performance segment",
      hypothesis: "At least one branch, LO cohort, or product segment is materially improving and should be surfaced as a positive strategic signal.",
      approach:
        "Identify top improvements over prior comparable period (90D vs prior 90D) across pull-through, cycle time, funded volume, and fallout; rank by magnitude and significance.",
      priority: "high",
      category: "positive_performance",
    });
  }

  return out.map((q, i) => ({ ...q, id: i + 1 }));
}
