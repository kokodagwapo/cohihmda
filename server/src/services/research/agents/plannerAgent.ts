/**
 * Planner Agent
 *
 * Receives the tenant's database schema, canonical metric definitions,
 * and optional user-specified topic. Produces a structured research plan
 * with 3-7 investigation questions, each with a hypothesis and approach.
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
      "category": "performance" | "risk" | "personnel" | "pipeline" | "compliance" | "trends"
    }
  ]
}

RULES:
- Generate 3-7 questions, prioritized by likely business impact
- Each question should be independently investigable with SQL queries against the loans table
- Approaches should be specific: mention column names, date ranges (use CURRENT_DATE-based expressions), aggregation strategies
- If a user topic is provided, at least 2-3 questions should focus on that topic; the rest can be broader
- If no topic is provided, cover a mix of: pipeline health, conversion rates, personnel performance, risk patterns, and time trends
- Consider multiple time windows: YTD, rolling 90D, rolling 30D, trailing 12M
- Focus on questions that can reveal actionable patterns, not just descriptive statistics
- NEVER suggest queries that modify data
- Today's date context will be provided separately`;

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
  options: { topic?: string; knowledgeContext?: string } = {}
): Promise<ResearchPlan> {
  const { topic, knowledgeContext } = options;

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const yearStr = now.getFullYear().toString();

  let userPrompt = `Today: ${todayStr}. Current year: ${yearStr}.\n\n`;
  userPrompt += `## Database Schema\n${schemaContext}\n\n`;
  userPrompt += `## Metric Definitions\n${metricDefinitions}\n\n`;

  if (topic) {
    userPrompt += `## User's Investigation Request\nThe user wants to investigate: "${topic}"\n\nCreate a research plan that prioritizes this topic while also covering other significant areas if relevant.\n`;
  } else {
    userPrompt += `## Investigation Scope\nNo specific topic was requested. Create a comprehensive research plan covering pipeline health, conversion performance, personnel patterns, risk exposure, and trends.\n`;
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
    maxTokens: 3000,
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
