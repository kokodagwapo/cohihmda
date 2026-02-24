/**
 * Synthesis Agent
 *
 * Takes all findings from data analyst agents plus the original research plan.
 * Produces a cohesive executive report: summary, key themes, ranked insights,
 * and areas for further investigation.
 */

import { callLLM, type LLMMessage } from "../tools.js";
import type { ResearchPlan } from "./plannerAgent.js";
import type { Finding } from "./dataAnalystAgent.js";

// ============================================================================
// Types
// ============================================================================

export interface ResearchTheme {
  name: string;
  description: string;
  findingIds: number[];
  severity: "critical" | "warning" | "info" | "positive";
}

export interface RankedInsight {
  rank: number;
  headline: string;
  detail: string;
  impact: "high" | "medium" | "low";
  supportingFindingIds: number[];
}

export interface FurtherInvestigation {
  question: string;
  rationale: string;
}

export interface ResearchReport {
  /** Optional 1-2 sentence direct answer to the user's original question. */
  directAnswer?: string | null;
  executiveSummary: string;
  themes: ResearchTheme[];
  rankedInsights: RankedInsight[];
  furtherInvestigation: FurtherInvestigation[];
  generatedAt: string;
}

// ============================================================================
// System Prompt
// ============================================================================

const SYNTHESIS_SYSTEM_PROMPT = `You are a Synthesis Agent for a mortgage lending research platform. Your job is to compile findings from multiple data analyst agents into a cohesive, executive-level research report.

You will receive:
- The original research plan (questions that were investigated)
- Findings from each investigation, including data evidence and key metrics

Your output is a JSON object:
{
  "directAnswer": "Optional: if the user asked a specific question, give a 1-2 sentence direct answer to that question with the key result (e.g. the main number or table takeaway). Omit or null if the request was broad / exploratory.",
  "executiveSummary": "2-3 sentence high-level summary of the most important findings",
  "themes": [
    {
      "name": "Theme name",
      "description": "1-2 sentence description of this pattern/theme",
      "findingIds": [1, 2],
      "severity": "critical" | "warning" | "info" | "positive"
    }
  ],
  "rankedInsights": [
    {
      "rank": 1,
      "headline": "Most impactful insight headline",
      "detail": "2-3 sentences explaining the insight with specific numbers",
      "impact": "high" | "medium" | "low",
      "supportingFindingIds": [1]
    }
  ],
  "furtherInvestigation": [
    {
      "question": "What else should be looked into?",
      "rationale": "Why this deserves deeper analysis"
    }
  ]
}

RULES:
- DATA BUILD requests: When the user asked for a specific output (a table, a breakdown, "show me X"), set directAnswer to a 1-2 sentence response telling them what was produced (e.g. "The table below shows hours per personnel across all loans."). The finding that contains the user's requested table MUST be the basis for the rank-1 insight so its evidence data is displayed first and prominently.
- INVESTIGATION requests: When the request was broad/exploratory, omit directAnswer or set to null, and rank insights by business impact.
- Themes should group related findings and identify cross-cutting patterns
- Ranked insights: For data-build requests, the finding that directly answers the user's question is ALWAYS rank 1. For investigations, rank by business impact.
- Use specific numbers from the findings — do not generalize or invent data
- Severity levels: "critical" = requires immediate attention, "warning" = concerning trend, "info" = noteworthy, "positive" = good performance
- Only suggest further investigation for genuinely unresolved questions
- Be concise but precise — this is for executives who need actionable intelligence
- If findings conflict, note the discrepancy and explain possible reasons`;

// ============================================================================
// Agent Entry Point
// ============================================================================

export async function runSynthesisAgent(
  plan: ResearchPlan,
  findings: Finding[],
  apiKey: string,
  userTopic?: string | null
): Promise<ResearchReport> {
  const planSummary = plan.questions
    .map((q) => `Q${q.id}: [${q.category}] ${q.topic}`)
    .join("\n");

  const findingsSummary = findings
    .map((f) => {
      const metricsStr = Object.entries(f.keyMetrics)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n");
      const evidenceStr = f.evidence
        .map((e) => `  Query: ${e.explanation} (${e.rowCount} rows)`)
        .join("\n");
      return [
        `### Finding for Q${f.questionId}: ${f.title}`,
        `Confidence: ${f.confidence}`,
        `Summary: ${f.summary}`,
        metricsStr ? `Key Metrics:\n${metricsStr}` : "",
        evidenceStr ? `Evidence:\n${evidenceStr}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const userPrompt = [
    userTopic ? `## User's question / topic\n${userTopic}\n` : "",
    `## Research Plan`,
    planSummary,
    `\n## Findings from Data Analysts`,
    findingsSummary,
    `\nSynthesize these findings into a cohesive research report.${userTopic ? " If the user asked a specific question above, include a directAnswer field with a 1-2 sentence direct response." : ""} Respond with JSON.`,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: LLMMessage[] = [
    { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const raw = await callLLM(messages, apiKey, {
    temperature: 0.4,
    maxTokens: 4000,
    jsonMode: true,
  });

  const parsed = JSON.parse(raw) as ResearchReport;

  // Ensure ranked insights have sequential ranks
  if (parsed.rankedInsights) {
    parsed.rankedInsights = parsed.rankedInsights.map((ins, i) => ({
      ...ins,
      rank: i + 1,
    }));
  }

  parsed.generatedAt = new Date().toISOString();

  return parsed;
}
