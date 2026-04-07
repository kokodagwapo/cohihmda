# Dashboard Insights Template Plan for a New Dashboard

Use this template to implement Dashboard Insights for any dashboard page that does not currently support insights. This follows the production pattern already used by `leaderboard`, `loan-complexity`, and `company-scorecard`.

---

## 1) Objective and Scope

### Goal

Add end-to-end Dashboard Insights support for a new page:

- Persisted insights per page/filter context
- On-demand generation via `Generate Insights`
- Display behavior aligned to current product rules:
  - `GET /api/dashboard-insights` returns only the most recent generated batch for the page/filter slice
  - Active tracked insights for that same source page are always included (even if filter_context differs)
  - If a newly generated insight duplicates a tracked insight, tracked insight wins in UI payload
- In-page display via `DashboardInsightsStrip`
- **Tracked insights (watchlist):** when technically evaluable, users can bookmark dashboard insights so metrics **auto-refresh** on a schedule and show **history, trends, and KPI cards** consistent with other sources; new dashboards must wire **`detail_data`** (see §4.7) so the server can derive a valid signature—or mark the row **explicitly non-evaluable** with a clear UX message
- "Show on dashboard" behavior that restores relevant filters and navigates/highlights the target widget
- Evidence/detail hydration parity in modals
- Prompting and page guidance aligned to the page's semantics

### Non-goals

- Rewriting the core multi-pass dashboard-insights pipeline
- Cross-page insight generation in one request
- Replacing existing dashboard business logic

---

## 2) Architecture Pattern (Must Reuse)

Implement with the existing architecture, not a one-off:

1. **Dashboard adapter** builds `DashboardPageContext` for the page
2. **Pipeline** (`generator -> fact-check -> judge -> curator -> evidence agent`) generates/polishes insights
3. **Storage** persists insights to `dashboard_generated_insights`
4. **UI hook** fetches page insights
5. **Dashboard strip** renders insights and actions
6. **Show on dashboard** restores filters and scrolls to the target widget

Key integration points:

- `server/src/services/dashboardInsights/adapters/*`
- `server/src/services/dashboardInsights/pipeline.ts`
- `server/src/services/dashboardInsights/dashboardInsightDetailHydrator.ts`
- `server/src/services/trackedInsights/dashboardTrackedDerivation.ts` (watchlist **`metric_signature`** from **`detail_data`**)
- `server/src/routes/trackedInsights.ts` (dashboard track + immediate baseline evaluation)
- `server/src/config/defaultPromptConfigs.ts`
- `src/hooks/useDashboardInsights.ts`
- `src/components/dashboard/DashboardInsightsStrip.tsx`
- Target dashboard page component (`src/pages/*` or `src/components/views/*`)

---

## 3) Pre-implementation Discovery Checklist

Before coding, complete this checklist for the target dashboard:

- Page identity:
  - `pageId` (kebab-case, stable)
  - `pageName`
  - `pageDescription` (clear metric/cohort semantics)
- Filter model:
  - Which filters should affect **generation context**
  - Which filters should be applied only on **Show on dashboard**
- Time periods:
  - Canonical period keys used by adapter (`mtd`, `qtd`, `ytd`, `l13m`, `y_2025`, etc.)
  - Display labels
  - Date range semantics (rolling vs fixed/full-year)
- Widgets:
  - Which charts/tables/KPIs are valid evidence targets
  - Stable widget DOM ids required for scroll/highlight
- Metrics:
  - Summary metrics
  - Segment metrics (by dimension)
  - By-period metrics
  - Any cohort caveats (application cohort vs funded cohort)
- Subject dimensions:
  - Named entities used in insights (branch, LO, processor, etc.)
  - Exact label source and expected matching

---

## 4) Backend Implementation Plan

### 4.1 Create/Register Adapter

Create `server/src/services/dashboardInsights/adapters/<newDashboard>Adapter.ts` with:

- `pageId`, `pageName`, `pageDescription`
- `getFilterCombinations()`
  - Return combinations for generation scope
  - If insights are page-level only, return `[{}]`
- `getWidgetCatalog()`
  - Include only valid evidence widgets
  - Use stable IDs that match frontend DOM ids
- `buildContext()`
  - Build full `DashboardPageContext`
  - Populate:
    - `filters`
    - `dimensions`
    - `data.summary`
    - `data.by_dimension`
    - `data.by_time_period`
    - `widget_catalog`
    - `pageGuidance` (page-specific instructions)

Register in `server/src/services/dashboardInsights/adapters/index.ts`.

### 4.2 Build Strong Page Guidance in Adapter

Put page-specific rules in `pageGuidance` (adapter-owned), not in global prompt:

- Metric semantics and "good vs bad" framing
- Evidence widget usage expectations
- Subject/dimension constraints
- Filter context requirements
- Chronology and period semantics for that dashboard

### 4.3 Pipeline Support

Update `server/src/services/dashboardInsights/pipeline.ts` as needed:

- Add/extend page-specific types for `by_time_period`
- Ensure evidence value enrichment supports new widget ids
- Ensure subject-key extraction works for new dimensions (dedupe and subject identity)
- Ensure supporting-data extraction includes page-specific fields needed by modals

### 4.4 Detail Hydrator Support

Update `server/src/services/dashboardInsights/dashboardInsightDetailHydrator.ts`:

- Map new widget IDs to dimension/entity behavior
- Add column definitions and display order for new page metrics
- Add page-specific aggregate/subject row builders if needed
- Ensure `buildDetailFromSupportingData` handles new page format
- For **tracked / watchlist** auto-refresh: the hydrator-produced **`detail_data`** must satisfy **`deriveDashboardTrackedFromDetailData`** (§4.7)—in practice that means a coherent **`audit`** block (**`generatedSql`** and/or **handler** refresh metadata) plus **`displayConfig.summary_defs`** (or equivalent) aligned with evaluation output keys.
- Ensure `src/routes/dashboard/insightDetails.ts` has backward-compatible hydration:
  - If `detail_data` is missing but `supporting_data` exists, synthesize detail payload via `buildDetailFromSupportingData`
  - Return the same full detail modal shape (title/summary/rows/displayConfig/etm) instead of falling back to minimal evidence modal

### 4.5 Types

Update shared types in:

- `server/src/services/dashboardInsights/types.ts`
- `src/hooks/useDashboardInsights.ts`
- any local modal types if required

Ensure supporting data fields are mirrored frontend/backend.

### 4.6 Routes and Operational Behavior

Confirm route behavior already supports the page:

- `GET /api/dashboard-insights?pageId=<pageId>`
- `POST /api/dashboard-insights/generate` body `{ pageId, filters }`
- Error handling for missing migration (`42P01`) remains intact
- `GET /api/dashboard-insights` payload semantics:
  - generated insights come from the latest `generation_batch` for the requested page/filter slice
  - active tracked dashboard insights are included for the same source page regardless of filter subset
  - generated insights that duplicate tracked insights are excluded from response (tracked wins)

No new endpoint is typically required for adding one page.

### 4.7 Tracked insights (watchlist) enablement for a new dashboard

This subsection is the **general checklist** for making dashboard insights **watchlist-compatible**, matching the pattern used for existing dashboards (e.g. leaderboard-style metrics, loan complexity, company scorecard, credit risk cohorts, TopTiering-style comparisons). It intentionally avoids naming a single dashboard so you can reuse it as an agent brief for **any** new page.

For background on the watchlist product and cross-source alignment, see `docs/TRACKED_INSIGHTS_IMPLEMENTATION_PLAN.md`. For **this** document, treat tracked insights as: **same bookmark UX**, **server-derived `metric_signature`** for `source_type: dashboard_insights`, and **immediate baseline snapshot** when the user first tracks (no need to wait for the next batch evaluator run).

#### 4.7.1 What “trackable” means (contract)

When a user bookmarks a dashboard insight, the client calls **`POST /api/insights/tracked`** with:

- `source_type: "dashboard_insights"`
- `source_insight_id`: numeric **`dashboard_generated_insights.id`** (not `generated_insights`)

The server loads the source row and derives **`metric_signature` + `display_metadata`** via **`deriveDashboardTrackedFromDetailData`** (`server/src/services/trackedInsights/dashboardTrackedDerivation.ts`), using:

- **`detail_data`** (primary technical contract)
- **`sentiment`**, **`severity_score`**, **`page_id` / `page_name`**, and **`filter_context`** (rolling context for parameters)

The stored row must be one of:

| Outcome | What the user sees | What was implemented |
| --- | --- | --- |
| **Evaluable** | Watchlist + detail modal auto-update; KPI cards and history populate | Valid **SQL + `keyFields`**, **handler refresh**, or rare **embedded `metricSignature`** on `detail_data` (see below) |
| **Non-evaluable (explicit)** | “Not auto-updating” / banner explains bookmark is kept but metrics will not refresh | Missing executable signature; **`display_metadata.evaluable === false`** + **`non_evaluable_reason`** |

There is **no** valid pattern where the UI pretends a bookmark is evaluable while the server stores an empty signature silently.

#### 4.7.2 Three ways `detail_data` can produce an evaluable signature

Implementers should pick one primary strategy per dashboard family (you may combine SQL + handler patterns only where the pipeline already does).

**A) SQL re-query (most common for dashboard-style metrics)**

- Hydrator / pipeline persist **`detail_data.audit.generatedSql`** with the exact SQL the evaluator should run on refresh (tenant-safe, read-only pattern consistent with the rest of the product).
- Persist **`detail_data.displayConfig.summary_defs`** (preferred) or **`summaryMetrics`** / **`summary`** keys so derivation can build **`metric_signature.keyFields`** aligned with the SELECT list.
- Map each **`summary_defs[].format`** to a supported **`keyMetricFormats`** hint where possible (currency, percent, number, days, etc.) so the tracked detail modal formats KPIs correctly.
- If SQL uses **`$1`, `$2`, …** placeholders, set **`detail_data.audit.paramResolution`** to **`rolling_dashboard`** (typical) or **`none`** (static params). Rolling resolution uses **`filter_context`** copied at track time into **`display_metadata.filter_context_snapshot`** so refreshes respect the user’s slice (date period, channel, etc.).

**B) Handler refresh (use when SQL is the wrong abstraction)**

- Some dashboards are easier to refresh by **re-running the same server-side aggregation** (joining page context, tier rules, benchmarks) than by serializing one giant SQL string.
- Hydrator sets **`detail_data.audit.trackedRefreshKind = "handler"`** and **`detail_data.audit.handlerId`** to a registered handler id in **`server/src/services/insights/trackedInsightHandlers.ts`**.
- **`metric_signature`** is stored with **`refresh_kind: "handler"`**, empty **`sql`**, and **`keyFields`** derived from **`summary_defs` / summary** exactly as in the SQL path—**`keyFields` must be non-empty** for handler refresh so normalization and UI behave consistently.
- Register the handler if new; keep handler output rows shaped so **`extractMetricValues`** (evaluator) can build **`metric_values`** keyed consistently with **`keyFields`**.

**C) Embedded agent-style `metricSignature` on `detail_data` (rare)**

- If **`detail_data.metricSignature`** is present with non-empty **`sql`** and **`keyFields`**, derivation treats it like agent insights.
- Use sparingly; prefer **A** or **B** so dashboard insights stay adapter/hydrator-native.

If none of the above apply and there is no **`generatedSql`**, derivation marks the insight **non-evaluable** with an explicit reason string.

#### 4.7.3 Hydrator responsibilities (parity with existing dashboards)

For a new **`pageId`**, extend **`server/src/services/dashboardInsights/dashboardInsightDetailHydrator.ts`** so `buildDetailFromSupportingData` / snapshot builders:

- Emit a **`detail_data` shape** that **`deriveDashboardTrackedFromDetailData`** can consume (audit block, `displayConfig`, `summary`, optional variant metadata).
- For **subject vs aggregate** insights on the same page, follow the same discipline as existing pages: **variant-specific summary keys** must match what the **handler** (if any) returns and what **`summary_defs`** advertise—avoid putting a generic “leaderboard subject” branch ahead of a **page-specific subject** branch when both could match; that pattern has caused empty **`summary_defs`** and invalid **`keyFields`** in the past.
- Keep **`buildSnapshotFromRows`** / column definitions aligned with **`trackedInsightHandlers`** when using handler refresh.

Add or extend **Vitest** coverage in **`dashboardInsightDetailHydrator.test.ts`** (and derivation tests in **`dashboardTrackedDerivation.test.ts`**) for the new page’s **`detail_data`**: assert **`metric_signature`** shape, **`keyFields`**, and **`display_metadata.evaluable`** for representative aggregate + subject rows.

#### 4.7.4 Track-create route and immediate baseline

**`server/src/routes/trackedInsights.ts`** (POST `/`):

- Loads the dashboard row with **`loadDashboardInsightForTracking`** (`server/src/services/dashboardInsights/storage.ts`).
- Derives signature/metadata; rejects **400** with a clear error if the shape is invalid for dashboard tracking.
- After insert, runs **`evaluateSingleTrackedInsight`** so the first **`tracked_insight_snapshots`** row exists immediately (“Initial evaluation — baseline established.”). The **201** response is enriched with the same **`latest_values` / `last_evaluated`** join shape as **GET** `/api/insights/tracked`, so the client can show KPIs without a refetch.

New dashboards inherit this behavior **automatically** once **`detail_data`** is correct; no extra route is required per page.

#### 4.7.5 Frontend expectations (dashboard strip)

Already required for bookmarking (§6.3A); tracked-specific expectations:

- Call **`POST /api/insights/tracked`** with **`source_type: "dashboard_insights"`** and **`source_insight_id`**; **do not** send a client-built **`metric_signature`** for dashboard sources—the server is the source of truth.
- Pass **`selectedTenantId`** (or equivalent) into **`DashboardInsightsStrip`** whenever the dashboard’s data is tenant-scoped and tracking/evaluation must target the same tenant as the page data (follow the pattern used on other multi-tenant dashboard views).
- Handle **non-evaluable** bookmarks: watchlist and **`TrackedInsightDetailModal`** show explicit copy when **`display_metadata.evaluable === false`**.
- Prefer using the **201** response body to update local insight/bookmark state so **Current values** appears immediately after track.

#### 4.7.6 Multi-row SQL and KPI display (evaluator + UI)

If **`generatedSql`** returns **multiple rows** (e.g. grouped breakdowns), the evaluator **rolls up numeric `keyFields`** onto the **base field names** (sums across rows) so **Current values** keys match **`metric_signature.keyFields`**. Dimension fields with many distinct values may show as “—” in KPI cards—the tracked headline is still about the aggregate pattern; narrow SQL or handler refresh is appropriate when the product needs a single-row scalar snapshot.

#### 4.7.7 Migrations and ops prerequisites

- **`101_tracked_insights_polymorphic_source_id`** (in this repo; filename/order may differ in forks): **`source_insight_id`** must **not** be constrained by a foreign key to **`generated_insights` only**. Dashboard bookmarks store **`dashboard_generated_insights.id`**; agent/pipeline bookmarks store **`generated_insights.id`**. The DB interprets the ID using **`source_type`** (polymorphic reference), so the old single-target FK must be dropped. **Do not reuse another migration’s number** if one already exists—keep the correct file in your branch’s ordered sequence (here, **`099`** is unrelated: tenant calculations; tracked polymorphism is **`101`**).
- Tenant migrations applied; evaluator runs on schedule or via admin **`POST /api/insights/tracked/reevaluate`**; baseline still runs **on track** as in §4.7.4.

---

## 5) Prompt Configuration Plan

### 5.1 Keep Global Prompt Generic

In `dashboard_insights.generator`:

- Keep rules page-agnostic
- Keep global chronology/cohort backup rules
- Do not hardcode dashboard-specific blocks
- New dashboard onboarding should not require changing the global generator prompt; implement dashboard-specific behavior in the new adapter's `pageGuidance` instead.

### 5.2 Put Page-Specific Behavior in Adapter `pageGuidance`

Follow Leaderboard pattern:

- Embed page-specific instructions in `pageGuidance` returned by adapter
- Ensure guidance includes:
  - Timeframe semantics
  - Allowed comparison framing
  - Required filter_context keys
  - Subject/evidence constraints

### 5.3 Curator/Judge Guardrails

Ensure existing strict duplicate and quality guardrails remain compatible:

- Same subject + same timeframe dedupe
- Programmatic dedupe by dashboard-specific `filter_context` key sets (must have the same relevant category set to compare)
- Near-duplicate headline collapse via high-similarity token-set Jaccard pass (used after filter-context pass)
- Evidence fit and timeframe clarity checks

---

## 6) Frontend Implementation Plan

### 6.1 Add Dashboard Insights Hook Usage

On target page:

- Use `useDashboardInsights(pageId, filters, { tenantId })`
- Decide page-level insight filters passed to hook
- Surface `insights`, `generatedAt`, loading, and `refresh`

### 6.2 Add Generate Action

Implement page handler:

- Call `POST /api/dashboard-insights/generate` with:
  - `pageId`
  - generation filters (often `{}` for page-level generation)
- Refresh stored insights after generation
- Show `generateLoading` and `generateError` states in strip

### 6.3 Integrate `DashboardInsightsStrip`

Render strip in the page layout with:

- `insights`
- `generatedAt`
- `loading`, `generating`, `generateError`
- `onGenerate`
- `onShowInsight`
- **`showFeedback` + `onSubmitFeedback`** when the page should expose thumbs/tags/comment (see §6.3A); wire handlers to **`GET/POST /api/dashboard-insights/:id/feedback`** (dashboard-specific storage, not `generated_insights` feedback)
- **`onRefreshInsights`** after admin delete or other mutations so the strip stays in sync

Spacing/layout:

- Keep visual rhythm with dashboard sections (strip spacing before KPI/data sections)

### 6.3A Insight cards: bucket styling and headline-row actions (current implementation)

Each insight is rendered by `InsightCard` inside `DashboardInsightsStrip`. Behavior matches the **Cohi-style** criticality buckets and keeps **primary actions on the headline row** so users do not have to expand the card to track, rate, deep-dive, or remove.

#### Bucket colors and labels (maps stored `sentiment`)

The card uses `insight.sentiment` to drive **left accent strip**, **border**, **gradient icon tile**, and a **badge label** (bright styling, not muted paste):

| `sentiment` | Badge label | Role |
| --- | --- | --- |
| `critical` | Immediate Action Required | Highest urgency (rose / red family) |
| `warning` | Monitor Closely | Elevated attention (amber / orange) |
| `positive` | Strategic Review | Positive / opportunity framing (blue / indigo) |
| `neutral` | Informational | Default / low urgency (slate) |

A secondary **“Dashboard Insight”** chip appears next to the bucket badge for context.

#### Headline row (always visible when `insight.id` is present)

These controls use **`stopPropagation`** so they do not toggle expand/collapse:

1. **Bookmark (track)** — Toggles the user watchlist via **`POST /api/insights/tracked`** (pin) and **`DELETE /api/insights/tracked/:id`** (unpin). The body uses **`source_type: "dashboard_insights"`** and **`source_insight_id`** = `dashboard_generated_insights.id` (no client **`metric_signature`**). The server derives **`metric_signature`** / **`display_metadata`** from stored **`detail_data`** and runs an **immediate baseline evaluation**; see **§4.7** and **§6.7**. Tracked rows are resolved on load by filtering tracked insights where `source_type === "dashboard_insights"`.  
   - **DB:** Tenant migration **`101_tracked_insights_polymorphic_source_id`** drops the old FK from `source_insight_id` to `generated_insights` so dashboard IDs are valid.
2. **Feedback** — Shown when **`showFeedback`** is true. Thumbs open a popover for optional tags + comment, then submit via **`onSubmitFeedback`** or the client’s **`submitDashboardInsightFeedback`** → **`POST /api/dashboard-insights/:id/feedback`**. This is **separate** from Cohi `generated_insights` feedback tables.
3. **Deep dive (Workbench)** — Shown for **platform staff** (`useAuth().isPlatformStaff()`). Calls **`POST /api/workbench/canvases/from-dashboard-insight`** then navigates to **`/my-dashboard/:canvasId`** (full insight dashboard widget group + `savedFilters` from `filter_context`).
4. **Remove insight** — Same admin gate; **`DELETE /api/dashboard-insights/:id`**, then **`onRefreshInsights`**.

#### Expanded section

- **ETM / understory** block (“Why this matters”) when expanded.
- **Secondary actions** (below headline): **Show on dashboard** (`onShowInsight`), **View evidence** (detail/evidence modals), **Less**.

#### Implementation reference

- UI: `src/components/dashboard/DashboardInsightsStrip.tsx` (`BUCKET_STYLE`, `InsightCard`).
- Feedback API: `server/src/routes/dashboardInsights.ts`, migration **`098_dashboard_insight_feedback.sql`**.
- Watchlist FK: **`101_tracked_insights_polymorphic_source_id.sql`**.
- Watchlist derivation + track route: **`server/src/services/trackedInsights/dashboardTrackedDerivation.ts`**, **`server/src/routes/trackedInsights.ts`** (see **§4.7**).
- Deep dive builder: `server/src/services/workbench/fromDashboardInsightCanvas.ts`.

### 6.4 Implement "Show on dashboard"

In page-specific `handleShowInsight`:

- Parse `insight.filter_context`
- Restore relevant page filters (time period + page-relevant selectors)
- Resolve target widget/entity from `evidence_refs`
- Switch tabs/actor modes as needed
- Set pending widget id for scroll

### 6.5 Stable DOM Targets + Deferred Scroll

Add stable wrapper ids around target widgets that match widget catalog ids.

Use deferred scroll logic so scrolling occurs:

- after data reload if filter changes trigger loading
- immediately if no reload is expected

This prevents stale-scroll behavior.

### 6.6 Route Mapping

If new page needs insights route mapping, update route helper(s), e.g.:

- `src/lib/dashboardInsightRoutes.ts`
- associated tests

### 6.7 Tracked insights (watchlist) — frontend checklist

This complements §6.3A (bookmark control on the card). For each new dashboard:

- **Track payload:** only **`headline`**, **`understory`** (optional), **`source_insight_id`** (`dashboard_generated_insights.id`), **`source_type: "dashboard_insights"`** — no **`metric_signature`** in the client body.
- **Tenant:** pass **`selectedTenantId`** into **`DashboardInsightsStrip`** when the page requires it so track/evaluate targets the same database slice as the charts (same pattern as other tenant-scoped dashboard pages).
- **After track:** prefer merging the **201** response from **`POST /api/insights/tracked`** (includes **`latest_values`**, **`last_evaluated`**, **`latest_trend`**) into local state so the user sees a baseline without waiting for a list refetch.
- **Non-evaluable:** if the server marks **`display_metadata.evaluable === false`**, the watchlist/detail modal should show the existing **“Not auto-updating”** treatment—do not imply scheduled refresh.

Backend requirements for evaluability are in **§4.7**.

---

## 7) Data/Filter Contract Requirements

For every generated insight, enforce:

- `filter_context.datePeriod` uses canonical lowercase adapter keys
- Optional filter keys match page semantics (entity name/branch/loanOfficer/actor/tier, etc.; avoid legacy ambiguous aliases where possible)
- `evidence_refs[].widgetId` is from `widget_catalog`
- For subject-level insights, `target.label` must be exact data label
- Any key used for dedupe must be explicitly prompted in page guidance so generation and dedupe compare the same semantics
- **Watchlist refresh:** keys in **`filter_context`** are snapshotted when the user tracks (see **§4.7**); omitting a dimension the refresh query expects can produce wrong metrics or failed evaluations—keep the contract explicit in **`pageGuidance`**

---

## 8) Chronology and Timeframe Rules (Required)

For all pages, ensure prompts/guidance enforce:

- Do not infer chronology from JSON key order
- Determine earlier/later from period semantics and/or `dateRange`
- Directional language ("increased from A to B") must follow earlier -> later
- If chronology ambiguous, use neutral comparisons
- Explicitly distinguish rolling/current windows vs fixed/full-year windows

---

## 9) Testing Plan

### Backend tests

- Adapter tests:
  - identity, filter combinations, widget catalog, context shape/pageGuidance
- Pipeline tests (where applicable):
  - evidence enrichment for new widgets
  - subject key extraction for new dimensions
- Hydrator tests:
  - row-building and column mapping for new fields
- **Tracked / watchlist derivation (required when the dashboard should be evaluable):**
  - **`deriveDashboardTrackedFromDetailData`**: at least one test path per evaluable strategy you use (**SQL + `generatedSql`**, **handler**, or embedded **`metricSignature`**) plus a **non-evaluable** fixture if the page can legally bookmark without SQL
  - **`dashboardInsightDetailHydrator`**: snapshot / **`detail_data`** tests asserting **`displayConfig.summary_defs`** (or equivalent) lines up with derived **`keyFields`** and handler ids when applicable—avoid regressions where **`summary_defs`** is empty for subject insights
- Existing route matrix/role tests remain green

### Frontend tests

- Route mapping tests if page added to insight routes
- Optional targeted component tests for `handleShowInsight` mapping logic

### Manual validation checklist

1. Open dashboard page and confirm strip renders
2. Generate insights succeeds and persists
3. Insights reference only page-local concepts
4. Display semantics are correct:
   - non-tracked insights come from latest generation batch only
   - tracked insights from this page remain visible across generation/filter changes
   - generated duplicates of tracked insights are not shown
5. Show on dashboard:
   - updates period/filter context correctly
   - navigates tab/actor mode as expected
   - scrolls to correct widget after load
6. Evidence/detail modal shows valid supporting rows and columns
   - Must open the same full Insight Detail modal used by other dashboard insights (not fallback evidence-only modal)
   - Verify older generated insights (without `detail_data`) still open full detail via `supporting_data` synthesis path
7. Card chrome and actions (§6.3A): bucket badge/colors match `sentiment`; bookmark, thumbs, deep dive, and remove work from the **headline row** without expanding; dashboard feedback persists separately from Cohi insight feedback
8. **Tracked insights (§4.7 / §6.7):** bookmark creates a watchlist row; **201** response includes **`latest_values`** and **`last_evaluated`** when evaluable; KPI cards in **`TrackedInsightDetailModal`** show numeric values (not all **“—”**) for evaluable signatures; non-evaluable bookmarks show explicit **not auto-updating** messaging
9. Duplicate/near-duplicate insights not surfaced together

---

## 10) Deployment and Ops Checklist

- Tenant migration applied for dashboard insights table(s):
  - `npm run migrate:tenant -- <tenant-slug>` (or `--all`)
- For **dashboard insight feedback** (thumbs/tags/comment on strip cards): tenant migration **`098_dashboard_insight_feedback`**
- For **bookmark/watchlist on dashboard insights** (`source_type: dashboard_insights`): tenant migration **`101_tracked_insights_polymorphic_source_id`** (removes FK that forced `source_insight_id` to exist only in `generated_insights`)
- **Baseline snapshot on track:** server runs an immediate evaluation after **`POST /api/insights/tracked`** for the new row; no separate deploy step per dashboard—ensure **`detail_data`** supports derivation (§4.7) so that evaluation succeeds
- For dashboard rows used by Cohi insights category chips/grouping: tenant migration **`098_dashboard_insights_functional_category`**
- For dashboard-specific curated few-shot examples in management DB: management migration **`028_dashboard_insight_training_examples`**
- Prompt defaults loaded (or admin overrides present)
- Verify environment has required LLM credentials/config
- Validate on dev tenant with real data and multiple period combinations

---

## 11) Implementation Task Template

Use this task list when executing:

1. [ ] Discovery completed (metrics, filters, periods, widgets, semantics)
2. [ ] Adapter created and registered
3. [ ] Adapter `pageGuidance` authored (including chronology rules)
4. [ ] Pipeline updated for new widget/dimension semantics
5. [ ] Hydrator updated for detail/evidence parity
5b. [ ] **Tracked insights:** `detail_data` + hydrator support **`deriveDashboardTrackedFromDetailData`** (§4.7) — SQL (`generatedSql` + `summary_defs`) and/or **handler** refresh; tests for derivation + hydrator snapshot shape
6. [ ] Shared types updated (server + frontend)
7. [ ] Frontend strip integrated on page (including §6.3A: `showFeedback` / `onSubmitFeedback` / `onRefreshInsights` where required; §6.7: `selectedTenantId` + no client `metric_signature` for dashboard track)
8. [ ] Generate handler implemented
9. [ ] Show-on-dashboard filter sync + deferred scroll implemented
10. [ ] Route mapping updates/tests completed
11. [ ] Adapter/pipeline/hydrator tests passing
12. [ ] Full server test suite passing
13. [ ] Manual QA checklist completed on dev

---

## 11A) Acceptance Criteria (Definition of Done)

A new dashboard insights rollout is done only when all criteria are true:

1. Adapter builds complete `DashboardPageContext` with valid `pageGuidance`.
2. Generator output for the page uses only page-local widgets/dimensions.
3. `filter_context` contract is populated correctly for page/subject/tier insights.
4. Evidence refs resolve to valid widget ids and exact target labels.
5. Dashboard strip renders, loads stored insights, and generates on demand; cards use bucket styling and headline-row actions per §6.3A where enabled.
6. "Show on dashboard" restores correct filter/tab/entity context.
7. Scroll/highlight targets are stable and occur at correct timing.
8. Detail/evidence modal rows and columns render with expected metrics.
9. If the page supports bookmarking: **evaluable** insights derive **`metric_signature`** on the server (§4.7); first track produces a **baseline snapshot** (`last_evaluated`, `latest_values`); **non-evaluable** insights remain explicit in UI.
10. Chronology wording is correct (earlier -> later for directional language).
11. Duplicate/near-duplicate insights are suppressed as expected.
12. Adapter/pipeline/hydrator (and tracked derivation) tests pass.
13. Full server tests pass; no new lint issues.

---

## 11B) Known Failure Modes and Standard Fixes

| Symptom | Likely Cause | Standard Fix |
|---|---|---|
| Show on dashboard opens wrong tab/entity | Incomplete widget->UI mapping | Complete mapping matrix and keep exact target.label matching |
| Evidence modal missing expected metrics | Supporting data/hydrator fields not wired | Extend shared types + hydrator column defs + supporting data builders |
| Dashboard insight opens fallback evidence modal instead of full detail modal | `detail_data` missing on stored row and no synthesis path | Add detail route synthesis from `supporting_data` via `buildDetailFromSupportingData`; keep pre-hydrated `detail_data` creation in pipeline |
| Similar duplicate insights shown | Dedupe constraints too weak | Tighten subject+timeframe and near-duplicate collapse rules |
| Bookmark succeeds but tracked KPI cards all “—” / Invalid metric signature | **`detail_data`** missing **`generatedSql`** + **`summary_defs`**, or **`keyFields`** don’t match evaluator output; subject path hit generic hydrator branch | Fix hydrator **`summary_defs`** + audit block (§4.7); ensure subject-specific **`variant`** logic runs before any generic subject branch; align SQL SELECT aliases with **`keyFields`** |
| Handler-tracked insight fails validation | **`keyFields: []`** for **`refresh_kind: "handler"`** | Populate **`summary_defs`** keys to match handler row shape; register handler id |
| Track works but no baseline until hours later | Old behavior / failed initial eval | Confirm server **`evaluateSingleTrackedInsight`** after insert; check logs for SQL/handler errors; fix **`detail_data`** or params |

---

## 11C) Minimum Test Expectations for Any New Dashboard

At minimum, add/verify:

- Adapter test:
  - page identity
  - filter combinations
  - widget catalog ids
  - `buildContext` shape and `pageGuidance` presence
- Pipeline behavior test(s) (if page-specific logic added):
  - evidence enrichment for new widget ids
  - subject extraction/dedupe behavior for new dimensions
- Hydrator behavior test(s):
  - expected snapshot row shape/column order for page metrics
- Tracked derivation test(s) (`deriveDashboardTrackedFromDetailData`):
  - evaluable SQL path, handler path (if used), and explicit non-evaluable path where applicable
- Route/UI utility tests:
  - route mapping if page added to dashboard insight routes
- Regression:
  - existing dashboard insight tests remain green

---

## 12) Copy/Paste Starter Snippets

### Adapter `pageGuidance` starter
This should be used as a starter only. Edit the starter and add more to make it more page-specific. 

```ts
pageGuidance: [
  "Use this dashboard's canonical time periods and metrics exactly as provided in by_time_period and summary.",
  "Chronology: determine earlier vs later from dateRange/period semantics, not object key order.",
  "Directional language must follow earlier->later ordering; if ambiguous, use neutral comparisons.",
  "Use only widget IDs from widget_catalog for evidence_refs.",
  "For subject-level insights, set evidence_refs.target.label to exact dimension values from context.",
  "Populate filter_context with the dashboard's canonical datePeriod key and required page-specific filters.",
]
```

### Generate request starter

```ts
await api.request("/api/dashboard-insights/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    pageId: "<new-page-id>",
    filters: {},
  }),
});
```

---

## 13) Notes for Future Dashboards

- Default to adapter-owned page guidance; avoid embedding page-specific instructions in global prompts
- Keep evidence references strict and widget-driven
- Favor stable filter_context contracts over UI-specific one-off parsing
- Treat chronology/cadence rules as first-class quality controls, not optional polish
- **Tracked insights:** design **`detail_data`** for **derivation first**—`audit.generatedSql` / handler audit + **`summary_defs`** should be planned alongside the evidence modal, not as a retrofit, if the product expects watchlist auto-refresh on that page

