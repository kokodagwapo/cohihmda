/**
 * Insight Evaluator Agent
 *
 * Replaces the Validator + Curator passes from the old pipeline.
 * Receives all findings from investigator agents and makes final decisions:
 *   - Significance filtering (drop noise)
 *   - Deduplication (merge overlapping findings)
 *   - Intelligent bucketing (critical / attention / working / context)
 *   - Impact-based ranking within each bucket
 *
 * Output is compatible with the existing `generated_insights` table.
 */

import { callLLM, type LLMMessage } from "../../research/tools.js";
import { isSqlEvidenceItem } from "../../research/agents/dataAnalystAgent.js";
import type { InsightFinding } from "./insightInvestigatorAgent.js";
import { SOURCE_TO_CATEGORY } from "./categoryDefinitions.js";
import {
  buildDataQualityReviewCatalogForPrompt,
  groupsForReviewTestIds,
  normalizeReviewTestIds,
  type DataQualityWarningGroup,
} from "../../dataQuality/dataQualityTests.js";

// ============================================================================
// Types
// ============================================================================

export interface EvaluatedInsight {
  headline: string;
  understory: string;
  bucket: "critical" | "attention" | "working" | "context";
  priority: "RED" | "YELLOW" | "BLUE" | "GRAY";
  insight_type: "critical" | "warning" | "success" | "info";
  severity_score: number;
  value_score?: number;
  source: string;
  functional_category?: string;
  impact: {
    type: string;
    estimated_dollars?: number;
    units_affected?: number;
  };
  evidence: any;
  metricSignature?: {
    sql: string;
    keyFields: string[];
    comparisonKeyFields?: string[];
  };
  /** Raw from investigator; canonical stored copy lives in detail_data after validation. */
  headlineMetricSignature?: {
    sql: string;
    keyFields: string[];
    comparisonKeyFields?: string[];
  };
  confidence: "high" | "medium" | "low";
  findingIndex: number;
  /** Whether this insight should be included in the podcast briefing context. Defaults to true. */
  for_podcast?: boolean;
  // ETM Framework fields
  what_changed?: string;
  why?: string;
  business_impact?: string;
  risk_if_ignored?: string;
  recommended_action?: string;
  owner?: string;
  /** Cross-cutting data quality caveat for this insight (persisted under detail_data.data_quality). */
  data_quality?: InsightDataQualityMeta;
}

/** Persisted to detail_data.data_quality; surfaced in UI when flagged. */
export interface InsightDataQualityMeta {
  flagged: boolean;
  issue_summary?: string;
  trust_impact?: "low" | "medium" | "high";
  affected_loan_count?: number | null;
  reference_loan_count?: number | null;
  counts_confidence?: "exact" | "estimated" | "unknown";
  /** Same `id` values as /api/data-quality automated tests (see `DATA_QUALITY_TESTS`). */
  review_test_ids?: string[];
  /** Distinct warning groups for `review_test_ids` (Status, Date, Application, etc.). */
  review_groups?: DataQualityWarningGroup[];
  /** Evaluator-owned high-recall prefilter candidates (1-10). */
  prefilter_candidate_test_ids?: string[];
  prefilter_basis?: "required_columns" | "name_desc" | "mixed";
  prefilter_notes?: string;
  /** Cohort-scoped sample rows keyed by review_test_id (max 20 rows/test). */
  dq_samples_by_test_id?: Record<
    string,
    Array<{ loan_id: string; loan_number: string | null; [key: string]: unknown }>
  >;
  dq_sample_columns_by_test_id?: Record<string, string[]>;
  /** Diagnostics for verifier pathing/debug. */
  dq_cohort_source?: "headlineMetricSignature" | "metricSignature" | "fallback" | "none";
  dq_drop_reasons?: Record<string, unknown>;
}

export interface EvaluationResult {
  insights: EvaluatedInsight[];
  dropped: Array<{ index: number; reason: string }>;
  summary: string;
}

// ============================================================================
// System Prompt
// ============================================================================

const EVALUATOR_PROMPT_BASE = `You are an Insight Evaluator for a mortgage lending analytics platform. You receive raw findings from data analyst agents and decide which ones deserve to appear on the executive dashboard.

Your job:
1. SIGNIFICANCE FILTERING — Drop only findings that are genuine noise (completely trivial, zero-insight, or exact duplicates). Prefer keeping over dropping — an executive dashboard should be comprehensive, not sparse.
2. DEDUPLICATION — If two findings cover the same topic, merge them into one stronger insight.
3. BUCKETING — Categorize each surviving insight by severity level:
   - "critical" (Level 1 — Immediate Action Required): Material financial risk, compliance exposure, or operational failure requiring same-day response
   - "attention" (Level 2 — Monitor Closely): Concerning trend, potential risk if unaddressed, warrants close tracking over days/weeks
   - "working" (Level 3 — Strategic Review): Positive signal, performance strength, or opportunity worth reviewing in planning cycles
   - "context" (Level 4 — Informational): Good to know, background context, not immediately actionable
4. RANKING — Within each bucket, assign a severity_score (0.00-1.00) where higher = more impactful.

Output JSON:
{
  "summary": "1-2 sentence overview of the insight landscape",
  "insights": [
    {
      "headline": "Punchy headline, max 45 words, starts with key metric or finding",
      "understory": "2-3 sentence detail with specific numbers and comparison.",
      "bucket": "critical" | "attention" | "working" | "context",
      "severity_score": 0.00-1.00,
      "source": "MUST be exactly one of: pipeline | performance | lock_risk | closing_risk | conversion | lost_opportunity | predictions | market_news | compliance | revenue | credit_risk | operations — definitions: pipeline=active loan volume/velocity/counts; performance=officer or branch KPIs/rankings/comparisons; lock_risk=rate lock expirations/timing/exposure; closing_risk=TRID deadlines/closing delays/milestone gaps; conversion=pull-through/fallout/application-to-close funnel; lost_opportunity=withdrawn/denied/cancelled volume; predictions=model forecasts/fallout probability; market_news=external rate data/industry news/regulatory updates (MBA, Fannie, Freddie, CFPB, FHFA); compliance=regulatory or compliance violations; revenue=GOS/margin/pricing/revenue figures; credit_risk=credit scores/DTI/LTV/risk cross-tabs; operations=cycle times/condition backlogs/processing/other",
      "impact": { "type": "revenue_at_risk|operational|compliance|performance", "estimated_dollars": null, "units_affected": null },
      "confidence": "high" | "medium" | "low",
      "findingIndex": 0,
      "what_changed": "Factual observation with concrete numbers — what moved, by how much, vs what baseline",
      "why": "Root cause or contributing factors grounded in the data (not speculation)",
      "business_impact": "Quantified impact in dollars, units, or operational terms",
      "risk_if_ignored": "What happens if no action is taken — be specific to this finding",
      "recommended_action": "Prescriptive next step: who should do what, by when (e.g. 'Branch Manager — review 15 stale loans over 90 days and escalate to processing by Friday')",
      "owner": "Role or person responsible (e.g. 'VP Operations', 'Branch Manager — Main St', 'Compliance Officer')",
      "data_quality": {
        "flagged": false,
        "issue_summary": "Only when flagged=true: plain-language description aligned with Data Quality dashboard wording (status vs milestones, HMDA/TRID gaps, date logic, credit ranges, assignments, etc.)",
        "trust_impact": "low|medium|high — how much this issue undermines acting on the insight",
        "affected_loan_count": null,
        "reference_loan_count": null,
        "counts_confidence": "exact|estimated|unknown",
        "review_test_ids": [],
        "prefilter_candidate_test_ids": [],
        "prefilter_basis": "required_columns|name_desc|mixed",
        "prefilter_notes": "optional short reason for broad prefilter choices"
      }
    }
  ],
  "dropped": [
    { "index": 0, "reason": "Why this finding was dropped" }
  ]
}

RULES:
__TARGET_RULE__
- KEEP MORE THAN YOU DROP. When in doubt, KEEP the finding — put it in "context" (Informational) if it doesn't fit a higher bucket. Only drop findings that are truly redundant (near-duplicate of another finding) or completely uninformative (no specific numbers, zero confidence).
- Positive findings (improving metrics, strong performance, good trends) go in "working" (Strategic Review). Do NOT drop positive findings just because they aren't problems.
- AVOID NOISE FINDINGS: Drop findings whose headline or summary states that a topic "cannot be assessed", has "insufficient data", or reports only that fields are missing/unpopulated. These are not executive insights — they belong in the dropped list. Exception: if a finding can be reframed as a concrete data-quality issue with specific numbers (e.g., "HMDA ethnicity blank on 94% of active loans — fair lending analysis blocked"), keep it as a "context" insight with those specific numbers. If it cannot be reframed with real numbers, drop it.
- AVOID NEGATIVE-FINDING INSIGHTS: If an investigator found that a problem does NOT exist (e.g., "no stale loans", "no lock expirations", "0 loans with missing milestones"), do NOT surface this as a standalone insight. An absence of a problem is not newsworthy by default. However, if the finding contains other substantive data alongside the absence (e.g., "no stale loans AND pipeline is 154 active loans worth $61M"), keep the substantive part and reframe the headline around the real finding.
- PRIORITIZE DOLLAR IMPACT: Insights with quantified dollar impact (revenue at risk, lost opportunity volume, exposure) should rank higher than insights that are purely observational. When assigning severity_score, weight financial impact heavily.
- MARKET RATE INSIGHTS: If any findings reference market rate trends, rate changes, lock-vs-market analysis, or borrower rate sensitivity, these are HIGH VALUE — keep them and bucket appropriately. Market-aware insights connecting rate movements to pipeline behavior are particularly valuable.
- Headlines must be concrete and specific: "Pull-through drops 12% vs Q4" not "Performance metrics show changes"
- Understory must include specific numbers from the finding's keyMetrics. The **headline** states the primary KPIs; the understory may add examples (e.g. a named loan officer) as supplemental context — do not rewrite the headline to be about a drill-down unless the finding is truly single-entity.
- ETM COMPLETENESS (REQUIRED): Every insight MUST include all six ETM fields (what_changed, why, business_impact, risk_if_ignored, recommended_action, owner). These fields turn raw observations into executive-ready coaching. If the finding doesn't provide enough detail for a field, derive it from the data context. recommended_action should be prescriptive and specific (who + what + when), NOT vague suggestions. owner should name a role, not "management".
- Map bucket -> priority: critical=RED, attention=YELLOW, working=BLUE, context=GRAY
- Map bucket -> insight_type: critical=critical, attention=warning, working=success, context=info
- Preserve the findingIndex so we can link back to evidence.
- De-duplicate only when two findings are nearly identical. Similar topics from different angles should BOTH be kept.
- HEADLINE ACCURACY: Before writing the headline, read the finding's summary carefully. If the investigator's title contradicts the actual findings (e.g. title says "missing milestones" but summary says "0 loans have blank milestones"), you MUST rewrite the headline to reflect the TRUE finding. Never propagate a disproven hypothesis into the headline.
- CONFIDENCE GROUNDING: When setting confidence, consider the evidence depth. "high" confidence requires 2+ SQL queries returning meaningful data. "medium" requires at least 1 query with clear results. "low" means speculative or based on thin data — these should generally not be in "critical" bucket.
- DATA_QUALITY (OPTIONAL): For each insight, include a "data_quality" object. Set "flagged": true ONLY when a specific, defensible data-quality issue affects interpretation of THIS finding. Classification MUST align with the same dimensions the Data Quality product uses: the appended catalog lists every automated test id. When flagged=true: (1) issue_summary MUST be concrete and should read like those dashboard warnings; (2) include prefilter_candidate_test_ids: broad high-recall candidate ids (1-10), prioritizing required-column overlap with the finding context; (3) include review_test_ids: your best 1–3 ids; (4) cohort language MUST match the chosen test definition (example: if issue_summary says "active loans", do NOT map to HMDA originated/funded/purchased tests). (5) If no catalog id truly matches, DO NOT set flagged=true. (6) Set trust_impact; set reference_loan_count from evidence (e.g. rowCount / distinct loans in keyMetrics) and affected_loan_count for loans showing the defect (affected <= reference). Use null counts with counts_confidence "unknown" if evidence cannot support numbers—never invent counts. Keep prefilter_notes brief if provided.`;

const FULL_PIPELINE_TARGET = `- TARGET 12-18 insights across all buckets. A comprehensive dashboard should have broad coverage. Aim for at least 1 insight per bucket when findings support it, but do NOT force low-quality findings into a bucket just to fill a quota.`;

function buildPerCategoryTarget(findingCount: number): string {
  return `- CATEGORY MODE — you are evaluating a focused batch of ${findingCount} findings for ONE functional category. Target: keep 5-8 insights from this batch (or more if all findings have real signal). Every finding that contains concrete numbers and a genuine signal should survive as at minimum a "context" insight. Only drop findings that are true duplicates of another finding in this batch, or that contain zero concrete data (no numbers, no specific result). Do NOT apply the full-pipeline "12-18" guidance here — that refers to the total across all functional categories combined; the per-category target is higher.`;
}

/** Normalize LLM output for persistence and UI. */
export function normalizeInsightDataQuality(
  raw: unknown,
  _finding?: InsightFinding
): InsightDataQualityMeta | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.flagged !== true) return undefined;

  const trustRaw = r.trust_impact;
  const trust_impact: "low" | "medium" | "high" =
    trustRaw === "low" || trustRaw === "high" ? trustRaw : "medium";

  const ccRaw = r.counts_confidence;
  const counts_confidence: "exact" | "estimated" | "unknown" =
    ccRaw === "exact" || ccRaw === "estimated" || ccRaw === "unknown" ? ccRaw : "unknown";

  const toInt = (n: unknown): number | null => {
    if (n === null || n === undefined) return null;
    if (typeof n === "number" && Number.isFinite(n)) return Math.max(0, Math.round(n));
    if (typeof n === "string" && n.trim() !== "" && !Number.isNaN(Number(n)))
      return Math.max(0, Math.round(Number(n)));
    return null;
  };

  let affected = toInt(r.affected_loan_count);
  let reference = toInt(r.reference_loan_count);
  if (affected != null && reference != null && affected > reference) affected = reference;

  const issue_summary =
    typeof r.issue_summary === "string" && r.issue_summary.trim()
      ? r.issue_summary.trim().slice(0, 4000)
      : "A data quality concern affects how this insight should be interpreted.";

  const effectiveConfidence: "exact" | "estimated" | "unknown" =
    affected == null || reference == null ? "unknown" : counts_confidence;

  const review_test_ids = normalizeReviewTestIds(r.review_test_ids);
  const prefilter_candidate_test_ids = normalizeReviewTestIds(r.prefilter_candidate_test_ids).slice(0, 10);
  const prefilter_basis =
    r.prefilter_basis === "required_columns" || r.prefilter_basis === "name_desc" || r.prefilter_basis === "mixed"
      ? r.prefilter_basis
      : undefined;
  const prefilter_notes =
    typeof r.prefilter_notes === "string" && r.prefilter_notes.trim().length > 0
      ? r.prefilter_notes.trim().slice(0, 300)
      : undefined;
  const review_groups = groupsForReviewTestIds(review_test_ids);

  return {
    flagged: true,
    issue_summary,
    trust_impact,
    affected_loan_count: affected,
    reference_loan_count: reference,
    counts_confidence: effectiveConfidence,
    ...(prefilter_candidate_test_ids.length > 0 ? { prefilter_candidate_test_ids } : {}),
    ...(prefilter_basis ? { prefilter_basis } : {}),
    ...(prefilter_notes ? { prefilter_notes } : {}),
    ...(review_test_ids.length > 0 ? { review_test_ids } : {}),
    ...(review_groups.length > 0 ? { review_groups } : {}),
  };
}

function buildEvaluatorSystemPrompt(options?: { functionalCategory?: string; categorySupplement?: string }, findingCount = 0): string {
  const targetRule = options?.functionalCategory
    ? buildPerCategoryTarget(findingCount)
    : FULL_PIPELINE_TARGET;
  const base = EVALUATOR_PROMPT_BASE.replace("__TARGET_RULE__", targetRule);
  const withCatalog = `${base}\n\n${buildDataQualityReviewCatalogForPrompt()}`;
  return options?.categorySupplement ? `${withCatalog}\n\n${options.categorySupplement}` : withCatalog;
}

// ============================================================================
// Agent Entry Point
// ============================================================================

const BUCKET_TO_PRIORITY: Record<string, string> = {
  critical: "RED",
  attention: "YELLOW",
  working: "BLUE",
  context: "GRAY",
};

const BUCKET_TO_TYPE: Record<string, string> = {
  critical: "critical",
  attention: "warning",
  working: "success",
  context: "info",
};

export async function runInsightEvaluator(
  findings: InsightFinding[],
  apiKey: string,
  previousHeadlines?: string[],
  options?: { functionalCategory?: string; categorySupplement?: string; knowledgeContext?: string }
): Promise<EvaluationResult> {
  if (findings.length === 0) {
    return { insights: [], dropped: [], summary: "No findings to evaluate." };
  }

  const findingSummaries = findings.map((f, i) => ({
    index: i,
    title: f.title,
    summary: f.summary,
    confidence: f.confidence,
    keyMetrics: f.keyMetrics,
    suggestedBucket: f.suggestedBucket,
    impactEstimate: f.impactEstimate,
    evidenceCount: f.evidence.length,
  }));

  let userPrompt = "";

  // Knowledge context first — shapes severity judgments before findings are seen
  if (options?.knowledgeContext) {
    userPrompt += `## Organization Knowledge & Guidelines\nThe following excerpts from the organization's knowledge center should inform how you assess severity, compliance relevance, and priority:\n${options.knowledgeContext}\n\n`;
  }

  if (previousHeadlines && previousHeadlines.length > 0) {
    userPrompt += `## Previous Insight Headlines (reference only — keep findings with updated numbers even if the topic was covered before; only drop if the finding adds nothing new)\n`;
    previousHeadlines.forEach((h) => (userPrompt += `- ${h}\n`));
    userPrompt += "\n";
  }

  if (options?.functionalCategory) {
    userPrompt += `## FUNCTIONAL CATEGORY\nAll findings belong to the "${options.functionalCategory}" category. Every output insight must have functional_category = "${options.functionalCategory}".\n\n`;
  }

  userPrompt += `## Findings to Evaluate\n\n${JSON.stringify(findingSummaries, null, 2)}\n\n`;
  userPrompt += `Evaluate these findings and produce the final insight set. Respond with JSON.`;

  // Build system prompt dynamically — per-category mode gets a different TARGET rule
  const systemPrompt = buildEvaluatorSystemPrompt(options, findings.length);

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const raw = await callLLM(messages, apiKey, {
    temperature: 0.3,
    maxTokens: 10000,
    jsonMode: true,
  });

  const parsed = JSON.parse(raw) as EvaluationResult;

  // Post-process: enrich each evaluated insight with the correct priority/type mappings,
  // stamp functional_category (from options or source-based fallback), and attach metricSignature.
  parsed.insights = (parsed.insights || []).map((ins) => {
    const bucket = ins.bucket || "context";
    const originalFinding = findings[ins.findingIndex];

    // Determine functional_category: explicit option > LLM output > source-based fallback
    const functionalCategory =
      options?.functionalCategory ||
      ins.functional_category ||
      SOURCE_TO_CATEGORY[ins.source] ||
      undefined;

    const base: Record<string, unknown> = { ...(ins as unknown as Record<string, unknown>) };
    const rawDq = base.data_quality;
    delete base.data_quality;
    const data_quality = normalizeInsightDataQuality(rawDq, originalFinding);

    return {
      ...(base as unknown as EvaluatedInsight),
      bucket,
      priority: (BUCKET_TO_PRIORITY[bucket] || "GRAY") as any,
      insight_type: (BUCKET_TO_TYPE[bucket] || "info") as any,
      severity_score: Math.min(1, Math.max(0, ins.severity_score || 0.5)),
      functional_category: functionalCategory,
      ...(data_quality ? { data_quality } : {}),
      metricSignature: originalFinding?.metricSignature || ins.metricSignature,
      headlineMetricSignature: originalFinding?.headlineMetricSignature,
      evidence: originalFinding
        ? {
            metrics: Object.entries(originalFinding.keyMetrics).map(([k, v]) => ({
              label: k,
              value: v,
            })),
            evidenceQueries: originalFinding.evidence.filter(isSqlEvidenceItem).map((e) => ({
              sql: e.sql,
              explanation: e.explanation,
              rowCount: e.rowCount,
            })),
          }
        : ins.evidence,
    };
  });

  return parsed;
}
