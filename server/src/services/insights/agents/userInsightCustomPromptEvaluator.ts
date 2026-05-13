/**
 * My Insights — dedicated evaluator for a single custom prompt + one InsightFinding.
 * Produces one EvaluatedInsight with ETM fields grounded in evidence (Option A).
 */

import { callLLM, type LLMMessage } from "../../research/tools.js";
import type { EvaluatedInsight } from "./insightEvaluatorAgent.js";
import type { InsightFinding } from "./insightInvestigatorAgent.js";
import { logWarn } from "../../logger.js";

const SYSTEM = `You are an Insight Evaluator for ONE user-saved My Insights question.
You receive the user's prompt and raw findings from SQL (summary, keyMetrics, evidence samples).

Output JSON only, matching this shape:
{
  "headline": "string, max ~20 words, must cite real numbers from keyMetrics or evidence when possible",
  "understory": "2-4 sentences; every number must appear in keyMetrics or evidence rows",
  "bucket": "critical" | "attention" | "working" | "context",
  "source": "operations | performance | pipeline | credit_risk | compliance | predictions | market_news | revenue | lost_opportunity | lock_risk | closing_risk | conversion | historical",
  "severity_score": 0.0-1.0,
  "what_changed": "string",
  "why": "string",
  "business_impact": "string",
  "risk_if_ignored": "string",
  "recommended_action": "string",
  "owner": "string role or team"
}

Rules:
- NEVER invent loan counts, dollars, rates, or dates not present in keyMetrics or evidence row samples.
- If evidence is empty or keyMetrics are empty and the question cannot be answered, write an honest "attention" or "context" insight explaining what is missing — without fabricated metrics.
- severity_score should align with bucket (critical ~0.75+, attention ~0.45-0.74, working ~0.35-0.55, context lower).
- source must be one of the allowed enum values listed above.
- recommended_action must be specific (who + what), not vague.
`;

function truncateJson(obj: unknown, maxLen: number): string {
  const s = JSON.stringify(obj);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}… (truncated)`;
}

export async function runUserCustomPromptEvaluator(
  apiKey: string,
  input: {
    title: string;
    promptText: string;
    specifierSummary: string;
    finding: InsightFinding;
  }
): Promise<EvaluatedInsight | null> {
  const findingPayload = {
    title: input.finding.title,
    summary: input.finding.summary,
    confidence: input.finding.confidence,
    keyMetrics: input.finding.keyMetrics,
    keyMetricDescriptions: input.finding.keyMetricDescriptions,
    evidence: (input.finding.evidence || []).slice(0, 4).map((e: any) => ({
      explanation: e.explanation,
      rowCount: e.rowCount,
      sampleRows: Array.isArray(e.rows) ? e.rows.slice(0, 8) : [],
    })),
  };

  const userMsg = [
    `Saved prompt title: ${input.title}`,
    `User request:\n${input.promptText}`,
    input.specifierSummary ? `Specifier cohort (server-enforced on SQL):\n${input.specifierSummary}` : "",
    `Investigator finding (ground truth for numbers):\n${truncateJson(findingPayload, 14_000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: LLMMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userMsg },
  ];

  try {
    const raw = await callLLM(messages, apiKey, {
      temperature: 0.25,
      maxTokens: 3500,
      jsonMode: true,
    });
    const p = JSON.parse(raw) as Record<string, unknown>;
    const headline = String(p.headline || "").trim();
    if (!headline) return null;

    const bucket = (["critical", "attention", "working", "context"].includes(String(p.bucket))
      ? p.bucket
      : "context") as EvaluatedInsight["bucket"];

    const priority =
      bucket === "critical" ? "RED" : bucket === "attention" ? "YELLOW" : bucket === "working" ? "BLUE" : "GRAY";
    const insight_type =
      bucket === "critical"
        ? "critical"
        : bucket === "attention"
          ? "warning"
          : bucket === "working"
            ? "success"
            : "info";

    const allowedSources = new Set([
      "operations",
      "performance",
      "pipeline",
      "credit_risk",
      "compliance",
      "predictions",
      "market_news",
      "revenue",
      "lost_opportunity",
      "lock_risk",
      "closing_risk",
      "conversion",
      "historical",
    ]);
    const source = allowedSources.has(String(p.source))
      ? String(p.source)
      : "operations";

    return {
      headline,
      understory: String(p.understory || "").trim() || headline,
      bucket,
      priority: priority as EvaluatedInsight["priority"],
      insight_type: insight_type as EvaluatedInsight["insight_type"],
      source,
      severity_score: Math.min(1, Math.max(0, Number(p.severity_score) || 0.5)),
      value_score: Math.min(1, Math.max(0, Number(p.severity_score) || 0.5)),
      impact: { type: "custom_prompt_data" },
      evidence: {
        metrics: Object.entries(input.finding.keyMetrics || {}).map(([label, value]) => ({
          label,
          value,
        })),
      },
      metricSignature: input.finding.metricSignature,
      headlineMetricSignature: input.finding.headlineMetricSignature,
      confidence: input.finding.confidence || "medium",
      findingIndex: 0,
      for_podcast: false,
      what_changed: p.what_changed ? String(p.what_changed) : undefined,
      why: p.why ? String(p.why) : undefined,
      business_impact: p.business_impact ? String(p.business_impact) : undefined,
      risk_if_ignored: p.risk_if_ignored ? String(p.risk_if_ignored) : undefined,
      recommended_action: p.recommended_action ? String(p.recommended_action) : undefined,
      owner: p.owner ? String(p.owner) : undefined,
      functional_category: undefined,
    };
  } catch (e: any) {
    logWarn(`[UserCustomPromptEvaluator] LLM failed: ${e.message}`);
    return null;
  }
}
