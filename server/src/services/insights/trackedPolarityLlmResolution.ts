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
- neutral: The metric is not inherently good or bad when it moves up or down in isolation (e.g., a mix index, a share split between two buckets, or a context-free count where direction requires external business rules not stated here). If the text does not clearly establish direction, choose neutral.

You will be given:
- The insight headline and understory — these are the **primary** evidence for whether an **increase** in each metric is good or bad **in this insight's framing**.
- Optional per-key descriptions from the product UI (if provided).
- The metric keys to judge and, optionally, current numeric values for those keys (for scale / disambiguation only).

Rules:
1) **Direction comes from the headline and understory**, not from time series, snapshot counts, or whether a number went up or down between periods. Do **not** infer polarity from "trend" or "delta" in the data.
2) The same metric **name** can mean different polarity in **different** insights (e.g. "units" as YTD leadership vs "units" stuck in pipeline). Always anchor to **this** headline/understory only.
3) Judge each listed metric_key independently, but use the full headline/understory so wording stays consistent across keys, and the interaction between two keys might influence the direction.
4) Base your answer on explicit cues in the text (e.g., "reduce", "improve", "faster", "lower", "higher", "risk", "efficiency", "leads", "sitting in the pipeline"). If cues conflict or are absent, lower your confidence.
5) Do not invent domain facts not supported by the text. If the metric name is ambiguous and the text does not disambiguate, prefer neutral with low confidence.
6) Confidence is an integer 0-100 meaning probability that the polarity label is correct given the provided text and keys. Calibration guide: 90+ only when the text clearly states or strongly implies direction for that metric; 70-89 when direction is likely but some ambiguity remains; below 70 when guessing.
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
