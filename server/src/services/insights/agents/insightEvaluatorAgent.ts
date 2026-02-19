/**
 * Insight Evaluator Agent
 *
 * Replaces the Validator + Curator passes from the old pipeline.
 * Receives all findings from investigator agents and makes final decisions:
 *   - Significance filtering (drop noise)
 *   - Deduplication (merge overlapping findings)
 *   - Intelligent bucketing (critical / attention / working / context)
 *   - Impact-based ranking within each bucket
 *
 * Output is compatible with the existing `generated_insights` table.
 */

import { callLLM, type LLMMessage } from "../../research/tools.js";
import type { InsightFinding } from "./insightInvestigatorAgent.js";

// ============================================================================
// Types
// ============================================================================

export interface EvaluatedInsight {
  headline: string;
  understory: string;
  bucket: "critical" | "attention" | "working" | "context";
  priority: "RED" | "YELLOW" | "BLUE" | "GRAY";
  insight_type: "critical" | "warning" | "success" | "info";
  severity_score: number;
  source: string;
  impact: {
    type: string;
    estimated_dollars?: number;
    units_affected?: number;
  };
  evidence: any;
  metricSignature?: { sql: string; keyFields: string[] };
  confidence: "high" | "medium" | "low";
  findingIndex: number; // maps back to the original InsightFinding
}

export interface EvaluationResult {
  insights: EvaluatedInsight[];
  dropped: Array<{ index: number; reason: string }>;
  summary: string;
}

// ============================================================================
// System Prompt
// ============================================================================

const EVALUATOR_PROMPT = `You are an Insight Evaluator for a mortgage lending analytics platform. You receive raw findings from data analyst agents and decide which ones deserve to appear on the executive dashboard.

Your job:
1. SIGNIFICANCE FILTERING — Drop only findings that are genuine noise (completely trivial, zero-insight, or exact duplicates). Prefer keeping over dropping — an executive dashboard should be comprehensive, not sparse.
2. DEDUPLICATION — If two findings cover the same topic, merge them into one stronger insight.
3. BUCKETING — Categorize each surviving insight by severity level:
   - "critical" (Level 1 — Immediate Action Required): Material financial risk, compliance exposure, or operational failure requiring same-day response
   - "attention" (Level 2 — Monitor Closely): Concerning trend, potential risk if unaddressed, warrants close tracking over days/weeks
   - "working" (Level 3 — Strategic Review): Positive signal, performance strength, or opportunity worth reviewing in planning cycles
   - "context" (Level 4 — Informational): Good to know, background context, not immediately actionable
4. RANKING — Within each bucket, assign a severity_score (0.00-1.00) where higher = more impactful.

Output JSON:
{
  "summary": "1-2 sentence overview of the insight landscape",
  "insights": [
    {
      "headline": "Punchy headline, max 45 words, starts with key metric or finding",
      "understory": "2-3 sentence detail with specific numbers and comparison. Answers: what changed, why it matters, what to do about it.",
      "bucket": "critical" | "attention" | "working" | "context",
      "severity_score": 0.00-1.00,
      "source": "category string (e.g., pipeline_velocity, officer_performance, lock_risk, conversion_trends)",
      "impact": { "type": "revenue_at_risk|operational|compliance|performance", "estimated_dollars": null, "units_affected": null },
      "confidence": "high" | "medium" | "low",
      "findingIndex": 0
    }
  ],
  "dropped": [
    { "index": 0, "reason": "Why this finding was dropped" }
  ]
}

RULES:
- TARGET 10-16 insights across all buckets. A well-rounded dashboard MUST have coverage across all four levels. Minimum 2 per bucket.
- KEEP MORE THAN YOU DROP. When in doubt, KEEP the finding — put it in "context" (Informational) if it doesn't fit a higher bucket. Only drop findings that are truly redundant (near-duplicate of another finding) or completely uninformative (no specific numbers, zero confidence).
- EVERY bucket must have at least 2 insights. If you have none in a bucket, you are being too aggressive with filtering — go back and re-assign borderline findings to fill the gap.
- Positive findings (improving metrics, strong performance, good trends) go in "working" (Strategic Review). Do NOT drop positive findings just because they aren't problems.
- Headlines must be concrete and specific: "Pull-through drops 12% vs Q4" not "Performance metrics show changes"
- Understory must include specific numbers from the finding's keyMetrics.
- Map bucket -> priority: critical=RED, attention=YELLOW, working=BLUE, context=GRAY
- Map bucket -> insight_type: critical=critical, attention=warning, working=success, context=info
- Preserve the findingIndex so we can link back to evidence.
- De-duplicate only when two findings are nearly identical. Similar topics from different angles should BOTH be kept.
- HEADLINE ACCURACY: Before writing the headline, read the finding's summary carefully. If the investigator's title contradicts the actual findings (e.g. title says "missing milestones" but summary says "0 loans have blank milestones"), you MUST rewrite the headline to reflect the TRUE finding. Never propagate a disproven hypothesis into the headline.`;

// ============================================================================
// Agent Entry Point
// ============================================================================

const BUCKET_TO_PRIORITY: Record<string, string> = {
  critical: "RED",
  attention: "YELLOW",
  working: "BLUE",
  context: "GRAY",
};

const BUCKET_TO_TYPE: Record<string, string> = {
  critical: "critical",
  attention: "warning",
  working: "success",
  context: "info",
};

export async function runInsightEvaluator(
  findings: InsightFinding[],
  apiKey: string,
  previousHeadlines?: string[]
): Promise<EvaluationResult> {
  if (findings.length === 0) {
    return { insights: [], dropped: [], summary: "No findings to evaluate." };
  }

  const findingSummaries = findings.map((f, i) => ({
    index: i,
    title: f.title,
    summary: f.summary,
    confidence: f.confidence,
    keyMetrics: f.keyMetrics,
    suggestedBucket: f.suggestedBucket,
    impactEstimate: f.impactEstimate,
    evidenceCount: f.evidence.length,
  }));

  let userPrompt = `## Findings to Evaluate\n\n${JSON.stringify(findingSummaries, null, 2)}\n\n`;

  if (previousHeadlines && previousHeadlines.length > 0) {
    userPrompt += `## Previous Insight Headlines (avoid near-duplicates)\n`;
    previousHeadlines.forEach((h) => (userPrompt += `- ${h}\n`));
    userPrompt += "\n";
  }

  userPrompt += `Evaluate these findings and produce the final insight set. Respond with JSON.`;

  const messages: LLMMessage[] = [
    { role: "system", content: EVALUATOR_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const raw = await callLLM(messages, apiKey, {
    temperature: 0.3,
    maxTokens: 6000,
    jsonMode: true,
  });

  const parsed = JSON.parse(raw) as EvaluationResult;

  // Post-process: enrich each evaluated insight with the correct priority/type mappings
  // and attach metricSignature from the original finding
  parsed.insights = (parsed.insights || []).map((ins) => {
    const bucket = ins.bucket || "context";
    const originalFinding = findings[ins.findingIndex];

    return {
      ...ins,
      bucket,
      priority: (BUCKET_TO_PRIORITY[bucket] || "GRAY") as any,
      insight_type: (BUCKET_TO_TYPE[bucket] || "info") as any,
      severity_score: Math.min(1, Math.max(0, ins.severity_score || 0.5)),
      metricSignature: originalFinding?.metricSignature || ins.metricSignature,
      evidence: originalFinding
        ? {
            metrics: Object.entries(originalFinding.keyMetrics).map(([k, v]) => ({
              label: k,
              value: v,
            })),
            evidenceQueries: originalFinding.evidence.map((e) => ({
              sql: e.sql,
              explanation: e.explanation,
              rowCount: e.rowCount,
            })),
          }
        : ins.evidence,
    };
  });

  return parsed;
}
