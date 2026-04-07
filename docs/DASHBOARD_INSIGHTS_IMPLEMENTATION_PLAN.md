# Dashboard Insights — Full Implementation Plan

## 1. Overview and principles

**Purpose**
Dashboard Insights is a **separate** feature from the existing Cohi/executive insights. It produces **1–3 insights per dashboard page** that call out what's noteworthy (good or bad), using only that page's data and all combinations of its existing filters. Each insight ties to the page's own widgets via **evidence_refs** (no SQL evidence). High-risk (critical sentiment) insights also surface in the main Critical Issues bucket with a link back to the originating dashboard page.

**Design principles**

- **Dimension-agnostic:** The generator does not assume fixed comparison types. It looks at all filter dimensions the dashboard exposes and surfaces what's important along any combination.
- **Page-scoped or widget-scoped:** Insights can be about the dashboard page as a whole (overall observations) or about specific widgets (tables, charts, KPIs) on it.
- **Page-local + critical escalation:** Most insights appear only on their dashboard page. Critical-sentiment insights additionally surface in the main Cohi Critical Issues bucket with a "Go to [page name]" link that restores the exact filter state that produced the insight.
- **Evidence = widget refs only:** Pass 4 outputs references into the page's existing widgets — no evidence SQL.
- **Reuse pattern, not coupling:** Same 4-pass pattern and infra, but separate prompts, services, and API.
- **Precomputed, not on-demand:** Dashboard insights are generated on the same schedule as regular insights (post-sync hook after data reload), not on every page load or filter change. An optional "Generate Insights" button per page allows on-demand fresh generation.
- **Data from existing APIs:** Page adapters build context by calling existing dashboard API endpoints, ensuring the data matches what the user actually sees. No new SQL queries for insight generation unless the audit identifies gaps.

---

## 2. Key terminology

- **Dimensions:** The axes along which a dashboard page can slice or view its data. This includes **user-selectable filters** (date period, branch, loan officer, channel, status) and **structural breakdowns** (e.g. a table that always breaks data out by product type, or a chart that shows data by month). Not all dimensions are filters — some are baked into the page's layout.
- **Filters:** A subset of dimensions — the ones the user can actively change via dropdowns, pickers, etc. (e.g. date period, branch selector, channel selector).
- **Page context:** The full data package the pipeline receives for one dashboard page: identity, available dimensions/filters, data summaries and breakdowns, and the widget catalog. The **page identity** fields (`pageId`, `pageName`, `pageDescription`) are provided by code in the page adapter, not configured in the AI Prompts admin UI.
- **Widget catalog:** A registry of all widgets (KPIs, tables, charts) on a dashboard page, each with a stable `id`, so evidence_refs can point at them.

---

## 3. Data model

### 3.1 Page context (input to the pipeline)

Every pipeline run is keyed by **pageId** and **filter state** (the "view-level" filters like date period and channel — not drill-down filters like a single LO).

```typescript
interface DashboardPageContext {
  pageId: string;            // e.g. "leaderboard", "loan-complexity", "operations-scorecard"
  pageName: string;          // e.g. "Leaderboard", "Loan Complexity"
  pageDescription?: string;

  // View-level filters that change the entire page's data
  filters: Record<string, any>;  // e.g. { datePeriod: "ytd", channelGroup: "Retail" }

  // All dimensions this page can show data for
  dimensions: Array<{
    id: string;              // e.g. "branch", "loan_officer", "time_period", "product"
    label: string;           // e.g. "Branch", "Loan Officer"
    type: "filter" | "structural";  // filter = user-selectable; structural = baked into layout
    values: string[];        // e.g. ["Branch A", "Branch B", ...] or ["MTD", "LM", "QTD", ...]
  }>;

  // Data: summary + breakdowns by dimension
  data: {
    summary: Record<string, any>;  // Overall KPIs for current filter state
    by_dimension: Record<string, Array<Record<string, any>>>;
    // e.g. {
    //   "branch": [{ name: "Branch A", pullThrough: 68, volume: 1200000, ... }, ...],
    //   "loan_officer": [{ name: "Jane Smith", units: 12, revenue: 45000, ... }, ...],
    //   "time_period": [{ period: "MTD", pullThrough: 71, ... }, { period: "LM", pullThrough: 74, ... }, ...]
    // }
    // NOTE: Drill-down dimensions (branch, LO) are included as breakdowns within
    // a single data fetch, NOT as separate API calls per branch/LO. The generator
    // compares individuals within these breakdowns (e.g. "Branch A vs Branch B")
    // rather than the system making individual API calls per segment.
  };

  widget_catalog: Array<{
    id: string;              // Stable widget id (must match DOM id/data-widget-id)
    type: "kpi" | "table" | "chart" | "other";
    label: string;
    description?: string;
    dimension?: string;      // Which dimension this widget is keyed by
    columns_or_series?: string[];
  }>;
}
```

**How "all combinations of filters" works:**

The page context does **not** require a separate API call per branch or per loan officer. Instead:

- **View-level filters** (date period, channel, tenant) are what define the "run." Each unique combination of view-level filters produces one page context and one pipeline run. These are the filters that change the entire page's data.
- **Drill-down dimensions** (branch, loan officer, product, status) are included as **breakdowns within the data**. The adapter fetches one dataset that includes per-branch, per-LO, per-product rows (which the existing APIs typically already return), and the generator is told to compare individuals within those breakdowns.
- **Time period comparisons** are handled by including multiple periods in the `by_dimension.time_period` array (e.g. MTD, LM, QTD, LQ, YTD). The generator can compare any pair.

So for a page with 5 date periods and 3 channels, the maximum number of pipeline runs is 5 × 3 = 15 (one per view-level filter combination), not 5 × 3 × N_branches × N_LOs. Each run includes all branches and LOs as breakdowns in one fetch.

### 3.2 Pipeline output (per insight)

```typescript
interface DashboardInsight {
  headline: string;
  understory: string;
  sentiment: "positive" | "warning" | "critical" | "neutral";
  severity_score: number;
  cited_numbers: string[];

  // ETM fields
  what_changed: string;
  why: string;
  business_impact: string;
  risk_if_ignored: string;
  recommended_action: string;
  owner: string;

  // Scope: "page" if about the whole dashboard, "widget" if about a specific widget
  scope: "page" | "widget";

  // The filter state that produced this insight — so the UI can restore it
  // and Pass 4 knows what data view this is about
  filter_context: {
    datePeriod: string;        // e.g. "mtd", "ytd", "last-month"
    channelGroup?: string;
    // Any other view-level filters active when this was generated
    [key: string]: any;
  };

  // Widget references for UI highlighting
  evidence_refs: Array<{
    widgetId: string;
    role: "primary" | "supporting";
    target?: {
      type: "row" | "series" | "cell";
      label: string;
    };
  }>;

  // Critical escalation
  escalate: boolean;         // true for critical-sentiment insights
  sourcePageId: string;
  sourcePageName: string;
}
```

---

## 4. Pass 1 — Generator (3–5 candidates)

**Role:** Produce **3–5** insight candidates for this dashboard page. Insights can be about the dashboard as a whole or about specific widgets. Dimension-agnostic: use any combination of existing dimensions to find what's important.

### Sample prompt (`dashboard_insights.generator`)

```
You are Cohi, an AI analytics engine for mortgage lending executives. Your job is to analyze ONE dashboard page's data and generate 3-5 insight CANDIDATES about what is noteworthy on this page — good or bad.

You will receive:
1. PAGE IDENTITY — the dashboard page name and description
2. DIMENSIONS — all dimensions available on this page (filters and structural breakdowns) and their current values. Includes data for multiple time periods so you can compare across time.
3. DATA — summary KPIs plus breakdowns by each dimension (e.g. per-branch metrics, per-LO metrics, per-time-period metrics)
4. WIDGET CATALOG — every widget on this page (KPIs, tables, charts) with its id, type, label, and what dimension it shows

SCOPE RULES:
- Each insight can be about the DASHBOARD AS A WHOLE (scope: "page") — an overall observation spanning multiple widgets — or about a SPECIFIC WIDGET (scope: "widget") — something noteworthy in one table, chart, or KPI.
- For widget-scoped insights, reference the specific widget by its id from the widget catalog.
- For page-scoped insights, reference the 1-2 most relevant widgets as supporting evidence.

WHAT TO LOOK FOR:
- Look across ALL dimensions and their data. Do NOT restrict yourself to specific comparison types.
- The data includes multiple time periods (e.g. MTD, LM, QTD, LQ, YTD). You can compare any periods, but PRIORITIZE recent/actionable comparisons (e.g. MTD vs LM, QTD vs LQ) over distant ones (e.g. LQ vs LY).
- The data includes per-segment breakdowns (branches, loan officers, products). Compare individuals within these breakdowns — are any segments significantly better or worse than others?
- Surface 3-5 things worth calling out: significant differences between segments, noteworthy trends over time, outliers, standouts (good or bad), risks, or wins.
- Both good and bad findings are valuable. Do not only surface problems.

FILTER CONTEXT:
- Every insight MUST include a filter_context object specifying the exact filters (especially time period) that the insight is about. If the insight compares two periods, specify the primary period.
- Example: { "datePeriod": "mtd", "channelGroup": "Retail" }

EVIDENCE REFS:
- Every insight MUST include an evidence_refs array with at least one widget reference.
- Each ref: { "widgetId": "<id from widget_catalog>", "role": "primary" | "supporting" }
- When the insight is about a specific segment value (e.g. a branch, LO, product), include a target: { "type": "row" | "series", "label": "<exact value from dimensions>" } so the UI can highlight it.

RULES:
- Only use dimensions and numbers present in the page context. Do not invent filter values, time periods, or segments.
- Every headline MUST include the active timeframe (e.g. MTD, YTD, Q1 2026).
- Write like a wire service — facts and numbers, no editorializing.
- BANNED LANGUAGE: "may", "might", "could", "should", "consider", "potential", "possibly", "suggests", "indicates", "concerning", "opportunities"

EXECUTIVE THINKING MODEL (ETM) — for EVERY insight:
- "what_changed": Factual observation with specific numbers.
- "why": Causal explanation based on the data.
- "business_impact": Quantified dollar or unit impact.
- "risk_if_ignored": What happens if no action is taken.
- "recommended_action": Specific, prescriptive action — name the team, the step, the timeline.
- "owner": Who should act (role name or specific person if named in data).

OUTPUT FORMAT (strict JSON):
{
  "insights": [
    {
      "headline": "Branch A pull-through trails all other branches by 7+ pts MTD",
      "understory": "Branch A's pull-through is 61% MTD vs company average of 71%. 8 loans fell out of 21 completed, concentrated in FHA product.",
      "sentiment": "warning",
      "severity_score": 0.65,
      "scope": "widget",
      "filter_context": { "datePeriod": "mtd" },
      "cited_numbers": ["61%", "71%", "7", "8", "21"],
      "what_changed": "Branch A pull-through declined to 61% MTD, 10 pts below company average",
      "why": "8 of 21 completed loans fell out, with FHA product accounting for 5 of 8 fallouts",
      "business_impact": "Estimated $1.2M in lost funded volume from Branch A fallout",
      "risk_if_ignored": "Continued underperformance costs ~$400K/month in lost revenue",
      "recommended_action": "Branch Manager review FHA fallout root causes with processing team within 1 week",
      "owner": "Branch Manager — Branch A",
      "evidence_refs": [
        { "widgetId": "table-branch-performance", "role": "primary", "target": { "type": "row", "label": "Branch A" } },
        { "widgetId": "kpi-pull-through", "role": "supporting" }
      ]
    }
  ]
}

DATA-ONLY RULE: Every claim MUST be directly verifiable from the page data provided. NEVER include unquantifiable claims.
```

**Config:** category `dashboard_insights`, model gpt-5.2, temperature 0.7, max_tokens 6000, JSON mode.

---

## 5. Pass 2 — Fact-check + Judge

### 5a. Fact-check (programmatic)

- Validate that every number cited in each candidate appears in the page context (summary or by_dimension data). Flag mismatches.
- Validate that every `widgetId` in evidence_refs exists in widget_catalog.
- Validate that every `target.label` matches a value in the corresponding dimension.
- Validate that `filter_context` contains valid filter values.
- Score 0–1; drop candidates below 0.5.

### 5b. Judge (LLM)

**Role:** Score each surviving candidate on six dimensions and recommend keep/drop.

### Sample prompt (`dashboard_insights.judge`)

```
You are a quality judge for dashboard-level insights on a mortgage analytics platform. You receive insight candidates generated from a single dashboard page's data, along with fact-check results.

Your job: score EACH candidate on 6 dimensions (1-10 scale). Be strict — only high-quality insights should survive.

SCORING DIMENSIONS:

1. FACTUAL GROUNDING (1-10)
   - Does the insight accurately cite numbers from the page data?
   - Are all named segments (branches, LOs, products) real and present in the data?
   - Fact-check issues passed in: deduct 2 points per issue flagged.

2. ACTIONABILITY (1-10)
   - Can someone act on this finding?
   - 10: "Branch A pull-through trails others by 7 pts — 8 FHA loans fell out of 21" (specific, root cause named)
   - 5: "Pull-through is 71% MTD" (factual but just restating a KPI)
   - 1: "Data exists on this page" (vacuous)

3. NON-OBVIOUSNESS (1-10)
   - Does it go beyond restating a single widget's headline number?
   - 10: Cross-dimension connection or a non-obvious pattern across widgets
   - 5: Restating one metric with some context
   - 1: Trivially obvious from glancing at the page

4. SENTIMENT ACCURACY (1-10)
   - Does the assigned sentiment match the actual data direction?
   - A "positive" sentiment on a declining metric → score 1.

5. EVIDENCE FIT (1-10)
   - Do the evidence_refs point at the right widgets for this insight?
   - Does the target (row/series) match the insight's subject?
   - Missing or wrong refs → score 1-3.

6. RECENCY (1-10)
   - Does the insight focus on recent, actionable time periods?
   - 10: Compares MTD to LM, or QTD to LQ — recent and relevant.
   - 7: Compares YTD to prior YTD — useful but less immediate.
   - 3: Compares last quarter to last year — stale and less actionable.
   - 1: References only distant historical periods with no tie to current data.
   - Insights about the current period or the most recent prior period score highest.

OUTPUT FORMAT (strict JSON):
{
  "evaluations": [
    {
      "insight_index": 0,
      "factual_grounding": 8,
      "actionability": 7,
      "non_obviousness": 6,
      "sentiment_accuracy": 9,
      "evidence_fit": 8,
      "recency": 9,
      "overall_score": 7.8,
      "issues": ["Minor: insight says 7 pts gap but data shows 6.8 pts"],
      "keep": true
    }
  ]
}

RULES:
- Score EVERY candidate. Do not skip any.
- "keep": true if overall_score >= 5.5, false otherwise.
- overall_score = average of the 6 dimension scores.
- Be STRICT on evidence_fit — wrong widget refs destroy user trust when the UI highlights the wrong thing.
- Be STRICT on recency — stale comparisons that aren't actionable should score low.
```

**Config:** category `dashboard_insights`, model gpt-5.2, temperature 0.1, max_tokens 3000, JSON mode.

---

## 6. Pass 3 — Curator (limit to 1–3)

**Role:** From the 3–5 judged candidates, select the final **1–3** insights based on how well they scored. Remove redundancy, ensure variety, polish wording.

### Sample prompt (`dashboard_insights.curator`)

```
You are the final curator for a dashboard insight pipeline. You receive 3-5 validated and scored insight candidates for a single dashboard page. Your job: select the best 1-3 insights based on their scores, remove redundancy, and polish the final output.

INPUT: Candidates with their judge scores (factual_grounding, actionability, non_obviousness, sentiment_accuracy, evidence_fit, recency, overall_score) and ETM fields.

CURATION RULES:

1. SELECT 1-3 INSIGHTS based on score quality. Prefer fewer, higher-quality insights over more mediocre ones. If only 1 candidate scored well, return 1. Never return more than 3.

2. VARIETY — avoid selecting two insights about the same metric, dimension value, or widget. If two insights both discuss Branch A, keep the one with higher overall_score.

3. SCOPE MIX — when possible, include a mix: one page-level insight and one widget-level insight. Not required, but preferred when quality supports it.

4. CRITICAL ESCALATION — if an insight has sentiment "critical", set "escalate": true. These will also appear in the main executive insights Critical Issues bucket with a link to this dashboard page.

5. FILTER CONTEXT — preserve the filter_context from the generator. This is critical: the frontend uses it to restore the exact filter state and the evidence agent uses it to validate refs.

6. POLISHING:
   - Headlines max 35 words. Facts and numbers only.
   - Understory: 2-3 sentences with supporting numbers.
   - Every headline includes the active timeframe.
   - severity_score bands: critical 0.80-0.95, warning 0.55-0.79, positive 0.30-0.54, neutral 0.05-0.29.

7. ETM PRESERVATION — preserve what_changed, why, business_impact, risk_if_ignored, recommended_action, owner. Polish wording but do not remove.

OUTPUT FORMAT (strict JSON):
{
  "insights": [
    {
      "headline": "...",
      "understory": "...",
      "sentiment": "warning",
      "severity_score": 0.65,
      "scope": "widget",
      "escalate": false,
      "filter_context": { "datePeriod": "mtd" },
      "cited_numbers": [...],
      "what_changed": "...",
      "why": "...",
      "business_impact": "...",
      "risk_if_ignored": "...",
      "recommended_action": "...",
      "owner": "...",
      "evidence_refs": [...]
    }
  ]
}

BANNED LANGUAGE: "may", "might", "could", "should", "consider", "potential", "possibly", "suggests", "indicates", "concerning", "opportunities", "challenges"
```

**Config:** category `dashboard_insights`, model gpt-5.2, temperature 0.2, max_tokens 4000, JSON mode.

---

## 7. Pass 4 — Evidence agent (widget refs only)

**Role:** For each final insight, validate and refine evidence_refs against the widget catalog. Add or fix `target` (row/series) when the insight is about a specific segment. No SQL.

### Sample prompt (`dashboard_insights.evidence_agent`)

```
You are an evidence agent for a dashboard insight system. You receive ONE insight and the widget catalog for its dashboard page. Your job: validate and refine the insight's evidence_refs so they accurately point to the right widgets and, when applicable, the right row or series within a widget.

You will receive:
1. INSIGHT — headline, understory, sentiment, scope, filter_context, and existing evidence_refs
2. WIDGET CATALOG — every widget on the page with its id, type, label, dimension, and columns/series

YOUR TASK:
- Validate that every widgetId in evidence_refs exists in the widget catalog. Remove any that don't.
- If the insight is about a specific segment (branch, LO, product, etc.), ensure a target is set: { "type": "row" | "series", "label": "<exact dimension value>" }. The label must match a value from the widget's dimension.
- If evidence_refs are missing or incomplete, add the most relevant widget(s) from the catalog.
- Assign role: "primary" for the main widget supporting the insight, "supporting" for additional context.
- For page-scoped insights (scope: "page"), include 1-2 widgets that best represent the overall observation.
- For widget-scoped insights (scope: "widget"), the primary ref should be the specific widget the insight is about.

DO NOT:
- Generate SQL queries
- Reference widgets not in the catalog
- Invent dimension values not present in the data

OUTPUT FORMAT (strict JSON):
{
  "evidence_refs": [
    { "widgetId": "table-branch-performance", "role": "primary", "target": { "type": "row", "label": "Branch A" } },
    { "widgetId": "kpi-pull-through", "role": "supporting" }
  ]
}
```

**Config:** category `dashboard_insights`, model gpt-5.2, temperature 0.1, max_tokens 2000, JSON mode.

---

## 8. Critical escalation to Cohi

When a dashboard insight has **`escalate: true`** (set by the Curator for critical-sentiment insights):

- The insight is stored in the `dashboard_generated_insights` table with `escalate = true`.
- The Cohi insights card (`CohiPromptsCard`) is updated to **also query** the `dashboard_generated_insights` table for rows where `escalate = true`, and display those in the **Critical Issues** bucket alongside regular critical insights.
- The UI renders a **"Go to [sourcePageName]"** button on escalated dashboard insights (when `source_page_id` is present). Clicking it navigates to the originating dashboard page **and restores the exact `filter_context`** that produced the insight (e.g. the date period and channel).
- Dashboard insights are **not** duplicated into the `generated_insights` table. They live only in `dashboard_generated_insights`; the Cohi card reads from both tables.
- Escalated insights persist until the next time dashboard insights are regenerated (same lifecycle as non-escalated dashboard insights).

---

## 9. Storage — `dashboard_generated_insights` table

Dashboard insights are stored in their **own table** in the tenant database (not in `generated_insights`).

```sql
CREATE TABLE IF NOT EXISTS dashboard_generated_insights (
  id SERIAL PRIMARY KEY,
  page_id TEXT NOT NULL,                -- e.g. 'loan-complexity'
  page_name TEXT NOT NULL,              -- e.g. 'Loan Complexity'
  headline TEXT NOT NULL,
  understory TEXT,
  sentiment TEXT NOT NULL,              -- 'positive', 'warning', 'critical', 'neutral'
  severity_score DECIMAL(4,2),
  scope TEXT NOT NULL DEFAULT 'page',   -- 'page' or 'widget'
  escalate BOOLEAN NOT NULL DEFAULT false,

  -- ETM fields
  what_changed TEXT,
  why TEXT,
  business_impact TEXT,
  risk_if_ignored TEXT,
  recommended_action TEXT,
  owner TEXT,

  -- Filter context (the exact filters that produced this insight)
  filter_context JSONB NOT NULL DEFAULT '{}',

  -- Evidence refs (widget references for UI highlighting)
  evidence_refs JSONB NOT NULL DEFAULT '[]',

  -- Cited numbers
  cited_numbers JSONB DEFAULT '[]',

  -- Generation metadata
  generation_batch TEXT NOT NULL,       -- UUID grouping insights from one generation run
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_insights_page
  ON dashboard_generated_insights(page_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_insights_escalate
  ON dashboard_generated_insights(escalate) WHERE escalate = true;

CREATE INDEX IF NOT EXISTS idx_dashboard_insights_batch
  ON dashboard_generated_insights(generation_batch);
```

---

## 10. Scheduling and generation triggers

Dashboard insights are generated on the **same schedule** as regular Cohi insights — via the **post-sync hook** system.

### How current insights are triggered (for reference)

Current insights use a hook-based system in `server/src/services/hooks/registerInsightHooks.ts`. After a successful data sync (Encompass, API, or CSV), registered hooks run in priority order:

1. `prediction-pipeline` (priority 50) — runs predictions
2. `agent-insight-generation` (priority 100) — runs the main insight pipeline
3. `tracked-insight-evaluation` (priority 200) — re-evaluates tracked insights

Each hook checks whether `insights_auto_enabled` is set for that LOS connection before running.

### Dashboard insights hook

A new hook will be registered at **priority 150** (after agent insights, before tracked insight evaluation):

```
registerPostSyncHook(
  "dashboard-insight-generation",
  async (ctx: PostSyncContext) => {
    // Check insights_auto_enabled
    // For each supported dashboard page:
    //   For each view-level filter combination:
    //     Build page context via adapter
    //     Run 4-pass pipeline
    //     Persist to dashboard_generated_insights
  },
  150
);
```

This means dashboard insights:
- Run automatically whenever data syncs for a tenant (same trigger as regular insights).
- Respect the `insights_auto_enabled` flag per connection.
- Run **after** regular insights (so any shared signals/predictions are already computed).

### On-demand generation

Each dashboard page also has an optional **"Generate Insights"** button that:
- Calls `POST /api/dashboard-insights/generate` with `{ pageId, filters }`.
- Runs the pipeline for that specific page + filter combination only.
- Replaces existing insights for that page + filter combination in the DB.
- Does not affect other pages' insights or the scheduled generation.

---

## 11. API

### Fetch stored insights for a page

`GET /api/dashboard-insights?pageId=<id>&datePeriod=<period>&channelGroup=<channel>`

Returns the most recently generated insights for that page + filter combination from the `dashboard_generated_insights` table.

**Response:**

```json
{
  "insights": [ ... ],
  "generatedAt": "2026-03-05T14:30:00Z",
  "pageId": "loan-complexity",
  "pageName": "Loan Complexity"
}
```

### On-demand generation

`POST /api/dashboard-insights/generate`

**Body:**

```json
{
  "pageId": "loan-complexity",
  "filters": { "datePeriod": "mtd", "channelGroup": "Retail" }
}
```

Runs the 4-pass pipeline for the specified page + filters, persists results, and returns the new insights.

---

## 12. Frontend — how insights are displayed

### In-page insight strip

Each supported dashboard page renders a **"Dashboard Insights"** strip component showing 1–3 insight bullets. The strip appears near the top of the page (below filters, above widgets).

**Each insight displays:**
- **Headline** — bold, with sentiment color indicator (red/amber/blue/gray dot or border).
- **Understory** — 2–3 sentence summary, shown below the headline.
- **Expandable detail** (on click or chevron):
  - **What changed** — the factual observation.
  - **Why** — the causal explanation.
  - **Business impact** — the quantified dollar/unit impact.
- **"Show me" button** — scrolls to and highlights the relevant widget(s) using evidence_refs.

### Widget highlighting (on "Show me" or insight click)

When a user clicks an insight or its "Show me" button:
1. Read `evidence_refs` from the insight.
2. Scroll to the **primary** widget: `document.getElementById(ref.widgetId)?.scrollIntoView(...)`.
3. If `target` exists (e.g. `{ type: "row", label: "Branch A" }`), highlight that specific row or chart series with a temporary visual treatment (e.g. pulse animation, background highlight that fades after 3 seconds).
4. Supporting widgets get a lighter highlight or border glow.

### Escalated insights in Cohi

In the main `CohiPromptsCard` (Critical Issues bucket):
- Query `dashboard_generated_insights WHERE escalate = true` alongside regular `generated_insights WHERE bucket = 'critical'`.
- Escalated dashboard insights render with a **"Go to [sourcePageName]"** button.
- Clicking the button navigates to `/[page-route]` and restores the `filter_context` from the insight (e.g. sets the date picker to MTD, the channel to Retail, etc.).

### Feedback

Dashboard insights support the same feedback mechanism as regular insights:
- **Thumbs up / thumbs down** buttons on each insight (visible to users with `tenant_admin` role).
- Feedback is stored in a `dashboard_insight_feedback` table (same structure as `insight_feedback`).
- Feedback data is available in the admin panel under a "Dashboard Insight Feedback" section.

---

## 13. Backend structure

```
server/src/services/dashboardInsights/
  types.ts                       — DashboardPageContext, DashboardInsight, etc.
  buildPageContext.ts             — Dispatches to page-specific adapters
  adapters/
    baseDashboardAdapter.ts      — Generic adapter base class/interface
    loanComplexityAdapter.ts     — Builds page context for Loan Complexity (Phase 1)
    operationsScorecardAdapter.ts — (Phase 3)
    ...more per page
  generator.ts                   — Pass 1 (3-5 candidates)
  factCheck.ts                   — Pass 2a (programmatic)
  judge.ts                       — Pass 2b (LLM)
  curator.ts                     — Pass 3 (limit to 1-3)
  evidenceAgent.ts               — Pass 4 (widget refs only)
  orchestrator.ts                — Full pipeline + cache + critical escalation + persistence
  signals.ts                     — Pre-computed directional signals for page data
                                   (reuse or adapt from insights/insightMetricsCollector.ts)

server/src/routes/dashboardInsights.ts  — GET + POST routes
server/src/services/hooks/registerInsightHooks.ts  — Add dashboard insight generation hook

server/migrations/tenant/0XX_dashboard_generated_insights.sql  — New table
```

### Generic adapter pattern

With 15-17+ dashboards, a generic adapter pattern keeps things scalable:

```typescript
// baseDashboardAdapter.ts
interface DashboardAdapter {
  pageId: string;
  pageName: string;
  pageDescription: string;

  // Returns the view-level filter combinations to run insights for
  getFilterCombinations(tenantPool: pg.Pool): Promise<Record<string, any>[]>;

  // Builds the full page context for one filter combination
  buildContext(
    tenantPool: pg.Pool,
    filters: Record<string, any>,
    accessClause?: string
  ): Promise<DashboardPageContext>;

  // Returns the widget catalog (can be static or dynamic)
  getWidgetCatalog(): WidgetCatalogEntry[];
}
```

Each page implements this interface. The orchestrator:
1. Gets the list of registered adapters.
2. For each adapter, calls `getFilterCombinations()` to know what filter states to generate for.
3. For each filter combination, calls `buildContext()` and runs the pipeline.

**Adding a new dashboard page** means:
1. Create a new adapter file implementing `DashboardAdapter`.
2. Register it in the adapter registry.
3. Add stable widget IDs to the frontend view.
4. That's it — the pipeline, prompts, API, and UI strip are all reusable.

### Loan Complexity (`pageId: loan-complexity`)

Implemented end-to-end alongside Leaderboard:

- **Adapter** (`adapters/loanComplexityAdapter.ts`): Builds `by_time_period` for **MTD, QTD, YTD, LQ, LM, LY** using the same pivot/bar services as the UI. Includes **portfolio WA complexity**, **units**, **portfolio pull-through** on the **application_date** cohort (documented in `pageDescription`), pivot slices per actor/branch/current loan status, bar snapshot (loan officer), and **`status_catalog`** for the LLM.
- **Pipeline** (`pipeline.ts`): Enriches evidence for `loan-complexity-bar-chart` and `loan-complexity-pivot-*` widgets; **supporting_data** rows include `portfolioWaComplexity` and pull-through; subject dedup recognizes **`complexity_*`** dimensions.
- **Detail hydrator** (`dashboardInsightDetailHydrator.ts`): Aggregate tables show WA complexity + pull-through by period; subject tables resolve the pivot slice from the **primary** `evidence_ref` widget id (e.g. branch pivot → `branch` slice).
- **Prompts** (`defaultPromptConfigs.ts`): Loan Complexity block uses **`filter_context`** for this page only (`datePeriod`, optional `channelGroup`); no Leaderboard cross-links or `leaderName` for navigation.
- **Frontend** (`LoanComplexityView.tsx`): **`DashboardInsightsStrip`**, generate POST `pageId: loan-complexity`, evidence scroll/highlight to **`loan-complexity-bar-chart`** and **`loan-complexity-pivot-*`** (pivot section expands when targeting a pivot widget).
- **Leaderboard deep-link** (`LeaderBoardSection.tsx`): Reads **`location.state.dashboardInsightFilterContext`** when navigating from **Leaderboard**-sourced insights (period/channel/LO). Loan Complexity insights do not pass this state—**one insight → one destination** via `sourcePageId`.
- **Navigation helper** (`src/lib/dashboardInsightRoutes.ts`): **`getDashboardInsightPath`** / **`getDashboardInsightNavigateState`** centralize `pageId` → route; used by **`DashboardInsightEvidenceModal`** and **`CohiPromptsCard`** so critical/main-page “Go to dashboard” opens the correct URL (`/loan-complexity` vs `/insights#leaderboard`).

### Pre-computed signals

The page adapter (or a shared `signals.ts` module) can pre-compute directional signals for the page data, similar to how `insightMetricsCollector.ts` computes signals for regular insights. Each signal tags a metric with direction (positive/negative/critical/neutral) and magnitude.

This can either:
- **Reuse** the existing `computeSignals()` function from `insightMetricsCollector.ts` if the page data maps cleanly to the same metric structure.
- **Adapt** the implementation with dashboard-specific signal definitions (e.g. "complexity score > 8 = critical", "branch pull-through < 60% = negative").

Signals are passed to the generator alongside the page context to improve accuracy and reduce hallucination.

---

## 14. Prompt config

New category `dashboard_insights` in `defaultPromptConfigs.ts` with four prompts:

| Prompt ID | Name | Pass |
|-----------|------|------|
| `dashboard_insights.generator` | Dashboard Insights: Generator (Pass 1) | 1 |
| `dashboard_insights.judge` | Dashboard Insights: Judge (Pass 2) | 2b |
| `dashboard_insights.curator` | Dashboard Insights: Curator (Pass 3) | 3 |
| `dashboard_insights.evidence_agent` | Dashboard Insights: Evidence Agent (Pass 4) | 4 |

These prompts are **general** for all dashboard pages and are editable via the AI Prompts admin UI (category: `dashboard_insights`). They do **not** contain per-page descriptions; instead, they expect `pageId`, `pageName`, and `pageDescription` to be supplied at runtime via the page context built by each dashboard adapter.

All four prompt configs are seeded into `ai_prompt_configs` so they appear under **"Dashboard Insights"** in Admin → AI Prompts, separate from the regular "Insights" category.

### 14.1 Page-specific guidance (`pageGuidance`)

Each page adapter can set an optional **`pageGuidance`** (array of strings) on `DashboardPageContext`. The generator prompt treats these as high-priority instructions for what patterns to surface on that page (e.g. cross-period comparisons, high-performer trend analysis). The leaderboard adapter sets guidance such as:

- Prioritize insights that compare current period to the immediately prior comparable period (MTD vs LM, QTD vs LQ).
- Highlight high performers whose metrics have changed significantly over time.
- Call out both improvements and declines for top performers across periods.

Other dashboard pages can define their own guidance in their adapter’s `buildContext` return value.

### 14.2 Person-specific insights and evidence

When an insight is about a **specific loan officer, branch, or other segment** (name appears in headline/understory/ETM), the evidence agent must set the primary `evidence_ref` to a widget whose rows represent that entity (e.g. dimension `"leader"`) with `target.label` equal to the entity’s exact name. The detail hydrator then uses that subject to build **person-focused evidence tables**: one row per time period showing that subject’s metrics (pull-through, units, volume, rank) instead of generic top-performer summaries. Subject detection prefers the primary evidence_ref’s `target.label` when the widget has dimension `"leader"`; fallbacks include `filter_context.leaderName` or parsing from the headline.

Example: an insight "LQ vs MTD: High Performer Decline for Stanley Edward Obrecht Jr." with an evidence_ref `{ widgetId: "leaderboard-main-table", role: "primary", target: { type: "row", label: "Stanley Edward Obrecht Jr." } }` produces a detail table with one row per period (MTD, QTD, YTD, LQ, LM) containing Stanley’s pull-through, units, and volume for that period.

---

## 15. Dashboard page prep checklist

Before a dashboard page can support Dashboard Insights, it needs:

### Frontend prep (per page)
1. **Stable widget IDs:** Every widget (KPI card, table, chart) must have a stable `id` or `data-widget-id` attribute that doesn't change across renders. This is what evidence_refs reference.
2. **Insight strip mount point:** A location in the page layout (below filters, above widgets) where the `DashboardInsightsStrip` component will render.
3. **Highlight support:** Tables need row-level identification (e.g. `data-row-label` attributes) and charts need series-level identification so the highlight logic can target specific rows/series from `evidence_refs.target`.

### Backend prep (per page)
1. **API audit:** Review what the page's existing API endpoints return. Document which endpoints return the data needed for the page context (summary KPIs, per-dimension breakdowns). Identify any gaps where new endpoints or query parameters are needed.
2. **Adapter implementation:** Create a page-specific adapter that calls existing APIs and shapes responses into `DashboardPageContext`.
3. **Widget catalog:** Define the static widget catalog for the page (id, type, label, dimension for each widget).

---

## 16. Phasing

### Phase 1 — Foundation + Leaderboard dashboard

**Backend:**
- Define `DashboardPageContext`, `DashboardInsight`, and adapter interface types.
- Add 4 prompts to `defaultPromptConfigs.ts` under `dashboard_insights` category; seed DB.
- Create `dashboard_generated_insights` migration and table.
- Implement orchestrator with Pass 1 (3–5) → Pass 2 (fact-check + judge) → Pass 3 (curator, limit 1–3) → Pass 4 (evidence agent).
- Implement generic adapter base and **Leaderboard adapter**:
  - Audit Leaderboard dashboard APIs: what endpoints exist, what data they return, what's missing (e.g. `/api/dashboard/leaderboard`, any supporting endpoints already in `analyticsService.ts`).
  - Build adapter: call existing APIs, construct page context with dimensions (timeframe/time period, channel group, and structural dimensions like branch vs loan officer), data (summary + per-leader breakdowns), widget catalog (for the leaderboard table, any supporting charts/KPIs).
- Add `dashboard-insight-generation` post-sync hook (priority 150).
- Add GET and POST routes for `/api/dashboard-insights`.
- Wire critical escalation: update Cohi card query to also pull from `dashboard_generated_insights WHERE escalate = true`.

**Frontend (Leaderboard dashboard):**
- Add stable widget IDs to all widgets on the Leaderboard dashboard view (e.g. main leaderboard table, supporting KPIs/charts).
- Add `DashboardInsightsStrip` component (1–3 insights, expandable detail with what_changed/why/business_impact).
- Implement "Show me" → scroll + highlight using evidence_refs.
- Add "Generate Insights" button.
- Add "Go to [page]" button in CohiPromptsCard for escalated dashboard insights.

### Phase 2 — Validation + feedback

- Validate end-to-end: scheduled generation after sync, on-demand generation, filter context restoration, widget highlighting, escalation to Cohi.
- Add feedback mechanism (thumbs up/down for tenant_admin role).
- Tune prompts based on output quality.

### Phase 3 — More pages

For each additional dashboard page:
1. **API audit:** Review existing endpoints, identify gaps.
2. **Adapter:** Create page-specific adapter implementing `DashboardAdapter`.
3. **Widget IDs:** Add stable IDs to frontend widgets.
4. **Widget catalog:** Define catalog for the page.
5. **Mount strip:** Add `DashboardInsightsStrip` to the page layout.

Target pages (in suggested order based on data richness):
- Operations Scorecard
- Sales Scorecard / Sales View
- Pipeline Analysis
- Lock Stratification
- Loan Funnel
- Actors View
- TopTiering Comparison
- Operations Scorecard Trends
- Pricing Dashboard
- Workflow Conversion
- Company Detail View
- Financial Modeling Sandbox
- (remaining pages)

### Phase 4 — Polish + optimization

- Tune prompts based on feedback across multiple pages.
- Add pre-computed directional signals (adapt from insightMetricsCollector or build dashboard-specific).
- Optimize adapter performance (parallel API calls, caching intermediate data).
- Add LLM-based fact-check if programmatic check isn't sufficient.

---

## 17. Future plans

### Batch generation across multiple pages

For scenarios where a user views a "home" or overview page that shows data from multiple dashboards, a batch endpoint could generate insights for several pages in parallel:

`POST /api/dashboard-insights/batch`

```json
{
  "pages": [
    { "pageId": "loan-complexity", "filters": { "datePeriod": "mtd" } },
    { "pageId": "operations-scorecard", "filters": { "datePeriod": "mtd" } },
    { "pageId": "pipeline-analysis", "filters": { "datePeriod": "ytd" } }
  ]
}
```

The orchestrator would run pipelines for each page in parallel (respecting LLM rate limits), returning all results in one response. This reduces latency when multiple pages' insights are needed at once and could power a "cross-dashboard executive summary" view.

**Implementation:**
- The orchestrator already handles one page at a time. Batch = `Promise.all()` over multiple page runs, with a concurrency limit (e.g. 3 pages at a time) to avoid overwhelming the LLM.
- Response: `{ pages: [{ pageId, insights, generatedAt }, ...] }`.
- Can be triggered by the scheduled hook (which already iterates over all pages) or by a dedicated batch endpoint.

### Cross-dashboard insights

Once all pages have adapters, a "meta-insight" pass could look across all pages' insights to surface cross-cutting themes (e.g. "3 dashboards flagged Branch A as underperforming"). This would be a separate, optional pipeline that runs after all page-level insights are generated.

---

## 18. Questions, clarifications, and needed information

1. **Loan Complexity page API audit:** What specific API endpoints does the Loan Complexity page call? The adapter needs to call these same endpoints server-side. (To be done as part of Phase 1 implementation.)

2. **Date period handling across pages:** Do all dashboard pages use the same date period options (MTD, LM, QTD, LQ, YTD, LY, Custom)? Or do some pages have different period sets? This affects how `getFilterCombinations()` works.

3. **Channel filter:** Is channel group (Retail, TPO, etc.) a view-level filter on all pages, or only some? This determines whether it's part of the filter combinations for every adapter.

4. **Access control:** Dashboard insights should respect the same row-level security as the dashboard page itself. Does the existing `accessClause` / RLS mechanism cover this, or does the adapter need special handling?

5. **LLM cost budget:** Running 4 LLM passes × N pages × M filter combinations per sync could be significant. Is there a target cost budget per tenant per sync? This affects whether we limit the number of filter combinations or pages per run.

6. **Existing pre-computed signals:** Can we directly reuse `computeSignals()` from `insightMetricsCollector.ts`, or does dashboard data have a different shape that needs adapted signal logic?
