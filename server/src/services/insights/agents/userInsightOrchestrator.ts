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
import { runInsightPlannerAgent, type InsightPlannerContext, type InvestigationQuestion } from "./insightPlannerAgent.js";
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
  type FinalizeAgentDetailDataOptions,
} from "./insightOrchestrator.js";
import { getTenantRevenueExpression } from "../../../utils/scorecard-utils.js";
import { buildUnderstoryBullets } from "../understoryBullets.js";
import { getUserLoanAccessFilter, COHEUS_FULL_LOAN_ACCESS_ROLES } from "../../userLoanAccessService.js";
import { pool as managementPool } from "../../../config/managementDatabase.js";
import {
  ACTIVITY_STALE_DAYS,
  computeAndPersistUserInterestProfile,
  loadPersistedUserInterestProfilePayload,
  passesMyInsightsLoginRecencyGate,
  shouldSkipGenerationForUnchangedProfile,
  updateLastGenerationMeta,
} from "../userInterestProfileService.js";
import { specifiersToSummary } from "./userInsightCustomPrompt.js";
import { buildProfileRelevanceRationales } from "./userInsightProfileRelevance.js";
import { runUserCustomPromptEvaluator } from "./userInsightCustomPromptEvaluator.js";
import {
  buildSpecifierPredicateSql,
  composeAccessAndSpecifierFilters,
} from "../userInsightSpecifierPredicate.js";
import { getColumnsForTenant } from "../../ai/schemaContextService.js";
import { isSqlEvidenceItem } from "../../research/agents/dataAnalystAgent.js";

const MAX_CONCURRENT_INVESTIGATORS = 5;
/** Base planner question cap for My Insights; grows when user custom prompts need coverage. */
const MAX_PLANNER_QUESTIONS_USER_BASE = 6;
const MAX_PLANNER_QUESTIONS_USER_ABS_CAP = 14;
/** Max behavior-origin insights persisted per user after ranking/DQ (custom prompts are separate). */
const USER_BEHAVIOR_INSIGHT_CAP = 5;

const activeUserGenerations = new Map<string, { startedAt: number; batch: string }>();

async function loadUserCustomPromptsForPlanner(
  tenantPool: pg.Pool,
  userId: string
): Promise<{ id: string; title: string; prompt_text: string }[]> {
  try {
    const r = await tenantPool.query(
      `SELECT id::text, title, prompt_text
       FROM public.user_insight_prompts
       WHERE user_id = $1::uuid AND enabled = true AND scope = 'user'
         AND schedule IN ('batch', 'on_demand')
       ORDER BY updated_at DESC
       LIMIT 24`,
      [userId]
    );
    return r.rows.map((x: any) => ({
      id: String(x.id || "").trim(),
      title: String(x.title || "").trim(),
      prompt_text: String(x.prompt_text || "").trim(),
    }));
  } catch {
    return [];
  }
}

function stubCustomPromptEvaluatedInsight(title: string, reason: string): EvaluatedInsight {
  return {
    headline: `Custom insight: ${title}`,
    understory: reason,
    bucket: "attention",
    priority: "YELLOW",
    insight_type: "warning",
    severity_score: 0.45,
    value_score: 0.45,
    source: "operations",
    impact: { type: "custom_prompt_stub" },
    evidence: { metrics: [] },
    confidence: "low",
    findingIndex: 0,
    for_podcast: false,
  };
}

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
    /** Per-index options for headline SQL validation (custom_prompt + agent findings). */
    finalizeDetailPerIndex?: (FinalizeAgentDetailDataOptions | undefined)[];
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
    const finOpts = options.finalizeDetailPerIndex?.[idx];
    const hasSqlEvidence =
      finding &&
      Array.isArray(finding.evidence) &&
      finding.evidence.some((e) => isSqlEvidenceItem(e) && typeof (e as { sql?: string }).sql === "string");

    if (options.insightOrigin === "custom_prompt") {
      if (finding && hasSqlEvidence) {
        detailData = await finalizeAgentDetailData(tenantPool, ins, finding, finOpts);
      } else {
        detailData = {
          type: "custom_prompt",
          title: ins.headline,
          summary: { overview: ins.understory },
          rows: [],
          displayConfig: { columns: [], summaryMetrics: [] },
        };
      }
    } else if (finding) {
      detailData = await finalizeAgentDetailData(tenantPool, ins, finding, finOpts);
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
    /** Use saved `user_interest_profiles` row only (no recompute). Requires an existing profile row. */
    insightsOnly?: boolean;
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

    let profile: Awaited<ReturnType<typeof computeAndPersistUserInterestProfile>>;
    if (options?.insightsOnly) {
      const loaded = await loadPersistedUserInterestProfilePayload(tenantPool, userId);
      if (!loaded?.contentHash) {
        activeUserGenerations.delete(lockKey);
        return {
          success: false,
          userId,
          insightCount: 0,
          generationBatch,
          durationMs: Date.now() - start,
          error: "No saved interest profile. Regenerate your user profile first.",
        };
      }
      profile = loaded;
    } else {
      profile = await computeAndPersistUserInterestProfile(tenantId, tenantPool, userId);
    }

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
      !options?.insightsOnly &&
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

    const userCustomPrompts = await loadUserCustomPromptsForPlanner(tenantPool, userId);
    const plannerQuestionCap = Math.min(
      MAX_PLANNER_QUESTIONS_USER_ABS_CAP,
      Math.max(
        MAX_PLANNER_QUESTIONS_USER_BASE,
        MAX_PLANNER_QUESTIONS_USER_BASE + userCustomPrompts.length
      )
    );

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
      userCustomPrompts: userCustomPrompts.length ? userCustomPrompts : undefined,
    };

    const plan = await runInsightPlannerAgent(apiKey, plannerContext);
    const questions = plan.questions.slice(0, plannerQuestionCap);

    const accessFilter = await getUserLoanAccessFilter(userId, tenantPool);

    const taggedQs = questions.filter((q) => Boolean(q.userInsightPromptId?.trim()));
    const untaggedQs = questions.filter((q) => !q.userInsightPromptId?.trim());
    const budgetUntagged = Math.max(0, plannerQuestionCap - taggedQs.length);
    const behaviorQuestions = untaggedQs.slice(0, budgetUntagged);

    const allFindings: InsightFinding[] = [];
    for (let i = 0; i < behaviorQuestions.length; i += MAX_CONCURRENT_INVESTIGATORS) {
      const batch = behaviorQuestions.slice(i, i + MAX_CONCURRENT_INVESTIGATORS);
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

    await deleteUserInsightsByOrigin(tenantPool, userId, "behavior");

    let verified: EvaluatedInsight[] = [];
    if (allFindings.length > 0) {
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
      verified = await verifyDataQualityForInsights(tenantPool, rankedForUser, allFindings);

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

      await persistUserInsights(tenantPool, userId, verified, allFindings, generationBatch, {
        insightOrigin: "behavior",
        userInsightPromptIds: undefined,
        profileRelevance,
      });
    } else {
      insightLog(`[UserInsights] No behavior findings user=${userId}`);
    }

    await runDataBackedBatchCustomPrompts(tenantId, tenantPool, userId, apiKey, generationBatch, {
      schemaContext,
      metricDefinitions,
      marketContext: marketContext || undefined,
      industryNewsContext: industryNewsContext || undefined,
      knowledgeContext: knowledgeContext || undefined,
      revenueFormula: revenueFormula || undefined,
      accessFilter,
      taggedQuestions: taggedQs,
    });

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

async function runDataBackedBatchCustomPrompts(
  tenantId: string,
  tenantPool: pg.Pool,
  userId: string,
  apiKey: string,
  generationBatch: string,
  ctx: {
    schemaContext: string;
    metricDefinitions: string;
    marketContext?: string;
    industryNewsContext?: string;
    knowledgeContext?: string;
    revenueFormula?: string;
    accessFilter: Awaited<ReturnType<typeof getUserLoanAccessFilter>>;
    taggedQuestions: InvestigationQuestion[];
  }
): Promise<void> {
  let rows: { id: string; title: string; prompt_text: string; specifiers: unknown }[] = [];
  try {
    const r = await tenantPool.query(
      `SELECT id::text, title, prompt_text, specifiers
       FROM public.user_insight_prompts
       WHERE user_id = $1::uuid AND enabled = true AND schedule = 'batch' AND scope = 'user'`,
      [userId]
    );
    rows = r.rows as { id: string; title: string; prompt_text: string; specifiers: unknown }[];
  } catch {
    return;
  }

  await deleteUserInsightsByOrigin(tenantPool, userId, "custom_prompt");
  if (rows.length === 0) return;

  const cols = await getColumnsForTenant(tenantId);
  const allowedColumns = new Set(cols.map((c) => c.name));

  const synthetic: InsightFinding[] = [];
  const evaluated: EvaluatedInsight[] = [];
  const promptIds: (string | null)[] = [];
  const finalizeOpts: (FinalizeAgentDetailDataOptions | undefined)[] = [];

  const tagById = new Map(
    ctx.taggedQuestions.map((q) => [String(q.userInsightPromptId || "").trim(), q] as const)
  );

  for (const row of rows) {
    const pid = String(row.id || "").trim();
    try {
      const question: InvestigationQuestion =
        tagById.get(pid) ??
        ({
          id: 1,
          topic: `Custom prompt — ${row.title}`,
          hypothesis:
            "Produce SQL-backed evidence that answers this saved user question; cohort filters from specifiers are enforced server-side.",
          approach: `Use public.loans l. Address: ${String(row.prompt_text || "").slice(0, 1200)}`,
          priority: "high",
          category: "my_insights_custom_prompt",
          userInsightPromptId: pid,
        } as InvestigationQuestion);

      const specifiers = (row.specifiers && typeof row.specifiers === "object" ? row.specifiers : {}) as Record<
        string,
        unknown
      >;
      const predRes = buildSpecifierPredicateSql(specifiers, allowedColumns);
      const cohortSummary = specifiersToSummary(specifiers);
      const mandatoryCohortMarkdown = [
        cohortSummary || null,
        predRes.ok
          ? "Server injects specifier cohort predicates (AND) on every SELECT against `public.loans l`, together with loan access rules."
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      if (predRes.ok === false) {
        const stub = stubCustomPromptEvaluatedInsight(
          row.title,
          `This prompt has invalid specifier column name(s): ${predRes.invalidKeys.join(
            ", "
          )}. Only loans-table columns from your tenant schema may be used. Edit the specifiers and try again.`
        );
        evaluated.push(stub);
        promptIds.push(pid);
        synthetic.push({
          questionId: question.id ?? 0,
          title: row.title,
          summary: stub.understory,
          confidence: "low",
          evidence: [],
          keyMetrics: {},
        });
        finalizeOpts.push(undefined);
        continue;
      }

      const composed = composeAccessAndSpecifierFilters(ctx.accessFilter, predRes.filter);
      const finalizeOpt: FinalizeAgentDetailDataOptions = {
        tenantId,
        accessFilter: composed ?? undefined,
        metricComposeAccessFilter: composed ?? undefined,
      };

      let finding: InsightFinding;
      try {
        finding = await runInsightInvestigator(
          question,
          ctx.schemaContext,
          ctx.metricDefinitions,
          tenantPool,
          apiKey,
          undefined,
          ctx.marketContext,
          ctx.industryNewsContext,
          ctx.knowledgeContext,
          ctx.revenueFormula,
          composed,
          tenantId,
          mandatoryCohortMarkdown
        );
      } catch (e: any) {
        logWarn(`[UserInsightOrchestrator] Custom prompt investigator ${pid}: ${e.message}`);
        const stub = stubCustomPromptEvaluatedInsight(
          row.title,
          `Investigation failed for this prompt: ${e.message || "unknown error"}.`
        );
        evaluated.push(stub);
        promptIds.push(pid);
        synthetic.push({
          questionId: question.id ?? 0,
          title: row.title,
          summary: stub.understory,
          confidence: "low",
          evidence: [],
          keyMetrics: {},
        });
        finalizeOpts.push(undefined);
        continue;
      }

      let ev = await runUserCustomPromptEvaluator(apiKey, {
        title: row.title,
        promptText: row.prompt_text,
        specifierSummary: cohortSummary,
        finding,
      });
      if (!ev) {
        ev = await runUserCustomPromptEvaluator(apiKey, {
          title: row.title,
          promptText: row.prompt_text,
          specifierSummary: cohortSummary,
          finding,
        });
      }
      if (!ev) {
        ev = stubCustomPromptEvaluatedInsight(
          row.title,
          "Could not synthesize an insight card from the investigation results. Try Regenerate my insights."
        );
      }

      evaluated.push(ev);
      promptIds.push(pid);
      synthetic.push(finding);
      finalizeOpts.push(finalizeOpt);
    } catch (e: any) {
      logWarn(`[UserInsightOrchestrator] Custom prompt ${row.id} failed: ${e.message}`);
      const stub = stubCustomPromptEvaluatedInsight(
        row.title,
        `This saved prompt hit an unexpected error: ${e.message || "unknown"}.`
      );
      evaluated.push(stub);
      promptIds.push(pid);
      synthetic.push({
        questionId: 0,
        title: row.title,
        summary: stub.understory,
        confidence: "low",
        evidence: [],
        keyMetrics: {},
      });
      finalizeOpts.push(undefined);
    }
  }

  if (evaluated.length === 0) return;

  for (let i = 0; i < evaluated.length; i++) {
    evaluated[i]!.findingIndex = i;
  }

  await persistUserInsights(tenantPool, userId, evaluated, synthetic, generationBatch, {
    insightOrigin: "custom_prompt",
    userInsightPromptIds: promptIds,
    finalizeDetailPerIndex: finalizeOpts,
  });

  try {
    const gap = await tenantPool.query<{ id: string; title: string }>(
      `SELECT p.id::text, p.title FROM public.user_insight_prompts p
       WHERE p.user_id = $1::uuid AND p.enabled = true AND p.schedule = 'batch' AND p.scope = 'user'
       AND NOT EXISTS (
         SELECT 1 FROM public.user_generated_insights i
         WHERE i.user_id = p.user_id AND i.user_insight_prompt_id = p.id::uuid
           AND i.insight_origin = 'custom_prompt'
           AND i.generation_batch = $2
       )`,
      [userId, generationBatch]
    );
    for (const g of gap.rows) {
      logWarn(
        `[UserInsightOrchestrator] custom_prompt gap recovery for prompt ${g.id} (${g.title}) in batch ${generationBatch}`
      );
      const ev = stubCustomPromptEvaluatedInsight(
        g.title,
        "This saved prompt did not receive a persisted card in the primary batch. This recovery stub avoids a silent gap; try Regenerate my insights or edit the prompt if it persists."
      );
      ev.findingIndex = 0;
      await persistUserInsights(
        tenantPool,
        userId,
        [ev],
        [
          {
            questionId: 0,
            title: g.title,
            summary: ev.understory,
            confidence: "low",
            evidence: [],
            keyMetrics: {},
          },
        ],
        generationBatch,
        { insightOrigin: "custom_prompt", userInsightPromptIds: [g.id] }
      );
    }
  } catch (e: any) {
    logWarn(`[UserInsightOrchestrator] custom_prompt post-batch verify failed: ${e.message}`);
  }
}

/**
 * Run one user-scoped custom prompt now (on-demand). Replaces prior custom_prompt rows for that prompt id.
 */
export async function runSingleUserCustomPromptInsight(
  tenantId: string,
  tenantPool: pg.Pool,
  userId: string,
  promptId: string
): Promise<{ success: boolean; error?: string }> {
  let row: { id: string; title: string; prompt_text: string; specifiers: unknown };
  try {
    const r = await tenantPool.query(
      `SELECT id, title, prompt_text, specifiers
       FROM public.user_insight_prompts
       WHERE id = $1::uuid AND user_id = $2::uuid AND scope = 'user'`,
      [promptId, userId]
    );
    if (r.rows.length === 0) return { success: false, error: "Prompt not found" };
    row = r.rows[0] as { id: string; title: string; prompt_text: string; specifiers: unknown };
  } catch (e: any) {
    return { success: false, error: e.message || "Lookup failed" };
  }

  const apiKey = await getOpenAIKey(tenantId);
  const generationBatch = uuidv4();
  try {
    await tenantPool.query(
      `DELETE FROM public.user_generated_insights
       WHERE user_id = $1::uuid AND user_insight_prompt_id = $2::uuid AND insight_origin = 'custom_prompt'`,
      [userId, promptId]
    );
  } catch {
    /* ignore */
  }

  const [schemaContext, metricDefinitions, accessFilter, cols] = await Promise.all([
    getSchemaContext(tenantId),
    Promise.resolve(getMetricDefinitions()),
    getUserLoanAccessFilter(userId, tenantPool),
    getColumnsForTenant(tenantId),
  ]);
  const allowedColumns = new Set(cols.map((c) => c.name));

  const pid = String(row.id);
  const question: InvestigationQuestion = {
    id: 1,
    topic: `Custom prompt — ${row.title}`,
    hypothesis:
      "Produce SQL-backed evidence that answers this saved user question; cohort filters from specifiers are enforced server-side.",
    approach: `Use public.loans l. Address: ${String(row.prompt_text || "").slice(0, 1200)}`,
    priority: "high",
    category: "my_insights_custom_prompt",
    userInsightPromptId: pid,
  };

  const specifiers = (row.specifiers && typeof row.specifiers === "object" ? row.specifiers : {}) as Record<
    string,
    unknown
  >;
  const cohortSummary = specifiersToSummary(specifiers);
  const predRes = buildSpecifierPredicateSql(specifiers, allowedColumns);
  const mandatoryCohortMarkdown = [
    cohortSummary || null,
    predRes.ok
      ? "Server injects specifier cohort predicates (AND) on every SELECT against `public.loans l`, together with loan access rules."
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (predRes.ok === false) {
    const stub = stubCustomPromptEvaluatedInsight(
      row.title,
      `This prompt has invalid specifier column name(s): ${predRes.invalidKeys.join(
        ", "
      )}. Only loans-table columns from your tenant schema may be used. Edit the specifiers and try again.`
    );
    stub.findingIndex = 0;
    await persistUserInsights(
      tenantPool,
      userId,
      [stub],
      [
        {
          questionId: 0,
          title: row.title,
          summary: stub.understory,
          confidence: "low",
          evidence: [],
          keyMetrics: {},
        },
      ],
      generationBatch,
      { insightOrigin: "custom_prompt", userInsightPromptIds: [pid] }
    );
    return { success: true };
  }

  const composed = composeAccessAndSpecifierFilters(accessFilter, predRes.filter);
  const finalizeOpt: FinalizeAgentDetailDataOptions = {
    tenantId,
    accessFilter: composed ?? undefined,
    metricComposeAccessFilter: composed ?? undefined,
  };

  let finding: InsightFinding;
  try {
    finding = await runInsightInvestigator(
      question,
      schemaContext,
      metricDefinitions,
      tenantPool,
      apiKey,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      composed,
      tenantId,
      mandatoryCohortMarkdown
    );
  } catch (e: any) {
    const stub = stubCustomPromptEvaluatedInsight(
      row.title,
      `Investigation failed for this prompt: ${e.message || "unknown error"}.`
    );
    stub.findingIndex = 0;
    await persistUserInsights(
      tenantPool,
      userId,
      [stub],
      [
        {
          questionId: 0,
          title: row.title,
          summary: stub.understory,
          confidence: "low",
          evidence: [],
          keyMetrics: {},
        },
      ],
      generationBatch,
      { insightOrigin: "custom_prompt", userInsightPromptIds: [pid] }
    );
    return { success: true };
  }

  let ev = await runUserCustomPromptEvaluator(apiKey, {
    title: row.title,
    promptText: row.prompt_text,
    specifierSummary: cohortSummary,
    finding,
  });
  if (!ev) {
    ev = await runUserCustomPromptEvaluator(apiKey, {
      title: row.title,
      promptText: row.prompt_text,
      specifierSummary: cohortSummary,
      finding,
    });
  }
  if (!ev) {
    ev = stubCustomPromptEvaluatedInsight(
      row.title,
      "Could not synthesize an insight card from the investigation results. Try again after a refresh."
    );
  }
  ev.findingIndex = 0;

  await persistUserInsights(tenantPool, userId, [ev], [finding], generationBatch, {
    insightOrigin: "custom_prompt",
    userInsightPromptIds: [pid],
    finalizeDetailPerIndex: [finalizeOpt],
  });
  return { success: true };
}

/**
 * All active management `coheus_users` eligible for tenant-scoped My Insights bulk runs.
 * Role filter uses {@link COHEUS_FULL_LOAN_ACCESS_ROLES} so it stays aligned with {@link isCoheusUserWithFullLoanAccess}.
 */
async function listActiveCoheusMyInsightsBulkUserIds(): Promise<string[]> {
  try {
    const r = await managementPool.query(
      `SELECT cu.id::text AS id
       FROM public.coheus_users cu
       WHERE cu.is_active = true
         AND cu.role = ANY($1::text[])`,
      [[...COHEUS_FULL_LOAN_ACCESS_ROLES]]
    );
    return r.rows.map((row: { id: string }) => String(row.id));
  } catch (e: any) {
    logWarn(`[UserInsightOrchestrator] Could not load coheus_users for My Insights bulk: ${e.message}`);
    return [];
  }
}

/**
 * Post-sync or super-admin bulk refresh: every active tenant `users` row plus every active
 * management `coheus_users` row whose role is in {@link COHEUS_FULL_LOAN_ACCESS_ROLES}, deduped by id.
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

  const seen = new Set(userRows.map((u) => String(u.id)));
  const coheusIds = await listActiveCoheusMyInsightsBulkUserIds();
  for (const id of coheusIds) {
    if (!seen.has(id)) {
      seen.add(id);
      userRows.push({ id });
    }
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
