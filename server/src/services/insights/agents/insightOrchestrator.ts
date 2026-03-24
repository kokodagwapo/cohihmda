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
import {
  FUNCTIONAL_CATEGORIES,
  type CategoryDefinition,
} from "./categoryDefinitions.js";
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
  categoryResults?: Array<{
    categoryId: string;
    insightCount: number;
    questionsCount: number;
    findingsCount: number;
    error?: string;
  }>;
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

// Per-tenant:bucket lock for generate-more — allows different buckets in parallel
const activeBucketGenerations = new Map<string, { startedAt: number; batch: string }>();

const VALID_BUCKETS = ["critical", "attention", "working", "context"] as const;

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
    const [schemaContext, metricDefinitions, marketContext, industryNewsContext, staleLoanStats] = await Promise.all([
      getSchemaContext(tenantId),
      Promise.resolve(getMetricDefinitions()),
      fetchMarketContext(),
      fetchIndustryNewsContext(),
      fetchStaleLoanStats(tenantPool),
    ]);
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

    // Build shared planner base context (used by every category's planner)
    // Note: knowledgeContext is fetched per-category inside the loop using category.knowledgeTopic
    const basePlannerContext = {
      schemaContext,
      metricDefinitions,
      fieldPopulationStats: fieldPopStats,
      previousInsightHeadlines: previousHeadlines,
      trackedInsights,
      marketContext: marketContext || undefined,
      industryNewsContext: industryNewsContext || undefined,
      staleLoanContext: staleLoanContext || undefined,
    };

    // ----- Phase 1-3: Per-category pipelines -----
    // Run categories sequentially to stay within LLM rate limits.
    // Each category runs its own Planner -> Investigators -> Evaluator.
    const allEvaluatedInsights: EvaluatedInsight[] = [];
    const allFindingsGlobal: InsightFinding[] = [];
    const categoryResults: InsightGenerationResult["categoryResults"] = [];
    let totalQuestionsCount = 0;
    let totalDroppedCount = 0;
    let planSummaries: string[] = [];

    for (const category of FUNCTIONAL_CATEGORIES) {
      emit(`planning:${category.id}`, `Running ${category.label} planner...`);

      let catQuestions = 0;
      let catFindings = 0;
      let catError: string | undefined;

      try {
        // Fetch category-specific knowledge context using the category's targeted RAG topic
        const categoryKnowledgeContext = await getKnowledgeContext(tenantPool, tenantId, category.knowledgeTopic);
        if (categoryKnowledgeContext) {
          emit(`planning:${category.id}`, `KB context loaded for ${category.label} (${categoryKnowledgeContext.length} chars)`);
        }

        // Phase 1: Category-scoped planning
        const plannerContext: InsightPlannerContext = {
          ...basePlannerContext,
          knowledgeContext: categoryKnowledgeContext || undefined,
          categoryFocus: category,
        };

        const plan = await runInsightPlannerAgent(apiKey, plannerContext);
        const questions = plan.questions.slice(0, category.questionCount.max);
        catQuestions = questions.length;
        totalQuestionsCount += questions.length;
        planSummaries.push(`[${category.label}] ${plan.summary}`);
        emit(`planning:${category.id}`, `${category.label} plan: ${questions.length} questions`);

        // Phase 2: Category-scoped investigation
        emit(`investigating:${category.id}`, `Running ${questions.length} ${category.label} investigators...`);
        const categoryFindings: InsightFinding[] = [];
        const findingIndexOffset = allFindingsGlobal.length;

        for (let i = 0; i < questions.length; i += MAX_CONCURRENT_INVESTIGATORS) {
          const batch = questions.slice(i, i + MAX_CONCURRENT_INVESTIGATORS);
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
                    emit(`investigating:${category.id}`, `Finding: ${step.content}`);
                  }
                },
                marketContext || undefined,
                industryNewsContext || undefined,
                categoryKnowledgeContext || undefined
              )
            )
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              categoryFindings.push(result.value);
            } else {
              logWarn(`[InsightOrchestrator] [${category.label}] Investigator failed: ${result.reason?.message}`);
            }
          }
        }

        catFindings = categoryFindings.length;
        allFindingsGlobal.push(...categoryFindings);

        if (categoryFindings.length === 0) {
          emit(`evaluating:${category.id}`, `No findings for ${category.label} — skipping evaluation.`);
          categoryResults.push({ categoryId: category.id, insightCount: 0, questionsCount: catQuestions, findingsCount: 0 });
          continue;
        }

        // Phase 3: Category-scoped evaluation
        // Re-index findings so findingIndex in EvaluatedInsight maps correctly into allFindingsGlobal
        emit(`evaluating:${category.id}`, `Evaluating ${categoryFindings.length} ${category.label} findings...`);
        const evaluation = await runInsightEvaluator(
          categoryFindings,
          apiKey,
          previousHeadlines,
          {
            functionalCategory: category.id,
            categorySupplement: category.evaluatorSupplement,
            knowledgeContext: categoryKnowledgeContext || undefined,
          }
        );

        // Remap findingIndex to global offset so persistence can retrieve original findings
        const remappedInsights = evaluation.insights.map((ins) => ({
          ...ins,
          findingIndex: ins.findingIndex + findingIndexOffset,
        }));

        // Value scoring
        for (const ins of remappedInsights) {
          const finding = allFindingsGlobal[ins.findingIndex];
          ins.value_score = finding ? computeValueScore(ins, finding) : ins.severity_score;
        }

        totalDroppedCount += evaluation.dropped.length;
        allEvaluatedInsights.push(...remappedInsights);

        const catBucketCounts = remappedInsights.reduce<Record<string, number>>((acc, ins) => {
          acc[ins.bucket] = (acc[ins.bucket] || 0) + 1;
          return acc;
        }, {});
        const funcCatCheck = remappedInsights.every(i => i.functional_category === category.id);
        emit(
          `evaluating:${category.id}`,
          `${category.label}: ${remappedInsights.length} insights kept (${JSON.stringify(catBucketCounts)}), ${evaluation.dropped.length} dropped; functional_category tagged=${funcCatCheck ? "✓" : "✗ MISSING"}`
        );

        categoryResults.push({
          categoryId: category.id,
          insightCount: remappedInsights.length,
          questionsCount: catQuestions,
          findingsCount: catFindings,
        });
      } catch (catErr: any) {
        catError = catErr.message;
        logWarn(`[InsightOrchestrator] [${category.label}] Pipeline failed: ${catErr.message}`);
        categoryResults.push({ categoryId: category.id, insightCount: 0, questionsCount: catQuestions, findingsCount: catFindings, error: catError });
      }
    }

    if (allEvaluatedInsights.length === 0) {
      emit("complete", "No insights produced across all categories.");
      return {
        success: true,
        insightCount: 0,
        generationBatch,
        durationMs: Date.now() - startTime,
        planSummary: planSummaries.join(" | "),
        questionsCount: totalQuestionsCount,
        findingsCount: allFindingsGlobal.length,
        droppedCount: totalDroppedCount,
        categoryResults,
      };
    }

    // ----- Phase 3b: Global sort by bucket + value_score -----
    allEvaluatedInsights.sort((a, b) => {
      const bucketOrder: Record<string, number> = { critical: 0, attention: 1, working: 2, context: 3 };
      const bucketDiff = (bucketOrder[a.bucket] ?? 4) - (bucketOrder[b.bucket] ?? 4);
      if (bucketDiff !== 0) return bucketDiff;
      return (b.value_score ?? b.severity_score) - (a.value_score ?? a.severity_score);
    });

    const bucketCounts = allEvaluatedInsights.reduce<Record<string, number>>((acc, ins) => {
      acc[ins.bucket] = (acc[ins.bucket] || 0) + 1;
      return acc;
    }, {});
    emit("evaluating", `Total insight distribution: ${JSON.stringify(bucketCounts)}`);
    emit("evaluating", `Value scores computed (range: ${Math.min(...allEvaluatedInsights.map(i => i.value_score ?? 0)).toFixed(2)} - ${Math.max(...allEvaluatedInsights.map(i => i.value_score ?? 1)).toFixed(2)})`);

    // ----- Phase 4: Persist -----
    emit("persisting", `Persisting ${allEvaluatedInsights.length} insights across ${FUNCTIONAL_CATEGORIES.length} categories...`);
    await persistAgentInsights(tenantPool, allEvaluatedInsights, allFindingsGlobal, generationBatch);
    emit("persisting", "Done.");

    const duration = Date.now() - startTime;
    emit("complete", `Finished in ${Math.round(duration / 1000)}s — ${allEvaluatedInsights.length} insights across ${FUNCTIONAL_CATEGORIES.length} categories`);
    insightLogEnd(
      `[Agent] Complete: ${allEvaluatedInsights.length} insights persisted (batch: ${generationBatch}, durationMs: ${duration})`
    );

    activeGenerations.delete(tenantId);
    return {
      success: true,
      insightCount: allEvaluatedInsights.length,
      generationBatch,
      durationMs: duration,
      planSummary: planSummaries.join(" | "),
      questionsCount: totalQuestionsCount,
      findingsCount: allFindingsGlobal.length,
      droppedCount: totalDroppedCount,
      categoryResults,
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
// Generate more for a single bucket (append-only, bucket-focused)
// ============================================================================

export function isBucketGenerationRunning(
  tenantId: string,
  bucket: string
): { running: boolean; startedAt?: number; batch?: string } {
  const key = `${tenantId}:${bucket}`;
  const active = activeBucketGenerations.get(key);
  if (!active) return { running: false };
  if (Date.now() - active.startedAt > 10 * 60 * 1000) {
    activeBucketGenerations.delete(key);
    return { running: false };
  }
  return { running: true, startedAt: active.startedAt, batch: active.batch };
}

export async function generateMoreForBucketAgent(
  tenantId: string,
  tenantPool: pg.Pool,
  targetBucket: string,
  onProgress?: OnProgress
): Promise<InsightGenerationResult> {
  if (!VALID_BUCKETS.includes(targetBucket as (typeof VALID_BUCKETS)[number])) {
    return {
      success: false,
      insightCount: 0,
      generationBatch: "",
      durationMs: 0,
      error: `Invalid bucket: ${targetBucket}`,
    };
  }

  const lockKey = `${tenantId}:${targetBucket}`;
  const existing = activeBucketGenerations.get(lockKey);
  if (existing) {
    const elapsed = Math.round((Date.now() - existing.startedAt) / 1000);
    return {
      success: false,
      insightCount: 0,
      generationBatch: existing.batch,
      durationMs: 0,
      error: `Generate-more for "${targetBucket}" already in progress (${elapsed}s)`,
    };
  }

  const startTime = Date.now();
  const generationBatch = uuidv4();
  activeBucketGenerations.set(lockKey, { startedAt: startTime, batch: generationBatch });

  const emit = (phase: string, detail: string) => {
    logInfo(`[InsightOrchestrator] [generate-more:${targetBucket}] [${phase}] ${detail}`);
    onProgress?.({ phase, detail, timestamp: Date.now() });
  };

  try {
    emit("init", `Generate more for bucket "${targetBucket}" (tenant: ${tenantId})`);

    const apiKey = await getOpenAIKey(tenantId);

    emit("context", "Gathering context...");
    const [schemaContext, metricDefinitions, knowledgeContext, marketContext, industryNewsContext, staleLoanStats] =
      await Promise.all([
        getSchemaContext(tenantId),
        Promise.resolve(getMetricDefinitions()),
        getKnowledgeContext(tenantPool, tenantId, "mortgage pipeline performance and risk analysis"),
        fetchMarketContext(),
        fetchIndustryNewsContext(),
        fetchStaleLoanStats(tenantPool),
      ]);

    const staleLoanContext = buildStaleLoanContext(staleLoanStats);
    const previousHeadlines = await fetchPreviousHeadlines(tenantPool);
    const trackedInsights = await fetchTrackedInsights(tenantPool);
    const fieldPopStats = await fetchFieldPopulationSummary(tenantPool);

    emit("planning", `Running planner focused on "${targetBucket}"...`);
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
      bucketFocus: targetBucket,
    };

    const plan = await runInsightPlannerAgent(apiKey, plannerContext);
    plan.questions = augmentPlanQuestions(
      plan.questions,
      !!marketContext,
      !!industryNewsContext
    );
    // Keep at most 6 questions for generate-more to limit cost/time
    const questions = plan.questions.slice(0, 6);
    emit("planning", `Plan: ${plan.summary} — ${questions.length} questions`);

    emit("investigating", `Running ${questions.length} investigators...`);
    const allFindings: InsightFinding[] = [];
    for (let i = 0; i < questions.length; i += MAX_CONCURRENT_INVESTIGATORS) {
      const batch = questions.slice(i, i + MAX_CONCURRENT_INVESTIGATORS);
      const results = await Promise.allSettled(
        batch.map((question) =>
          runInsightInvestigator(
            question,
            schemaContext,
            metricDefinitions,
            tenantPool,
            apiKey,
            () => {},
            marketContext || undefined,
            industryNewsContext || undefined,
            knowledgeContext || undefined
          )
        )
      );
      for (const result of results) {
        if (result.status === "fulfilled") allFindings.push(result.value);
      }
    }

    emit("investigating", `Collected ${allFindings.length} findings`);

    if (allFindings.length === 0) {
      activeBucketGenerations.delete(lockKey);
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

    emit("evaluating", "Running evaluator...");
    const evaluation = await runInsightEvaluator(allFindings, apiKey, previousHeadlines);
    const forBucket = evaluation.insights.filter((ins) => ins.bucket === targetBucket);

    for (const ins of forBucket) {
      const finding = allFindings[ins.findingIndex];
      ins.value_score = finding ? computeValueScore(ins, finding) : ins.severity_score;
    }
    forBucket.sort((a, b) => (b.value_score ?? b.severity_score) - (a.value_score ?? a.severity_score));

    const existingHeadlines = new Set(
      (await tenantPool.query(`SELECT headline FROM generated_insights`)).rows.map(
        (r: { headline: string }) => r.headline.toLowerCase()
      )
    );
    const newInsights = forBucket.filter((ins) => !existingHeadlines.has(ins.headline.toLowerCase()));

    if (newInsights.length > 0) {
      emit("persisting", `Appending ${newInsights.length} new insights for "${targetBucket}"...`);
      await appendAgentInsights(tenantPool, newInsights, allFindings, generationBatch);
    } else {
      emit("persisting", "No new unique insights after dedup — nothing to append.");
    }

    activeBucketGenerations.delete(lockKey);
    const duration = Date.now() - startTime;
    emit("complete", `Done in ${Math.round(duration / 1000)}s — ${newInsights.length} new insights appended`);

    return {
      success: true,
      insightCount: newInsights.length,
      generationBatch,
      durationMs: duration,
      planSummary: plan.summary,
      questionsCount: questions.length,
      findingsCount: allFindings.length,
      droppedCount: evaluation.dropped.length,
    };
  } catch (err: any) {
    activeBucketGenerations.delete(lockKey);
    logError(`[InsightOrchestrator] Generate-more for ${targetBucket} failed: ${err.message}`, err);
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
// Per-category refresh — replaces insights for a single functional category
// ============================================================================

// Per-tenant:category concurrency lock
const activeCategoryGenerations = new Map<string, { startedAt: number; batch: string }>();

export function isCategoryGenerationRunning(
  tenantId: string,
  categoryId: string
): { running: boolean; startedAt?: number; batch?: string } {
  const key = `${tenantId}:cat:${categoryId}`;
  const active = activeCategoryGenerations.get(key);
  if (!active) return { running: false };
  if (Date.now() - active.startedAt > 15 * 60 * 1000) {
    activeCategoryGenerations.delete(key);
    return { running: false };
  }
  return { running: true, startedAt: active.startedAt, batch: active.batch };
}

export async function generateInsightsForCategory(
  tenantId: string,
  tenantPool: pg.Pool,
  categoryId: string,
  onProgress?: OnProgress
): Promise<InsightGenerationResult> {
  const category = FUNCTIONAL_CATEGORIES.find((c) => c.id === categoryId);
  if (!category) {
    return {
      success: false,
      insightCount: 0,
      generationBatch: "",
      durationMs: 0,
      error: `Unknown category: ${categoryId}`,
    };
  }

  const lockKey = `${tenantId}:cat:${categoryId}`;
  const existing = activeCategoryGenerations.get(lockKey);
  if (existing) {
    const elapsed = Math.round((Date.now() - existing.startedAt) / 1000);
    return {
      success: false,
      insightCount: 0,
      generationBatch: existing.batch,
      durationMs: 0,
      error: `Generation for "${category.label}" already in progress (${elapsed}s)`,
    };
  }

  const startTime = Date.now();
  const generationBatch = uuidv4();
  activeCategoryGenerations.set(lockKey, { startedAt: startTime, batch: generationBatch });

  const emit = (phase: string, detail: string) => {
    logInfo(`[InsightOrchestrator] [category:${categoryId}] [${phase}] ${detail}`);
    onProgress?.({ phase, detail, timestamp: Date.now() });
  };

  try {
    emit("init", `Refreshing ${category.label} insights for tenant ${tenantId}`);

    const apiKey = await getOpenAIKey(tenantId);

    emit("context", "Gathering context...");
    const [schemaContext, metricDefinitions, categoryKnowledgeContext, marketContext, industryNewsContext, staleLoanStats] =
      await Promise.all([
        getSchemaContext(tenantId),
        Promise.resolve(getMetricDefinitions()),
        getKnowledgeContext(tenantPool, tenantId, category.knowledgeTopic),
        fetchMarketContext(),
        fetchIndustryNewsContext(),
        fetchStaleLoanStats(tenantPool),
      ]);

    if (categoryKnowledgeContext) {
      emit("context", `KB context loaded for ${category.label} (${categoryKnowledgeContext.length} chars)`);
    }

    const staleLoanContext = buildStaleLoanContext(staleLoanStats);
    const previousHeadlines = await fetchPreviousHeadlines(tenantPool);
    const trackedInsights = await fetchTrackedInsights(tenantPool);
    const fieldPopStats = await fetchFieldPopulationSummary(tenantPool);

    emit("planning", `Running ${category.label} planner...`);
    const plannerContext: InsightPlannerContext = {
      schemaContext,
      metricDefinitions,
      fieldPopulationStats: fieldPopStats,
      previousInsightHeadlines: previousHeadlines,
      trackedInsights,
      knowledgeContext: categoryKnowledgeContext || undefined,
      marketContext: marketContext || undefined,
      industryNewsContext: industryNewsContext || undefined,
      staleLoanContext: staleLoanContext || undefined,
      categoryFocus: category,
    };

    const plan = await runInsightPlannerAgent(apiKey, plannerContext);
    const questions = plan.questions.slice(0, category.questionCount.max);
    emit("planning", `Plan: ${plan.summary} — ${questions.length} questions`);

    emit("investigating", `Running ${questions.length} investigators...`);
    const allFindings: InsightFinding[] = [];
    for (let i = 0; i < questions.length; i += MAX_CONCURRENT_INVESTIGATORS) {
      const batch = questions.slice(i, i + MAX_CONCURRENT_INVESTIGATORS);
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
            industryNewsContext || undefined,
            categoryKnowledgeContext || undefined
          )
        )
      );
      for (const result of results) {
        if (result.status === "fulfilled") allFindings.push(result.value);
        else logWarn(`[InsightOrchestrator] [${category.label}] Investigator failed: ${(result as any).reason?.message}`);
      }
    }

    emit("investigating", `Collected ${allFindings.length} findings`);

    if (allFindings.length === 0) {
      activeCategoryGenerations.delete(lockKey);
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

    emit("evaluating", `Evaluating ${allFindings.length} findings...`);
    const evaluation = await runInsightEvaluator(allFindings, apiKey, previousHeadlines, {
      functionalCategory: category.id,
      categorySupplement: category.evaluatorSupplement,
      knowledgeContext: categoryKnowledgeContext || undefined,
    });

    for (const ins of evaluation.insights) {
      const finding = allFindings[ins.findingIndex];
      ins.value_score = finding ? computeValueScore(ins, finding) : ins.severity_score;
    }
    evaluation.insights.sort((a, b) => {
      const bucketOrder: Record<string, number> = { critical: 0, attention: 1, working: 2, context: 3 };
      const bd = (bucketOrder[a.bucket] ?? 4) - (bucketOrder[b.bucket] ?? 4);
      if (bd !== 0) return bd;
      return (b.value_score ?? b.severity_score) - (a.value_score ?? a.severity_score);
    });

    // Replace only this category's rows — leave other categories untouched
    emit("persisting", `Replacing ${category.label} insights (${evaluation.insights.length} new)...`);
    await tenantPool.query(
      `DELETE FROM generated_insights WHERE generation_method = 'agent' AND functional_category = $1`,
      [category.id]
    );
    if (evaluation.insights.length > 0) {
      await appendAgentInsights(tenantPool, evaluation.insights, allFindings, generationBatch);
    }

    activeCategoryGenerations.delete(lockKey);
    const duration = Date.now() - startTime;
    emit("complete", `Done in ${Math.round(duration / 1000)}s — ${evaluation.insights.length} ${category.label} insights`);

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
    activeCategoryGenerations.delete(lockKey);
    logError(`[InsightOrchestrator] Category refresh for ${categoryId} failed: ${err.message}`, err);
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
  // Check which columns exist (and auto-migrate functional_category if missing)
  let hasDetailDataCol = false;
  let hasGenerationMethodCol = false;
  let hasValueScoreCol = false;
  let hasFunctionalCategoryCol = false;
  try {
    const colCheck = await tenantPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'generated_insights'
        AND column_name IN ('detail_data', 'generation_method', 'value_score', 'functional_category')
    `);
    for (const row of colCheck.rows) {
      if (row.column_name === "detail_data") hasDetailDataCol = true;
      if (row.column_name === "generation_method") hasGenerationMethodCol = true;
      if (row.column_name === "value_score") hasValueScoreCol = true;
      if (row.column_name === "functional_category") hasFunctionalCategoryCol = true;
    }
    // Auto-migrate: create functional_category column if migration hasn't been applied yet
    if (!hasFunctionalCategoryCol) {
      try {
        await tenantPool.query(`
          ALTER TABLE generated_insights
            ADD COLUMN IF NOT EXISTS functional_category TEXT
        `);
        await tenantPool.query(`
          CREATE INDEX IF NOT EXISTS idx_generated_insights_category
            ON generated_insights(functional_category)
        `);
        hasFunctionalCategoryCol = true;
        logInfo("[InsightOrchestrator] Auto-migrated: added functional_category column to generated_insights");
      } catch (migErr: any) {
        logWarn(`[InsightOrchestrator] Could not auto-migrate functional_category column: ${migErr.message}`);
      }
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
    const extraCount =
      (hasDetailDataCol ? 1 : 0) +
      (hasValueScoreCol ? 1 : 0) +
      (hasFunctionalCategoryCol ? 1 : 0);
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
    if (hasFunctionalCategoryCol) {
      values.push(ins.functional_category ?? null);
    }
  }

  let columnList = `bucket, priority, headline, understory, insight_type, source,
       severity_score, impact, evidence, for_podcast,
       date_filter, channel_group, generation_batch, generated_at, detail_query,
       generation_method`;
  if (hasDetailDataCol) columnList += `, detail_data`;
  if (hasValueScoreCol) columnList += `, value_score`;
  if (hasFunctionalCategoryCol) columnList += `, functional_category`;
  const columns = `(${columnList})`;

  // Diagnostic: log a sample of what's being persisted to confirm functional_category
  const categorySample = insights.slice(0, 3).map(
    (i) => `"${(i.headline || "").slice(0, 30)}" → ${JSON.stringify(i.functional_category)}`
  ).join("; ");
  logInfo(`[InsightOrchestrator] persistAgentInsights: hasFuncCat=${hasFunctionalCategoryCol}, total=${insights.length}, sample=[${categorySample}]`);

  await tenantPool.query(
    `INSERT INTO generated_insights ${columns}
     VALUES ${placeholders.join(", ")}`,
    values
  );

  logInfo(
    `[InsightOrchestrator] Persisted ${insights.length} agent insights (batch: ${generationBatch})`
  );
}

/** Append agent insights without deleting existing ones. Used by generate-more per bucket. */
async function appendAgentInsights(
  tenantPool: pg.Pool,
  insights: EvaluatedInsight[],
  findings: InsightFinding[],
  generationBatch: string
): Promise<void> {
  if (insights.length === 0) return;

  let hasDetailDataCol = false;
  let hasGenerationMethodCol = false;
  let hasValueScoreCol = false;
  let hasFunctionalCategoryCol = false;
  try {
    const colCheck = await tenantPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'generated_insights'
        AND column_name IN ('detail_data', 'generation_method', 'value_score', 'functional_category')
    `);
    for (const row of colCheck.rows) {
      if (row.column_name === "detail_data") hasDetailDataCol = true;
      if (row.column_name === "generation_method") hasGenerationMethodCol = true;
      if (row.column_name === "value_score") hasValueScoreCol = true;
      if (row.column_name === "functional_category") hasFunctionalCategoryCol = true;
    }
    // Auto-migrate: create functional_category column if migration hasn't been applied yet
    if (!hasFunctionalCategoryCol) {
      try {
        await tenantPool.query(`
          ALTER TABLE generated_insights
            ADD COLUMN IF NOT EXISTS functional_category TEXT
        `);
        await tenantPool.query(`
          CREATE INDEX IF NOT EXISTS idx_generated_insights_category
            ON generated_insights(functional_category)
        `);
        hasFunctionalCategoryCol = true;
        logInfo("[InsightOrchestrator] Auto-migrated (append): added functional_category column to generated_insights");
      } catch (migErr: any) {
        logWarn(`[InsightOrchestrator] Could not auto-migrate functional_category column (append): ${migErr.message}`);
      }
    }
  } catch { /* pre-migration tenant */ }

  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const ins of insights) {
    const finding = findings[ins.findingIndex];
    const detailData = finding
      ? buildDetailDataFromFinding(ins, finding)
      : null;

    const baseCount = 16;
    const extraCount =
      (hasDetailDataCol ? 1 : 0) +
      (hasValueScoreCol ? 1 : 0) +
      (hasFunctionalCategoryCol ? 1 : 0);
    const totalParams = baseCount + extraCount;
    const ph = Array.from({ length: totalParams }, () => `$${paramIdx++}`);
    placeholders.push(`(${ph.join(", ")})`);

    values.push(
      ins.bucket,
      ins.priority,
      ins.headline,
      ins.understory,
      ins.insight_type,
      ins.source,
      ins.severity_score,
      JSON.stringify(ins.impact || {}),
      JSON.stringify(ins.evidence || {}),
      false,
      "ytd",
      null,
      generationBatch,
      new Date().toISOString(),
      null,
      hasGenerationMethodCol ? "agent" : "pipeline",
    );

    if (hasDetailDataCol) {
      values.push(detailData ? JSON.stringify(detailData) : null);
    }
    if (hasValueScoreCol) {
      values.push(ins.value_score ?? ins.severity_score);
    }
    if (hasFunctionalCategoryCol) {
      values.push(ins.functional_category ?? null);
    }
  }

  let columnList = `bucket, priority, headline, understory, insight_type, source,
       severity_score, impact, evidence, for_podcast,
       date_filter, channel_group, generation_batch, generated_at, detail_query,
       generation_method`;
  if (hasDetailDataCol) columnList += `, detail_data`;
  if (hasValueScoreCol) columnList += `, value_score`;
  if (hasFunctionalCategoryCol) columnList += `, functional_category`;
  const columns = `(${columnList})`;

  await tenantPool.query(
    `INSERT INTO generated_insights ${columns}
     VALUES ${placeholders.join(", ")}`,
    values
  );

  logInfo(
    `[InsightOrchestrator] Appended ${insights.length} agent insights (batch: ${generationBatch})`
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
