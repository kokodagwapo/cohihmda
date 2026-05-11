/**
 * My Insights — per-user agentic insight generation (independent from tenant-wide orchestrator).
 */

import pg from "pg";
import { v4 as uuidv4 } from "uuid";
import {
  getOpenAIKey,
  getSchemaContext,
  getMetricDefinitions,
  getKnowledgeContext,
} from "../../research/tools.js";
import { runInsightPlannerAgent, type InsightPlannerContext } from "./insightPlannerAgent.js";
import { runInsightInvestigator, type InsightFinding } from "./insightInvestigatorAgent.js";
import { runInsightEvaluator, type EvaluatedInsight } from "./insightEvaluatorAgent.js";
import { logInfo, logWarn, logError } from "../../logger.js";
import {
  insightLogStart,
  insightLog,
  insightLogEnd,
  getInsightLogPath,
} from "../insightLogger.js";
import {
  verifyDataQualityForInsights,
  finalizeAgentDetailData,
  computeValueScore,
  fetchMarketContext,
  fetchIndustryNewsContext,
  fetchStaleLoanStats,
  buildStaleLoanContext,
  fetchFieldPopulationSummary,
} from "./insightOrchestrator.js";
import { getTenantRevenueExpression } from "../../../utils/scorecard-utils.js";
import { buildUnderstoryBullets } from "../understoryBullets.js";
import { getUserLoanAccessFilter } from "../../userLoanAccessService.js";
import {
  ACTIVITY_STALE_DAYS,
  computeAndPersistUserInterestProfile,
  passesMyInsightsLoginRecencyGate,
  shouldSkipGenerationForUnchangedProfile,
  updateLastGenerationMeta,
} from "../userInterestProfileService.js";
import { runUserCustomPromptLlm, specifiersToSummary } from "./userInsightCustomPrompt.js";
import { buildProfileRelevanceRationales } from "./userInsightProfileRelevance.js";

const MAX_CONCURRENT_INVESTIGATORS = 5;
/** Planner questions for user-specific insights only (tenant-wide pipeline uses a larger budget elsewhere). */
const MAX_PLANNER_QUESTIONS_USER = 6;
/** Max behavior-origin insights persisted per user after ranking/DQ (custom prompts are separate). */
const USER_BEHAVIOR_INSIGHT_CAP = 5;

const activeUserGenerations = new Map<string, { startedAt: number; batch: string }>();

export function isUserInsightGenerationRunning(
  tenantId: string,
  userId: string
): { running: boolean; batch?: string } {
  const key = `${tenantId}:${userId}`;
  const active = activeUserGenerations.get(key);
  if (!active) return { running: false };
  if (Date.now() - active.startedAt > 15 * 60 * 1000) {
    activeUserGenerations.delete(key);
    return { running: false };
  }
  return { running: true, batch: active.batch };
}

export interface UserInsightGenerationResult {
  success: boolean;
  userId: string;
  insightCount: number;
  generationBatch: string;
  durationMs: number;
  skipped?: string;
  error?: string;
}

async function fetchUserPreviousHeadlines(
  tenantPool: pg.Pool,
  userId: string
): Promise<string[]> {
  try {
    const r = await tenantPool.query(
      `SELECT headline FROM public.user_generated_insights
       WHERE user_id = $1
       ORDER BY generated_at DESC LIMIT 30`,
      [userId]
    );
    return r.rows.map((x: any) => x.headline);
  } catch {
    return [];
  }
}

async function persistUserInsights(
  tenantPool: pg.Pool,
  userId: string,
  insights: EvaluatedInsight[],
  findings: InsightFinding[],
  generationBatch: string,
  options: {
    insightOrigin: "behavior" | "custom_prompt";
    /** When length matches insights, maps each row to a prompt id (custom prompts). */
    userInsightPromptIds?: (string | null)[];
    /** Per insight: why this matches the user's profile (My Insights behavior path). */
    profileRelevance?: (string | null | undefined)[];
  }
): Promise<void> {
  if (insights.length === 0) return;

  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (let idx = 0; idx < insights.length; idx++) {
    const ins = insights[idx];
    const finding = findings[ins.findingIndex];

    let detailData: any = null;
    if (options.insightOrigin === "custom_prompt") {
      detailData = {
        type: "custom_prompt",
        title: ins.headline,
        summary: { overview: ins.understory },
        rows: [],
        displayConfig: { columns: [], summaryMetrics: [] },
      };
    } else if (finding) {
      detailData = await finalizeAgentDetailData(tenantPool, ins, finding);
    }

    const evidenceWithEtm = {
      ...(ins.evidence || {}),
      ...(ins.what_changed ? { what_changed: ins.what_changed } : {}),
      ...(ins.why ? { why: ins.why } : {}),
      ...(ins.business_impact ? { business_impact: ins.business_impact } : {}),
      ...(ins.risk_if_ignored ? { risk_if_ignored: ins.risk_if_ignored } : {}),
      ...(ins.recommended_action ? { recommended_action: ins.recommended_action } : {}),
      ...(ins.owner ? { owner: ins.owner } : {}),
    };

    const understorySource =
      detailData?.type === "agent_finding" && typeof detailData?.summary === "string" && detailData.summary.trim()
        ? detailData.summary
        : ins.understory;
    const bullets = await buildUnderstoryBullets(understorySource, {
      headline: ins.headline,
      sourceLabel:
        detailData?.type === "agent_finding" && detailData?.summary?.trim() ? "summary" : "understory",
    });

    const promptId =
      options.userInsightPromptIds && options.userInsightPromptIds[idx] !== undefined
        ? options.userInsightPromptIds[idx]
        : null;

    const rawPr = options.profileRelevance?.[idx];
    const profileRelevance =
      rawPr != null && String(rawPr).trim() ? String(rawPr).trim().slice(0, 2000) : null;

    const ph = Array.from({ length: 24 }, () => `$${paramIdx++}`);
    placeholders.push(`(${ph.join(", ")})`);

    values.push(
      userId,
      ins.bucket,
      ins.priority,
      ins.headline,
      ins.understory,
      ins.insight_type,
      ins.source,
      ins.severity_score,
      JSON.stringify(ins.impact || {}),
      JSON.stringify(evidenceWithEtm),
      false,
      "ytd",
      null,
      generationBatch,
      new Date().toISOString(),
      null,
      "user_agent",
      detailData ? JSON.stringify(detailData) : null,
      ins.value_score ?? ins.severity_score,
      ins.functional_category ?? null,
      JSON.stringify(bullets),
      options.insightOrigin,
      promptId,
      profileRelevance
    );
  }

  const columnList = `user_id, bucket, priority, headline, understory, insight_type, source,
       severity_score, impact, evidence, for_podcast,
       date_filter, channel_group, generation_batch, generated_at, detail_query,
       generation_method, detail_data, value_score, functional_category, understory_bullets,
       insight_origin, user_insight_prompt_id, profile_relevance`;

  await tenantPool.query(
    `INSERT INTO public.user_generated_insights (${columnList})
     VALUES ${placeholders.join(", ")}`,
    values
  );

  logInfo(`[UserInsightOrchestrator] Persisted ${insights.length} rows (${options.insightOrigin}) for user ${userId}`);
}

async function deleteUserInsightsByOrigin(
  tenantPool: pg.Pool,
  userId: string,
  origin: "behavior" | "custom_prompt"
): Promise<void> {
  await tenantPool.query(
    `DELETE FROM public.user_generated_insights WHERE user_id = $1 AND insight_origin = $2`,
    [userId, origin]
  );
}

export async function runUserInsightGeneration(
  tenantId: string,
  tenantPool: pg.Pool,
  userId: string,
  options?: {
    forceFresh?: boolean;
    skipProfileUnchanged?: boolean;
    /** User explicitly requested refresh — bypass “profile unchanged since last generation” only; users without a tenant login in the past 7 days are still skipped. */
    manualRefresh?: boolean;
  }
): Promise<UserInsightGenerationResult> {
  const lockKey = `${tenantId}:${userId}`;
  const existing = activeUserGenerations.get(lockKey);
  if (existing) {
    return {
      success: false,
      userId,
      insightCount: 0,
      generationBatch: existing.batch,
      durationMs: 0,
      error: "User insight generation already in progress",
    };
  }

  const generationBatch = uuidv4();
  const start = Date.now();
  activeUserGenerations.set(lockKey, { startedAt: start, batch: generationBatch });

  try {
    insightLogStart(tenantId, "ytd");
    insightLog(`[UserInsights] Starting batch ${generationBatch} user=${userId}`);

    const profile = await computeAndPersistUserInterestProfile(tenantId, tenantPool, userId);

    if (!(await passesMyInsightsLoginRecencyGate(tenantPool, userId))) {
      insightLog(
        `[UserInsights] Skip user ${userId} — no tenant login in past ${ACTIVITY_STALE_DAYS} days`
      );
      activeUserGenerations.delete(lockKey);
      return {
        success: true,
        userId,
        insightCount: 0,
        generationBatch,
        durationMs: Date.now() - start,
        skipped: "inactive",
      };
    }

    const skipForUnchangedProfile =
      !options?.manualRefresh &&
      options?.skipProfileUnchanged !== false &&
      !options?.forceFresh;

    if (
      skipForUnchangedProfile &&
      (await shouldSkipGenerationForUnchangedProfile(tenantPool, userId, profile.contentHash))
    ) {
      insightLog(`[UserInsights] Skip user ${userId} — profile unchanged since last generation`);
      activeUserGenerations.delete(lockKey);
      return {
        success: true,
        userId,
        insightCount: 0,
        generationBatch,
        durationMs: Date.now() - start,
        skipped: "profile_unchanged",
      };
    }

    const apiKey = await getOpenAIKey(tenantId);

    const [
      schemaContext,
      metricDefinitions,
      marketContext,
      industryNewsContext,
      staleLoanStats,
      revenueFormula,
      fieldPopStats,
      knowledgeContext,
    ] = await Promise.all([
      getSchemaContext(tenantId),
      Promise.resolve(getMetricDefinitions()),
      fetchMarketContext(),
      fetchIndustryNewsContext(),
      fetchStaleLoanStats(tenantPool),
      getTenantRevenueExpression(tenantPool).catch(() => undefined),
      fetchFieldPopulationSummary(tenantPool),
      getKnowledgeContext(
        tenantPool,
        tenantId,
        "mortgage pipeline operations velocity cycle time throughput SLA milestones"
      ),
    ]);

    const staleLoanContext = buildStaleLoanContext(staleLoanStats);
    const previousHeadlines = options?.forceFresh
      ? []
      : await fetchUserPreviousHeadlines(tenantPool, userId);

    const plannerContext: InsightPlannerContext = {
      schemaContext,
      metricDefinitions,
      fieldPopulationStats: fieldPopStats,
      previousInsightHeadlines: previousHeadlines,
      knowledgeContext: knowledgeContext || undefined,
      marketContext: marketContext || undefined,
      industryNewsContext: industryNewsContext || undefined,
      staleLoanContext: staleLoanContext || undefined,
      userInterestProfile: profile.profileText,
    };

    const plan = await runInsightPlannerAgent(apiKey, plannerContext);
    const questions = plan.questions.slice(0, MAX_PLANNER_QUESTIONS_USER);

    const accessFilter = await getUserLoanAccessFilter(userId, tenantPool);

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
            undefined,
            marketContext || undefined,
            industryNewsContext || undefined,
            knowledgeContext || undefined,
            revenueFormula || undefined,
            accessFilter,
            tenantId
          )
        )
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          allFindings.push(result.value);
        } else {
          logWarn(`[UserInsightOrchestrator] Investigator failed: ${result.reason?.message}`);
        }
      }
    }

    if (allFindings.length === 0) {
      await deleteUserInsightsByOrigin(tenantPool, userId, "behavior");
      await updateLastGenerationMeta(tenantPool, userId, profile.contentHash);
      insightLogEnd(`[UserInsights] No findings user=${userId}`);
      activeUserGenerations.delete(lockKey);
      return {
        success: true,
        userId,
        insightCount: 0,
        generationBatch,
        durationMs: Date.now() - start,
      };
    }

    let evaluation = await runInsightEvaluator(allFindings, apiKey, previousHeadlines, {
      knowledgeContext: knowledgeContext || undefined,
    });

    for (const ins of evaluation.insights) {
      const finding = allFindings[ins.findingIndex];
      ins.value_score = finding ? computeValueScore(ins, finding) : ins.severity_score;
    }

    evaluation.insights.sort((a, b) => {
      const order: Record<string, number> = { critical: 0, attention: 1, working: 2, context: 3 };
      const d = (order[a.bucket] ?? 4) - (order[b.bucket] ?? 4);
      if (d !== 0) return d;
      return (b.value_score ?? b.severity_score) - (a.value_score ?? a.severity_score);
    });

    const rankedForUser = evaluation.insights.slice(0, USER_BEHAVIOR_INSIGHT_CAP);
    const verified = await verifyDataQualityForInsights(tenantPool, rankedForUser, allFindings);

    let profileRelevance: string[] = [];
    if (verified.length > 0) {
      profileRelevance = await buildProfileRelevanceRationales(
        apiKey,
        profile.profileText,
        verified.map((v) => ({
          headline: v.headline,
          source: v.source,
          bucket: v.bucket,
        }))
      );
      const filled = profileRelevance.filter((s) => s.length > 0).length;
      logInfo(
        `[UserInsights] Profile relevance user=${userId} batch=${generationBatch.slice(0, 8)}… ${filled}/${verified.length} non-empty`
      );
    }

    await deleteUserInsightsByOrigin(tenantPool, userId, "behavior");
    await persistUserInsights(tenantPool, userId, verified, allFindings, generationBatch, {
      insightOrigin: "behavior",
      userInsightPromptIds: undefined,
      profileRelevance,
    });

    await runBatchCustomPrompts(tenantId, tenantPool, userId, apiKey, generationBatch);

    await updateLastGenerationMeta(tenantPool, userId, profile.contentHash);

    insightLogEnd(`[UserInsights] Complete user=${userId} count=${verified.length}`);
    activeUserGenerations.delete(lockKey);

    return {
      success: true,
      userId,
      insightCount: verified.length,
      generationBatch,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    activeUserGenerations.delete(lockKey);
    logError(`[UserInsightOrchestrator] Failed user ${userId}: ${err.message}`, err);
    insightLogEnd(`[UserInsights] Failed user=${userId}`);
    return {
      success: false,
      userId,
      insightCount: 0,
      generationBatch,
      durationMs: Date.now() - start,
      error: err.message,
    };
  }
}

async function runBatchCustomPrompts(
  tenantId: string,
  tenantPool: pg.Pool,
  userId: string,
  apiKey: string,
  generationBatch: string
): Promise<void> {
  let rows: { id: string; title: string; prompt_text: string; specifiers: any }[] = [];
  try {
    const r = await tenantPool.query(
      `SELECT id, title, prompt_text, specifiers
       FROM public.user_insight_prompts
       WHERE user_id = $1 AND enabled = true AND schedule = 'batch' AND scope = 'user'`,
      [userId]
    );
    rows = r.rows;
  } catch {
    return;
  }

  await deleteUserInsightsByOrigin(tenantPool, userId, "custom_prompt");

  const synthetic: InsightFinding[] = [];
  const evaluated: EvaluatedInsight[] = [];
  const promptIds: (string | null)[] = [];

  for (const row of rows) {
    try {
      const specifiers = (row.specifiers && typeof row.specifiers === "object" ? row.specifiers : {}) as Record<
        string,
        unknown
      >;
      const summary = specifiersToSummary(specifiers);
      const ev = await runUserCustomPromptLlm(apiKey, row.title, row.prompt_text, summary);
      if (!ev) continue;
      evaluated.push(ev);
      promptIds.push(row.id);
      synthetic.push({
        questionId: 0,
        title: row.title,
        summary: ev.understory,
        confidence: "medium",
        evidence: [],
        keyMetrics: {},
      });
    } catch (e: any) {
      logWarn(`[UserInsightOrchestrator] Custom prompt ${row.id} failed: ${e.message}`);
    }
  }

  if (evaluated.length === 0) return;

  for (let i = 0; i < evaluated.length; i++) {
    evaluated[i].findingIndex = i;
  }

  await persistUserInsights(tenantPool, userId, evaluated, synthetic, generationBatch, {
    insightOrigin: "custom_prompt",
    userInsightPromptIds: promptIds,
  });
}

/**
 * Post-sync or super-admin bulk refresh: all active users in tenant.
 * @param options.adminRefresh When true, runs generation even if profile hash unchanged (still skips if no tenant login in past 7 days).
 */
export async function runMyInsightsForTenant(
  tenantId: string,
  tenantPool: pg.Pool,
  options?: { forceFresh?: boolean; adminRefresh?: boolean }
): Promise<{ usersProcessed: number; errors: number; insightsTotal: number }> {
  let usersProcessed = 0;
  let errors = 0;
  let insightsTotal = 0;

  let userRows: { id: string }[] = [];
  try {
    const r = await tenantPool.query(`SELECT id FROM public.users WHERE is_active = true`);
    userRows = r.rows;
  } catch (e: any) {
    logError(`[UserInsightOrchestrator] Failed to list users: ${e.message}`);
    return { usersProcessed: 0, errors: 1, insightsTotal: 0 };
  }

  for (const u of userRows) {
    try {
      const res = await runUserInsightGeneration(tenantId, tenantPool, u.id, {
        forceFresh: options?.forceFresh,
        skipProfileUnchanged: options?.adminRefresh ? false : true,
      });
      if (res.success && !res.skipped) {
        usersProcessed++;
        insightsTotal += res.insightCount;
      } else if (res.success && res.skipped) {
        usersProcessed++;
      } else {
        errors++;
      }
    } catch (e: any) {
      errors++;
      logWarn(`[UserInsightOrchestrator] user loop ${u.id}: ${e.message}`);
    }
  }

  logInfo(
    `[UserInsightOrchestrator] Tenant ${tenantId} complete: processed=${usersProcessed} errors=${errors} insights=${insightsTotal}`
  );
  return { usersProcessed, errors, insightsTotal };
}
