/**
 * LLM planner: natural language → MetricSpec JSON (validated with Zod).
 */

import { getOpenAIKey } from "../research/tools.js";
import { METRICS_CATALOG } from "./metricsService.js";
import { selectRelevantMetricIds } from "./intentRouter.js";
import { safeParseMetricSpec, type MetricSpec } from "./metricSpec.js";

const MODEL = process.env.COHI_METRIC_PLANNER_MODEL || process.env.COHI_CHAT_MODEL || "gpt-5.4";

function buildMetricsAppendix(metricIds: string[], maxSqlChars = 240): string {
  const lines: string[] = [];
  for (const id of metricIds) {
    const m = METRICS_CATALOG[id];
    if (!m) continue;
    const sql = m.sqlQuery.replace(/\s+/g, " ").trim();
    lines.push(
      `- **${id}** (${m.name}, ${m.category}): ${m.description.slice(0, 200)}` +
        `\n  SQL expr: ${sql.slice(0, maxSqlChars)}${sql.length > maxSqlChars ? "…" : ""}`
    );
  }
  return lines.join("\n");
}

export interface MetricPlannerContext {
  tenantId: string;
}

/**
 * Produces a MetricSpec for the question, or null if the planner declines / parse fails.
 */
export async function planMetricSpec(
  question: string,
  ctx: MetricPlannerContext
): Promise<MetricSpec | null> {
  const selected = selectRelevantMetricIds(question, 16);
  const appendix = buildMetricsAppendix(selected);

  const system = `You are a metrics planner for a mortgage analytics app. Output a single JSON object (MetricSpec) with no markdown.

**Schema (required fields):**
- metricIds: string[] — 1+ ids from the allowed list below
- dimensions: optional array — one of: loan_officer, branch, processor, underwriter, channel, investor, loan_type, loan_purpose, occupancy_type, account_executive. Use for breakdowns (compare by branch, top loan officers, etc.)
- window: one of: this_quarter, last_quarter, ytd, last_90_days, this_month, last_month, all_time, custom
- customRange: { start, end } only if window is custom (YYYY-MM-DD)
- comparison: usually "segment" when dimensions are set, else "none"
- filters: optional object (branch, channel, loan_officer, consolidated_channel, etc.)
- topN: optional for top-N breakdowns
- pullThroughSegment: "branch" | "loan_officer" only when the user wants pull-through rate segmented (compare pull-through by branch / LO). In that case set metricIds to ["pull_through_rate"] and set pullThroughSegment.

**Rules:**
- For "compare pull-through by branch this quarter" → metricIds ["pull_through_rate"], pullThroughSegment "branch", window "this_quarter", comparison "segment"
- For a single KPI snapshot (e.g. "active loans") → one metric id, no dimensions, window as appropriate
- If the request is not representable with the catalog above, set "unsupported": true and "unsupportedReason" with a short reason.

**Allowed metric ids for this request:** ${selected.join(", ")}

**Metric reference:**
${appendix}
`;

  const apiKey = await getOpenAIKey(ctx.tenantId);
  const prefersCompletionTokens = /^(gpt-5|o3|o4)/i.test(MODEL);
  const body: Record<string, unknown> = {
    model: MODEL,
    temperature: 0.1,
    messages: [
      { role: "system", content: system },
      { role: "user", content: question },
    ],
    response_format: { type: "json_object" },
    ...(prefersCompletionTokens
      ? { max_completion_tokens: 1200 }
      : { max_tokens: 1200 }),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn("[MetricPlanner] OpenAI error:", err);
    return null;
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) return null;

  try {
    const raw = JSON.parse(text);
    const parsed = safeParseMetricSpec(raw);
    if ("error" in parsed) {
      console.warn("[MetricPlanner] Zod validation failed:", parsed.error.flatten());
      return null;
    }
    if (parsed.data.unsupported) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
