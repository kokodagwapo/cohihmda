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
  keyMetricDescriptions?: Record<string, string>;
  keyMetricFormats?: Record<string, string>;
}

export interface ChartHint {
  type?: 'bar' | 'horizontal_bar' | 'line' | 'area' | 'pie' | 'donut' | 'stacked_bar' | 'grouped_bar';
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  xLabel?: string;
  yLabel?: string;
  nameKey?: string;
  valueKey?: string;
}

export interface EvidenceItem {
  sql: string;
  explanation: string;
  rows: Record<string, any>[];
  rowCount: number;
  fields: string[];
  columnFormats?: Record<string, string>;
  chartHint?: ChartHint;
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

LANGUAGE AND FORMATTING RULES:
- Never write "pp" or "p.p." to mean percentage points. Write "ppts" or spell it out: "percentage points". Example: "pull-through fell 12 percentage points" not "fell 12pp".
- Use "%" for rates and proportions (e.g. "pull-through is 74%"). Use "percentage points" or "ppts" only when describing the change between two rates (e.g. "improved 8 ppts YoY").

RULES:
- Only generate SELECT queries (CTEs with WITH are allowed)
- Query the public.loans table (alias as l)
- Use CURRENT_DATE for date references, not hardcoded dates
- Be precise with status filters:
  - Active: current_loan_status = 'Active Loan' AND application_date IS NOT NULL (loans without application_date are data artifacts, not real pipeline)
  - Funded/Originated: current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%'
  - Withdrawn: current_loan_status ILIKE '%Withdrawn%'
  - Denied: current_loan_status ILIKE '%Denied%'
  - Completed (non-active): current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
  - When reporting or filtering by outcome date for Denied loans, use current_status_date when uw_denied_date/denial_date is null (platform fallback). Do not report "no denied date populated" as an issue.
  - Pull-through: funded / completed * 100 (use application_date cohort)
  - Revenue: loan_amount * (rate_lock_buy_side_base_price_rate - 100) / 100 (when rate > 100, else use 25bps default)
- Result set size: you may return up to 1000 rows. The UI uses lazy loading and virtualization, so large result sets are fine. For pipelines or cohorts larger than 1000, aggregate in your query (e.g. by status, by personnel, by month) rather than returning raw rows.
- Use multiple time windows for comparison: YTD, rolling 90D, rolling 30D, prior 90D
- Include NULL handling: COALESCE, NULLIF where appropriate
- When action is "query", include columnFormats mapping each SELECT alias to its display format: "number" (counts/integers), "currency" (dollar amounts), "percent" (rates/percentages), "days" (day counts), "date" (calendar dates), or "text" (labels/names).
- When action is "query", include a chartHint object to guide visualization (see VISUALIZATION GUIDANCE below).

VISUALIZATION GUIDANCE (include chartHint with every query action):
- chartHint tells the frontend how to render the result as a chart. Always include it.
- Chart type selection rules:
  - Time series (result has a date/month/quarter/year/period column) → type "line". Use DATE_TRUNC + TO_CHAR to produce a formatted period column (e.g. 'Mon YYYY'). xKey = "period".
  - Category comparison, single metric, ≤12 categories → type "bar". xKey = category column.
  - Category comparison, single metric, >12 categories OR avg label length >20 chars → type "horizontal_bar".
  - Multi-metric comparison (2+ numeric columns per category, e.g. funded_count + denied_count by branch) → type "grouped_bar". Use yKeys array listing ALL numeric column names. Do NOT use type "bar" for this case.
  - Part-of-whole (proportional breakdown, ≤8 categories, values sum to ~100% or a total) → type "pie" or "donut". nameKey = category column, valueKey = numeric column.
  - Trend over time with cumulative fill → type "area".
- CRITICAL for multi-timeframe queries: If your SQL returns rows with (category, timeframe, value), restructure to return one row per category with each timeframe as a separate numeric column. Example: SELECT branch, SUM(CASE WHEN period='YTD' THEN amount END) AS ytd_amount, SUM(CASE WHEN period='90D' THEN amount END) AS rolling_90d_amount FROM ... GROUP BY branch. This enables grouped_bar with yKeys = ["ytd_amount", "rolling_90d_amount"].
- Always include xLabel and yLabel as human-readable axis labels (e.g. xLabel: "Branch", yLabel: "Funded Volume ($)").
- For grouped_bar and stacked_bar: yKeys must list every numeric column name to be plotted.
- Maximum 30 rows per chart query; aggregate with GROUP BY and LIMIT if needed.

chartHint schema (include inside each query action response):
"chartHint": {
  "type": "bar|horizontal_bar|line|area|pie|donut|grouped_bar|stacked_bar",
  "xKey": "column_name_for_x_axis_or_categories",
  "yKey": "primary_numeric_column (for single-series)",
  "yKeys": ["col1", "col2"],
  "xLabel": "Human-readable X axis label",
  "yLabel": "Human-readable Y axis label",
  "nameKey": "category_column (pie/donut only)",
  "valueKey": "value_column (pie/donut only)"
}

ACTIVE PIPELINE DEFINITION (CRITICAL — READ BEFORE EVERY QUERY):
- The active pipeline filter is: current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND (is_archived IS DISTINCT FROM TRUE). This is non-negotiable. EVERY query touching active loans MUST include all three conditions.
- Archived loans are excluded from active pipeline. NULL is_archived is treated as not archived (included in active). — they've been moved to archive folders in the LOS and are no longer part of the working pipeline.
- Loans with NULL application_date are pre-excluded artifacts (bulk imports, test files, incomplete records). They do not exist for analysis purposes. Do NOT query them, count them, report on them, or mention them in findings. Do NOT write insights about "X% of active loans missing application_date" — that is a known data artifact, not a discovery.
- Even among loans that pass this filter, many may be stale (application_date > 6 months old). Consider segmenting by recency when relevant — an "active" loan from 14 months ago is likely abandoned.

DATA QUALITY AWARENESS:
- Focus data quality analysis on loans that PASS the active filter (have application_date IS NOT NULL). Within that set, look for:
  - Stale loans: application_date > 6 months old (likely abandoned, not closed out in LOS)
  - Missing lock dates on loans that should be locked by their milestone stage
  - Impossible date sequences (funding_date before application_date, closing_date in the future)
  - NULL or zero values in critical fields (loan_amount, interest_rate) on genuinely active loans
- When a finding is driven by a data quality issue within the real pipeline, frame it as such and be specific about the business impact.

CATEGORICAL DATA QUALITY — SUSPICIOUS LOW-VOLUME VALUES:
- When querying by any categorical dimension (loan_type, product_type, program_type, investor, branch, etc.), always scan for values that appear to be data-entry artifacts:
  - Very low volume (< ~15 loans) combined with an unusual format (CamelCase, no spaces, all-lowercase, single-word concatenation, or truncation) is a strong signal of a miscoded entry — e.g. "FarmersHomeAdministration", "conventionalfixed", "USDA_RD", "HomeReady_97".
  - When you encounter such values, explicitly note in your finding: "The value '[name]' appears to be a non-standard data entry (N loans). This may be a miscoded or legacy LOS value — confirm whether it represents a distinct product or should be remapped."
  - Do NOT silently include a suspicious low-volume label in a chart or breakdown as if it were a real, distinct category equal to "FHA", "Conventional", "VA", etc.
- Standard industry loan type names and their common aliases (flag ANY deviation from these as a data quality note):
  - FHA / Federal Housing Administration (NOT "FarmersHomeAdministration" — that is a historical alias for USDA/FmHA; if you see it alongside "FHA", flag both as potentially miscoded)
  - VA / Veterans Administration / Veterans Affairs
  - USDA / RD / Rural Development / FmHA / Farmers Home Administration (these ARE the same program; if they appear as separate values, flag as likely duplicate coding)
  - Conventional (may appear as "Conv", "CONV", "Conventional Fixed", "Conventional ARM" — these are valid sub-types, not errors)
  - Jumbo / Non-conforming
  - Non-QM
- When a dimension breakdown has a "long tail" of micro-categories each with < 1% of volume, aggregate them as "Other" in your summary and note the count: "N additional loan types accounting for <2% of volume were excluded for clarity."

CONVERSION METRIC TIME WINDOWS (IMPORTANT):
- Pull-through, fallout, and conversion rates are cohort-completion metrics — they only make sense when most loans in the cohort have had time to reach a terminal status (funded, withdrawn, denied, etc.)
- Mortgage cycle times (application to funding) typically range from 30-60+ days. A 30-day application cohort will contain many loans still in-process, making PT artificially low and fallout artificially high.
- Before citing pull-through or fallout for a short window, first check the tenant's actual average cycle time (AVG(funding_date - application_date) for funded loans). If avg cycle time >= 30 days, 30D PT is unreliable — prefer 90D or YTD.
- When you DO report short-window conversion metrics, always caveat them with the cycle time context (e.g. "30D PT is 18%, but avg cycle time is 42 days so most recent applications haven't had time to close").
- For trend comparison of conversion metrics, 90D-vs-prior-90D or YTD-vs-prior-YTD are the most reliable windows.

POSTGRESQL DATE ARITHMETIC (CRITICAL):
- Date columns (application_date, funding_date, closing_date, lock_date, approval_date, etc.) are stored as DATE type
- Subtracting two DATE values returns an INTEGER (number of days), NOT an interval
  - CORRECT: (l.closing_date::date - l.application_date::date) — returns integer days
  - WRONG: EXTRACT(EPOCH FROM (l.closing_date - l.application_date)) / 86400 — this FAILS because DATE minus DATE is not an interval
- If you need days between two dates, just subtract them directly: (date_b - date_a)
- For averages: AVG(l.funding_date::date - l.application_date::date)
- Cast to ::date if needed to ensure date subtraction, not timestamp subtraction
- Date comparisons: l.application_date >= CURRENT_DATE - INTERVAL '90 days' is fine (the interval is subtracted from the date)

STRING PARSING (for multi-value fields):
- Some fields store multiple values in a single text column. BEFORE writing SQL, first run a small query (LIMIT 5) to inspect the actual format of the field. Different fields use different delimiters.
- Common formats and how to parse each:

  Format A — newline-delimited lines with tab-separated key\tvalue (e.g. "j_budde\t0.077\nr.childress\t3.483"):
  WITH lines AS (
    SELECT l.loan_number, NULLIF(BTRIM(line), '') AS line
    FROM public.loans l
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(l.some_field, ''), E'\\n') AS line
    WHERE l.some_field IS NOT NULL AND BTRIM(l.some_field) != ''
  ),
  parsed AS (
    SELECT loan_number,
      NULLIF(split_part(line, E'\\t', 1), '') AS person_name,
      NULLIF(split_part(line, E'\\t', 2), '')::numeric AS hours
    FROM lines WHERE line IS NOT NULL AND line LIKE '%' || E'\\t' || '%'
  )
  SELECT person_name, COUNT(DISTINCT loan_number) AS loans, SUM(hours) AS total_hours,
    ROUND(AVG(hours), 3) AS avg_hours_per_loan
  FROM parsed GROUP BY person_name ORDER BY total_hours DESC

  Format B — space-delimited alternating key-value pairs (e.g. "user1 0.5 user2 1.2"):
  WITH tokens AS (
    SELECT l.loan_number, t.token, t.ordinality
    FROM public.loans l,
    LATERAL regexp_split_to_table(TRIM(l.some_field), '\\s+') WITH ORDINALITY AS t(token, ordinality)
    WHERE l.some_field IS NOT NULL AND TRIM(l.some_field) != ''
  ),
  paired AS (
    SELECT loan_number,
      MAX(CASE WHEN ordinality % 2 = 1 THEN token END) AS person_name,
      MAX(CASE WHEN ordinality % 2 = 0 THEN token END)::numeric AS hours
    FROM tokens
    GROUP BY loan_number, CEIL(ordinality::numeric / 2)
  )
  SELECT person_name, COUNT(DISTINCT loan_number) AS loans, SUM(hours) AS total_hours
  FROM paired GROUP BY person_name ORDER BY total_hours DESC

- For pipe-separated lists: unnest(string_to_array(field, '|'))
- For comma-separated lists: unnest(string_to_array(field, ','))
- IMPORTANT: Always inspect the field with a small sample query FIRST before choosing a parsing strategy. Do not assume the format.
- Always handle NULLs and empty strings (TRIM, COALESCE) before parsing
- After parsing, aggregate as the investigation requires (SUM, AVG, COUNT per parsed entity)
- Column names may use dots (e.g. cx_touches_all_userhours); reference them with double quotes if needed: l."CX.TOUCHES.ALL.USERHOURS"

- When you have enough evidence (usually 2-3 queries), produce your finding

OUTPUT FORMAT (when outputHint is provided):
- The outputHint describes the table or visualization the user wants. Your goal is to produce it as closely as possible.
- ALWAYS produce a finding with data, even if parsing is imperfect. A partial result is far better than giving up. NEVER refuse to produce output — the user already knows the data is parseable.
- Include as many of the requested columns as you can. If the schema doesn't have a column the user mentioned, skip it and note it in your finding summary — don't let one missing column stop you from producing the rest.
- For pivot-style requests ("a column for each person with their hours"): produce a normalized table with one row per loan-person combination (loan_number, person_name, hours, plus the other requested columns). The UI can display this effectively. Don't try to build dynamic column names — just normalize.
- Your final query before the finding should be the one that produces the user's requested table. Earlier queries can explore the data structure.
- If a query fails or returns unexpected results, try a different parsing approach. You have up to 5 iterations — use them to iterate on the SQL until it works.

DERIVED METRICS AND TIERS (CRITICAL — READ BEFORE ANY PERSONNEL INVESTIGATION):
- "Tier" is NEVER a stored column. Tiers must always be COMPUTED from composite scores.
- When a user asks about "tier distribution", "personnel tiers", "scorecard", or "LO tiers":
  1. Compute per-personnel metrics (funded volume, units, pull-through, avg cycle time, revenue BPS)
  2. Compute company-wide averages for each metric
  3. Calculate ratings as (actor_value / company_avg) * 100 — score of 100 = average
  4. Average the ratings to get a TTS score
  5. Rank personnel by TTS score descending and assign tiers by percentile:
     - Top tier:    top 20% by count
     - Second tier: next 30% (rank 21%-50%)
     - Bottom tier: remaining 50%
- The "Business Knowledge" section of your context (if present) contains the exact formulas
  and a complete SQL recipe you can adapt. USE IT — do not guess or invent a simplified approach.
- Revenue BPS = (rate_lock_buy_side_base_price_rate - 100) * 100 when rate > 100, else default 25
- Turn-time and concession ratings are INVERSE: (company_avg / actor_value) * 100

- CRITICAL: Your finding title MUST reflect what the data actually shows, NOT the original hypothesis. If your investigation disproved the hypothesis, the title must reflect the real finding.
- Every key in keyMetrics MUST have a corresponding entry in keyMetricDescriptions AND keyMetricFormats.
- keyMetricDescriptions: 1 sentence explaining what the metric measures in plain business language.
- keyMetricFormats: the display format for each metric. Must be one of: "number" (plain count), "currency" (dollar amount), "percent" (percentage), "days" (day count), "date" (calendar date), "text" (freeform string).

Respond in JSON format:
{
  "thinking": "Your reasoning about what to investigate next",
  "action": "query" | "finding",
  "sql": "SELECT ... (only when action=query)",
  "explanation": "What this query investigates (only when action=query)",
  "columnFormats": { "column_alias": "number|currency|percent|days|date|text", ... },
  "chartHint": {
    "type": "bar|horizontal_bar|line|area|pie|donut|grouped_bar|stacked_bar",
    "xKey": "category_or_date_column",
    "yKey": "primary_value_column",
    "yKeys": ["col1", "col2"],
    "xLabel": "Human-readable X axis label",
    "yLabel": "Human-readable Y axis label",
    "nameKey": "category_column (pie/donut only)",
    "valueKey": "value_column (pie/donut only)"
  },
  "finding": {
    "title": "Concise finding title — must reflect the actual evidence",
    "summary": "2-4 sentence summary of what you found, with specific numbers",
    "confidence": "high" | "medium" | "low",
    "keyMetrics": { "metricName": "value", ... },
    "keyMetricDescriptions": { "metricName": "One sentence explaining what this metric measures", ... },
    "keyMetricFormats": { "metricName": "number|currency|percent|days|date|text", ... }
  }
}`;

// ============================================================================
// Agent Loop
// ============================================================================

const MAX_ITERATIONS = 8;

export async function runDataAnalystAgent(
  question: InvestigationQuestion,
  schemaContext: string,
  metricDefinitions: string,
  tenantPool: pg.Pool,
  apiKey: string,
  onStep: OnStepCallback,
  getSteeringDirective: () => string | null,
  checkPause: () => Promise<void>,
  knowledgeContext?: string,
  businessKnowledge?: string
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

  if (businessKnowledge) {
    userContentParts.push(`\n${businessKnowledge}`);
  }

  if (knowledgeContext) {
    userContentParts.push(`\n${knowledgeContext}`);
  }

  userContentParts.push(
    `\n## Investigation Question`,
    `Topic: ${question.topic}`,
    `Hypothesis: ${question.hypothesis}`,
    `Suggested Approach: ${question.approach}`,
  );

  if (question.outputHint) {
    userContentParts.push(
      `\n## Desired Output Format (from the user's request)`,
      `${question.outputHint}`,
      `Your final query should produce a table as close to this format as possible. Include as many of the requested columns as the schema supports. Always produce data — a partial table is much better than no table.`
    );
  }

  userContentParts.push(
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
      maxTokens: 4096,
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
        keyMetricDescriptions: parsed.finding.keyMetricDescriptions || {},
        keyMetricFormats: parsed.finding.keyMetricFormats || {},
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
        columnFormats: parsed.columnFormats || undefined,
        chartHint: parsed.chartHint || undefined,
      });

      const formattedResults = formatResultsForLLM(queryResult);
      const iterationsRemaining = MAX_ITERATIONS - iteration;
      const urgency = iterationsRemaining <= 2
        ? `\n\n⚠️ You have ${iterationsRemaining} iteration(s) remaining. You MUST produce your finding on the next iteration. Use the best evidence you have — do NOT run another query unless absolutely necessary. Produce action "finding" now with whatever data you've collected.`
        : iterationsRemaining <= 3
        ? `\n\nNote: ${iterationsRemaining} iterations remaining. Start wrapping up — produce your finding soon.`
        : "";
      conversationHistory.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `Query results (${queryResult.rowCount} rows, ${queryResult.executionTimeMs}ms):\n\n${formattedResults}\n\nAnalyze these results. Either run another query for more data, or produce your final finding if you have enough evidence.${urgency}`,
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

  // Ran out of iterations — force the LLM to produce a finding from what it has
  if (evidence.length > 0) {
    try {
      conversationHistory.push({
        role: "user",
        content: `You have reached the iteration limit. You MUST produce your finding NOW using action "finding". Summarize what you found from the ${evidence.length} queries you ran. The last query's results are your primary evidence table. Do not run any more queries.`,
      });

      const finalRaw = await callLLM(conversationHistory, apiKey, {
        temperature: 0.2,
        maxTokens: 4096,
        jsonMode: true,
      });

      const finalParsed = JSON.parse(finalRaw);
      if (finalParsed.action === "finding" && finalParsed.finding) {
        const finding: Finding = {
          questionId: question.id,
          title: finalParsed.finding.title || question.topic,
          summary: finalParsed.finding.summary || "Investigation reached iteration limit.",
          confidence: finalParsed.finding.confidence || "medium",
          evidence,
          keyMetrics: finalParsed.finding.keyMetrics || {},
          keyMetricDescriptions: finalParsed.finding.keyMetricDescriptions || {},
          keyMetricFormats: finalParsed.finding.keyMetricFormats || {},
        };

        onStep({
          iteration: MAX_ITERATIONS + 1,
          type: "finding",
          content: JSON.stringify(finding, null, 2),
          timestamp: Date.now(),
        });

        return finding;
      }
    } catch {
      // Fall through to static fallback
    }
  }

  return buildFallbackFinding(question, evidence);
}

// ============================================================================
// Fallback finding when agent produces no evidence at all
// ============================================================================

function buildFallbackFinding(
  question: InvestigationQuestion,
  evidence: EvidenceItem[]
): Finding {
  return {
    questionId: question.id,
    title: question.topic,
    summary: evidence.length > 0
      ? `Investigation gathered ${evidence.length} data point(s). Review the evidence tables below for the raw results.`
      : `Investigation could not gather sufficient data to answer this question.`,
    confidence: "low",
    evidence,
    keyMetrics: {},
  };
}
