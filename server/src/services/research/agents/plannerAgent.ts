/**
 * Planner Agent
 *
 * Receives the tenant's database schema, canonical metric definitions,
 * and optional user-specified topic. Produces a structured research plan
 * with 1-7 investigation questions (1-3 for specific requests, 3-7 for broad), each with a hypothesis and approach.
 */

import { callLLM, type LLMMessage } from "../tools.js";
import { pool as managementPool } from "../../../config/managementDatabase.js";

// ============================================================================
// Types
// ============================================================================

export interface InvestigationQuestion {
  id: number;
  topic: string;
  hypothesis: string;
  approach: string;
  priority: "high" | "medium" | "low";
  category: string;
  /** When the user asks for a specific output format (e.g. table showing X by Y), describe it here. */
  outputHint?: string | null;
}

export interface ResearchPlan {
  summary: string;
  questions: InvestigationQuestion[];
}

// ============================================================================
// System Prompt
// ============================================================================

const PLANNER_SYSTEM_PROMPT = `You are a Research Planner for a mortgage lending analytics platform. Your job is to create a focused, data-driven investigation plan.

You will receive:
- The tenant's database schema (loans table columns, types, enum values)
- Canonical metric definitions (SQL formulas for standard KPIs)
- Optionally, a specific topic the user wants investigated

Your output is a JSON object with:
{
  "summary": "Brief 1-2 sentence overview of the research plan",
  "questions": [
    {
      "id": 1,
      "topic": "Short descriptive topic title",
      "hypothesis": "What you expect to find or investigate",
      "approach": "How a data analyst should investigate this — what tables to query, what comparisons to make, what date ranges to use",
      "priority": "high" | "medium" | "low",
      "category": "performance" | "risk" | "personnel" | "pipeline" | "compliance" | "trends",
      "outputHint": "optional: describe the exact output format the user wants (e.g. 'table showing personnel name then hours per loan', 'breakdown of X by Y', 'trend over time') or null"
    }
  ]
}

RULES:
- DATA BUILD vs INVESTIGATION: Distinguish between two types of requests:
  1. DATA BUILD — the user describes a specific output they want ("I want a table with columns A, B, C", "show me a breakdown of X by Y", "parse field F and create a table showing..."). For data-build requests, generate EXACTLY 1 question whose sole purpose is producing that exact table/output. The outputHint MUST contain the complete column specification. Do NOT add extra questions about data quality, validation, or distribution — the user wants the table, not an investigation about the table. Set priority to "high".
  2. INVESTIGATION — the user asks a question or wants analysis ("Why is pull-through dropping?", "overall pipeline health", "investigate processing delays"). For investigations, follow the question count rules below.
- Question count for INVESTIGATIONS: If the user's request is highly specific (a single metric, a single question), generate only 1-3 focused questions. If broad ("overall pipeline health", "comprehensive analysis"), generate 3-7 covering multiple areas. Do not pad with unrelated questions.
- Each question should be independently investigable with SQL queries against the loans table
- Approaches should be specific: mention column names, date ranges (use CURRENT_DATE-based expressions), aggregation strategies
- If a user topic is provided and this is an investigation, at least 2-3 questions should focus on that topic; the rest can be broader
- If no topic is provided, cover a mix of: pipeline health, conversion rates, personnel performance, risk patterns, and time trends
- Consider multiple time windows: YTD, rolling 90D, rolling 30D, trailing 12M
- For conversion metrics (pull-through, fallout, funded rate): be aware that mortgage cycle times often exceed 30 days. A 30D application cohort will contain many loans still in-process, making conversion rates unreliable. Prefer 90D or YTD windows for these metrics unless the investigation specifically needs short-window sensitivity. When planning 30D conversion analysis, include a cycle-time check so the analyst can contextualize the results.
- Focus on questions that can reveal actionable patterns, not just descriptive statistics
- NEVER suggest queries that modify data
- Today's date context will be provided separately
- DATA QUALITY: "Active Loan" status often includes stale records not properly closed out in the LOS. When planning pipeline-related questions, instruct the analyst to check for and segment stale active loans (application_date > 6 months old). Data quality issues (missing fields, stale statuses, impossible dates) are high-value findings — include them when relevant.
- If the user's request implies a specific output format (e.g. "create a table showing...", "break down X by Y", "show me hours per loan per user"), include an outputHint on the relevant question describing that format. Be VERY specific in the outputHint — list every column the user mentioned. The data analyst will use it to shape the final query so the user gets the exact table or visualization they asked for.
- When the user lists specific columns they want (e.g. "loan number, loan officer, state, FICO..."), copy that FULL column list verbatim into the outputHint. Do not summarize or abbreviate it.
- PERSONNEL TIERS AND SCORECARDS: "Tier" is NEVER a stored column. When the topic mentions tiers, scorecard, tiering, personnel performance, or LO ranking, plan questions that COMPUTE tiers from composite scores (TTS). Do NOT suggest looking for a tier column. Instead plan questions like:
  - "Calculate TTS scores for all active LOs using volume, units, pull-through, turn time, and margin ratings vs company averages"
  - "Assign tiers by Pareto percentile (top 20% / second 30% / bottom 50%) and show distribution"
  - "Identify top vs bottom tier LOs by TTS and compare key metrics"
  The "Business Knowledge" context section (if present) provides the exact TTS formula and a ready-to-use SQL recipe.`;

// ============================================================================
// Training Examples
// ============================================================================

async function fetchPlannerTrainingExamples(): Promise<string> {
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
      `SELECT example_type, headline, admin_note
       FROM insight_training_examples
       WHERE prompt_id = 'research.planner' AND is_active = true
       ORDER BY created_at DESC LIMIT 5`
    );
    if (result.rows.length === 0) return "";

    const positive = result.rows.filter((r: any) => r.example_type === "positive").slice(0, 3);
    const negative = result.rows.filter((r: any) => r.example_type === "negative").slice(0, 2);
    if (positive.length === 0 && negative.length === 0) return "";

    let section = "\n\nLEARN FROM THESE EXAMPLES:";
    if (positive.length > 0) {
      section += "\nGOOD investigation plans:";
      for (const ex of positive) {
        section += `\n- "${ex.headline}"`;
        if (ex.admin_note) section += ` — ${ex.admin_note}`;
      }
    }
    if (negative.length > 0) {
      section += "\nBAD investigation plans (avoid):";
      for (const ex of negative) {
        section += `\n- "${ex.headline}"`;
        if (ex.admin_note) section += ` — ${ex.admin_note}`;
      }
    }
    return section;
  } catch {
    return "";
  }
}

// ============================================================================
// Agent Entry Point
// ============================================================================

export async function runPlannerAgent(
  schemaContext: string,
  metricDefinitions: string,
  apiKey: string,
  options: { topic?: string; knowledgeContext?: string; priorInvestigationContext?: string; priorSessionSummaries?: string; businessKnowledge?: string; uploadContext?: string } = {}
): Promise<ResearchPlan> {
  const { topic, knowledgeContext, priorInvestigationContext, priorSessionSummaries, businessKnowledge, uploadContext } = options;

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const yearStr = now.getFullYear().toString();

  let userPrompt = `Today: ${todayStr}. Current year: ${yearStr}.\n\n`;
  userPrompt += `## Database Schema\n${schemaContext}\n\n`;
  userPrompt += `## Metric Definitions\n${metricDefinitions}\n\n`;

  if (businessKnowledge) {
    userPrompt += `${businessKnowledge}\n\n`;
  }

  if (uploadContext) {
    userPrompt += `## User-Uploaded Dataset Context\n`;
    userPrompt += `The user has uploaded data files for analysis. TWO types of uploads may be present:\n`;
    userPrompt += `- INLINE (small files, ≤200 rows): The full dataset is embedded as text in the analyst's knowledge context. `
      + `For questions involving inline data, the analyst will read it directly from context — they do NOT run SQL. `
      + `In the question "approach", say: "Analyze the inline CSV data from the knowledge context — do NOT use SQL for this. `
      + `Produce two evidence items: (1) a summary table with computed aggregates, and (2) a detail table with the `
      + `individual rows most relevant to this finding (e.g. all delinquent loans, all flagged records, top entries). `
      + `Include all original columns in the detail table." `
      + `These are labelled "User-Uploaded Dataset (INLINE)" in the context.\n`;
    userPrompt += `- SQL TABLE (large files, >200 rows): The data is loaded into a queryable table named upload_<name>. `
      + `For questions involving table data, the analyst CAN use SQL. `
      + `These are labelled "User-Uploaded Dataset Table: upload_..." in the schema context.\n\n`;
    userPrompt += `Prioritize investigation questions that leverage these datasets. Cross-reference with existing loan/warehouse data where column semantics overlap.\n${uploadContext}\n\n`;
  }

  if (topic) {
    userPrompt += `## User's Investigation Request\nThe user wants to investigate: "${topic}"\n\nCreate a research plan that prioritizes this topic while also covering other significant areas if relevant.\n`;
  } else if (uploadContext) {
    userPrompt += `## Investigation Scope\nThe user has uploaded data for analysis. Focus the investigation plan on understanding patterns, distributions, outliers, and correlations in the uploaded data. Also consider how it relates to existing loan/lending data.\n`;
  } else {
    userPrompt += `## Investigation Scope\nNo specific topic was requested. Create a comprehensive research plan covering pipeline health, conversion performance, personnel patterns, risk exposure, and trends.\n`;
  }

  if (priorInvestigationContext) {
    userPrompt += `\n## Prior Investigation Context\nThe user is escalating from a dashboard insight. Build on these findings — go deeper, explore related angles, and uncover patterns the initial analysis didn't cover.\n${priorInvestigationContext}\n`;
  }

  if (priorSessionSummaries) {
    userPrompt += `\n${priorSessionSummaries}\nAvoid duplicating these prior investigations unless the user specifically asks to revisit a topic. Instead, explore new angles, dig deeper on areas not yet covered, or check whether previously identified issues have changed.\n`;
  }

  if (knowledgeContext) {
    userPrompt += `\n${knowledgeContext}\nUse any relevant information from the knowledge base to inform your investigation plan — reference policies, guidelines, or thresholds where applicable.\n`;
  }

  userPrompt += `\nRespond with a JSON object containing "summary" and "questions" as described.`;

  const trainingSection = await fetchPlannerTrainingExamples();

  const messages: LLMMessage[] = [
    { role: "system", content: PLANNER_SYSTEM_PROMPT + trainingSection },
    { role: "user", content: userPrompt },
  ];

  const raw = await callLLM(messages, apiKey, {
    temperature: 0.7,
    maxTokens: 4096,
    jsonMode: true,
  });

  const parsed = JSON.parse(raw) as ResearchPlan;

  if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error("Planner agent returned no investigation questions.");
  }

  // Ensure IDs are sequential
  parsed.questions = parsed.questions.map((q, i) => ({ ...q, id: i + 1 }));

  return parsed;
}
