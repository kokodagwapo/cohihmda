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
import type { InvestigationQuestion } from "../../research/agents/plannerAgent.js";
import type { EvidenceItem } from "../../research/agents/dataAnalystAgent.js";

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
  metricSignature?: {
    sql: string;
    keyFields: string[];
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
1. THINK: Reason about what data you need
2. ACT: Generate a SQL query
3. OBSERVE: Receive query results
4. DECIDE: Run another query (if needed) or produce your final insight finding

RULES:
- Only SELECT queries (CTEs allowed). Query public.loans (alias: l)
- Use CURRENT_DATE for dates, never hardcoded dates
- Status filters:
  - Active: current_loan_status = 'Active Loan' AND application_date IS NOT NULL
  - Funded: current_loan_status ILIKE '%Originated%' OR ILIKE '%purchased%'
  - Withdrawn: current_loan_status ILIKE '%Withdrawn%'
  - Denied: current_loan_status ILIKE '%Denied%'
- CRITICAL: Loans with NULL application_date are pre-excluded data artifacts. EVERY query on active loans MUST include application_date IS NOT NULL. Do NOT investigate, count, or report on loans missing application_date — that is a known data artifact, not a finding.
- Pull-through: funded / completed * 100
- Revenue: loan_amount * (rate_lock_buy_side_base_price_rate - 100) / 100
- PostgreSQL: DATE - DATE = integer days. Use ::date cast for date subtraction.
- Limit to 100 rows max
- Use COALESCE / NULLIF for NULL handling
- 2-3 queries is usually enough. Don't over-investigate.
- When action is "query", include columnFormats mapping each SELECT alias to its display format: "number" (counts/integers), "currency" (dollar amounts), "percent" (rates/percentages), "days" (day counts), "date" (calendar dates), or "text" (labels/names).

INSIGHT QUALITY STANDARDS:
- Be specific with numbers. EVERY finding must cite concrete metrics.
- Headlines should be max 45 words — punchy and actionable.
- Summaries should be 2-3 sentences with specific numbers and comparisons.
- If the data doesn't show anything significant, set confidence to "low" and say so honestly. Do NOT manufacture an insight.
- Include a suggestedBucket: "critical" (Level 1 — immediate action required), "attention" (Level 2 — monitor closely), "working" (Level 3 — strategic review / positive signal), or "context" (Level 4 — informational).
- Include metricSignature: the single most representative SQL query and its key result fields — this will be used to track this insight over time.
- CRITICAL: Your finding title MUST reflect what the data actually shows, NOT the original hypothesis. If you set out to investigate "missing milestones" but found milestones are fine and the real issue is stale loans, the title should be about stale loans, not missing milestones. The title is the headline users see — it must be accurate to the evidence.
- Every key in keyMetrics MUST have a corresponding entry in keyMetricDescriptions AND keyMetricFormats.
- keyMetricDescriptions: 1 sentence explaining what the metric measures in plain business language.
- keyMetricFormats: the display format for each metric. Must be one of: "number" (plain count), "currency" (dollar amount), "percent" (percentage), "days" (day count), "date" (calendar date), "text" (freeform string). Choose the format that matches the metric's meaning — e.g. loan counts are "number", dollar volumes are "currency", rates are "percent".

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
    "metricSignature": { "sql": "the best single query to track this insight", "keyFields": ["field1", "field2"] }
  }
}`;

// ============================================================================
// Constants
// ============================================================================

const MAX_ITERATIONS = 4;

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
  industryNewsContext?: string
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

  userContentParts.push(
    `\n## Investigation Question`,
    `Topic: ${question.topic}`,
    `Hypothesis: ${question.hypothesis}`,
    `Suggested Approach: ${question.approach}`,
    `\nBegin your investigation. Think about what data you need first.`
  );

  const conversation: LLMMessage[] = [
    { role: "system", content: INVESTIGATOR_PROMPT },
    { role: "user", content: userContentParts.join("\n") },
  ];

  const evidence: EvidenceItem[] = [];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const raw = await callLLM(conversation, apiKey, {
      temperature: 0.2,
      maxTokens: 2500,
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
        result = await safeExecuteSQL(parsed.sql, tenantPool);
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
