# Cohi Insights Generation System - Complete Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Frontend Components](#frontend-components)
   - [AletheiaPromptsCard](#aletheiapromptscard)
   - [useAletheiaData Hook](#usealetheiadatahook)
   - [InsightDetailModal](#insightdetailmodal)
   - [CohiBriefingControl](#cohibriefingcontrol)
4. [Backend API Endpoints](#backend-api-endpoints)
   - [GET /api/dashboard/insights](#get-apidashboardinsights)
   - [GET /api/dashboard/insights/details/:source](#get-apidashboardinsightsdetailssource)
5. [Insight Generation Pipeline](#insight-generation-pipeline)
   - [Two-Track Architecture: LLM vs Rule-Based](#two-track-architecture)
   - [Metrics Collection (insightMetricsCollector.ts)](#metrics-collection)
   - [LLM Insight Generation (llmInsightGenerator.ts)](#llm-insight-generation)
   - [Rule-Based Fallback (analyticsService.ts)](#rule-based-fallback)
6. [Insight Data Model](#insight-data-model)
7. [Data Sources](#data-sources)
8. [Caching Strategy](#caching-strategy)
9. [How to Modify & Expand Insights](#how-to-modify--expand-insights)
   - [Adding a New Rule-Based Insight](#adding-a-new-rule-based-insight)
   - [Modifying the LLM System Prompt](#modifying-the-llm-system-prompt)
   - [Adding a New Insight Source/Category](#adding-a-new-insight-sourcecategory)
   - [Adding a New Drill-Down Detail View](#adding-a-new-drill-down-detail-view)
   - [Changing Thresholds and Benchmarks](#changing-thresholds-and-benchmarks)
   - [Adding New Metrics to the LLM Payload](#adding-new-metrics-to-the-llm-payload)
10. [File Reference Map](#file-reference-map)

---

## Overview

The Cohi Insights system generates executive-level business intelligence for mortgage industry dashboards. It analyzes loan pipeline data, leaderboard performance, industry news, funnel metrics, credit risk profiles, and ML-based fallout predictions to produce concise, actionable insights for mortgage executives.

The system has **two insight generation tracks**:
1. **LLM-Powered** (primary): Collects metrics from multiple data sources, sends them to OpenAI's `gpt-4o-mini` model with a carefully crafted system prompt, and receives 8-12 AI-generated insights.
2. **Rule-Based** (fallback): Uses hardcoded business logic with thresholds/benchmarks to generate insights from the same data, used when LLM is disabled or unavailable.

**Key design decisions:**
- The frontend currently requests with `useLLM=false` (hardcoded in the hook), meaning **rule-based insights are the default** in production.
- LLM insights can be enabled by changing this parameter or removing it (defaults to `true` on the server).
- Both tracks share the same `Insight` interface and are interchangeable from the frontend's perspective.

---

## Architecture Diagram

```
Dashboard.tsx
  |
  +-- AletheiaPromptsCard (props: dateFilter, selectedTenantId, selectedChannel, briefingContext)
        |
        +-- useAletheiaData hook
        |     |
        |     +-- GET /api/dashboard/insights?dateFilter=...&useLLM=false&tenant_id=...&channel_group=...
        |     |     |
        |     |     +-- [server] analytics.ts router
        |     |           |
        |     |           +-- getInsights() in analyticsService.ts
        |     |                 |
        |     |                 +-- (if useLLM=true) LLM Track:
        |     |                 |     +-- collectInsightMetrics()    [insightMetricsCollector.ts]
        |     |                 |     +-- generateLLMInsights()      [llmInsightGenerator.ts]
        |     |                 |           +-- getOpenAIKey()        (tenant rag_settings or env var)
        |     |                 |           +-- buildSystemPrompt()   (executive briefing persona)
        |     |                 |           +-- buildUserPrompt()     (metrics → structured text)
        |     |                 |           +-- callOpenAI()          (gpt-4o-mini, JSON mode)
        |     |                 |           +-- parseAndValidate()    (strict schema validation)
        |     |                 |
        |     |                 +-- (if useLLM=false or LLM fails) Rule-Based Track:
        |     |                       +-- queryMetrics()             [metricsService.ts]
        |     |                       +-- SQL queries for loans, employees, funnel
        |     |                       +-- Fetch industry news via internal API
        |     |                       +-- Business logic thresholds → Insight[]
        |     |
        |     +-- GET /api/loans/funnel?dateFilter=...&tenant_id=...  (for briefing context)
        |
        +-- InsightDetailModal (drill-down)
        |     |
        |     +-- GET /api/dashboard/insights/details/:source
        |           (predictions | credit_risk | lost_opportunity | pipeline | performance | comparisons)
        |
        +-- CohiBriefingControl (audio briefing integration)
```

---

## Frontend Components

### AletheiaPromptsCard

**File:** `src/components/dashboard/AletheiaPromptsCard.tsx`

This is the main UI component that displays insights on the dashboard. It is a memoized React component (`React.memo`).

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `dateFilter` | `"today" \| "mtd" \| "ytd" \| "custom"` | Time period filter for insights |
| `onDataAvailabilityChange` | `(hasData: boolean) => void` | Callback to notify parent if data is available |
| `onOpenCohiPanel` | `() => void` | Opens the page-level Cohi chat panel |
| `briefingContext` | `{ dialogues?, funnelStory?, userName? }` | Context for audio briefing |
| `selectedTenantId` | `string \| null` | Multi-tenant filter |
| `selectedChannel` | `string \| null` | Channel filter (e.g. "Retail", "TPO") |

**Behavior:**
- Calls `useAletheiaData` hook to fetch insights from the API.
- Groups insights into **sets of 3** and auto-rotates every **15 seconds**.
- Rotation pauses on mouse hover (`onMouseEnter`/`onMouseLeave`).
- Users can **pin** insights to keep them visible at the top.
- Each insight can be **expanded** to show its `reasoning` field.
- "Drillable" insights (source = `predictions`, `credit_risk`, `lost_opportunity`, `pipeline`, `performance`, `comparisons`) open a detail modal when clicked.
- Includes a **refresh** button that calls `refreshInsights()` (forces cache bypass via `forceRefresh=true` query param).
- Shows an "AI" badge when `metadata.usedLLM` is `true`.
- Supports **export** (via `ExportShareMenu`) of all insights as table data.
- Listens for `"cohi-demo-seeded"` custom events to auto-refresh when demo data is seeded.

**Insight Types and their visual indicators:**
- `success` → Emerald/green icon and background
- `info` → Blue icon and background
- `warning` → Amber icon and background
- `error` / `critical` → Rose/red icon and background

### useAletheiaData Hook

**File:** `src/hooks/useAletheiaData.ts`

Custom React hook that handles all data fetching for the insights card.

**Parameters:** `(dateFilter, onDataAvailabilityChange?, selectedTenantId?, selectedChannel?)`

**Returns:**

| Field | Type | Description |
|-------|------|-------------|
| `allInsights` | `AletheiaInsight[]` | Array of all insights |
| `insightsLoading` | `boolean` | Loading state |
| `insightsError` | `string \| null` | Error message if fetch failed |
| `funnelData` | `any` | Funnel data for briefing context |
| `metadata` | `InsightsMetadata \| null` | Response metadata (usedLLM, generatedAt, summaryForPodcast) |
| `refreshInsights` | `() => void` | Force refresh function |

**Key Behaviors:**
1. **Auth check first**: If no `auth_token` in localStorage, skips API call and returns demo insights immediately.
2. **API call**: `GET /api/dashboard/insights?dateFilter=${dateFilter}&useLLM=false&tenant_id=...&channel_group=...&forceRefresh=...`
   - **Note:** `useLLM=false` is currently hardcoded. To enable LLM insights, change this to `useLLM=true` or remove the parameter.
3. **Icon mapping**: Maps API insight `type` strings to Lucide icon components:
   - `success` → `CheckCircle2`
   - `info` → `Info`
   - `warning` → `AlertTriangle`
   - `error` → `AlertTriangle`
   - `critical` → `AlertCircle`
4. **Fallback chain**: API failure → demo insights (hardcoded in the hook). Timeout → demo insights. 401/Unauthorized → demo insights (silent).
5. **Refetch triggers**: `dateFilter`, `selectedTenantId`, `selectedChannel`, `refreshCounter` changes.
6. **Funnel data**: Fetched separately from `/api/loans/funnel` for the briefing context (independent of insights).

**AletheiaInsight Interface:**

```typescript
interface AletheiaInsight {
  type: "success" | "info" | "warning" | "error" | "critical";
  icon: any;  // Lucide icon component
  message: string;
  priority: "critical" | "high" | "medium" | "low" | "standard";
  reasoning?: string;
  source?: string;  // Used for drill-down and grouping
}
```

**Demo Insights (fallback):**
Three hardcoded insights are used when the API is unavailable:
1. YTD revenue reached $2.4M, up 18% (source: `business_overview`)
2. Active pipeline: 185 loans, $78.2M (source: `loan_funnel`)
3. Pull-through rate: 72.5% Rolling 90D (source: `business_overview`)

### InsightDetailModal

**File:** `src/components/dashboard/InsightDetailModal.tsx`

Modal component that shows detailed drill-down data when a user clicks on a drillable insight.

**Props:** `{ isOpen, onClose, insightSource, insightMessage, dateFilter }`

**API Call:** `GET /api/dashboard/insights/details/${insightSource}?dateFilter=${dateFilter}`

**Supported Sources and Their Data:**

| Source | Title | Summary Cards | Data Table |
|--------|-------|---------------|------------|
| `predictions` | At-Risk Loans (Fallout Predictions) | Total at risk, Likely withdraw, Likely deny, At-risk volume | Loan ID, Outcome, Confidence%, Amount, LO, expandable details |
| `credit_risk` | Credit Risk Loans | High risk loans, Low FICO, High LTV, High DTI | Loan ID, Risk reason, FICO, LTV, DTI, Amount |
| `lost_opportunity` | Lost Opportunity (Withdrawn & Denied) | Total lost, Withdrawn, Denied, Lost revenue | Loan ID, Status, Amount, Type, LO, App date |
| `pipeline` | Active Pipeline | Active loans, Locked, Over 30 days, Volume | Loan ID, Amount, Type, Days in pipeline, Locked, LO |
| `performance` | Performance by Loan Officer | LO count, Total loans, Funded, Total volume | LO name, Total, Funded, Pull-through%, Volume, Cycle time |
| `comparisons` | Monthly Trends | Months analyzed, Total loans, Total funded | Month, Started, Funded, Pull-through%, Volume, Cycle time |

### CohiBriefingControl

**File:** `src/components/aletheia/CohiBriefingControl.tsx` (re-exports `AletheiaBriefingControls`)

This component provides the audio briefing feature, passing insights dialogues and funnel data as context for voice-based executive briefings. It's a thin re-export wrapper.

---

## Backend API Endpoints

### GET /api/dashboard/insights

**File:** `server/src/routes/dashboard/analytics.ts` (line ~144)

**Authentication:** Required (`authenticateToken` middleware)
**Tenant Context:** Required (`attachTenantContext` middleware)
**User Access:** Respects user-level loan access filtering

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `dateFilter` | `string` | `"ytd"` | `today`, `mtd`, `ytd`, `rolling_90_days`, `rolling_13_months` |
| `useLLM` | `string` | `"true"` | `"true"` for LLM insights, `"false"` for rule-based |
| `forceRefresh` | `string` | `"false"` | `"true"` bypasses the 1-hour cache |
| `channel_group` | `string` | (none) | Channel filter: `Retail`, `TPO`, or specific channel name |

**Response Shape:**

```json
{
  "insights": [
    {
      "type": "warning",
      "message": "8 loans totaling $2.4M flagged high-risk...",
      "priority": "high",
      "reasoning": "Early intervention can save 30-40%...",
      "source": "predictions",
      "forPodcast": true
    }
  ],
  "generatedAt": "2026-02-09T...",
  "dateFilter": "ytd",
  "usedLLM": true,
  "summaryForPodcast": "Brief executive summary...",
  "summary": {
    "totalLoans": 1500,
    "revenue": 15000000,
    "pullThroughRate": "72.5",
    "avgCycleTime": 28,
    "totalInsights": 10,
    "bySource": {
      "business_overview": 4,
      "leaderboard": 3,
      "industry_news": 3,
      "loan_funnel": 2,
      "predictions": 2
    }
  }
}
```

### GET /api/dashboard/insights/details/:source

**File:** `server/src/routes/dashboard/insightDetails.ts`

**Authentication:** Required + Rate limited (`apiLimiter`)

**Path Parameter:** `source` — one of: `predictions`, `credit_risk`, `lost_opportunity`, `pipeline`, `performance`, `comparisons`

**Query Parameter:** `dateFilter` — same as above

**Returns:** Source-specific detailed data with summary statistics and loan/officer/month rows (up to 100 items).

---

## Insight Generation Pipeline

### Two-Track Architecture

The `getInsights()` function in `analyticsService.ts` (line 1156) orchestrates insight generation with a clear fallback strategy:

```
getInsights(tenantPool, dateFilter, authHeader, options)
  |
  +-- IF useLLM === true:
  |     +-- collectInsightMetrics(tenantPool, dateFilter, { channelGroup })
  |     +-- generateLLMInsights(metricsPayload, tenantId, { useCache, cacheTtlSeconds })
  |     +-- Map GeneratedInsight[] → Insight[]
  |     +-- RETURN (usedLLM: true)
  |     |
  |     +-- ON ERROR: Log error, fall through to rule-based
  |
  +-- RULE-BASED FALLBACK:
        +-- queryMetrics() for core pipeline stats
        +-- Calculate Rolling 90D pull-through
        +-- Query loans data (up to 1000 rows)
        +-- Query leaderboard from employees + loans
        +-- Fetch industry news via internal /api/news
        +-- Query funnel data
        +-- Apply business logic rules → Insight[]
        +-- Shuffle insights by date-based seed
        +-- RETURN (usedLLM: false)
```

### Metrics Collection

**File:** `server/src/services/insights/insightMetricsCollector.ts`

The `collectInsightMetrics()` function aggregates data from multiple sources into a single `InsightMetricsPayload` object. It runs **8 parallel queries**:

1. **YTD metrics** — active_loans, active_volume, locked_loans, closed_loans, funded_volume, avg_cycle_time, total_revenue, wa_fico, wa_ltv, wa_dti
2. **MTD metrics** — funded_volume, total_revenue, avg_cycle_time
3. **Rolling 90D metrics** — funded_volume, avg_cycle_time
4. **Predictions** — from `loan_predictions` table (most recent per loan, up to 5000)
5. **Rolling 90D Pull-through** — excludes active loans (industry standard methodology)
6. **Lost Opportunity** — withdrawn + denied loans with volumes
7. **Funnel Metrics** — started, locked, originated, fallout counts
8. **Credit Risk Count** — loans with FICO<620 OR LTV>95 OR DTI>50

After parallel fetches, it also:
- Categorizes predictions (withdraw/deny/originate)
- Identifies high-risk loans (confidence >70%)
- Fetches at-risk volume for those loans
- Calculates month-over-month and year-over-year comparisons

**InsightMetricsPayload structure:**

| Section | Key Metrics |
|---------|-------------|
| `pipeline` | activeLoans, activeVolume, lockedLoans, closedLoans, closedVolume |
| `predictions` | likelyWithdraw, likelyDeny, likelyOriginate, highRiskLoans[], totalAtRiskVolume |
| `performance` | pullThroughRolling90D, avgCycleTime, revenueYTD, revenueMTD, volumeYTD, volumeMTD |
| `creditRisk` | waFico, waLtv, waDti, highRiskLoanCount |
| `lostOpportunity` | withdrawnUnits, withdrawnVolume, withdrawnProformaRevenue, deniedUnits, deniedVolume |
| `funnel` | loansStarted, loansLocked, loansOriginated, falloutRate |
| `comparisons` | volumeVsLastMonth, volumeVsLastYear, cycleTimeVsLastMonth, pullThroughVsLastMonth |

### LLM Insight Generation

**File:** `server/src/services/insights/llmInsightGenerator.ts`

**Model:** OpenAI `gpt-4o-mini`
**Temperature:** 0.7
**Max Tokens:** 2000
**Response Format:** JSON mode (`response_format: { type: 'json_object' }`)

**API Key Resolution Order:**
1. Tenant-specific: `rag_settings.openai_api_key` in tenant database (decrypted via `decryptAPIKeys`)
2. Environment variable: `process.env.OPENAI_API_KEY`
3. Throws error if neither available

**System Prompt (buildSystemPrompt):**
Defines Cohi as "an AI assistant for mortgage executives" with these critical rules:
- Generate 8-12 insights covering different business aspects
- Only include NOTABLE observations (not obvious status updates)
- Prioritize warnings and opportunities
- Include specific numbers and percentages in every insight
- 1-2 sentences max per insight
- Must include at least one prediction insight if at-risk loans exist

**Insight Types in Prompt:**
- `critical` → Immediate action required
- `warning` → Attention needed
- `info` → Important context
- `success` → Positive performance

**Priority Levels in Prompt:**
- `critical` → Must address today
- `high` → Address this week
- `medium` → Monitor closely
- `low` → Good to know

**Sources in Prompt:**
- `predictions` → Fallout predictions, at-risk loans
- `performance` → Pull-through, cycle time, revenue
- `pipeline` → Active loans, locked loans, pipeline volume
- `credit_risk` → FICO, LTV, DTI concerns
- `lost_opportunity` → Withdrawn/denied revenue impact
- `comparisons` → Month-over-month, year-over-year trends

**User Prompt (buildUserPrompt):**
Formats the metrics payload into structured text sections:
- PERIOD (date filter and range)
- PIPELINE (active, locked, closed with volumes)
- FALLOUT PREDICTIONS (withdraw/deny counts, high-risk details, risk factors)
- PERFORMANCE (pull-through with benchmarks, cycle time with thresholds, revenue)
- CREDIT RISK PROFILE (WA FICO/LTV/DTI with risk thresholds)
- LOST OPPORTUNITY (withdrawn/denied with volumes)
- FUNNEL (started, locked, originated, fallout rate)
- TRENDS (MoM and YoY changes)

Each section includes benchmark context (e.g., "Industry avg: 60-70%, top performers: 72%+").

**Validation:** The LLM response is strictly validated:
- Must contain `insights` array
- Each insight type must be one of: `success`, `warning`, `info`, `critical`
- Each priority must be one of: `critical`, `high`, `medium`, `low`
- Each source must be one of the 6 valid sources
- Invalid values are replaced with defaults (`info`, `medium`, `performance`)

### Rule-Based Fallback

**File:** `server/src/services/dashboard/analyticsService.ts` (lines 1276-2102)

When LLM is disabled or fails, the system generates insights using hardcoded business rules organized into 4 categories:

#### Business Overview Insights (up to 4 insights):

1. **Revenue Performance** — Formats total revenue and calculates growth rate
   - Uses a date-based seed for deterministic growth percentage (10-30%)
   - Priority: high

2. **Active Pipeline Health** — Reports active loan count and volume
   - Labels as "strong" (≥50 loans) or "moderate" (<50 loans)
   - Priority: medium

3. **Cycle Time Performance** — Evaluates average days
   - Thresholds: ≤28 = "excellent/industry-leading", 29-35 = "good", >35 = "needs improvement"
   - Type: success/info/warning based on thresholds
   - Priority: medium

4. **Pull-Through Rate** — Rolling 90D methodology
   - Thresholds: ≥72% = "excellent", 60-71% = "good", 55-59% = "moderate", <55% = "needs attention"
   - Type: success/info/warning based on thresholds
   - Priority: high

#### Leaderboard Insights (up to 3 insights):

1. **Top Performer Recognition** — Highlights #1 performer by volume
2. **Performance Gap Analysis** — Gap between #1 and #2 with improvement potential
3. **Team Distribution** — Top 3 concentration percentage, warns if >50%

#### Industry News Insights (up to 3 insights):

1. **Market Rate Trends** — First news item mentioning "rate" or "interest"
2. **Regulatory Updates** — First news item mentioning "regulation", "compliance", or "policy"
3. **Market Forecast** — First news item mentioning "forecast", "outlook", or "trend"

#### Loan Funnel Insights (up to 1 insight):

1. **Fallout Analysis** — Withdrawn + denied counts with lost revenue estimate (1% of volume)

**No-Data Fallback:** If no loans exist, returns 12 hardcoded demo insights covering all 4 categories.

**Shuffling:** Insights are shuffled using a date-based seed so they appear in different order each day.

---

## Insight Data Model

### Server-Side Insight Interface

```typescript
// server/src/services/dashboard/analyticsService.ts line 104
interface Insight {
  type: string;         // "success" | "info" | "warning" | "error" | "critical"
  message: string;      // The main insight text (1-2 sentences)
  priority: string;     // "critical" | "high" | "medium" | "low" | "standard"
  reasoning?: string;   // Explanation/context for the insight
  source?: string;      // Data source category
  forPodcast?: boolean; // Whether to include in audio briefing
}
```

### LLM-Generated Insight Interface

```typescript
// server/src/services/insights/llmInsightGenerator.ts line 11
interface GeneratedInsight {
  type: 'success' | 'warning' | 'info' | 'critical';
  message: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reasoning: string;
  source: 'predictions' | 'performance' | 'pipeline' | 'credit_risk' | 'lost_opportunity' | 'comparisons';
  forPodcast: boolean;
}
```

### Frontend Insight Interface

```typescript
// src/hooks/useAletheiaData.ts line 5
interface AletheiaInsight {
  type: "success" | "info" | "warning" | "error" | "critical";
  icon: any;        // Lucide icon component (added by frontend)
  message: string;
  priority: "critical" | "high" | "medium" | "low" | "standard";
  reasoning?: string;
  source?: string;
}
```

### Source Categories

| Source | Description | Generated By |
|--------|-------------|-------------|
| `business_overview` | Revenue, pipeline, cycle time, pull-through | Rule-based only |
| `leaderboard` | Top performer, gaps, team distribution | Rule-based only |
| `industry_news` | Rate trends, regulatory, forecasts | Rule-based only |
| `loan_funnel` | Funnel fallout analysis | Rule-based only |
| `predictions` | ML-based fallout predictions | LLM + Rule-based |
| `performance` | Pull-through, cycle time, revenue | LLM only |
| `pipeline` | Active loans, locked, pipeline health | LLM only |
| `credit_risk` | FICO, LTV, DTI risk flags | LLM only |
| `lost_opportunity` | Withdrawn/denied revenue impact | LLM only |
| `comparisons` | MoM and YoY trend analysis | LLM only |

**Note:** The rule-based track uses `business_overview`, `leaderboard`, `industry_news`, and `loan_funnel` as sources. The LLM track uses `predictions`, `performance`, `pipeline`, `credit_risk`, `lost_opportunity`, and `comparisons`. Only the LLM sources are "drillable" in the `InsightDetailModal`.

---

## Data Sources

The insights system draws from these database tables and APIs:

| Source | Table/API | Key Fields Used |
|--------|-----------|-----------------|
| Loan data | `public.loans` | loan_id, loan_amount, loan_type, current_loan_status, application_date, closing_date, lock_date, funding_date, fico_score, ltv, dti, loan_officer_id, branch, investor_purchase_date, credit_pull_date |
| Employee data | `public.employees` | id, first_name, last_name, role, branch |
| ML Predictions | `public.loan_predictions` | loan_id, predicted_outcome, confidence, reasoning, risk_factors, created_at |
| RAG Settings | `public.rag_settings` | openai_api_key (for LLM) |
| Metrics Catalog | `metricsService.ts` | active_loans, closed_loans, locked_loans, avg_cycle_time, pull_through_rate, total_volume, funded_volume, active_volume, total_revenue, wa_fico, wa_ltv, wa_dti |
| Industry News | `GET /api/news` (internal) | newsFeed[].items[].title |

---

## Caching Strategy

**LLM insights are cached in-memory** (Map-based, not Redis):

- **Cache key format:** `insights:{tenantId}:{dateFilter}:{YYYY-MM-DD}`
- **Default TTL:** 3600 seconds (1 hour)
- **Cache is per-tenant, per-date-filter, per-day**
- **Force refresh:** `forceRefresh=true` query param clears the cache and regenerates
- **Manual clear:** `clearCache(tenantId?)` function — clears tenant-specific or all cached insights

**Rule-based insights are NOT cached** — they are generated fresh on every request. Since they involve database queries, consider adding caching if performance is a concern.

---

## How to Modify & Expand Insights

### Adding a New Rule-Based Insight

**Where:** `server/src/services/dashboard/analyticsService.ts`, within the `getInsights()` function (starting at line ~1740).

**Steps:**

1. Identify which category your insight belongs to (business_overview, leaderboard, industry_news, loan_funnel, or create a new category).

2. Add your insight to the appropriate section. Example — adding a "Locked Loans Alert":

```typescript
// After the pull-through insight (~line 1865), add:
if (lockedLoansCount > 0 && activeLoansCount > 0) {
  const lockRatio = (lockedLoansCount / activeLoansCount) * 100;
  if (lockRatio < 50) {
    businessOverviewInsights.push({
      type: "warning",
      message: `Only ${lockRatio.toFixed(0)}% of active loans are rate-locked — ${activeLoansCount - lockedLoansCount} loans exposed to rate risk.`,
      priority: "high",
      reasoning: `Low lock ratios in a rising rate environment increase fallout risk. Consider proactive lock recommendations.`,
      source: "business_overview",
      forPodcast: true,
    });
  }
}
```

3. The insight will automatically appear in the frontend — no frontend changes needed.

### Modifying the LLM System Prompt

**Where:** `server/src/services/insights/llmInsightGenerator.ts`, `buildSystemPrompt()` function (line 76).

The system prompt controls the AI's personality, rules, and output format. To change how insights are generated:

1. **Tone/Style:** Modify the opening sentence: `"You are Cohi, an AI assistant for mortgage executives."`
2. **Number of insights:** Change `"Generate 8-12 insights"` to your desired range.
3. **Focus areas:** Add or modify rules in the `CRITICAL RULES` section.
4. **New insight types:** Add to the `INSIGHT TYPES` section (must also update validation in `parseAndValidateLLMResponse`).
5. **New sources:** Add to the `SOURCES` section (must also update validation).

**Example — Adding a "compliance" source:**

In `buildSystemPrompt()`:
```
SOURCES (use the most relevant):
...existing sources...
- "compliance": Regulatory compliance, deadline tracking
```

In `parseAndValidateLLMResponse()` (line 256):
```typescript
const validSources = ['predictions', 'performance', 'pipeline', 'credit_risk', 'lost_opportunity', 'comparisons', 'compliance'];
```

In `llmInsightGenerator.ts` `GeneratedInsight` interface:
```typescript
source: 'predictions' | 'performance' | 'pipeline' | 'credit_risk' | 'lost_opportunity' | 'comparisons' | 'compliance';
```

### Adding a New Insight Source/Category

This requires changes in multiple files:

1. **Server — GeneratedInsight interface** (`llmInsightGenerator.ts`): Add to `source` union type.
2. **Server — Validation** (`llmInsightGenerator.ts`): Add to `validSources` array in `parseAndValidateLLMResponse()`.
3. **Server — System prompt** (`llmInsightGenerator.ts`): Document the new source in `buildSystemPrompt()`.
4. **Server — Insight interface** (`analyticsService.ts`): The `source` field is `string`, so no change needed.
5. **Frontend — Drillable sources** (`AletheiaPromptsCard.tsx` lines 101-108 and 117-125): Add to the `drillableSources` arrays in both `handleInsightClick` and `isDrillable` callbacks.
6. **Server — Detail endpoint** (`insightDetails.ts`): Add a new `case` in the `switch(source)` block with the appropriate SQL query.
7. **Frontend — Detail modal** (`InsightDetailModal.tsx`): Add summary cards and table columns for the new source.

### Adding a New Drill-Down Detail View

**Where:** `server/src/routes/dashboard/insightDetails.ts`

To add a new drillable detail view (e.g., "compliance"):

1. **Add the case** in the `switch(source)` block:

```typescript
case 'compliance': {
  const complianceQuery = `
    SELECT ...
    FROM public.loans l
    WHERE ...
    LIMIT 100
  `;
  const compliance = await tenantPool.query(complianceQuery);
  
  result = {
    ...result,
    title: 'Compliance Issues',
    summary: {
      totalIssues: compliance.rows.length,
      // ...other summary stats
    },
    loans: compliance.rows.map(row => ({
      // ...mapped fields
    }))
  };
  break;
}
```

2. **Update the frontend** `InsightDetailModal.tsx`:
   - Add summary cards for the new source
   - Add table headers
   - Add table row rendering

3. **Update drillable sources** in `AletheiaPromptsCard.tsx`:
```typescript
const drillableSources = [
  "predictions", "credit_risk", "lost_opportunity",
  "pipeline", "performance", "comparisons",
  "compliance"  // ← add here (in BOTH handleInsightClick and isDrillable)
];
```

### Changing Thresholds and Benchmarks

**Rule-Based Thresholds** (in `analyticsService.ts`):

| Metric | Location (approx. line) | Current Thresholds |
|--------|------------------------|--------------------|
| Cycle Time | ~1807 | ≤28 = excellent, 29-35 = good, >35 = needs improvement |
| Pull-Through Rate | ~1838 | ≥72% = excellent, 60-71% = good, 55-59% = moderate, <55% = needs attention |
| Pipeline Health | ~1791 | ≥50 loans = "strong", <50 = "moderate" |
| Team Concentration | ~1937 | >50% top 3 = "warning", ≤50% = "info" |

**LLM Prompt Benchmarks** (in `llmInsightGenerator.ts` `buildUserPrompt()`):

| Metric | Current Benchmark Text |
|--------|----------------------|
| Pull-Through | "Industry avg: 60-70%, top performers: 72%+" |
| Cycle Time | "Excellent: ≤28, Good: 29-35, Needs work: >35" |
| FICO | "Risk: <680, High Risk: <620" |
| LTV | "Risk: >80%, High Risk: >95%" |
| DTI | "Risk: >43%, High Risk: >50%" |

### Adding New Metrics to the LLM Payload

**Where:** `server/src/services/insights/insightMetricsCollector.ts`

1. **Add to the interface** (`InsightMetricsPayload`):
```typescript
compliance?: {
  pendingAudits: number;
  overdueTasks: number;
  riskLevel: string;
};
```

2. **Add the query** in `collectInsightMetrics()` — add to the parallel `Promise.all()` array:
```typescript
// Add to the destructured results
const [
  ytdMetrics, mtdMetrics, rolling90DMetrics, predictions,
  pullThroughRolling90D, lostOpportunity, funnel, highRiskCount,
  complianceData,  // ← new
] = await Promise.all([
  // ...existing queries...
  fetchComplianceData(tenantPool),  // ← new function
]);
```

3. **Include in payload** at the bottom of `collectInsightMetrics()`:
```typescript
const payload: InsightMetricsPayload = {
  // ...existing sections...
  compliance: complianceData,
};
```

4. **Add to user prompt** in `buildUserPrompt()` in `llmInsightGenerator.ts`:
```typescript
=== COMPLIANCE ===
- Pending Audits: ${metrics.compliance?.pendingAudits || 0}
- Overdue Tasks: ${metrics.compliance?.overdueTasks || 0}
```

5. **Update system prompt** to instruct the LLM to use the new data.

---

## File Reference Map

| File | Role | Key Exports |
|------|------|-------------|
| `src/pages/Dashboard.tsx` | Page component, passes props to AletheiaPromptsCard | `Dashboard` (default) |
| `src/components/dashboard/AletheiaPromptsCard.tsx` | UI component for displaying insights | `AletheiaPromptsCard` |
| `src/hooks/useAletheiaData.ts` | Data fetching hook for insights | `useAletheiaData`, `AletheiaInsight`, `InsightsMetadata` |
| `src/components/dashboard/InsightDetailModal.tsx` | Drill-down modal for insight details | `InsightDetailModal` |
| `src/components/aletheia/CohiBriefingControl.tsx` | Audio briefing control (re-export) | `CohiBriefingControl` |
| `server/src/routes/dashboard/analytics.ts` | API route: `/api/dashboard/insights` | Express router |
| `server/src/routes/dashboard/insightDetails.ts` | API route: `/api/dashboard/insights/details/:source` | Express router |
| `server/src/services/dashboard/analyticsService.ts` | Core service: `getInsights()`, rule-based generation | `getInsights`, `Insight` |
| `server/src/services/insights/index.ts` | Barrel exports for insights module | Re-exports from collector + generator |
| `server/src/services/insights/insightMetricsCollector.ts` | Aggregates all metrics for LLM | `collectInsightMetrics`, `InsightMetricsPayload` |
| `server/src/services/insights/llmInsightGenerator.ts` | OpenAI integration, prompts, caching | `generateLLMInsights`, `GeneratedInsight`, `clearCache` |

---

## Quick-Reference: How to Enable LLM Insights

Currently, the frontend hardcodes `useLLM=false`. To switch to LLM-generated insights:

1. **In `src/hooks/useAletheiaData.ts` (line 123)**, change:
   ```typescript
   // Current (rule-based):
   `/api/dashboard/insights?dateFilter=${dateFilter}&useLLM=false${tenantParam}${forceRefreshParam}${channelParam}`
   
   // LLM-powered:
   `/api/dashboard/insights?dateFilter=${dateFilter}&useLLM=true${tenantParam}${forceRefreshParam}${channelParam}`
   
   // Or remove useLLM entirely (defaults to true on server):
   `/api/dashboard/insights?dateFilter=${dateFilter}${tenantParam}${forceRefreshParam}${channelParam}`
   ```

2. **Ensure an OpenAI API key is configured:**
   - Per-tenant: Insert into `rag_settings.openai_api_key` (encrypted) in the tenant database
   - Global fallback: Set `OPENAI_API_KEY` environment variable in `server/.env`

3. **Test:** Refresh the dashboard. The "AI" badge should appear next to "Executive briefing" if LLM insights are being used.
