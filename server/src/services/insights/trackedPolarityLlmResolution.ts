/**
 * LLM-based polarity inference for tracked insights (headline + understory).
 * See docs/TRACKED_INSIGHTS_LLM_POLARITY_INFERENCE_PLAN.md
 */

import pg from "pg";
import { callLLM, getOpenAIKey, type LLMMessage } from "../research/tools.js";
import { logInfo, logWarn } from "../logger.js";
import {
  resolvePolarityForKey,
  type MetricPolarity,
} from "./trackedPolarityResolve.js";

const CHUNK_SIZE = 10;
const CONFIDENCE_THRESHOLD = 70;
const TEMPERATURE = 0.15;
const MAX_COMPLETION_TOKENS = 1200;

/** Feature flag from plan §11: `TRACKED_INSIGHT_POLARITY_LLM_ENABLED=true` */
export function isTrackedInsightPolarityLlmEnabled(): boolean {
  return process.env.TRACKED_INSIGHT_POLARITY_LLM_ENABLED === "true";
}

/** Shadow mode: log decisions without persisting polarities (plan §11). */
export function isTrackedInsightPolarityLlmShadow(): boolean {
  return process.env.TRACKED_INSIGHT_POLARITY_LLM_SHADOW === "true";
}

/** Print parsed decisions to terminal (plan §10: dev or explicit debug). */
export function shouldLogPolarityLlmDecisionsToTerminal(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.TRACKED_POLARITY_LLM_DEBUG === "true"
  );
}

const SYSTEM_PROMPT = `You are a senior mortgage banking analytics assistant. Your task is to infer the directional preference ("polarity") of specific numeric metrics for a tracked operational insight.

Definitions:
- higher_better: An increase in the metric is generally favorable for the business (e.g., revenue, funded volume, pull-through rate when defined that way).
- lower_better: A decrease in the metric is generally favorable (e.g., cycle time, aging, defect rate, fallout, backlog counts).
- neutral: The metric is not inherently good or bad when it moves up or down in isolation (e.g., a mix index, a denominator-only count in a ratio, or a field where direction needs the headline to decide). If the text does not clearly establish direction, choose neutral.

You will be given:
- The insight headline and understory — primary evidence for whether an **increase** in each metric is good or bad **in this insight's framing**.
- Optional per-key descriptions from the product UI (if provided).
- The metric keys to judge and, optionally, current numeric values for those keys (for scale / disambiguation only — not for trend-based polarity).

Headline/understory vs domain context:
- **Ultimately, base the decision on the headline and understory.** Use the mortgage domain context below to **steer** polarity when the headline/understory would otherwise leave a key ambiguous or **neutral**, **and** that context clearly applies to that metric key.
- Heuristics can **contradict** each other (e.g. "counts used as denominators are often neutral" vs "applications taken is often higher_better"). When that happens, use the headline and understory to decide whether the insight treats that field as: (a) **only a denominator or background** for a rate, (b) **context** mentioned alongside the real KPI, or (c) a **primary metric** used to judge performance. Example: "applications taken" only in the denominator of a share → often **neutral** for that count; the same concept as the **main** success measure in the headline → may be **higher_better**.

Mortgage domain defaults (apply only when consistent with the headline/understory):
- **Loan counts / units / number of loans:** The count of loans in that cohort. Usually **higher_better** when more loans in that group is good for the story. If the field is clearly the **denominator** of a ratio (the "per X" or "of X" part of a rate), prefer **neutral**; assign **higher_better** or **lower_better** to the **numerator** or to the **rate** outcome when the text supports it.
- **Denominators vs numerators:** In fractions or rates, **denominator** counts are often **neutral**; the **numerator** or the **rate** usually carries directional polarity (higher or lower is better depending on the metric).
- **Loan amount, volume, balance (sum of loan_amount-style fields):** Total dollars for the cohort. For **active** or **originated** lending, more is often **higher_better**. For **withdrawn** or **denied** exposure, less is often **lower_better**. For **closed** loans as a **generic** bucket without a clear "more production is better" frame, treat as **neutral** unless the headline/understory specifies.
- **Loans closed (non-active loan counts):** May mix originated, withdrawn, denied, incomplete, etc. Often **neutral** unless the headline clearly frames whether more or fewer is better.
- **Missing date or missing milestone:** Data completeness / backlog risk — **lower_better** (fewer missing is better).
- **Applications taken:** Often **higher_better** when pipeline intake or application flow is the success story; use the headline if the field is only structural (e.g. denominator).
- **Complexity:** Usually **lower_better** (higher complexity tends to drive fallout: withdrawn and denied).
- **FICO:** Usually **higher_better** (higher score, lower credit risk).
- **LTV and DTI:** Usually **lower_better** (lower values imply less risk / simpler loans in typical underwriting framing).

Rules:
1) **Do not** infer polarity from time series, snapshot counts, or whether a value went up or down vs a prior period. Direction comes from the **text** plus the domain guidance above, not from deltas in the numbers.
2) The same metric **name** can differ by insight (e.g. units as leadership vs units stuck in pipeline). Anchor to **this** headline/understory.
3) Judge each metric_key with the full headline/understory; related keys can inform each other.
4) Use explicit cues in the text ("reduce", "improve", "risk", "pipeline", etc.). If cues conflict or are absent, lower confidence.
5) Do not invent facts not supported by the text or the domain defaults; when still ambiguous, prefer **neutral** with lower confidence.
6) Confidence is an integer 0-100. Use 90+ only when the headline/understory (and applicable domain hint) clearly support the label; 70-89 when likely but some ambiguity; below 70 when uncertain.
7) Output MUST be a single JSON object matching the required schema. No markdown, no commentary outside JSON.

Required JSON schema:
{
  "decisions": [
    {
      "metric_key": "<string>",
      "polarity": "higher_better" | "lower_better" | "neutral",
      "confidence": <integer 0-100>,
      "rationale": "<= 200 characters, plain text>"
    }
  ]
}

Include exactly one decision object per requested metric_key, in the same order as requested.`;

export interface TrackedPolarityLlmContext {
  tenantId: string;
  trackedInsightId: string;
  headline: string;
  understory: string;
  sourceType: string;
  displayMetadata: Record<string, unknown> | null | undefined;
  metricValues: Record<string, unknown>;
  comparedKeys: string[];
  existingPolarities: Record<string, MetricPolarity> | undefined;
  apiKey: string | null;
}

export interface PolarityLlmDecisionRow {
  metric_key: string;
  polarity: MetricPolarity;
  confidence: number;
  rationale?: string;
}

export interface ApplyLlmPolarityInferenceResult {
  polaritiesToMerge: Record<string, MetricPolarity>;
  polarityInferenceAudit: Array<{
    key: string;
    raw_polarity: MetricPolarity;
    confidence: number;
    model?: string;
    run_at: string;
  }>;
  rawDecisions: PolarityLlmDecisionRow[];
}

function stripInternalMetricKeys(mv: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mv)) {
    if (k.startsWith("_")) continue;
    out[k] = v;
  }
  return out;
}

function chunkKeys<T>(keys: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < keys.length; i += size) {
    out.push(keys.slice(i, i + size));
  }
  return out;
}

function buildUserPrompt(
  ctx: TrackedPolarityLlmContext,
  requestedKeys: string[]
): string {
  const dm = ctx.displayMetadata || {};
  const bucket =
    typeof dm.original_bucket === "string" ? dm.original_bucket : "n/a";
  const priority =
    typeof dm.original_priority === "string" ? dm.original_priority : "n/a";
  const desc =
    dm.keyMetricDescriptions &&
    typeof dm.keyMetricDescriptions === "object" &&
    !Array.isArray(dm.keyMetricDescriptions)
      ? JSON.stringify(dm.keyMetricDescriptions)
      : "{}";

  const stripped = stripInternalMetricKeys(ctx.metricValues);
  const relevant: Record<string, unknown> = {};
  for (const k of requestedKeys) {
    const base = k.replace(/_(avg|sum|count)$/i, "");
    const v =
      stripped[k] ??
      stripped[base] ??
      stripped[`${base}_sum`] ??
      stripped[`${base}_avg`] ??
      stripped[`${base}_count`];
    if (v !== undefined && v !== null) relevant[k] = v;
  }
  const metricJson = JSON.stringify(
    Object.keys(relevant).length > 0 ? relevant : stripped
  );

  const bulletList = requestedKeys.map((k) => `- ${k}`).join("\n");

  return [
    "Tracked insight",
    `- headline: ${ctx.headline}`,
    `- understory: ${ctx.understory || ""}`,
    "",
    "Source context (if any)",
    `- source_type: ${ctx.sourceType}`,
    `- original_bucket: ${bucket}`,
    `- original_priority: ${priority}`,
    "",
    "Optional metric descriptions (if any)",
    desc,
    "",
    "Metrics to classify (only these keys)",
    bulletList,
    "",
    "Current metric values (optional; for labeling / scale only — do not use for trend-based polarity)",
    metricJson,
    "",
    "Instructions:",
    "- For each metric_key, decide polarity from the **headline and understory** only: is an **increase** in this metric **good**, **bad**, or **not stated** for this insight?",
    "- Return JSON only.",
  ].join("\n");
}

function parseDecisionsJson(raw: string): { decisions?: PolarityLlmDecisionRow[] } {
  const parsed = JSON.parse(raw) as { decisions?: unknown };
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.decisions)) {
    throw new Error("Missing decisions array");
  }
  return parsed as { decisions: PolarityLlmDecisionRow[] };
}

function normalizeDecision(
  d: unknown,
  allowlist: Set<string>
): PolarityLlmDecisionRow | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const metric_key = typeof o.metric_key === "string" ? o.metric_key.trim() : "";
  if (!metric_key || !allowlist.has(metric_key)) return null;
  const pol = o.polarity;
  if (
    pol !== "higher_better" &&
    pol !== "lower_better" &&
    pol !== "neutral"
  ) {
    return null;
  }
  let confidence = 0;
  if (typeof o.confidence === "number" && Number.isFinite(o.confidence)) {
    confidence = Math.max(0, Math.min(100, Math.round(o.confidence)));
  }
  const rationale =
    typeof o.rationale === "string" ? o.rationale.slice(0, 200) : undefined;
  return { metric_key, polarity: pol, confidence, rationale };
}

function effectivePolarity(
  polarity: MetricPolarity,
  confidence: number
): MetricPolarity {
  if (confidence < CONFIDENCE_THRESHOLD) return "neutral";
  return polarity;
}

function polarityKeyForStorage(metricKey: string): string {
  return metricKey.replace(/_(avg|sum|count)$/i, "");
}

async function callPolarityLlmOnce(
  userContent: string,
  apiKey: string,
  repairHint?: string
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(repairHint
      ? ([
          { role: "user", content: userContent },
          { role: "user", content: repairHint },
        ] as LLMMessage[])
      : ([{ role: "user", content: userContent }] as LLMMessage[])),
  ];
  return callLLM(messages, apiKey, {
    jsonMode: true,
    temperature: TEMPERATURE,
    maxTokens: MAX_COMPLETION_TOKENS,
    tag: "tracked-polarity-llm",
  });
}

/**
 * Run LLM polarity inference for neutral compared keys; returns merges for metric_signature.polarities (v1: only non-neutral when confidence ≥ 70).
 */
export async function runTrackedPolarityLlmInference(
  ctx: TrackedPolarityLlmContext
): Promise<ApplyLlmPolarityInferenceResult | null> {
  const neutralKeys = ctx.comparedKeys.filter(
    (k) => resolvePolarityForKey(k, ctx.existingPolarities) === "neutral"
  );
  if (neutralKeys.length === 0) return null;

  let apiKey = ctx.apiKey;
  if (!apiKey) {
    try {
      apiKey = await getOpenAIKey(ctx.tenantId);
    } catch {
      logWarn(
        `[TrackedPolarityLLM] No API key for insight ${ctx.trackedInsightId}`
      );
      return null;
    }
  }

  const allRaw: PolarityLlmDecisionRow[] = [];
  const chunks = chunkKeys(neutralKeys, CHUNK_SIZE);

  for (const keyChunk of chunks) {
    const userContent = buildUserPrompt(ctx, keyChunk);
    const allowlist = new Set(keyChunk);
    let raw: string;
    try {
      raw = await callPolarityLlmOnce(userContent, apiKey);
    } catch (e: any) {
      logWarn(
        `[TrackedPolarityLLM] LLM call failed for insight ${ctx.trackedInsightId}: ${e?.message || e}`
      );
      continue;
    }

    let decisions: PolarityLlmDecisionRow[] = [];
    try {
      const parsed = parseDecisionsJson(raw);
      decisions = (parsed.decisions || [])
        .map((d) => normalizeDecision(d, allowlist))
        .filter((x): x is PolarityLlmDecisionRow => x !== null);
    } catch {
      const repairHint = `The previous output was invalid JSON or did not match the schema. Return ONLY a valid JSON object with the same schema as specified in the system message. Keys to include: ${keyChunk.join(", ")}`;
      try {
        raw = await callPolarityLlmOnce(userContent, apiKey, repairHint);
        const parsed = parseDecisionsJson(raw);
        decisions = (parsed.decisions || [])
          .map((d) => normalizeDecision(d, allowlist))
          .filter((x): x is PolarityLlmDecisionRow => x !== null);
      } catch (e2: any) {
        logWarn(
          `[TrackedPolarityLLM] Repair parse failed for insight ${ctx.trackedInsightId}: ${e2?.message || e2}`
        );
        continue;
      }
    }

    for (const d of decisions) {
      allRaw.push(d);
    }
  }

  if (allRaw.length === 0) return null;

  const polaritiesToMerge: Record<string, MetricPolarity> = {};
  const polarityInferenceAudit: ApplyLlmPolarityInferenceResult["polarityInferenceAudit"] =
    [];
  const runAt = new Date().toISOString();
  const modelNote = "default-callLLM";

  for (const row of allRaw) {
    const eff = effectivePolarity(row.polarity, row.confidence);
    const storageKey = polarityKeyForStorage(row.metric_key);
    polarityInferenceAudit.push({
      key: storageKey,
      raw_polarity: row.polarity,
      confidence: row.confidence,
      model: modelNote,
      run_at: runAt,
    });
    if (eff === "higher_better" || eff === "lower_better") {
      polaritiesToMerge[storageKey] = eff;
    }
  }

  if (shouldLogPolarityLlmDecisionsToTerminal()) {
    for (const row of allRaw) {
      const line = JSON.stringify({
        tracked_insight_id: ctx.trackedInsightId,
        metric_key: row.metric_key,
        polarity: row.polarity,
        confidence: row.confidence,
        rationale: row.rationale ?? null,
        effective:
          row.confidence >= CONFIDENCE_THRESHOLD ? row.polarity : "neutral",
      });
      logInfo(`[TrackedPolarityLLM] decision ${line}`);
    }
  }

  return {
    polaritiesToMerge,
    polarityInferenceAudit,
    rawDecisions: allRaw,
  };
}

/**
 * Merge LLM polarities into metric_signature, update DB, optional display_metadata.polarity_inference.
 */
export async function applyLlmPolarityInferenceToTrackedInsight(
  tenantPool: pg.Pool,
  trackedInsightId: string,
  existingMetricSignature: Record<string, unknown>,
  _existingDisplayMetadata: Record<string, unknown> | null | undefined,
  result: ApplyLlmPolarityInferenceResult,
  options: { shadow?: boolean }
): Promise<void> {
  const shadow = options.shadow === true;
  const prior = (existingMetricSignature.polarities &&
  typeof existingMetricSignature.polarities === "object" &&
  !Array.isArray(existingMetricSignature.polarities)
    ? (existingMetricSignature.polarities as Record<string, MetricPolarity>)
    : {}) as Record<string, MetricPolarity>;

  const nextPolarities = { ...prior, ...result.polaritiesToMerge };
  const nextSig = {
    ...existingMetricSignature,
    polarities: nextPolarities,
  };

  const infBlock = {
    polarity_inference: result.polarityInferenceAudit,
    polarity_inference_updated_at: new Date().toISOString(),
  };

  if (shadow) {
    logInfo(
      `[TrackedPolarityLLM] shadow mode — not persisting polarities for ${trackedInsightId}`
    );
    return;
  }

  try {
    await tenantPool.query(
      `UPDATE tracked_insights
         SET metric_signature = $1::jsonb,
             display_metadata = COALESCE(display_metadata, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(nextSig), JSON.stringify(infBlock), trackedInsightId]
    );
  } catch {
    await tenantPool.query(
      `UPDATE tracked_insights
         SET metric_signature = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(nextSig), trackedInsightId]
    );
  }
}

/**
 * Backfill: evaluate LLM polarity for all active tracked insights (re-runs full evaluation per row).
 * Plan: batch / rate-limited use is left to the operator.
 */
export async function backfillTrackedInsightPolarityLlmForPool(
  tenantId: string,
  tenantPool: pg.Pool,
  evaluateSingle: (
    tid: string,
    pool: pg.Pool,
    row: Record<string, unknown>
  ) => Promise<{ status: string }>
): Promise<{ processed: number; errors: number }> {
  let hasDisplayMetaCol = false;
  try {
    const colCheck = await tenantPool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tracked_insights' AND column_name = 'display_metadata'
    `);
    hasDisplayMetaCol = colCheck.rows.length > 0;
  } catch {
    /* pre-migration */
  }

  const displayMetaSelect = hasDisplayMetaCol
    ? ", display_metadata"
    : ", NULL::jsonb AS display_metadata";
  const result = await tenantPool.query(
    `SELECT id, headline, understory, source_type, source_insight_id, metric_signature, alert_threshold
     ${displayMetaSelect}
     FROM tracked_insights
     WHERE status = 'active'
     ORDER BY created_at`
  );

  let processed = 0;
  let errors = 0;
  for (const row of result.rows) {
    const one = await evaluateSingle(tenantId, tenantPool, row);
    if (one.status === "evaluated") processed++;
    else if (one.status === "error") errors++;
  }
  return { processed, errors };
}
