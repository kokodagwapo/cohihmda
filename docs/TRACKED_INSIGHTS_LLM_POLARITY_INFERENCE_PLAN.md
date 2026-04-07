# Tracked Insights: LLM Polarity Inference — Implementation Plan

This document describes how polarity works in the codebase today, then a full implementation plan and copy-pasteable prompts for inferring **`higher_better`**, **`lower_better`**, or **`neutral`** for metric keys that still resolve to **`neutral`** after explicit polarities and name-based inference. **Polarity is meant to be read from the insight’s headline and understory**—i.e. whether, *in this insight’s framing*, an **increase** in that metric is good or bad—not from comparing one snapshot to another or from time series.

---

## How polarity works today (grounding)

- **Resolution order** is explicit `metric_signature.polarities` first, then **name-based** `inferTrackedMetricPolarity` on the base key (suffixes like `_avg` / `_sum` / `_count` are stripped for explicit lookup). See `resolvePolarityForKey` in `trackedInsightEvaluator.ts`:

```447:458:server/src/services/insights/trackedInsightEvaluator.ts
function resolvePolarityForKey(
  key: string,
  explicit?: Record<string, MetricPolarity>
): MetricPolarity {
  const base = key.replace(/_(avg|sum|count)$/i, "");
  const fromExplicit =
    explicit?.[key] ?? explicit?.[base];
  if (fromExplicit === "higher_better" || fromExplicit === "lower_better" || fromExplicit === "neutral") {
    return fromExplicit;
  }
  return inferTrackedMetricPolarity(base);
}
```

- **Trend voting** ignores keys whose resolved polarity is `neutral` (no directional contribution), which is why improving neutral fallbacks matters:

```478:487:server/src/services/insights/trackedInsightEvaluator.ts
  for (const key of currentKeys) {
    ...
      const polarity = resolvePolarityForKey(key, polarities);
      // Ambiguous / context-dependent: no directional signal for trend voting
      if (polarity === "neutral") continue;
```

- Snapshots store **`_polarities`** built from the same resolution, alongside **`_compared_keys`** — useful to see **which keys** carried a neutral polarity after evaluation, but **the LLM should not use snapshot history** to *decide* polarity (see §2 and §3).

- Track-create **merges** client polarities with name-inferred non-neutral entries in `normalizeMetricSignature` (`trackedInsights.ts`); anything that stays **unlisted** ultimately falls through to inference and often **`neutral`**.

### Why the same metric key can need different polarities across insights

Polarity is **not a property of the bare field name alone**; it depends on **how the insight describes success**. The LLM step exists to recover that from **headline + understory** when naming rules return `neutral`.

Examples:

- Headline: *“Branch 2001 leads with highest YTD complexity and unit volume.”*  
  For keys like **`units`** and **`wa_complexity`**, a natural reading is **`units`** → **higher is better** (leading in volume), and **`wa_complexity`** → **lower is better** (complexity is usually undesirable).

- Same key **`units`**, different headline: *“Branch 2001 leads in highest number of active units sitting in the pipeline.”*  
  Here **`units`** is framed as **inventory sitting in pipeline**—often **lower is better** (clear the pipeline), not “more is better” like in the YTD leadership example.

So: **one classification per tracked insight**, from text; **not** from counting snapshots or from “which way the number moved last time.”

---

## Implementation plan

### 1. Goal and scope

- **Goal**: For tracked insights where one or more metric keys still resolve to **`neutral`** after explicit polarities + `inferTrackedMetricPolarity`, call an LLM that uses primarily **headline** and **understory** to decide whether an **increase** in each such metric is **good**, **bad**, or **not directionally stated** (`higher_better`, `lower_better`, or `neutral`), each with a **confidence in 0–100**.
- **Optional context only**: Current metric values (and optional `keyMetricDescriptions`) may be passed to **disambiguate which keys** are being discussed or to ground units—they **must not** be used to infer polarity from **movement between snapshots** or from “up vs down” over time. Polarity is **text-derived** for that insight.
- **Rule**: If **confidence < 70%**, treat the outcome as **`neutral`** (no write). If **≥ 70%**, persist the assigned polarity for that metric key on **this** `tracked_insights` row only.
- **Non-goals (unless product asks)**: Changing SQL, keyFields, or user-explicit polarities; redefining business thresholds for “significant change” (still the evaluator’s 5% rule).

### 2. Inputs (what the LLM sees)

**Primary (drives polarity)**

- **`headline`**, **`understory`** from `tracked_insights` — these determine whether “up” is good or bad for each neutral key in **this** insight’s wording.

**Which keys to classify**

- **Candidate keys**: metric keys that are still **`neutral`** after **explicit** `metric_signature.polarities` and **`inferTrackedMetricPolarity`**, and that participate in comparison for this evaluation (e.g. aligned with `comparisonKeyFields` / `keyFields` and the evaluator’s comparable-key logic). You can derive the list using the same inputs the evaluator will use when it builds `_compared_keys` / `_polarities`—the point is **key selection**, not **using snapshot history to decide polarity**.

**Optional supporting context (not for direction-from-time-series)**

- **Current `metric_values`** (numeric scalars per key, with internal keys stripped: `_compared_keys`, `_polarities`, `_rowCount`, etc.) — useful so the model sees **which metrics** are on the row and at what scale; **do not** instruct the model to choose polarity based on **change since last snapshot** or **number of snapshots**.
- **`display_metadata.keyMetricDescriptions`** / **`keyMetricFormats`** when present — clarifies opaque field names without extra joins.
- **`source_type`** and minimal **bucket/priority** from `display_metadata` if already stored (same spirit as change-summary).

**Per-insight only (critical)**

- LLM output is merged into **`metric_signature.polarities` on that `tracked_insights` row only**. Do **not** maintain a global or cross-insight cache of “polarity for `units`” — the same SQL column name can legitimately differ by insight (see examples above).

### 3. When to run (triggers) and pipeline order

**When this step runs (intended product scope)**

1. **Backfill**: Existing tracked insights that still have **neutral** polarities where we want LLM help (e.g. batch job, rate-limited).
2. **New / newly tracked insights**: When an insight is **tracked** and the pipeline reaches the point where **`metric_values` / `_polarities` are being determined** for that evaluation cycle—i.e. this is **not** a separate “mystery cron” unrelated to tracking; it is tied to **establishing polarity context for that insight’s metrics**.

Do **not** design the feature so that **different snapshots over time** “vote” on polarity. **Re-running** may still happen on backfill or if headline/understory change and you intentionally re-infer—**not** because a new snapshot number appeared.

**Code order (required)**

Polarity resolution for a given evaluation should follow:

1. **Explicit polarities** (`metric_signature.polarities` from user/source + normalization merge rules).
2. **Name-based inference** (`inferTrackedMetricPolarity` for keys still unset).
3. **LLM pass** — only for keys that are still **`neutral`** after (1) and (2); merge results into `metric_signature.polarities` per thresholds (e.g. confidence ≥ 70%).
4. **Continue** the rest of the evaluator: trend, **`_polarities`** in snapshot `metric_values`, change summary, etc., using the **final** polarities from (1)–(3).

So the LLM step completes **before** persisting snapshot `metric_values` that include **`_polarities`**, whenever this feature is enabled for that run.

**Skip / guardrails**

- Skip if `metric_signature` is non-evaluable (no SQL/handler) **unless** product allows text-only polarity (no metric row)—default is often to skip when there is no evaluable signature.
- **Do not override** keys already set explicitly in `metric_signature.polarities` to non-neutral (treat as ground truth). Only fill gaps where resolution is still **`neutral`** after explicit + name inference.

### 4. Batching: one insight vs one key

**Recommendation: one LLM call per insight** that returns **all neutral keys** for that insight in one JSON object.

| Approach | Pros | Cons |
|----------|------|------|
| **Per insight (batch keys)** | One round-trip; model can use headline/story once; cross-metric consistency; matches how you already batch context in `generateChangeSummary` | Larger prompts; one malformed JSON fails whole parse (mitigate with repair retry) |
| **Per key** | Simple schema; easy parallelism | N× cost/latency; loses cross-metric context |

**Mitigation for many keys**: If neutral keys exceed a **soft cap** (e.g. 8–12), **chunk keys** into multiple calls **in the same job** (still per-insight, sequential chunks), or drop lowest-priority keys using `comparisonKeyFields` / `_compared_keys` ordering.

### 5. Why a single LLM call (not a multi-step “agent” like other insight flows)

Elsewhere, “agent” often means **orchestrated** flows: planners, tools, multiple turns, retrieval, or synthesis. **Polarity per key** is a **single classification task** with a **fixed JSON schema**, no tool loop, and no external actions—only mapping (headline, understory, key list) → labels + confidence. That fits a **one-shot chat completion** with **`response_format: json_object`** (already used via `callLLM(..., { jsonMode: true })` in `server/src/services/research/tools.ts`).

Using the same **`callLLM`** helper keeps **one API surface**, **retries**, **tenant API key** behavior (`getOpenAIKey` / existing patterns), and **logging** consistent with `generateChangeSummary` and research agents—without pulling in orchestrator complexity.

**Model choice**

- Default to the **same default model as `callLLM`** (currently **`gpt-5.2`** in `tools.ts`) unless product standardizes a different classifier model.
- Use **low temperature** (e.g. **0.1–0.2**) for stable labels.
- **Implementation sketch**: a small module (e.g. `trackedPolarityLlmResolution.ts`) that (1) builds messages from headline/understory + neutral key list + optional descriptions, (2) calls `callLLM` with `jsonMode: true`, `maxTokens` modest (completion is small), (3) parses JSON, validates keys against the allowlist, applies the **70%** threshold, (4) returns a partial `Record<key, polarity>` to merge into `metric_signature.polarities` **on that row**. Optional: one repair retry with the “repair” prompt if parse/validation fails.

### 6. LLM contract (structured output)

- Use **`callLLM` with `jsonMode: true`** (same pattern as `plannerAgent` / `dataAnalystAgent`) in `server/src/services/research/tools.ts`.
- **Temperature**: low (e.g. **0.1–0.2**) for stable classifications.
- **Schema (conceptual)**:

```json
{
  "insight_id": "<optional echo>",
  "decisions": [
    {
      "metric_key": "string (base key, matching metric_signature keyFields / snapshot keys)",
      "polarity": "higher_better | lower_better | neutral",
      "confidence": 0-100,
      "rationale": "one short sentence"
    }
  ]
}
```

- **Post-process**: For each decision, `effectivePolarity = confidence >= 70 ? polarity : "neutral"`.
- **Validation**: Whitelist `metric_key` against expected set only; discard unknown keys; clamp confidence; if JSON parse fails, retry once with “repair” system message or fall back to no-op.

### 7. Persistence

- **Update** `tracked_insights.metric_signature.polarities` **for this insight row only** by **merging** new entries only for keys where `effectivePolarity !== "neutral"` **or** where you want to **lock in explicit neutral** after high-confidence “truly neutral” — product choice:
  - **Minimal**: Only **write** `higher_better` / `lower_better`; leave true neutrals unstored so future model versions can retry.
  - **Explicit neutral**: Write `"neutral"` for high-confidence neutral to **stop re-running** — requires a flag like `polarity_inference_version` or stored `last_inferred_at` per key.

Recommended for v1: **only persist non-neutral** when confidence ≥ 70%; optional **`display_metadata.polarity_inference`** (or a small sibling object) storing `{ key, raw_polarity, confidence, model, run_at }` for debugging **without** polluting the polarity map. **Never** promote these into a **global** lookup reused across insights.

### 8. Interaction with the next evaluation

- If the LLM step runs **inline** before the snapshot write (see §3), the **same** `evaluateSingleTrackedInsight` run already uses the merged polarities for `determineTrend`, `_polarities` in `metric_values`, and `generateChangeSummary`—no extra “re-run evaluation” is required for consistency in that pass. If polarity is updated **outside** that path (e.g. backfill updating `metric_signature` only), the **next** scheduled evaluation will pick up the new polarities.

### 9. Cost, limits, and abuse

- Per-tenant **rate limits** on backfill; cap keys per call; **dedupe** (optional): skip re-inference if **`headline` + `understory` + sorted neutral key list** are unchanged since last successful LLM merge for that row—**not** based on numeric metric values or snapshot counts, since polarity is text-driven.
- Log token usage via existing `callLLM` usage fields if exposed.

### 10. Testing

- **Unit tests**: Mock `callLLM` returning fixed JSON; assert merge into `metric_signature`, threshold behavior at 69 vs 70, and “explicit polarity not overwritten.”
- **Fixtures**: Keys that are intentionally neutral by name but clearly “lower is better” in text (e.g. “days to close” in understory).
- **Manual / terminal checks**: During development (or behind a debug flag in non-production), **print the LLM result to the terminal**—e.g. the parsed JSON for **each metric key** (`metric_key`, `polarity`, `confidence`, and optionally `rationale`)—so you can eyeball whether each decision and confidence score matches the headline/understory before relying on persisted `metric_signature.polarities`.

### 11. Rollout

- Feature flag per tenant or global: `tracked_insight_polarity_llm_enabled`.
- Shadow mode: log decisions without writing; compare to manual review on a sample.

---

## Summary recommendation

- **Batch all neutral keys for one insight in a single JSON-mode LLM call**, chunk if there are many keys; **persist only** `higher_better` / `lower_better` when **confidence ≥ 70%**, otherwise leave resolution as neutral—**on that insight row only**, no cross-insight reuse.
- **Pipeline order**: explicit polarities → name inference → **LLM for remaining neutrals** → then trend / `_polarities` / snapshot / change summary (see §3).
- **Triggers**: **backfill** + **when tracking / establishing polarities for `metric_values`** in that flow—not “infer polarity from snapshot deltas.”
- Reuse **`callLLM` + `jsonMode`**, low temperature, strict validation against the **expected key set**; default model aligned with `tools.ts` (see §5–6).

### Suggested implementation touchpoints

- New small service module (e.g. `trackedPolarityLlmResolution.ts`).
- Integrate into **`evaluateSingleTrackedInsight`** (and/or track-create path) **before** snapshot insert so `_polarities` reflects LLM output; plus **backfill** job for existing rows.
- `trackedInsightEvaluator.ts`, `trackedInsights.ts` (normalization/merge rules), tests alongside existing tracked-insights tests.

---

## LLM prompts (for implementation)

Use two messages: a fixed **system** prompt and a **user** prompt template filled at runtime.

### System prompt

```text
You are a senior mortgage banking analytics assistant. Your task is to infer the directional preference ("polarity") of specific numeric metrics for a tracked operational insight.

Definitions:
- higher_better: An increase in the metric is generally favorable for the business (e.g., revenue, funded volume, pull-through rate when defined that way).
- lower_better: A decrease in the metric is generally favorable (e.g., cycle time, aging, defect rate, fallout, backlog counts).
- neutral: The metric is not inherently good or bad when it moves up or down in isolation (e.g., a mix index, a share split between two buckets, or a context-free count where direction requires external business rules not stated here). If the text does not clearly establish direction, choose neutral.

You will be given:
- The insight headline and understory — these are the **primary** evidence for whether an **increase** in each metric is good or bad **in this insight’s framing**.
- Optional per-key descriptions from the product UI (if provided).
- The metric keys to judge and, optionally, current numeric values for those keys (for scale / disambiguation only).

Rules:
1) **Direction comes from the headline and understory**, not from time series, snapshot counts, or whether a number went up or down between periods. Do **not** infer polarity from “trend” or “delta” in the data.
2) The same metric **name** can mean different polarity in **different** insights (e.g. “units” as YTD leadership vs “units” stuck in pipeline). Always anchor to **this** headline/understory only.
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

Include exactly one decision object per requested metric_key, in the same order as requested.
```

### User prompt template (fill dynamically)

```text
Tracked insight
- headline: {{headline}}
- understory: {{understory}}

Source context (if any)
- source_type: {{source_type}}
- original_bucket: {{original_bucket or "n/a"}}
- original_priority: {{original_priority or "n/a"}}

Optional metric descriptions (if any)
{{keyMetricDescriptionsJson or "{}"}}

Metrics to classify (only these keys)
{{requested_keys_bullet_list}}

Current metric values (optional; for labeling / scale only — do not use for trend-based polarity)
{{current_metric_values_json}}

Instructions:
- For each metric_key, decide polarity from the **headline and understory** only: is an **increase** in this metric **good**, **bad**, or **not stated** for this insight?
- Return JSON only.
```

### Optional “repair” prompt (on parse failure)

```text
The previous output was invalid JSON or did not match the schema. Return ONLY a valid JSON object with the same schema as specified in the system message. Keys to include: {{comma_separated_keys}}
```
