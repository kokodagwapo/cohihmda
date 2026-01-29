# Cohi Insights Section - Architecture Documentation

> **Last Updated:** January 28, 2026  
> **Version:** 1.0  
> **Scope:** The "Cohi Insights" card on the Dashboard page (`/insights` route)

---

## Overview

The **"Cohi Insights"** section is a specific card on the Dashboard page that displays AI-generated executive briefings. It's labeled "Cohi Insights - Executive Briefing" and shows rotating insights about business performance, leaderboard highlights, industry news, and loan funnel metrics.

### Location in UI

```
Dashboard Page (/insights)
└── Insights Section
    └── "Cohi Insights" card  ← THIS IS WHAT THIS DOCUMENT COVERS
```

---

## Component Architecture

### File Structure

```
src/
├── pages/
│   └── Dashboard.tsx                           # Parent page (lines 1105-1121)
├── components/
│   └── dashboard/
│       ├── AletheiaPromptsCard.tsx            # Main component
│       └── AletheiaBriefingControls.tsx       # Podcast/voice controls
└── hooks/
    └── useAletheiaData.ts                      # Data fetching hook
```

### Component Hierarchy

```
Dashboard.tsx
    │
    └── AletheiaPromptsCard  (when dashboardVisibility.aletheiaInsights = true)
            │
            ├── Header
            │   ├── Icon (Zap)
            │   ├── Title: "Cohi Insights"
            │   ├── Subtitle: "Executive Briefing"
            │   └── AletheiaBriefingControls (podcast player)
            │
            ├── Pinned Insights (if any)
            │   └── InsightCard[] (pinned items stay visible)
            │
            ├── Rotating Insights
            │   └── InsightCard[] (3 at a time, rotates every 6 seconds)
            │
            └── Pagination Dots (if multiple sets)
```

---

## How It Works

### 1. Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard.tsx                                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  AletheiaPromptsCard                                    ││
│  │  ┌────────────────────────────────────────────────────┐ ││
│  │  │  useAletheiaData(dateFilter, tenantId)             │ ││
│  │  │  └── API: GET /api/dashboard/insights              │ ││
│  │  │  └── API: GET /api/loans/funnel                    │ ││
│  │  └────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend: GET /api/dashboard/insights                        │
│  └── analyticsService.getInsights()                         │
│      ├── Query metrics catalog (active, closed, volume...)  │
│      ├── Query loans table                                   │
│      ├── Query leaderboard data                             │
│      ├── Fetch industry news                                │
│      ├── Query loan funnel data                             │
│      └── Generate insight messages                          │
└─────────────────────────────────────────────────────────────┘
```

### 2. Component Props

**AletheiaPromptsCard** (`src/components/dashboard/AletheiaPromptsCard.tsx`):

```typescript
interface Props {
  dateFilter: 'today' | 'mtd' | 'ytd' | 'custom';
  onDataAvailabilityChange?: (hasData: boolean) => void;
  briefingContext?: {
    dialogues?: Array<{ message: string; type: string; priority: string }>;
    funnelStory?: { conversionRates: any; falloutData: any; lostRevenue: any };
    userName?: string;
  };
  selectedTenantId?: string | null;
}
```

### 3. Insight Data Structure

Each insight returned from the API has this structure:

```typescript
interface AletheiaInsight {
  type: 'success' | 'info' | 'warning' | 'error';  // Color coding
  icon: LucideIcon;                                 // CheckCircle2, Info, AlertTriangle
  message: string;                                  // Main insight text
  priority: 'high' | 'medium' | 'standard';        // Importance level
  reasoning?: string;                               // Expandable explanation
  source?: string;                                  // 'business_overview' | 'leaderboard' | 'industry_news' | 'loan_funnel'
}
```

---

## Insight Sources

The backend generates insights from **4 data sources**:

### 1. Business Overview (`source: 'business_overview'`)
- Revenue metrics and YoY comparisons
- Active pipeline depth
- Cycle time performance

### 2. Leaderboard (`source: 'leaderboard'`)
- Top performer highlights
- Performance gaps between tiers
- Team concentration metrics

### 3. Industry News (`source: 'industry_news'`)
- Market rate trends
- Industry volume changes
- Technology adoption insights

### 4. Loan Funnel (`source: 'loan_funnel'`)
- Pull-through rates
- Fallout/withdrawal alerts
- Conversion analysis

---

## UI Features

### 1. Rotating Display
- Insights displayed in sets of **3 cards**
- Auto-rotates every **6 seconds**
- Pauses on mouse hover
- Pagination dots for manual navigation

### 2. Pin/Unpin
- Users can pin important insights
- Pinned insights stay visible above the rotating section
- Click the pin icon to toggle

### 3. Expandable Reasoning
- Click an insight card to expand
- Shows the `reasoning` field with more context

### 4. Color Coding
| Type | Background | Icon |
|------|------------|------|
| `success` | Emerald/green | CheckCircle2 |
| `info` | Blue | Info |
| `warning` | Amber/yellow | AlertTriangle |
| `error` | Rose/red | AlertTriangle |

---

## Backend: Insight Generation

**File:** `server/src/services/dashboard/analyticsService.ts`  
**Function:** `getInsights()`

### Process:

1. **Calculate date range** based on `dateFilter` (today/mtd/ytd)

2. **Query metrics** from centralized metrics catalog:
   - `active_loans`, `closed_loans`, `locked_loans`
   - `avg_cycle_time`, `pull_through_rate`
   - `total_volume`, `funded_volume`, `active_volume`

3. **Query loan data** for insight generation

4. **Query leaderboard** from employees + loans tables

5. **Fetch industry news** from external news API

6. **Query loan funnel** data (started, active, originated, fallout)

7. **Generate insights** based on thresholds and comparisons

### Example Insights Generated:

```typescript
// Business Overview insight
{
  type: 'info',
  message: 'YTD revenue reached $2.4M, up 18% versus last year — strong momentum continues.',
  priority: 'high',
  reasoning: 'Revenue trajectory shows consistent growth...',
  source: 'business_overview',
  forPodcast: true
}

// Leaderboard insight
{
  type: 'success',
  message: 'Top performer: Sarah Chen with $4.2M YTD — 42 loans closed, 87.5% pull-through.',
  priority: 'high',
  source: 'leaderboard',
  forPodcast: true
}

// Funnel insight
{
  type: 'warning',
  message: 'Funnel alert: 28 loans withdrawn (8% fallout) — review withdrawal reasons.',
  priority: 'medium',
  source: 'loan_funnel',
  forPodcast: true
}
```

---

## API Endpoint

### GET `/api/dashboard/insights`

**Query Parameters:**
- `dateFilter`: `'today'` | `'mtd'` | `'ytd'` | `'custom'`
- `tenant_id`: (optional) tenant UUID for multi-tenant

**Response:**
```typescript
{
  insights: Insight[];           // Array of insight objects
  generatedAt: string;           // ISO timestamp
  dateFilter: string;            // Echo of filter used
  summary: {
    totalLoans: number;
    revenue: number;
    pullThroughRate: string;
    avgCycleTime: number;
    totalInsights: number;
    bySource: {
      business_overview: number;
      leaderboard: number;
      industry_news: number;
      loan_funnel: number;
    }
  }
}
```

---

## Fallback Behavior

If no loan data exists or the API fails, the component falls back to **demo insights**:

```typescript
// Demo insights shown when:
// 1. No auth token
// 2. API returns empty
// 3. API request times out
// 4. API returns error

const demoInsights = [
  {
    type: 'info',
    message: 'YTD revenue reached $2.4M, up 18% versus last year...',
    priority: 'high',
    source: 'business_overview'
  },
  {
    type: 'info',
    message: 'Active pipeline: 185 loans, $78.2M in process...',
    priority: 'high',
    source: 'loan_funnel'
  }
];
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/pages/Dashboard.tsx` | Parent page, renders `AletheiaPromptsCard` at lines 1105-1121 |
| `src/components/dashboard/AletheiaPromptsCard.tsx` | Main "Cohi Insights" card component |
| `src/components/aletheia/AletheiaBriefingControls.tsx` | Podcast/voice player controls |
| `src/hooks/useAletheiaData.ts` | Data fetching hook for insights |
| `server/src/services/dashboard/analyticsService.ts` | Backend `getInsights()` function (line 966) |
| `server/src/routes/dashboard/analytics.ts` | API route handler |

---

## AI Architecture: What's AI vs What's Not

### IMPORTANT: The Insight Cards are NOT AI-Generated

The text insights shown in the Cohi Insights cards are **rule-based templates with dynamic data**, NOT AI-generated.

**How it works (`analyticsService.ts` lines 1345-1602):**

```typescript
// Example - this is TEMPLATE-BASED, not AI:
businessOverviewInsights.push({
  type: 'success',
  message: `${dateFilter === 'ytd' ? 'YTD' : 'MTD'} total revenue reached ${revenueFormatted}, up ${growthRate}% versus last year — strong momentum continues.`,
  priority: 'high',
  reasoning: `Revenue trajectory shows consistent growth. At current velocity, you're positioned for a strong quarter.`,
  source: 'business_overview'
});
```

The backend:
1. Queries metrics (active loans, volume, cycle time, etc.)
2. Applies threshold checks (e.g., `cycleTime <= 30 ? 'excellent' : 'needs improvement'`)
3. Interpolates values into hardcoded message templates
4. Returns an array of insight objects

**No LLM/GPT/AI is involved in generating the insight text itself.**

---

## AI Component: The "Start Briefing" Podcast

The **Play button** (🎵) in the Cohi Insights header DOES use AI. It generates a spoken podcast-style narration of the insights.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend: AletheiaBriefingControls.tsx                       │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  1. User clicks "Start Briefing" button                  ││
│  │  2. WebSocket connects to /ws/aletheia                   ││
│  │  3. Sends briefingPrompt with insight data               ││
│  │  4. Receives PCM audio chunks, plays in real-time        ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────┬────────────────────────────┘
                                  │ WebSocket
                                  ▼
┌──────────────────────────────────────────────────────────────┐
│  Backend: websocket.ts                                        │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  1. Authenticates user via JWT                           ││
│  │  2. Loads tenant RAG settings (API keys, voice config)   ││
│  │  3. Connects to AI provider (OpenAI or Gemini)           ││
│  │  4. Sends system prompt + user prompt                    ││
│  │  5. Streams audio response back to frontend              ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────┬────────────────────────────┘
                                  │ WebSocket
                                  ▼
┌──────────────────────────────────────────────────────────────┐
│  AI Provider (configurable via ALETHEIA_AI_PROVIDER env var) │
│  ┌────────────────────┐  OR  ┌────────────────────┐          │
│  │  OpenAI Realtime   │      │  Gemini Live       │          │
│  │  gpt-4o-mini-      │      │  gemini-2.0-       │          │
│  │  realtime-preview  │      │  flash-exp         │          │
│  └────────────────────┘      └────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

### The System Prompt (websocket.ts lines 27-54)

```typescript
const ALETHEIA_SYSTEM_PROMPT = `You are Aletheia, an executive-intelligent, 
predictive, and proactive AI assistant designed for mortgage executives. 
You are the voice of the Coheus Executive Intelligence Platform.

CORE IDENTITY:
- Executive-intelligent: You think like a Chief of Staff
- Predictive and proactive: You identify patterns before they become problems
- Professional with subtle wit: You're confident, clear, and occasionally insightful
- Industry Expert: You stay current with mortgage industry trends

CRITICAL RULE:
- NO STAGE DIRECTIONS: Never include bracketed text or stage directions
- FINANCIAL PRONUNCIATION: Read "$1.2M" as "one point two million dollars"
- TERMINOLOGY: Use "here's the latest" for insights, "headlines" only for news
- DYNAMIC BRIEFINGS: Never deliver the same briefing twice
- MACRO-TO-MICRO INSIGHTS: Connect industry news to company's specific data

COMMUNICATION STYLE:
- Executive-level: Speak to leaders, not operators
- Concise: Get to the point quickly
- Actionable: Every insight should lead to a decision
`;
```

### The Briefing Prompt (AletheiaBriefingControls.tsx lines 279-298)

When the user clicks "Start Briefing", this prompt is sent:

```typescript
const briefingPrompt = `Provide a unique, high-value executive briefing 
in a podcast-style format. 

CRITICAL: 
- Do not include any stage directions, music descriptions, or bracketed text
- GREETING: Begin with "${greeting}" (Good morning/afternoon/evening)
- Pronounce financial figures properly in full words
- RANDOMIZE YOUR OPENING: Vary tone, greeting, and structure each time
- TERMINOLOGY: Use "here's the latest" for insights, "headlines" for industry news
- INCLUDE INDUSTRY NEWS: Incorporate mortgage/lending current events
- PROVIDE INTELLIGENT INSIGHTS: Connect macro environment to specific figures

First, cover these key insights (introduced as "here's the latest"):
${dialoguesText}  // <-- The insight messages from the cards

${funnelText ? `Then transition to the Loan Funnel analysis:
${funnelText}` : ''}

Use executive terminology and be candid and direct.
Briefing ID: ${Date.now()}`;
```

### Configuration Options

**AI Provider** (`ALETHEIA_AI_PROVIDER` env var):
- `'openai'` - Uses OpenAI Realtime API (gpt-4o-mini-realtime-preview)
- `'gemini'` - Uses Gemini Live API (gemini-2.0-flash-exp)

**Tenant-Specific Settings** (from `tenant_rag_settings` table):
- `openai_api_key` / `gemini_api_key` - Per-tenant API keys
- `voice_model` - AI model to use
- `voice_name` - Voice preset (e.g., "Aoede" for Gemini)
- `personality_tone` - professional, friendly, executive, consultative, analytical
- `personality_style` - concise, detailed, conversational, formal
- `allowed_topics` - Restrict topics the AI can discuss
- `conversation_rules` - Custom rules for the AI to follow
- `knowledge_base_links` - Reference resources

---

## Summary

The **"Cohi Insights"** section has **two distinct parts**:

### 1. Insight Cards (NOT AI)
- **Rule-based templates** with dynamic data interpolation
- Generated by `analyticsService.getInsights()` 
- Fetched via `GET /api/dashboard/insights`
- Displays 3 cards at a time with 6-second rotation
- Color-coded by type, pinnable, multi-tenant aware

### 2. "Start Briefing" Podcast (AI-POWERED)
- **AI-generated spoken narration** of the insights
- Uses OpenAI Realtime or Gemini Live (configurable)
- WebSocket connection for real-time audio streaming
- Customizable via tenant RAG settings
- System prompt defines "Aletheia" persona
- User prompt includes insight data + briefing instructions
