/**
 * Data Analyst Agent
 *
 * Takes a single investigation question from the planner, then runs an
 * agentic loop (Think -> Act -> Observe -> Decide) for up to 5 iterations.
 * Generates SQL, executes it, analyzes results, and decides whether to
 * dig deeper or report a finding.
 *
 * Supports:
 *   - Graceful pause (checkPause called between iterations)
 *   - Steering directives injected between iterations
 *   - Few-shot training examples from curated feedback
 */

import pg from "pg";
import {
  callLLM,
  safeExecuteSQL,
  formatResultsForLLM,
  type LLMMessage,
  type QueryResult,
} from "../tools.js";
import { pool as managementPool } from "../../../config/managementDatabase.js";
import type { InvestigationQuestion } from "./plannerAgent.js";

// ============================================================================
// Types
// ============================================================================

export interface Finding {
  questionId: number;
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  evidence: EvidenceItem[];
  keyMetrics: Record<string, string | number>;
}

export interface EvidenceItem {
  sql: string;
  explanation: string;
  rows: Record<string, any>[];
  rowCount: number;
  fields: string[];
}

export type AgentStepType =
  | "thinking"
  | "sql_generated"
  | "sql_executed"
  | "analysis"
  | "followup"
  | "finding";

export interface AgentStep {
  iteration: number;
  type: AgentStepType;
  content: string;
  sql?: string;
  result?: QueryResult;
  timestamp: number;
}

export type OnStepCallback = (step: AgentStep) => void;

// ============================================================================
// Training Examples
// ============================================================================

async function fetchTrainingExamples(promptId: string): Promise<string> {
  try {
    if (!managementPool) return "";

    const tableCheck = await managementPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'insight_training_examples'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) return "";

    const result = await managementPool.query(
      `SELECT example_type, headline, understory, admin_note
       FROM insight_training_examples
       WHERE prompt_id = $1 AND is_active = true
       ORDER BY created_at DESC
       LIMIT 10`,
      [promptId]
    );

    if (result.rows.length === 0) return "";

    const positive = result.rows.filter((r: any) => r.example_type === "positive").slice(0, 3);
    const negative = result.rows.filter((r: any) => r.example_type === "negative").slice(0, 2);

    if (positive.length === 0 && negative.length === 0) return "";

    let section = "\n\nLEARN FROM THESE EXAMPLES:";
    if (positive.length > 0) {
      section += "\nGOOD (follow these patterns):";
      for (const ex of positive) {
        section += `\n- "${ex.headline}"`;
        if (ex.admin_note) section += ` — ${ex.admin_note}`;
        if (ex.understory) section += `\n  Context: ${ex.understory.substring(0, 200)}`;
      }
    }
    if (negative.length > 0) {
      section += "\nBAD (avoid these mistakes):";
      for (const ex of negative) {
        section += `\n- "${ex.headline}"`;
        if (ex.admin_note) section += ` — ${ex.admin_note}`;
        if (ex.understory) section += `\n  Context: ${ex.understory.substring(0, 200)}`;
      }
    }
    return section;
  } catch (err: any) {
    console.warn("[Research] Failed to fetch training examples:", err.message);
    return "";
  }
}

// ============================================================================
// System Prompt
// ============================================================================

const ANALYST_SYSTEM_PROMPT = `You are a Data Analyst investigating a specific question about a mortgage lender's loan data.

You operate in a loop:
1. THINK: Reason about what data you need to answer the question
2. ACT: Generate a SQL query to gather that data
3. OBSERVE: You'll receive the query results
4. DECIDE: Either formulate a follow-up query (if more data is needed) or produce your final finding

RULES:
- Only generate SELECT queries (CTEs with WITH are allowed)
- Query the public.loans table (alias as l)
- Use CURRENT_DATE for date references, not hardcoded dates
- Be precise with status filters:
  - Active: current_loan_status = 'Active Loan'
  - Funded/Originated: current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%'
  - Withdrawn: current_loan_status ILIKE '%Withdrawn%'
  - Denied: current_loan_status ILIKE '%Denied%'
  - Completed (non-active): current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
  - Pull-through: funded / completed * 100 (use application_date cohort)
  - Revenue: loan_amount * (rate_lock_buy_side_base_price_rate - 100) / 100 (when rate > 100, else use 25bps default)
- Limit results to 100 rows max
- Use multiple time windows for comparison: YTD, rolling 90D, rolling 30D, prior 90D
- Include NULL handling: COALESCE, NULLIF where appropriate

POSTGRESQL DATE ARITHMETIC (CRITICAL):
- Date columns (application_date, funding_date, closing_date, lock_date, approval_date, etc.) are stored as DATE type
- Subtracting two DATE values returns an INTEGER (number of days), NOT an interval
  - CORRECT: (l.closing_date::date - l.application_date::date) — returns integer days
  - WRONG: EXTRACT(EPOCH FROM (l.closing_date - l.application_date)) / 86400 — this FAILS because DATE minus DATE is not an interval
- If you need days between two dates, just subtract them directly: (date_b - date_a)
- For averages: AVG(l.funding_date::date - l.application_date::date)
- Cast to ::date if needed to ensure date subtraction, not timestamp subtraction
- Date comparisons: l.application_date >= CURRENT_DATE - INTERVAL '90 days' is fine (the interval is subtracted from the date)
- When you have enough evidence (usually 2-3 queries), produce your finding

Respond in JSON format:
{
  "thinking": "Your reasoning about what to investigate next",
  "action": "query" | "finding",
  "sql": "SELECT ... (only when action=query)",
  "explanation": "What this query investigates (only when action=query)",
  "finding": {  // only when action=finding
    "title": "Concise finding title",
    "summary": "2-4 sentence summary of what you found, with specific numbers",
    "confidence": "high" | "medium" | "low",
    "keyMetrics": { "metricName": "value", ... }
  }
}`;

// ============================================================================
// Agent Loop
// ============================================================================

const MAX_ITERATIONS = 5;

export async function runDataAnalystAgent(
  question: InvestigationQuestion,
  schemaContext: string,
  metricDefinitions: string,
  tenantPool: pg.Pool,
  apiKey: string,
  onStep: OnStepCallback,
  getSteeringDirective: () => string | null,
  checkPause: () => Promise<void>,
  knowledgeContext?: string
): Promise<Finding> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  // Fetch training examples for few-shot injection
  const trainingSection = await fetchTrainingExamples("research.analyst");
  const systemPrompt = ANALYST_SYSTEM_PROMPT + trainingSection;

  const userContentParts = [
    `Today: ${todayStr}. Current year: ${now.getFullYear()}.`,
    `\n## Database Schema\n${schemaContext}`,
    `\n## Metric Definitions\n${metricDefinitions}`,
  ];

  if (knowledgeContext) {
    userContentParts.push(`\n${knowledgeContext}`);
  }

  userContentParts.push(
    `\n## Investigation Question`,
    `Topic: ${question.topic}`,
    `Hypothesis: ${question.hypothesis}`,
    `Suggested Approach: ${question.approach}`,
    `\nBegin your investigation. Think about what data you need first.`
  );

  const conversationHistory: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContentParts.join("\n") },
  ];

  const evidence: EvidenceItem[] = [];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    // Graceful pause check — blocks here if paused, resumes when user unpauses
    await checkPause();

    // Check for user steering directive
    const steering = getSteeringDirective();
    if (steering) {
      conversationHistory.push({
        role: "user",
        content: `[USER DIRECTIVE] The user has provided additional guidance: "${steering}". Incorporate this into your investigation.`,
      });
      onStep({
        iteration,
        type: "thinking",
        content: `Incorporating user directive: ${steering}`,
        timestamp: Date.now(),
      });
    }

    // Call LLM
    const raw = await callLLM(conversationHistory, apiKey, {
      temperature: 0.2,
      maxTokens: 2500,
      jsonMode: true,
    });

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      onStep({
        iteration,
        type: "thinking",
        content: `Failed to parse LLM response, attempting recovery...`,
        timestamp: Date.now(),
      });
      return buildFallbackFinding(question, evidence);
    }

    // Emit thinking step
    if (parsed.thinking) {
      onStep({
        iteration,
        type: "thinking",
        content: parsed.thinking,
        timestamp: Date.now(),
      });
    }

    // Handle finding action
    if (parsed.action === "finding" && parsed.finding) {
      const finding: Finding = {
        questionId: question.id,
        title: parsed.finding.title || question.topic,
        summary: parsed.finding.summary || "No summary provided.",
        confidence: parsed.finding.confidence || "medium",
        evidence,
        keyMetrics: parsed.finding.keyMetrics || {},
      };

      onStep({
        iteration,
        type: "finding",
        content: JSON.stringify(finding, null, 2),
        timestamp: Date.now(),
      });

      return finding;
    }

    // Handle query action
    if (parsed.action === "query" && parsed.sql) {
      onStep({
        iteration,
        type: "sql_generated",
        content: parsed.explanation || "Executing query...",
        sql: parsed.sql,
        timestamp: Date.now(),
      });

      let queryResult: QueryResult;
      try {
        queryResult = await safeExecuteSQL(parsed.sql, tenantPool);
      } catch (err: any) {
        const errorMsg = `SQL Error: ${err.message}`;
        onStep({
          iteration,
          type: "sql_executed",
          content: errorMsg,
          sql: parsed.sql,
          timestamp: Date.now(),
        });

        conversationHistory.push(
          { role: "assistant", content: raw },
          { role: "user", content: `The query failed with error: ${err.message}\n\nPlease fix the query or try a different approach.` }
        );
        continue;
      }

      onStep({
        iteration,
        type: "sql_executed",
        content: `Query returned ${queryResult.rowCount} rows in ${queryResult.executionTimeMs}ms`,
        sql: parsed.sql,
        result: queryResult,
        timestamp: Date.now(),
      });

      evidence.push({
        sql: parsed.sql,
        explanation: parsed.explanation || "",
        rows: queryResult.rows,
        rowCount: queryResult.rowCount,
        fields: queryResult.fields,
      });

      const formattedResults = formatResultsForLLM(queryResult);
      conversationHistory.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `Query results (${queryResult.rowCount} rows, ${queryResult.executionTimeMs}ms):\n\n${formattedResults}\n\nAnalyze these results. Either run another query for more data, or produce your final finding if you have enough evidence.`,
        }
      );
    } else {
      conversationHistory.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `Your response did not include a valid "action" of "query" or "finding". Please respond with a valid JSON object.`,
        }
      );
    }
  }

  return buildFallbackFinding(question, evidence);
}

// ============================================================================
// Fallback finding when agent runs out of iterations or fails
// ============================================================================

function buildFallbackFinding(
  question: InvestigationQuestion,
  evidence: EvidenceItem[]
): Finding {
  return {
    questionId: question.id,
    title: question.topic,
    summary: evidence.length > 0
      ? `Investigation gathered ${evidence.length} data point(s) but could not reach a definitive conclusion within the iteration limit.`
      : `Investigation could not gather sufficient data to answer this question.`,
    confidence: "low",
    evidence,
    keyMetrics: {},
  };
}
