/**
 * Insight Investigator Agent
 *
 * Investigates a single question from the planner using an agentic loop
 * (Think -> Query -> Analyze -> Decide). Produces a structured InsightFinding
 * with evidence tables.
 *
 * Differences from the research DataAnalystAgent:
 *   - Max 4 iterations (faster for autonomous runs)
 *   - No steering/pause (non-interactive)
 *   - System prompt tuned for dashboard insights (concise, number-heavy)
 *   - Output includes suggestedBucket and metricSignature for tracking
 */

import pg from "pg";
import {
  callLLM,
  safeExecuteSQL,
  formatResultsForLLM,
  type LLMMessage,
  type QueryResult,
} from "../../research/tools.js";
import type { LoanAccessFilter } from "../../userLoanAccessService.js";
import type { InvestigationQuestion } from "../../research/agents/plannerAgent.js";
import type { EvidenceItem } from "../../research/agents/dataAnalystAgent.js";
import { VIZ_STANDARDS_MEDIUM } from "../../../config/visualizationStandards.js";

// ============================================================================
// Types
// ============================================================================

export interface InsightFinding {
  questionId: number;
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  evidence: EvidenceItem[];
  keyMetrics: Record<string, string | number>;
  keyMetricDescriptions?: Record<string, string>;
  keyMetricFormats?: Record<string, string>;
  suggestedBucket?: "critical" | "attention" | "working" | "context";
  impactEstimate?: {
    type: string;
    estimated_dollars?: number;
    units_affected?: number;
  };
  /**
   * Exploratory / breakdown queries may be multi-row (e.g. GROUP BY). Used for evidence and context — not preferred for watchlist refresh.
   */
  metricSignature?: {
    sql: string;
    keyFields: string[];
    comparisonKeyFields?: string[];
  };
  /**
   * Single-row headline KPIs matching keyMetrics. Prefer **either** `sql` **or** `metricSpec`
   * (catalog composer — deterministic); validated at persist.
   */
  headlineMetricSignature?: {
    sql?: string;
    /** When set without sql, headline SQL is composed server-side from METRICS_CATALOG. */
    metricSpec?: unknown;
    keyFields: string[];
    comparisonKeyFields?: string[];
  };
}

export type InvestigatorStepType =
  | "thinking"
  | "sql_generated"
  | "sql_executed"
  | "finding"
  | "error";

export interface InvestigatorStep {
  questionId: number;
  iteration: number;
  type: InvestigatorStepType;
  content: string;
  sql?: string;
  rowCount?: number;
  timestamp: number;
}

export type OnInvestigatorStep = (step: InvestigatorStep) => void;

// ============================================================================
// System Prompt
// ============================================================================

const INVESTIGATOR_PROMPT = `You are an Insight Investigator for a mortgage lending analytics platform. You investigate a specific question by querying loan data, analyzing results, and producing a dashboard-ready insight.

You operate in a loop:
1. THINK: Reason about what data you need — and whether you need a discovery query first
2. ACT: Generate a SQL query (diagnostic sample OR analytical query)
3. OBSERVE: Receive query results — read them carefully before deciding next step
4. DECIDE: Run another query, pivot the approach, or produce your final insight finding

DISCOVERY-FIRST PRINCIPLE:
Before writing a complex analytical query on a column you haven't seen before, run a quick diagnostic query to understand the data shape. This saves iterations and prevents wasted queries on empty columns.

When to run a discovery query:
- You're unsure what values exist in a categorical column (e.g., current_loan_status, current_milestone, loan_type, channel, branch) → run SELECT DISTINCT col, COUNT(*) ... GROUP BY col ORDER BY 2 DESC LIMIT 20
- Your first query returns 0 rows or all NULLs → run a LIMIT 5 sample to see what's actually there: SELECT col1, col2, col3 FROM public.loans WHERE ... LIMIT 5
- You see unexpected results (e.g., only 2 distinct statuses when you expected 5+) → run SELECT DISTINCT current_loan_status, COUNT(*) FROM public.loans GROUP BY 1 ORDER BY 2 DESC to confirm the actual distribution across ALL records
- A date column appears sparse → check: SELECT COUNT(*) AS total, COUNT(col) AS populated, ROUND(COUNT(col)*100.0/COUNT(*),1) AS pct FROM public.loans WHERE current_loan_status = 'Active Loan' AND application_date IS NOT NULL
- You're about to filter by a status or milestone value you haven't verified → sample first with SELECT DISTINCT current_loan_status FROM public.loans LIMIT 30

Discovery queries cost one iteration but save you from dead-end analytical queries. Budget 1-2 discovery queries when the data shape is unclear, then spend the remaining iterations on analysis.

RULES:
- Only SELECT queries (CTEs allowed). Query public.loans (alias: l)
- Use CURRENT_DATE for dates, never hardcoded dates
- Status filters (CRITICAL — use these EXACT definitions to match the rest of the platform):
  - Active pipeline: current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND (is_archived IS DISTINCT FROM TRUE)
  - Originated/Funded (status-based, pull-through numerator): current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%'
  - Withdrawn: current_loan_status ILIKE '%Withdrawn%'
  - Denied: current_loan_status ILIKE '%Denied%'
  - COMPLETED (all terminal — pull-through denominator): current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
    This catches Originated, Withdrawn, Denied, and any other terminal status — use this for pull-through denominators.
  - Funded (date-based, for revenue/volume): funding_date IS NOT NULL
- CRITICAL: Loans with NULL application_date are pre-excluded data artifacts. EVERY query on active loans MUST include application_date IS NOT NULL. Do NOT investigate, count, or report on loans missing application_date — that is a known data artifact, not a finding.
- Pull-through rate: COUNT(originated) / COUNT(completed) * 100 — use the COMPLETED definition above as denominator, NOT just withdrawn+denied.
- Revenue: Use the TENANT REVENUE FORMULA provided in the user context below. Every tenant has a custom revenue calculation — NEVER assume a formula. If no formula is provided, fall back to: loan_amount * (rate_lock_buy_side_base_price_rate - 100) / 100
- PostgreSQL: DATE - DATE = integer days. Use ::date cast for date subtraction.
- Limit to 100 rows max
- Use COALESCE / NULLIF for NULL handling
- STATUS DATE FALLBACK: When querying denied-loan dates, use COALESCE(uw_denied_date, denial_date, current_status_date) as the effective denial date. Many lenders do not export uw_denied_date or denial_date — this is normal, not a data quality issue. Similarly for withdrawn loans use COALESCE(withdrawal_date, current_status_date).
- 3-4 queries is usually appropriate. Use up to 5 for complex investigations.
- When action is "query", include columnFormats mapping each SELECT alias to its display format: "number" (counts/integers), "currency" (dollar amounts), "percent" (rates/percentages), "days" (day counts), "date" (calendar dates), or "text" (labels/names).
- CONVERSION METRIC TIME WINDOWS: Pull-through and fallout rates only make sense on cohorts where most loans have had time to complete. Mortgage cycle times are 30-60+ days. For short windows (30D), caveat results with cycle time context. Prefer 90D or YTD cohorts for conversion metrics.

INSIGHT QUALITY STANDARDS:
- Be specific with numbers. EVERY finding must cite concrete metrics.
- Headlines should be max 45 words — punchy and actionable.
- Summaries should be 2-3 sentences with specific numbers and comparisons.
- If the data doesn't show anything significant, set confidence to "low" and say so honestly. Do NOT manufacture an insight.
- Include a suggestedBucket: "critical" (Level 1 — immediate action required), "attention" (Level 2 — monitor closely), "working" (Level 3 — strategic review / positive signal), or "context" (Level 4 — informational).
- Include metricSignature: the most representative analytical SQL and its key result fields (may use GROUP BY / multiple rows for breakdowns and exploration). This backs evidence and drill-down context.
- Optional metricSignature.comparisonKeyFields: numeric-only subset when metricSignature is used for rollups.
- REQUIRED headlineMetricSignature: **either** "sql" (single SELECT, one row) **or** "metricSpec" (canonical MetricSpec JSON — server composes SQL). Same KPI grain rules as above.
- headlineMetricSignature.sql OR headlineMetricSignature.metricSpec: headline-level aggregates only — must return 1 row when composed.
- headlineMetricSignature.comparisonKeyFields: optional subset of keyFields for numeric KPI trend comparison only (counts, amounts, rates); omit pure scope/label columns.
- CRITICAL: Your finding title MUST reflect what the data actually shows, NOT the original hypothesis. If you set out to investigate "missing milestones" but found milestones are fine and the real issue is stale loans, the title should be about stale loans, not missing milestones. The title is the headline users see — it must be accurate to the evidence.
- Every key in keyMetrics MUST have a corresponding entry in keyMetricDescriptions AND keyMetricFormats.
- keyMetricDescriptions: 1 sentence explaining what the metric measures in plain business language.
- keyMetricFormats: the display format for each metric. Must be one of: "number" (plain count), "currency" (dollar amount), "percent" (percentage), "days" (day count), "date" (calendar date), "text" (freeform string). Choose the format that matches the metric's meaning — e.g. loan counts are "number", dollar volumes are "currency", rates are "percent".

HANDLING SPARSE DATA AND UNEXPECTED RESULTS:
- If a query returns 0 rows: do NOT immediately conclude the data doesn't exist. First run a discovery query (SELECT DISTINCT or LIMIT 5 sample) to see what values ARE in that column before giving up.
- If you see only 1-2 distinct status values when you expected more (e.g., only "Active Loan" and "Loan Originated"): run SELECT DISTINCT current_loan_status, COUNT(*) FROM public.loans GROUP BY 1 ORDER BY 2 DESC to see the full picture. The actual distribution may differ from what the status filter docs describe.
- If a field appears empty for your target date range: check whether the field IS populated in other periods (e.g., check all-time vs just YTD). The data may exist historically but not recently.
- If your first analytical query on specific fields returns all NULLs: run a fallback on related fields (e.g., if lock_expiration_date is NULL everywhere, check rate_lock_lock_in_date and compute expiration from lock period instead).
- Only conclude "insufficient data" after running at least one discovery query to confirm — never on the basis of a zero-result analytical query alone.
- If the question genuinely cannot be answered (confirmed by discovery queries), produce a finding that says WHAT data is missing, HOW MANY records are affected, and WHY it matters — with specific numbers. Set suggestedBucket to "context" and confidence to "medium". This is still a real data-quality finding.
- If the organization's knowledge base mentions specific thresholds, SLAs, or compliance rules (in the ## Organization Knowledge & Guidelines section), use those as benchmarks when evaluating whether a metric is concerning.

Respond in JSON:
{
  "thinking": "Your reasoning",
  "action": "query" | "finding",
  "sql": "SELECT ... (when action=query)",
  "explanation": "What this queries (when action=query)",
  "columnFormats": { "column_alias": "number|currency|percent|days|date|text", ... },
  "finding": {
    "title": "Concise headline (max 45 words) — must reflect the actual evidence, not the initial hypothesis",
    "summary": "2-3 sentences with specific numbers",
    "confidence": "high" | "medium" | "low",
    "keyMetrics": { "metric_name": "value", ... },
    "keyMetricDescriptions": { "metric_name": "One sentence explaining what this metric measures", ... },
    "keyMetricFormats": { "metric_name": "number|currency|percent|days|date|text", ... },
    "suggestedBucket": "critical" | "attention" | "working" | "context",
    "impactEstimate": { "type": "revenue_at_risk|operational|compliance", "estimated_dollars": 0, "units_affected": 0 },
    "metricSignature": { "sql": "breakdown or analytical query (may be multi-row)", "keyFields": ["dim1", "kpi1"], "comparisonKeyFields": ["kpi1"] },
    "headlineMetricSignature": { "metricSpec": { "metricIds": ["pull_through_rate"], "dimensions": [], "window": "ytd" }, "keyFields": ["pull_through_rate"], "comparisonKeyFields": ["pull_through_rate"] }
  }
}`;

// ============================================================================
// Constants
// ============================================================================

const MAX_ITERATIONS = 8;

// ============================================================================
// Agent Loop
// ============================================================================

export async function runInsightInvestigator(
  question: InvestigationQuestion,
  schemaContext: string,
  metricDefinitions: string,
  tenantPool: pg.Pool,
  apiKey: string,
  onStep?: OnInvestigatorStep,
  marketContext?: string,
  industryNewsContext?: string,
  knowledgeContext?: string,
  revenueFormula?: string,
  accessFilter?: LoanAccessFilter | null,
  tenantIdForSql?: string
): Promise<InsightFinding> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  const emit = (step: Omit<InvestigatorStep, "questionId" | "timestamp">) => {
    onStep?.({ ...step, questionId: question.id, timestamp: Date.now() });
  };

  const userContentParts = [
    `Today: ${todayStr}. Current year: ${now.getFullYear()}.`,
    `\n## Database Schema\n${schemaContext}`,
    `\n## Metric Definitions\n${metricDefinitions}`,
  ];

  if (marketContext) {
    userContentParts.push(
      `\n## Market Rate Context (OBMMIC30YF — 30-Year Fixed Conforming)\n${marketContext}`
    );
  }

  if (industryNewsContext) {
    userContentParts.push(
      `\n## Industry News Context\n${industryNewsContext}`
    );
  }

  if (knowledgeContext) {
    userContentParts.push(
      `\n## Organization Knowledge & Guidelines\nThe following excerpts from the organization's knowledge center contain compliance policies, SLA definitions, and internal thresholds. Use these as benchmarks when formulating queries and interpreting results:\n${knowledgeContext}`
    );
  }

  if (revenueFormula) {
    userContentParts.push(
      `\n## TENANT REVENUE FORMULA (MUST USE)\nThis tenant's configured revenue SQL expression:\n\`\`\`sql\n${revenueFormula}\n\`\`\`\nUse this EXACTLY when computing revenue. Do NOT invent your own formula or reference fields not in this expression.`
    );
  }

  userContentParts.push(
    `\n## Investigation Question`,
    `Topic: ${question.topic}`,
    `Hypothesis: ${question.hypothesis}`,
    `Suggested Approach: ${question.approach}`,
    `\nBegin your investigation. Think about what data you need first.`
  );

  const conversation: LLMMessage[] = [
    { role: "system", content: INVESTIGATOR_PROMPT + VIZ_STANDARDS_MEDIUM },
    { role: "user", content: userContentParts.join("\n") },
  ];

  const evidence: EvidenceItem[] = [];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const raw = await callLLM(conversation, apiKey, {
      temperature: 0.2,
      maxTokens: 5000,
      jsonMode: true,
    });

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      emit({ iteration, type: "error", content: "Failed to parse LLM response" });
      return buildFallback(question, evidence);
    }

    if (parsed.thinking) {
      emit({ iteration, type: "thinking", content: parsed.thinking });
    }

    // Finding action
    if (parsed.action === "finding" && parsed.finding) {
      const finding: InsightFinding = {
        questionId: question.id,
        title: parsed.finding.title || question.topic,
        summary: parsed.finding.summary || "No summary provided.",
        confidence: parsed.finding.confidence || "medium",
        evidence,
        keyMetrics: parsed.finding.keyMetrics || {},
        keyMetricDescriptions: parsed.finding.keyMetricDescriptions || {},
        keyMetricFormats: parsed.finding.keyMetricFormats || {},
        suggestedBucket: parsed.finding.suggestedBucket,
        impactEstimate: parsed.finding.impactEstimate,
        metricSignature: parsed.finding.metricSignature,
        headlineMetricSignature: parsed.finding.headlineMetricSignature,
      };

      emit({ iteration, type: "finding", content: finding.title });
      return finding;
    }

    // Query action
    if (parsed.action === "query" && parsed.sql) {
      emit({
        iteration,
        type: "sql_generated",
        content: parsed.explanation || "Executing query...",
        sql: parsed.sql,
      });

      let result: QueryResult;
      try {
        const params = Array.isArray(parsed.params) ? parsed.params : undefined;
        result = await safeExecuteSQL(parsed.sql, tenantPool, params, {
          accessFilter: accessFilter ?? undefined,
          tenantId: tenantIdForSql,
        });
      } catch (err: any) {
        emit({
          iteration,
          type: "error",
          content: `SQL error: ${err.message}`,
          sql: parsed.sql,
        });

        conversation.push(
          { role: "assistant", content: raw },
          {
            role: "user",
            content: `Query failed: ${err.message}\n\nFix the query or try a different approach.`,
          }
        );
        continue;
      }

      emit({
        iteration,
        type: "sql_executed",
        content: `${result.rowCount} rows in ${result.executionTimeMs}ms`,
        sql: parsed.sql,
        rowCount: result.rowCount,
      });

      evidence.push({
        sql: parsed.sql,
        explanation: parsed.explanation || "",
        rows: result.rows,
        rowCount: result.rowCount,
        fields: result.fields,
        columnFormats: parsed.columnFormats || undefined,
      });

      const formatted = formatResultsForLLM(result);
      conversation.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `Results (${result.rowCount} rows, ${result.executionTimeMs}ms):\n\n${formatted}\n\nAnalyze the results. Run another query or produce your finding.`,
        }
      );
    } else {
      conversation.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `Invalid response — "action" must be "query" or "finding". Try again.`,
        }
      );
    }
  }

  return buildFallback(question, evidence);
}

// ============================================================================
// Fallback
// ============================================================================

function buildFallback(
  question: InvestigationQuestion,
  evidence: EvidenceItem[]
): InsightFinding {
  return {
    questionId: question.id,
    title: question.topic,
    summary: evidence.length > 0
      ? `Investigation gathered ${evidence.length} data point(s) but could not produce a definitive insight within the iteration limit.`
      : `Could not gather sufficient data for this question.`,
    confidence: "low",
    evidence,
    keyMetrics: {},
    suggestedBucket: "context",
  };
}
