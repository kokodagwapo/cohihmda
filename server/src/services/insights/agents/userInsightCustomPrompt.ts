/**
 * My Insights — user-authored custom prompts (batch path).
 * Single LLM call per prompt; output normalized to EvaluatedInsight-like shape for persistence.
 *
 * Spec audit: user-scoped `user_insight_prompts`, specifier summary → cohort narrative (no free-text SQL),
 * batch + on-demand schedules, JSON insight card shape, and failure stubs align with the My Insights MVP.
 * Deferred per spec: `condition` JSONB / hybrid SQL gate, tenant-wide prompts (P2).
 */

import { callLLM, type LLMMessage } from "../../research/tools.js";
import type { EvaluatedInsight } from "./insightEvaluatorAgent.js";
import { logWarn } from "../../logger.js";

const CUSTOM_PROMPT_SYSTEM = `You are an executive insight author for a mortgage lending analytics platform.
Given the user's saved question and optional cohort description, produce ONE dashboard insight card.

Each invocation must directly answer that single saved user request; the headline should clearly reflect the prompt title or intent where natural.

Respond with JSON only:
{
  "headline": "string, max ~20 words, specific",
  "understory": "string, 2-4 sentences with concrete guidance",
  "bucket": "critical" | "attention" | "working" | "context",
  "source": "operations",
  "severity_score": 0.0-1.0,
  "what_changed": "string optional",
  "why": "string optional",
  "recommended_action": "string optional",
  "key_metrics": { "label": "value as string or number" }
}

Rules:
- Use only plausible mortgage operations themes; do not fabricate exact loan counts.
- If the question cannot be answered without data access, write an "attention" insight that states what data to pull and why.
- severity_score should match bucket (critical ~0.75+, attention ~0.45-0.74, working ~0.35-0.55, context lower).
- source must be one of: operations, performance, pipeline, credit_risk, compliance, predictions, market_news, revenue, lost_opportunity, lock_risk, closing_risk, conversion, historical
`;

export async function runUserCustomPromptLlm(
  apiKey: string,
  promptTitle: string,
  promptText: string,
  specifierSummary: string
): Promise<EvaluatedInsight | null> {
  const userMsg = [
    `Title: ${promptTitle}`,
    `User request:\n${promptText}`,
    specifierSummary ? `Structured cohort (apply mentally — narrative only):\n${specifierSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: LLMMessage[] = [
    { role: "system", content: CUSTOM_PROMPT_SYSTEM },
    { role: "user", content: userMsg },
  ];

  try {
    const raw = await callLLM(messages, apiKey, {
      temperature: 0.35,
      maxTokens: 2500,
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

    const keyMetrics = (p.key_metrics && typeof p.key_metrics === "object" ? p.key_metrics : {}) as Record<
      string,
      string | number
    >;

    return {
      headline,
      understory: String(p.understory || "").trim() || headline,
      bucket,
      priority: priority as EvaluatedInsight["priority"],
      insight_type: insight_type as EvaluatedInsight["insight_type"],
      source: String(p.source || "operations"),
      severity_score: Math.min(1, Math.max(0, Number(p.severity_score) || 0.5)),
      value_score: Math.min(1, Math.max(0, Number(p.severity_score) || 0.5)),
      impact: { type: "custom_prompt" },
      evidence: {
        metrics: Object.entries(keyMetrics).map(([label, value]) => ({ label, value })),
      },
      confidence: "medium",
      findingIndex: 0,
      for_podcast: false,
      what_changed: p.what_changed ? String(p.what_changed) : undefined,
      why: p.why ? String(p.why) : undefined,
      recommended_action: p.recommended_action ? String(p.recommended_action) : undefined,
      functional_category: undefined,
    };
  } catch (e: any) {
    logWarn(`[UserCustomPrompt] LLM failed: ${e.message}`);
    return null;
  }
}

const PROMPT_TAG_LABELS: Record<string, string> = {
  operations: "Operations",
  sales: "Sales",
  finance: "Finance",
  secondary_marketing: "Secondary Marketing",
  compliance: "Compliance",
};

export function specifiersToSummary(specifiers: Record<string, unknown>): string {
  if (!specifiers || typeof specifiers !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(specifiers)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "_prompt_tag") {
      const id = String(v).trim().toLowerCase();
      if (!id) continue;
      parts.push(`Tag: ${PROMPT_TAG_LABELS[id] ?? id}`);
      continue;
    }
    if (Array.isArray(v)) {
      const items = v.map((x) => String(x)).filter((s) => s.length > 0);
      if (items.length === 0) continue;
      parts.push(`${k}: ${items.join(", ")}`);
      continue;
    }
    parts.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join("\n");
}
