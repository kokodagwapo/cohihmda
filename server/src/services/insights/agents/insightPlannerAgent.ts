/**
 * Insight Planner Agent
 *
 * Dynamically decides which investigation domains matter for this tenant's
 * data. Unlike the research planner which is user-prompted, this runs
 * autonomously — it receives schema, metrics, field populations, previous
 * insights, and tracked items and determines what to investigate next.
 */

import { callLLM, type LLMMessage } from "../../research/tools.js";
import type { InvestigationQuestion, ResearchPlan } from "../../research/agents/plannerAgent.js";
import { pool as managementPool } from "../../../config/managementDatabase.js";

export type { InvestigationQuestion, ResearchPlan };

// ============================================================================
// System Prompt
// ============================================================================

const INSIGHT_PLANNER_PROMPT = `You are an autonomous Insight Planner for a mortgage lending analytics platform. Your job is to decide what is most important to investigate in this tenant's data RIGHT NOW and produce investigation questions.

You are NOT constrained to fixed domains. Analyze the context you receive and choose investigation areas by potential business impact. If the data suggests personnel issues, investigate personnel. If pipeline risk is the bigger story, focus there. If nothing has changed meaningfully, say so.

You will receive:
- Database schema (loans table columns and types)
- Canonical metric definitions (SQL formulas for standard KPIs)
- Field population stats (which fields are actually populated — low-population fields may indicate unused features)
- Previous insight headlines (the last batch — avoid repeating stale findings)
- Tracked insights (metrics users have pinned and are actively monitoring)
- Data quality flags (critical issues with the data)

Your output is a JSON object:
{
  "summary": "1-2 sentence assessment of what's most important to investigate right now",
  "questions": [
    {
      "id": 1,
      "topic": "Short descriptive topic",
      "hypothesis": "What you expect to find",
      "approach": "Specific SQL investigation strategy — mention column names, date expressions using CURRENT_DATE, aggregation methods",
      "priority": "high" | "medium" | "low",
      "category": "free-form category name"
    }
  ]
}

RULES:
- Generate 12-18 questions, prioritized by likely business impact. More is better — the evaluator will filter. Include a mix: 4-5 risk/problem questions, 2-3 positive/performance questions, 2-3 trend/benchmark questions, and 2-3 informational/context questions (portfolio composition, product mix, geographic distribution).
- Each question must be independently investigable with SQL queries against the loans table (alias: l)
- Approaches MUST be specific: column names, CURRENT_DATE-based date ranges, GROUP BY strategies
- DO NOT repeat topics from the previous insight batch unless the data has likely changed
- If tracked insights exist, include at least 1-2 questions that re-evaluate or deepen those specific areas
- Consider multiple time windows: YTD, rolling 30D, rolling 90D, prior-period comparisons
- For conversion/completion metrics (pull-through, fallout, funded rate): mortgage cycle times often exceed 30 days, so a 30D application cohort contains many loans still in-process — making short-window PT artificially low and fallout artificially high. Prefer 90D or YTD for these metrics. If you plan a short-window conversion question, pair it with a cycle-time check so the analyst can assess reliability.
- Prioritize questions that reveal ACTIONABLE patterns over descriptive statistics
- If a field has very low population (<20%), don't base questions on it — mention it as a data quality note instead
- Categories should be descriptive (e.g., "pipeline_velocity", "officer_performance", "lock_expiration_risk"), NOT generic ("general", "other")
- PostgreSQL syntax: DATE - DATE returns integer days. Use CURRENT_DATE for today.
- Active loan status: current_loan_status = 'Active Loan' AND application_date IS NOT NULL (loans without application_date are data artifacts, not real pipeline)
- Funded: current_loan_status ILIKE '%Originated%' OR ILIKE '%purchased%'
- Withdrawn: current_loan_status ILIKE '%Withdrawn%'
- Denied: current_loan_status ILIKE '%Denied%'
- NEVER suggest queries that modify data

BALANCED COVERAGE — INCLUDE STRATEGIC REVIEW (POSITIVE SIGNALS):
- A good insight batch is not all problems. Always include 2-3 questions that look for POSITIVE signals: personnel improving, pull-through trending up, cycle times shortening, strong branch performance, successful loan products, officers exceeding targets.
- Compare current-period performance against prior periods (90D vs prior 90D, YTD vs prior YTD) to find improvements, not just declines.
- Examples: "Which loan officers improved their pull-through rate most vs prior quarter?", "Are any branches showing faster cycle times YTD vs prior year?", "Which product types have the strongest funded volume growth?"
- The evaluator has a Level 3 (Strategic Review) bucket for positive insights — you need to feed it questions that can discover good news.

DATA QUALITY — FOCUS ON REAL PIPELINE:
- The active pipeline filter (current_loan_status = 'Active Loan' AND application_date IS NOT NULL) is already applied. Loans without application_date are pre-excluded data artifacts — do NOT plan questions about missing application_date or count those records. That is a known data artifact, not a discovery.
- Within the real active pipeline (loans WITH application_date), look for genuine data quality issues: missing lock dates on loans that should be locked, impossible date sequences, loans stuck in early milestones for abnormally long periods.
- IMPORTANT: The "Stale Loan Data" section below will tell you whether this tenant has stale loans. If the tenant has virtually no stale loans, do NOT waste investigation questions on stale/abandoned pipeline. If stale loans are significant, you may include one question about it.
- Data quality findings about the REAL pipeline are valuable. But "X% of Active Loan records have no application_date" is NOT — those are just import artifacts.

MARKET RATE CONTEXT:
- When market context is provided, include 1-2 questions that investigate the relationship between rate movements and pipeline behavior (lock expirations, withdrawal spikes, refi vs purchase mix shifts, borrower rate sensitivity).
- Market data comes from OBMMIC30YF (30-Year Fixed Conforming). Use the provided trend to contextualize pipeline risk findings.
- Examples: "How does the recent 25bps rate increase correlate with withdrawal activity in the last 30 days?", "What % of the locked pipeline has rates above the current market rate, indicating potential borrower regret?", "Has the refi vs purchase mix shifted in response to rate changes?"
- If rates are rising: prioritize lock expiration risk, withdrawal risk, and pipeline velocity questions.
- If rates are falling: look for refi surge opportunities and borrower regret on recently locked loans.

INDUSTRY NEWS CONTEXT:
- When industry news context is provided, include 1-2 questions that test whether recent external events are visible in this tenant's pipeline data.
- Focus on measurable relationships between headlines and portfolio behavior (application volume shifts, lock behavior changes, product mix movement, denial/withdrawal movement, cycle-time impacts).
- If the news is regulatory/compliance-focused (CFPB/FHFA), include at least one question to check operational or compliance exposure in current pipeline composition.`;

// ============================================================================
// Training Examples
// ============================================================================

async function fetchTrainingExamples(): Promise<string> {
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
       WHERE prompt_id = 'insights.planner' AND is_active = true
       ORDER BY created_at DESC LIMIT 5`
    );
    if (result.rows.length === 0) return "";

    const positive = result.rows.filter((r: any) => r.example_type === "positive").slice(0, 3);
    const negative = result.rows.filter((r: any) => r.example_type === "negative").slice(0, 2);
    if (positive.length === 0 && negative.length === 0) return "";

    let section = "\n\nLEARN FROM THESE EXAMPLES:";
    if (positive.length > 0) {
      section += "\nGood investigation plans:";
      for (const ex of positive) {
        section += `\n- "${ex.headline}"`;
        if (ex.admin_note) section += ` — ${ex.admin_note}`;
      }
    }
    if (negative.length > 0) {
      section += "\nBad plans (avoid):";
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
// Context Builders
// ============================================================================

export interface InsightPlannerContext {
  schemaContext: string;
  metricDefinitions: string;
  fieldPopulationStats?: string;
  previousInsightHeadlines?: string[];
  trackedInsights?: Array<{ headline: string; metric_signature: any }>;
  dataQualityFlags?: string[];
  knowledgeContext?: string;
  marketContext?: string;
  industryNewsContext?: string;
  staleLoanContext?: string;
}

function buildUserPrompt(ctx: InsightPlannerContext): string {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const yearStr = now.getFullYear().toString();

  let prompt = `Today: ${todayStr}. Current year: ${yearStr}.\n\n`;
  prompt += `## Database Schema\n${ctx.schemaContext}\n\n`;
  prompt += `## Metric Definitions\n${ctx.metricDefinitions}\n\n`;

  if (ctx.fieldPopulationStats) {
    prompt += `## Field Population Stats\n${ctx.fieldPopulationStats}\n\n`;
  }

  if (ctx.previousInsightHeadlines && ctx.previousInsightHeadlines.length > 0) {
    prompt += `## Previous Insight Headlines (last batch — avoid repeating unless data likely changed)\n`;
    ctx.previousInsightHeadlines.forEach((h, i) => {
      prompt += `${i + 1}. ${h}\n`;
    });
    prompt += "\n";
  }

  if (ctx.trackedInsights && ctx.trackedInsights.length > 0) {
    prompt += `## Tracked Insights (users are actively monitoring these — include re-evaluation questions)\n`;
    ctx.trackedInsights.forEach((t, i) => {
      prompt += `${i + 1}. "${t.headline}"\n`;
    });
    prompt += "\n";
  }

  if (ctx.dataQualityFlags && ctx.dataQualityFlags.length > 0) {
    prompt += `## Data Quality Flags\n`;
    ctx.dataQualityFlags.forEach((f) => {
      prompt += `- ${f}\n`;
    });
    prompt += "\n";
  }

  if (ctx.knowledgeContext) {
    prompt += `## Organization Knowledge Base Context\nThe following context comes from the organization's knowledge center and may contain domain-specific definitions, processes, or priorities that should inform your investigation planning:\n${ctx.knowledgeContext}\n\n`;
  }

  if (ctx.marketContext) {
    prompt += `## Market Rate Context (OBMMIC30YF — 30-Year Fixed Conforming)\n${ctx.marketContext}\n\n`;
  }

  if (ctx.industryNewsContext) {
    prompt += `## Industry News Context\n${ctx.industryNewsContext}\n\n`;
  }

  if (ctx.staleLoanContext) {
    prompt += `## Stale Loan Data\n${ctx.staleLoanContext}\n\n`;
  }

  prompt += `Produce your investigation plan as a JSON object with "summary" and "questions".`;
  return prompt;
}

// ============================================================================
// Agent Entry Point
// ============================================================================

export async function runInsightPlannerAgent(
  apiKey: string,
  context: InsightPlannerContext
): Promise<ResearchPlan> {
  const userPrompt = buildUserPrompt(context);
  const trainingSection = await fetchTrainingExamples();

  const messages: LLMMessage[] = [
    { role: "system", content: INSIGHT_PLANNER_PROMPT + trainingSection },
    { role: "user", content: userPrompt },
  ];

  const raw = await callLLM(messages, apiKey, {
    temperature: 0.6,
    maxTokens: 8000,
    jsonMode: true,
  });

  const parsed = JSON.parse(raw) as ResearchPlan;

  if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error("Insight planner returned no investigation questions.");
  }

  parsed.questions = parsed.questions.map((q, i) => ({ ...q, id: i + 1 }));
  return parsed;
}
