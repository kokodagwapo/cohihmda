# Tracked Insights / Watchlist Implementation Plan

This plan is the prior implementation plan, updated only with the requested clarifications and scope changes.

---

> **✅ IMPLEMENTED (2026-03-31 — §0 Dashboard alignment first)**  
> Delivered end-to-end for this section: server-side derivation for `source_type = dashboard_insights` (`loadDashboardInsightForTracking` + `deriveDashboardTrackedFromDetailData` in `server/src/services/`, wired in `server/src/routes/trackedInsights.ts`), dashboard strip no longer sends a forced-empty `metric_signature`, and watchlist + tracked detail modal surface explicit non-evaluable state (`display_metadata.evaluable` / `non_evaluable_reason`) with “Not auto-updating” and copy instead of silent empty signature behavior.

---

## Progress Snapshot (Current)

### Completed so far

- **Stage 0 complete** (Implementation Order item 1 / section 0): dashboard alignment contract baseline is implemented.
- **Stage 1 complete** (backend normalization scope):
  - `trackedInsights` create route now centralizes source-type normalization and server-side signature validation.
  - `source_type = "agent"` + `source_insight_id`: server loads `generated_insights.detail_data.metricSignature` and persists display metadata hints.
  - `source_type = "pipeline"` + `source_insight_id`: server prefers source-row signature derivation and falls back to valid payload only when needed.
  - `source_type = "dashboard_insights"` remains server-derived and supports explicit non-evaluable state.
  - Display metadata migration handling is guarded (column presence check aligned with existing migration intent).
- **Stage 2 complete** (backend re-evaluation trigger parity):
  - Added best-effort tracked reevaluation call after **generate-more** persistence.
  - Added best-effort tracked reevaluation call after **category refresh** replace/append persistence.
  - Full run reevaluation path remains in place (now via shared helper in orchestrator).
  - All three generation entry points now invoke tracked reevaluation logic consistently.
- **Stage 3 complete** (backend trend/summary quality):
  - Evaluator now derives compared metric keys deterministically from `keyFields` with stable aggregate-key fallback (`_avg` / `_sum` / `_count`).
  - Snapshot `metric_values` now persist compared-key and polarity context metadata (`_compared_keys`, `_polarities`) for downstream UI interpretation.
  - Track-create route now persists source bucket/priority/severity context into `display_metadata` for agent/pipeline sourced rows.
  - Change-summary generation now includes source bucket/priority/severity context (when available) plus polarity context.
- **Stage 4 complete** (frontend dashboard tracking parity):
  - `DashboardInsightsStrip` continues to track with `source_type: "dashboard_insights"` and no client `metric_signature` (server-derived); optional `refreshTrigger` refetches bookmark state when parent bumps it.
  - `AletheiaPromptsCard` tracks `source === "dashboard_insights"` the same way (no empty SQL payload); agent/pipeline paths unchanged.
  - `TrackedInsightDetailModal` shows a header “Not auto-updating” badge when `display_metadata.evaluable === false` (aligned with watchlist); non-evaluable banner unchanged.
- **Stage 5 complete** (frontend lifecycle UX):
  - **Pause / Resume** in `TrackedInsightDetailModal`: `status` → `resolved` (paused) vs `active`, with footer copy; evaluator already skips non-`active` rows.
  - **Polarity-aware deltas** in the modal: `metric_signature.polarities` when present, else `src/lib/trackedMetricPolarity.ts` (mirrors server inference).
  - **Watching vs Archived** toggle in `TrackedInsightsWatchlist`: Watching = `active` + `resolved` (paused chip); Archived = `archived`; Untrack vs Archive copy and actions remain distinct.
  - **Restore to watchlist** for archived rows (→ `active`). Dashboard strip / Aletheia bookmark maps treat `resolved` like tracked so toggling bookmark does not duplicate after pause.
- **Stage 6 complete** (validation hardening — Implementation Order item **8**):
  - Automated regression tests cover the **Suggested Test Plan** subsets that do not require a live DB or orchestrator: polarity inference (`cycle_time` / `fallout_rate` / `stale_count` style keys), dashboard `deriveDashboardTrackedFromDetailData` evaluable vs non-evaluable paths, and client/server parity for `inferTrackedMetricPolarity`.
  - **Run:** from repo root, `npm run test:tracked-insights` (frontend Vitest + server Vitest for the files above).
  - **Manual / integration** (still recommended before release): full insight generation runs, snapshot writes after generate-more/category-refresh, paused vs active evaluator behavior, non-admin bookmarking and watchlist UX — these remain manual or existing E2E where applicable; alerts are out of scope per plan.

### Left to do

- None for this tracked-insights plan; release when product signs off remaining manual checks above.

---

## 0) Dashboard Insights Alignment First (New)

Before the tracked-insight ticket work, align dashboard insights implementation to behave more like regular Cohi insights while preserving current dashboard functionality.

### Major implementation differences today

- **Data source and schema shape differ**
  - Regular insights: `generated_insights` with richer agent/pipeline conventions.
  - Dashboard insights: `dashboard_generated_insights`, with page/filter-context specific semantics.
- **Tracking input quality differs**
  - Regular insights path can provide usable `metric_signature` (especially agent insights from `detail_data.metricSignature`).
  - Dashboard strip currently tracks with `metric_signature: { sql: "", keyFields: [] }`, which is not re-evaluable.
- **Detail payload conventions differ**
  - Regular agent insights often carry `detail_data` fields expected by watchlist/evaluator flow.
  - Dashboard `detail_data` is oriented around dashboard evidence display, not always watchlist re-eval signatures.
- **Ownership/usage model differs**
  - Dashboard insights are page-bound and filter-context-aware.
  - Regular insights are lane/bucket-driven and directly used in watchlist flows.

### Alignment strategy (without breaking current behavior)

1. **Standardize trackable signature contract**
  - Ensure both insight types can resolve to the same watchlist-evaluable shape:
    - `metric_signature: { sql: string; keyFields: string[]; polarities?: ... }`
    - `display_metadata: { keyMetricDescriptions, keyMetricFormats, original bucket metadata }`
2. **Server-side derivation as source of truth**
  - For `source_type = dashboard_insights`, derive signature/metadata from source row server-side where possible.
  - Keep client payload optional; server validates/normalizes.
3. **Normalize UI behavior**
  - Keep one bookmark/track mental model for users regardless of source.
  - If a dashboard insight cannot be evaluated yet, return an explicit non-evaluable state and show this in watchlist UI (no silent failure).
4. **Incremental parity**
  - Phase 1: make dashboard-tracked items evaluable where possible.
  - Phase 2: enrich dashboard detail payloads so tracked evaluations match regular insight fidelity.

---

## Implementation Order

Follow this sequence to reduce rework and keep dependencies clean:

1. **Dashboard alignment contract first**
  - Finalize the shared tracked-signature contract (`metric_signature`, `display_metadata`, evaluable vs non-evaluable state).
  - Confirm how dashboard source rows will derive signature/metadata server-side.
2. **Backend track-create hardening**
  - Implement server-side extraction/validation in `trackedInsights` route.
  - Ensure agent/pipeline/dashboard tracking paths all normalize to the same stored shape.
3. **Backend generation-trigger parity**
  - Add tracked reevaluation calls after all generation flows (full, bucket generate-more, category refresh).
4. **Backend polarity + summary consistency**
  - Complete polarity consistency in evaluator output contract.
  - Add source bucket/severity context persistence and use it in change-summary prompt.
5. **Frontend dashboard tracking parity**
  - Stop sending guaranteed-empty dashboard `metric_signature`.
  - Handle backend evaluable/non-evaluable response states in UI.
6. **Frontend tracked detail lifecycle**
  - Add pause/resume actions and polarity-correct delta rendering in tracked detail modal.
7. **Frontend archived insights UX**
  - Add active/archived toggle and finalize archive vs untrack semantics in watchlist.
8. **Validation pass**
  - Run backend and frontend test plan sections end-to-end.
  - Specifically verify paused-item reevaluation behavior and dashboard parity behavior.

### Staged Delivery / Verification Gates (Recommended)

Use these stages so each increment is shippable and testable before starting the next one.

**Stage 0 — Dashboard alignment contract baseline (already completed)**
- Includes: Implementation Order item **1** (**Dashboard alignment contract first** / section 0 above).
- Verify baseline before Stage 1:
  - Dashboard track creation is server-derived (not client-signature-dependent).
  - Non-evaluable dashboard rows are explicit in watchlist/detail (no silent failure).
- Stop condition: baseline parity behavior is in place and stable.

**Stage 1 — Backend tracking normalization only**
- Includes:
  - Implementation Order item **2** (**Backend track-create hardening**)
  - Backend plan section **1) Harden tracked insight creation + signature extraction**
  - Backend plan section **5) Migration handling for display metadata**
- Verify before moving on:
  - Agent and pipeline tracks still create rows successfully.
  - Dashboard track no longer depends on client-provided signature.
  - Non-evaluable dashboard tracks persist explicit `display_metadata.evaluable = false` + reason.
- Stop condition: all track-create paths produce normalized stored shape.

**Stage 2 — Backend reevaluation trigger parity**
- Includes:
  - Implementation Order item **3** (**Backend generation-trigger parity**)
  - Backend plan section **2) Re-evaluate tracked insights after every generation path**
- Verify before moving on:
  - Full run, generate-more, and category refresh all invoke reevaluation.
  - New snapshots are created only for active tracked rows.
- Stop condition: reevaluation trigger behavior is consistent across all generation entry points.

**Stage 3 — Backend trend/summary quality**
- Includes:
  - Implementation Order item **4** (**Backend polarity + summary consistency**)
  - Backend plan section **3) Complete polarity usage consistency**
  - Backend plan section **4) Change-summary prompt upgrade with source context**
- Verify before moving on:
  - Trend direction remains stable and polarity-correct for known lower-is-better metrics.
  - Snapshot summary copy includes expected source/severity context where present.
- Stop condition: backend outputs are consistent enough for frontend consumption without extra heuristics.

**Stage 4 — Frontend dashboard parity only** ✅ **Done**
- Includes:
  - Implementation Order item **5** (**Frontend dashboard tracking parity**)
  - Frontend plan section **8) Ensure dashboard insight tracking produces watchlist-compatible rows**
- Verify before moving on:
  - Dashboard strip track/untrack works with server-derived signatures.
  - Non-evaluable dashboard items clearly indicate non-auto-refresh state in watchlist/detail.
- Stop condition: dashboard tracking UX is functionally aligned with regular tracking UX.

**Stage 5 — Frontend lifecycle UX** ✅ **Done**
- Includes:
  - Implementation Order item **6** (**Frontend tracked detail lifecycle**)
  - Implementation Order item **7** (**Frontend archived insights UX**)
  - Frontend plan sections **6 + 7**
- Verify before moving on:
  - Pause/resume changes tracked lifecycle state without untracking.
  - Archived view toggle works and archive/untrack semantics are clearly distinct.
- Stop condition: lifecycle management UX is complete and understandable for end users.

**Stage 6 — End-to-end validation hardening** ✅ **Done (automated subset + documented manual follow-ups)**
- Includes:
  - Implementation Order item **8** (**Validation pass**)
  - Full regression sweep from Suggested Test Plan.
- Verify before closing:
  - Backend + frontend test plan sections pass end-to-end.
  - No regressions in non-admin bookmarking, history timeline, and dashboard parity paths.
- Stop condition: all scoped plan items are verified and ready for release.
- **Delivered:** `npm run test:tracked-insights`; tests under `server/src/services/insights/trackedPolarityInference.test.ts`, `server/src/services/trackedInsights/dashboardTrackedDerivation.test.ts`, `src/lib/trackedMetricPolarity.test.ts`. Integration/E2E scenarios in the Suggested Test Plan remain for manual/CI E2E as noted in Progress Snapshot.

---

## Current State: Done vs Gap (Clarified)

> **Authoritative status:** see **Progress Snapshot** at the top of this doc. The subsections below are partly historical from the original gap analysis.

### Already done

- Tracked routes, history endpoint, evaluator, watchlist UI, and tracked detail modal exist.
- `display_metadata` migration exists in branch as `097_tracked_insights_display_meta.sql`.
- Bookmark button in `AletheiaPromptsCard.tsx` bucket lane is already not admin-gated.
- Main full agent generation path (`runInsightGeneration`) already calls `evaluateTrackedInsights` after persistence.

### Partially done (important clarification)

- **Polarity-aware trend detection is partially implemented, not fully complete end-to-end.**
  - In backend evaluator (`trackedInsightEvaluator.ts`), `determineTrend()` already applies polarity (explicit or inferred).
  - But polarity semantics are not consistently carried through all related UX/logic:
    - UI delta coloring is still simple up/down in tracked detail modal.
    - Not all tracking source paths guarantee polarity metadata/consistent key semantics.
  - So the Jira statement ("no polarity-aware trend detection") is directionally true from end-to-end product behavior, even though core backend trend logic exists.

### Remaining key gaps

- Backend still trusts client payload too much for tracked signature creation.
- Generation paths other than full run do not all trigger tracked re-evaluation.
- ~~Dashboard tracking path can create unevaluable tracked rows (empty signature).~~ Addressed for dashboard strip + Aletheia (Stage 4); server still marks non-evaluable explicitly when SQL cannot be derived.
- Pause/resume lifecycle semantics are not implemented as explicit tracked-insight controls.
- No UX entry point to browse archived tracked insights.
- Alerts are out of scope (removed from plan below).

---

## Backend Implementation Plan

### 1) Harden tracked insight creation + signature extraction

**Files**

- `server/src/routes/trackedInsights.ts`
- `server/src/services/dashboardInsights/storage.ts` (read path for dashboard source data)

**Changes**

- Centralize track-create normalization in route handler:
  - Validate and normalize `source_type`.
  - For `source_type = "agent"` and `source_insight_id` present:
    - Load source from `generated_insights`.
    - Extract `metric_signature` from `detail_data.metricSignature`.
    - Persist `display_metadata.keyMetricDescriptions` and `display_metadata.keyMetricFormats`.
  - For `source_type = "pipeline"`:
    - Prefer source-row derivation when available; fallback to provided payload if valid.
  - For `source_type = "dashboard_insights"`:
    - Derive best-available `metric_signature` server-side from `dashboard_generated_insights.detail_data`.
    - If still not derivable, explicitly mark tracked row as non-evaluable (preferred over silent bad signature).
- Enforce server-side shape validation:
  - `metric_signature.sql` non-empty string for evaluable rows.
  - `keyFields` array present.

**Why**

- Eliminates broken extraction paths and makes tracking durable even if frontend payload changes.

---

### 2) Re-evaluate tracked insights after every generation path

**File**

- `server/src/services/insights/agents/insightOrchestrator.ts`

**Changes**

- Add `evaluateTrackedInsights(tenantId, tenantPool)` calls after persistence in:
  - `generateMoreForBucketAgent` (after append)
  - `generateInsightsForCategory` (after category replace/append)
- Keep best-effort try/catch logging like existing full-run flow.

**Why**

- Matches ticket requirement: reevaluate on each insight generation event, not only full run.

---

### 3) Complete polarity usage consistency (trend + presentation contract)

**File**

- `server/src/services/insights/trackedInsightEvaluator.ts`

**Changes**

- Keep existing trend polarity logic and harden consistency:
  - Ensure primary compared keys are always derived deterministically from `keyFields`.
  - Persist enough polarity context in snapshot/metadata outputs for UI interpretation.
- Ensure fallback polarity inference includes ticket-mentioned fields and aliases (`cycle_time`, `fallout_rate`, `stale_count`, etc.).

**Why**

- Backend trend may already be polarity-aware, but end-to-end behavior must be consistent and explainable.

---

### 4) Change-summary prompt upgrade with mortgage context and source severity context

**Files**

- `server/src/services/insights/trackedInsightEvaluator.ts`
- `server/src/routes/trackedInsights.ts`

**Changes**

- Persist source context when tracking:
  - `display_metadata.original_bucket`
  - `display_metadata.original_priority`
  - `display_metadata.original_severity_score`
- Extend summary prompt context with:
  - metric polarity meaning
  - mortgage-domain framing
  - original bucket/severity context

**Why**

- Produces more meaningful and consistent historical summaries.

---

### 5) Migration handling for display metadata

**Files**

- Existing: `server/migrations/tenant/097_tracked_insights_display_meta.sql`
- Optional follow-up migration only if needed for added metadata structure/indexes

**Changes**

- Do not duplicate migration intent; keep single source in branch.
- Align route comments/guards and metadata expectations with the existing migration.

---

## Frontend Implementation Plan

### 6) Tracked detail modal: pause/resume semantics + polarity-correct deltas ✅ (Stage 5)

**File**

- `src/components/dashboard/TrackedInsightDetailModal.tsx`

**Changes**

- Add explicit **Pause / Resume** action:
  - Pause updates tracked insight status away from active (recommended: `resolved` or dedicated `paused` if backend expanded).
  - Resume returns status to `active`.
  - Paused insights remain tracked but are skipped by evaluator (backend filter already uses `status = 'active'`).
- Update footer/actions copy to make this lifecycle clear.
- Make delta coloring polarity-aware (not just green-up/red-down), using:
  - `display_metadata` hints where present
  - key-name inference fallback.

**Clarification captured**

- Pause/resume is purely for tracked update lifecycle, not untracking.

**Done:** Pause → `resolved`, Resume / Restore → `active`; archived row gets **Restore to watchlist**; footer explains pause vs archive vs untrack. Deltas use `metric_signature.polarities` + `src/lib/trackedMetricPolarity.ts`.

---

### 7) Add archived insights view entry point ✅ (Stage 5)

**Files**

- `src/components/dashboard/TrackedInsightsWatchlist.tsx`
- optionally `src/components/dashboard/TrackedInsightDetailModal.tsx` (archive flow copy tweaks)

**Changes**

- Add a toggle/button in watchlist to switch between:
  - Active tracked insights
  - Archived tracked insights
- Keep archive and untrack actions distinct:
  - Archive = keep tracked item for historical reference.
  - Untrack/Delete = remove tracked item.

**Done:** **Watching** vs **Archived** toggle; Watching includes **active** and **paused** (`resolved`) with a Paused chip. Modal headers/body copy for archived vs paused.

---

### 8) Ensure dashboard insight tracking produces watchlist-compatible rows ✅ (Stage 4)

**Files**

- `src/components/dashboard/DashboardInsightsStrip.tsx`
- `src/components/dashboard/AletheiaPromptsCard.tsx` (minor alignment only)

**Changes**

- Stop posting guaranteed-empty signature payload for dashboard tracks.
- Lean on backend derivation and pass source IDs/types consistently.
- If backend returns non-evaluable tracked state, show lightweight UI indication in watchlist/detail.

**Done:** Strip and Aletheia both POST `dashboard_insights` without `metric_signature`; Aletheia uses `source === "dashboard_insights"` so escalated dashboard rows no longer fall through to pipeline with empty SQL. Watchlist + detail modal surface non-evaluable state; detail header adds a “Not auto-updating” badge matching the watchlist chip.

---

## Explicitly Removed From Scope

- Alert configuration UI
- Alert threshold persistence logic changes
- Threshold-trigger evaluation behavior

Plan retains polarity/trend improvements, history/timeline, pause/resume, archive browsing, and dashboard parity work.

---

## Suggested Test Plan

**Automated (Stage 6):** `npm run test:tracked-insights` covers polarity keys and dashboard derivation evaluable / non-evaluable behavior. Other rows below are manual or environment-dependent.

### Backend

- Track agent insight by `source_insight_id` only and verify server extracts `detail_data.metricSignature`.
- Track dashboard insight and verify:
  - evaluable signature derivation when data exists
  - explicit non-evaluable state when not derivable.
- Trigger full run, bucket-generate, and category-refresh; verify snapshots are written for active tracked rows.
- Verify polarity trend outcomes for lower-is-better metrics (`cycle_time`, `fallout_rate`, `stale_count`).
- Verify paused rows are not reevaluated; resumed rows are reevaluated again.

### Frontend

- Bookmark/unbookmark works for non-admins in regular insights lanes.
- Watchlist modal supports pause/resume without removing item from tracked list.
- Archived toggle displays archived tracked rows.
- Trend delta colors follow metric polarity direction.
- Dashboard-tracked items behave consistently with regular tracked items (or show explicit non-evaluable state).

---

## File List To Modify (Implementation Phase)

### Backend

- `server/src/routes/trackedInsights.ts`
- `server/src/services/insights/agents/insightOrchestrator.ts`
- `server/src/services/insights/trackedInsightEvaluator.ts`
- Optional migration follow-up only if needed beyond existing `097`

### Frontend

- `src/components/dashboard/TrackedInsightDetailModal.tsx`
- `src/components/dashboard/TrackedInsightsWatchlist.tsx`
- `src/components/dashboard/DashboardInsightsStrip.tsx`
- `src/components/dashboard/AletheiaPromptsCard.tsx` (minimal alignment)
- `src/lib/api.ts` (typing/status values only if required)

### Tests (Stage 6)

- `server/src/services/insights/trackedPolarityInference.test.ts`
- `server/src/services/trackedInsights/dashboardTrackedDerivation.test.ts`
- `src/lib/trackedMetricPolarity.test.ts`

