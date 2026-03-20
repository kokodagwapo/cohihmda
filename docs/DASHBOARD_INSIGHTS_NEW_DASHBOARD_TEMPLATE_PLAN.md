# Dashboard Insights Template Plan for a New Dashboard

Use this template to implement Dashboard Insights for any dashboard page that does not currently support insights. This follows the production pattern already used by `leaderboard`, `loan-complexity`, and `company-scorecard`.

---

## 1) Objective and Scope

### Goal

Add end-to-end Dashboard Insights support for a new page:

- Persisted insights per page/filter context
- On-demand generation via `Generate Insights`
- In-page display via `DashboardInsightsStrip`
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

No new endpoint is typically required for adding one page.

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
- Near-duplicate collapse
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
- optional feedback props where used

Spacing/layout:

- Keep visual rhythm with dashboard sections (strip spacing before KPI/data sections)

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

---

## 7) Data/Filter Contract Requirements

For every generated insight, enforce:

- `filter_context.datePeriod` uses canonical lowercase adapter keys
- Optional filter keys match page semantics (entity type, branch, loanOfficer, actorType, tier, etc.)
- `evidence_refs[].widgetId` is from `widget_catalog`
- For subject-level insights, `target.label` must be exact data label

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
- Existing route matrix/role tests remain green

### Frontend tests

- Route mapping tests if page added to insight routes
- Optional targeted component tests for `handleShowInsight` mapping logic

### Manual validation checklist

1. Open dashboard page and confirm strip renders
2. Generate insights succeeds and persists
3. Insights reference only page-local concepts
4. Show on dashboard:
   - updates period/filter context correctly
   - navigates tab/actor mode as expected
   - scrolls to correct widget after load
5. Evidence/detail modal shows valid supporting rows and columns
   - Must open the same full Insight Detail modal used by other dashboard insights (not fallback evidence-only modal)
   - Verify older generated insights (without `detail_data`) still open full detail via `supporting_data` synthesis path
6. Duplicate/near-duplicate insights not surfaced together

---

## 10) Deployment and Ops Checklist

- Tenant migration applied for dashboard insights table(s):
  - `npm run migrate:tenant -- <tenant-slug>` (or `--all`)
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
6. [ ] Shared types updated (server + frontend)
7. [ ] Frontend strip integrated on page
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
5. Dashboard strip renders, loads stored insights, and generates on demand.
6. "Show on dashboard" restores correct filter/tab/entity context.
7. Scroll/highlight targets are stable and occur at correct timing.
8. Detail/evidence modal rows and columns render with expected metrics.
9. Chronology wording is correct (earlier -> later for directional language).
10. Duplicate/near-duplicate insights are suppressed as expected.
11. Adapter/pipeline/hydrator tests pass.
12. Full server tests pass; no new lint issues.

---

## 11B) Known Failure Modes and Standard Fixes

| Symptom | Likely Cause | Standard Fix |
|---|---|---|
| Show on dashboard opens wrong tab/entity | Incomplete widget->UI mapping | Complete mapping matrix and keep exact target.label matching |
| Evidence modal missing expected metrics | Supporting data/hydrator fields not wired | Extend shared types + hydrator column defs + supporting data builders |
| Dashboard insight opens fallback evidence modal instead of full detail modal | `detail_data` missing on stored row and no synthesis path | Add detail route synthesis from `supporting_data` via `buildDetailFromSupportingData`; keep pre-hydrated `detail_data` creation in pipeline |
| Similar duplicate insights shown | Dedupe constraints too weak | Tighten subject+timeframe and near-duplicate collapse rules |

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

