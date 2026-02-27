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
  /** One-line actionable takeaway (e.g. "Review LO tier mix to improve pull-through."). */
  keyTakeaway?: string;
  detail: string;
  impact: "high" | "medium" | "low";
  supportingFindingIds: number[];
  /** Recommended next step; required for high/medium impact. */
  recommendedAction?: string;
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
  "directAnswer": "Optional: if the user asked a specific question, give a 1-2 sentence direct answer with the key result. Use **bold** for key numbers. Omit or null if the request was broad / exploratory.",
  "executiveSummary": "2-3 sentence high-level summary of the most important findings. Use **bold** for key metrics and bullet lists where helpful.",
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
      "keyTakeaway": "One-line actionable sentence (e.g. 'Review LO tier mix to improve pull-through.')",
      "detail": "2-3 sentences with **bold** for key numbers; use bullet lists for multiple sub-points.",
      "impact": "high" | "medium" | "low",
      "supportingFindingIds": [1],
      "recommendedAction": "Concrete next step (required for high/medium impact; e.g. 'Segment by channel and rerun conversion metrics.')"
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
- DATA BUILD requests: When the user asked for a specific output (a table, a breakdown, "show me X"), set directAnswer to a 1-2 sentence response. The finding that contains the user's requested table MUST be the basis for the rank-1 insight.
- INVESTIGATION requests: Omit directAnswer or set to null; rank insights by business impact.
- FORMATTING: Use Markdown in directAnswer, executiveSummary, theme descriptions, and insight detail: **bold** for key numbers and metrics, bullet lists (- item) for multiple points. This improves scanability.
- MORTGAGE FRAMING: Always frame insights in terms of business impact: revenue, pipeline volume, risk exposure, cycle time, conversion (pull-through/fallout/denial), and compliance. Avoid generic language; tie each insight to a concrete operational or financial effect.
- keyTakeaway: Every ranked insight MUST have a keyTakeaway — one short, actionable sentence.
- recommendedAction: Every high- or medium-impact insight MUST have a recommendedAction. Low-impact can omit or keep brief.
- Themes: Group related findings; use severity consistently (critical / warning / info / positive).
- Use specific numbers from the findings — do not generalize or invent data.
- If findings conflict, note the discrepancy and explain possible reasons.`;

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
