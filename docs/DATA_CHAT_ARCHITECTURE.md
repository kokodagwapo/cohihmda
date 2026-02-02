# Data Chat Feature Architecture

> AI-powered natural language interface for querying mortgage loan data

## 1. Overview

**Data Chat** is an AI-powered natural language interface that allows users to query mortgage loan data conversationally. Users ask questions in plain English, and the system:

1. Converts questions to SQL queries using GPT-4o
2. Executes queries against the tenant's loan database
3. Auto-generates appropriate visualizations (charts, tables, KPIs)
4. Allows saving visualizations to a personal dashboard

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐     ┌─────────────────────────────────────────┐   │
│  │   DataChat.tsx      │     │         useDataChat.ts (Hook)           │   │
│  │   (Full Page UI)    │────▶│  - Session management                   │   │
│  │                     │     │  - Message state                        │   │
│  │  • Sidebar with     │     │  - API calls (/api/data-chat/*)         │   │
│  │    suggested Qs     │     │  - Conversation history (last 6 msgs)   │   │
│  │  • Chat messages    │     └────────────────────┬────────────────────┘   │
│  │  • Input field      │                          │                        │
│  │  • Save dialog      │                          ▼                        │
│  └─────────────────────┘     ┌─────────────────────────────────────────┐   │
│           │                  │    DynamicVisualization.tsx              │   │
│           │                  │    - Bar, Line, Pie, Area charts         │   │
│           ▼                  │    - Interactive tables                  │   │
│  ┌─────────────────────┐     │    - KPI cards                           │   │
│  │  ChatMessageBubble  │────▶│    - Chart type switching               │   │
│  │  - User messages    │     │    - Export CSV                          │   │
│  │  - AI responses     │     └─────────────────────────────────────────┘   │
│  │  - Visualizations   │                                                   │
│  └─────────────────────┘                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP/REST API
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Express.js)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    dataChat.ts (Routes)                              │   │
│  │  POST /api/data-chat/ask              - Process question             │   │
│  │  POST /api/data-chat/refine           - Refine previous query        │   │
│  │  POST /api/data-chat/new-session      - Create chat session          │   │
│  │  GET  /api/data-chat/history          - Get chat history             │   │
│  │  POST /api/data-chat/save-visualization - Save to dashboard          │   │
│  │  GET  /api/data-chat/saved-visualizations - List saved               │   │
│  │  PUT  /api/data-chat/saved-visualizations/:id - Update               │   │
│  │  DELETE /api/data-chat/saved-visualizations/:id - Delete             │   │
│  │  POST /api/data-chat/refresh-visualization/:id - Refresh data        │   │
│  │  GET  /api/data-chat/permissions      - Get user permissions         │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                           │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              dataChatService.ts (AI Processing)                      │   │
│  │                                                                       │   │
│  │  processDataQuestion()                                                │   │
│  │    │                                                                  │   │
│  │    ├──▶ generateQuery() ───────▶ OpenAI GPT-4o ───▶ SQL + Config    │   │
│  │    │         │                                                        │   │
│  │    │         └── LOAN_SCHEMA_CONTEXT (available fields)              │   │
│  │    │         └── METRICS_CATALOG (predefined metrics)                │   │
│  │    │         └── Conversation history (context)                      │   │
│  │    │                                                                  │   │
│  │    ├──▶ sanitizeGeneratedSQL() - Fix common AI SQL mistakes          │   │
│  │    │                                                                  │   │
│  │    ├──▶ executeQuery() ───────▶ PostgreSQL (tenant DB)              │   │
│  │    │                                                                  │   │
│  │    ├──▶ formatDataRows() - Clean dates, numbers                      │   │
│  │    │                                                                  │   │
│  │    └──▶ buildVisualizationConfig() - Generate chart config           │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────┐    ┌──────────────────────────────────────────┐  │
│  │   OpenAI API         │    │     PostgreSQL (Tenant Database)         │  │
│  │   (GPT-4o model)     │    │                                          │  │
│  │                      │    │  public.loans          - Loan data       │  │
│  │  • NL → SQL          │    │  public.chat_history   - Chat sessions   │  │
│  │  • Chart type        │    │  public.saved_visualizations - Saved     │  │
│  │  • Axis labels       │    │  public.rag_settings   - API keys        │  │
│  └──────────────────────┘    └──────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Flow Sequence

```
┌──────┐      ┌──────────┐      ┌─────────────┐      ┌────────┐      ┌──────────┐
│ User │      │ Frontend │      │   Backend   │      │ OpenAI │      │PostgreSQL│
└──┬───┘      └────┬─────┘      └──────┬──────┘      └───┬────┘      └────┬─────┘
   │               │                   │                 │                │
   │ Type question │                   │                 │                │
   │──────────────▶│                   │                 │                │
   │               │                   │                 │                │
   │               │ POST /ask         │                 │                │
   │               │──────────────────▶│                 │                │
   │               │                   │                 │                │
   │               │                   │ checkSectionAccess              │
   │               │                   │────────────────────────────────▶│
   │               │                   │◀────────────────────────────────│
   │               │                   │                 │                │
   │               │                   │ Send prompt     │                │
   │               │                   │────────────────▶│                │
   │               │                   │                 │                │
   │               │                   │ SQL + viz config│                │
   │               │                   │◀────────────────│                │
   │               │                   │                 │                │
   │               │                   │ Execute SQL                      │
   │               │                   │────────────────────────────────▶│
   │               │                   │                 │                │
   │               │                   │ Query results                   │
   │               │                   │◀────────────────────────────────│
   │               │                   │                 │                │
   │               │                   │ Save to chat_history            │
   │               │                   │────────────────────────────────▶│
   │               │                   │                 │                │
   │               │ Response + viz    │                 │                │
   │               │◀──────────────────│                 │                │
   │               │                   │                 │                │
   │ Display chart │                   │                 │                │
   │◀──────────────│                   │                 │                │
   │               │                   │                 │                │
```

---

## 4. Component Specifications

### 4.1 Frontend Components

| Component | File | Purpose |
|-----------|------|---------|
| `DataChat` | `src/pages/DataChat.tsx` | Main page with sidebar, chat area, input |
| `useDataChat` | `src/hooks/useDataChat.ts` | State management, API calls |
| `DynamicVisualization` | `src/components/visualizations/DynamicVisualization.tsx` | Renders charts/tables |
| `ChatMessageBubble` | (inline in DataChat.tsx) | Individual message display |

### 4.2 Backend Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/data-chat/ask` | POST | Process natural language question |
| `/api/data-chat/refine` | POST | Refine previous query |
| `/api/data-chat/new-session` | POST | Generate new UUID session |
| `/api/data-chat/history` | GET | Retrieve user's chat history |
| `/api/data-chat/save-visualization` | POST | Save viz to dashboard |
| `/api/data-chat/saved-visualizations` | GET | List saved visualizations |
| `/api/data-chat/saved-visualizations/:id` | PUT | Update saved viz |
| `/api/data-chat/saved-visualizations/:id` | DELETE | Delete saved viz |
| `/api/data-chat/refresh-visualization/:id` | POST | Re-run query with fresh data |
| `/api/data-chat/permissions` | GET | Get user's data permissions |

### 4.3 Backend Services

| Service | File | Purpose |
|---------|------|---------|
| `dataChatService` | `server/src/services/ai/dataChatService.ts` | AI processing, query generation |
| `queryBuilderService` | `server/src/services/ai/queryBuilderService.ts` | Permission checking |

---

## 5. Key Data Structures

### 5.1 VisualizationConfig

```typescript
interface VisualizationConfig {
  type: 'bar' | 'line' | 'pie' | 'area' | 'table' | 'kpi' | 'donut' | 'horizontal_bar';
  title: string;
  data: any[];
  xKey?: string;           // X-axis field
  yKey?: string;           // Y-axis field  
  yKeys?: string[];        // Multi-series charts
  xLabel?: string;         // Human-readable X label
  yLabel?: string;         // Human-readable Y label
  nameKey?: string;        // Pie chart category
  valueKey?: string;       // Pie chart value
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
  kpiConfig?: {
    value: number | string;
    label: string;
    change?: number;
    changeLabel?: string;
    format?: 'number' | 'currency' | 'percent';
  };
  tableConfig?: {
    columns: { key: string; label: string; format?: string }[];
    sortable?: boolean;
    pageSize?: number;
  };
}
```

### 5.2 ChatMessage

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  visualization?: VisualizationConfig;
  data?: any[];
  timestamp: Date;
  isLoading?: boolean;
  error?: string;
}
```

### 5.3 DataChatResponse

```typescript
interface DataChatResponse {
  message: string;                    // AI explanation
  visualization?: VisualizationConfig;
  data?: any[];                       // Raw query results
  suggestedQuestions?: string[];      // Follow-up suggestions
  error?: string;
}
```

### 5.4 ChatContext

```typescript
interface ChatContext {
  userId: string;
  tenantId: string;
  userRole: string;
  userEmail?: string;
  permissions?: UserPermissions;
}
```

---

## 6. AI Query Generation

### 6.1 System Prompt Components

The GPT-4o system prompt includes:

1. **LOAN_SCHEMA_CONTEXT** - Available database fields:
   - Core fields: `loan_id`, `loan_amount`, `loan_type`, `loan_purpose`, `current_loan_status`
   - Personnel fields: `loan_officer`, `processor`, `underwriter`, `branch`
   - Property fields: `property_city`, `property_state`, `property_county`, `property_type`
   - Financial fields: `interest_rate`, `ltv_ratio`, `be_dti_ratio`, `fico_score`
   - Date fields: `application_date`, `lock_date`, `closing_date`, `funding_date`

2. **PostgreSQL Syntax Rules**:
   - Always use table alias `l`: `FROM public.loans l`
   - Only SELECT queries allowed
   - Valid INTERVAL formats (no 'quarter' - use '3 months')
   - DATE_TRUNC for grouping
   - Limit 100 rows default

3. **Visualization Selection Rules**:
   - Time series → line/area
   - Categories → bar/horizontal_bar
   - Proportions → pie/donut
   - Single value → kpi
   - Detail records → table

4. **Current Date Context** - Today's date, year, month, quarter

5. **Conversation History** - Last 4 messages for context

### 6.2 GPT-4o Response Format

```json
{
  "sql": "SELECT branch, SUM(loan_amount) AS total FROM public.loans l GROUP BY branch ORDER BY total DESC LIMIT 10",
  "params": [],
  "explanation": "This shows the top 10 branches by total loan volume.",
  "visualizationType": "bar",
  "chartConfig": {
    "title": "Loan Volume by Branch",
    "xKey": "branch",
    "yKey": "total",
    "xLabel": "Branch",
    "yLabel": "Total Loan Amount"
  }
}
```

### 6.3 SQL Sanitization

The `sanitizeGeneratedSQL()` function fixes common AI mistakes:

- Converts `INTERVAL 'X quarters'` → `INTERVAL 'X*3 months'`
- Fixes double-quoted intervals
- Normalizes whitespace

---

## 7. Visualization Types

| Type | Best For | Data Requirements |
|------|----------|-------------------|
| `bar` | Category comparisons | Grouped data with < 20 categories |
| `horizontal_bar` | Many categories (5+) | Grouped data, long labels |
| `line` | Trends over time | Time-series with DATE_TRUNC |
| `area` | Volume trends | Time-series, emphasis on magnitude |
| `pie` / `donut` | Part-of-whole | 2-15 categories, proportions |
| `kpi` | Single metric | Aggregated single value |
| `table` | Detailed records | Individual loan rows, multiple fields |

### 7.1 Chart Type Compatibility

Users can switch between compatible chart types:

```typescript
const CHART_TYPE_INFO = {
  bar: { compatibleWith: ['bar', 'horizontal_bar', 'line', 'area', 'table'] },
  line: { compatibleWith: ['line', 'area', 'bar', 'table'] },
  pie: { compatibleWith: ['pie', 'donut', 'bar', 'horizontal_bar', 'table'] },
  kpi: { compatibleWith: ['kpi'] },  // KPI only converts to itself
  table: { compatibleWith: ['table', 'bar', 'horizontal_bar', 'line', 'pie'] },
};
```

---

## 8. Security & Access Control

### 8.1 Security Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     Security Layers                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Authentication (authenticateToken middleware)               │
│     • JWT token validation                                      │
│     • Extracts userId, tenantId, userRole, userEmail           │
│                                                                 │
│  2. Tenant Isolation (attachTenantContext middleware)           │
│     • Each tenant has separate database                         │
│     • Queries only run against tenant's data                    │
│                                                                 │
│  3. Section Access (checkSectionAccess)                         │
│     • Verifies user has 'data_chat' permission                 │
│     • Returns 403 if access denied                              │
│                                                                 │
│  4. Query Sanitization                                          │
│     • Only SELECT queries allowed                               │
│     • Blocks INSERT, UPDATE, DELETE, DROP, etc.                │
│     • Fixes common SQL injection patterns                       │
│                                                                 │
│  5. Rate Limiting (apiLimiter middleware)                       │
│     • Prevents abuse                                            │
│                                                                 │
│  6. API Key Encryption                                          │
│     • OpenAI keys stored encrypted in rag_settings             │
│     • Decrypted only at runtime                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Dangerous Keyword Blocking

```typescript
const dangerousKeywords = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 
  'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE'
];
```

---

## 9. Pre-built Question Categories

| Category | Icon | Example Questions |
|----------|------|-------------------|
| **Volume & Performance** | BarChart3 | "Total loan volume by month", "Average loan amount by type", "Top 10 loan officers" |
| **Pipeline & Status** | TrendingUp | "Active loans in pipeline", "Loans by milestone", "Pull-through rate" |
| **Geography & Demographics** | PieChart | "Loan distribution by state", "Top counties by volume" |
| **Detailed Data** | Table | "List recent funded loans", "Loans with FICO < 700" |

---

## 10. Database Schema

### 10.1 chat_history

```sql
CREATE TABLE public.chat_history (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id UUID NOT NULL,
  role TEXT NOT NULL,           -- 'user' or 'assistant'
  content TEXT NOT NULL,
  visualization_id INTEGER,
  metadata JSONB,               -- { timestamp, hasVisualization, rowCount, error }
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 10.2 saved_visualizations

```sql
CREATE TABLE public.saved_visualizations (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  question TEXT NOT NULL,       -- Original question asked
  visualization_type TEXT NOT NULL,
  visualization_config JSONB NOT NULL,
  query_config JSONB,
  data_snapshot JSONB,          -- Cached data for quick loading
  position INTEGER DEFAULT 0,
  width INTEGER,
  height INTEGER,
  is_pinned BOOLEAN DEFAULT FALSE,
  refresh_interval INTEGER,     -- Auto-refresh in seconds
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 11. Frontend Features

### 11.1 DataChat Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Navigation Bar                                                 │
├────────────────┬────────────────────────────────────────────────┤
│                │                                                │
│   SIDEBAR      │           MAIN CHAT AREA                       │
│   (320px)      │                                                │
│                │   ┌────────────────────────────────────────┐   │
│  [Explore Qs]  │   │  Header: "Data Chat" + New Chat btn   │   │
│                │   ├────────────────────────────────────────┤   │
│  Volume &      │   │                                        │   │
│  Performance   │   │     Messages Area (ScrollArea)         │   │
│  • Question 1  │   │                                        │   │
│  • Question 2  │   │     [User bubble]                      │   │
│                │   │           [AI response + chart]        │   │
│  Pipeline &    │   │     [User bubble]                      │   │
│  Status        │   │           [AI response + table]        │   │
│  • Question 1  │   │                                        │   │
│  • Question 2  │   ├────────────────────────────────────────┤   │
│                │   │  Suggested follow-ups (chips)          │   │
│  Geography     │   ├────────────────────────────────────────┤   │
│  • Question 1  │   │  [Input field]            [Send btn]   │   │
│                │   └────────────────────────────────────────┘   │
│                │                                                │
└────────────────┴────────────────────────────────────────────────┘
```

### 11.2 DynamicVisualization Features

- **Chart Type Switching**: Dropdown to change visualization type
- **Interactive Elements**: Click bars/pie slices to select
- **Table Features**: Sortable columns, pagination
- **Export Options**: Copy data, download CSV
- **Display Options**: Toggle grid, legend, expand/collapse

---

## 12. Hook API (useDataChat)

```typescript
const {
  messages,           // ChatMessage[] - All messages
  isLoading,          // boolean - Request in progress
  sessionId,          // string | null - Current session UUID
  suggestedQuestions, // string[] - Follow-up suggestions
  sendMessage,        // (question: string) => void
  refineQuery,        // (refinement: string) => void
  saveVisualization,  // (viz, question, title?, desc?) => Promise
  clearMessages,      // () => void
  newSession,         // () => Promise - Start fresh
} = useDataChat({ tenantId });
```

---

## 13. Error Handling

### 13.1 Error Types & User Messages

| Error Code | Description | User Message |
|------------|-------------|--------------|
| `42703` | Column does not exist | "I tried to use a field that doesn't exist..." |
| `42601` | Syntax error | "There was an issue with the query..." |
| `22007` | Date/time parse error | "There was an issue with the query..." |
| Timeout | Query took too long | "Try asking for a smaller date range..." |
| OpenAI error | API connection issue | "Having trouble connecting to AI assistant..." |

### 13.2 Fallback Suggestions

When errors occur, the system returns safe fallback questions:
- "Show me total loan volume"
- "How many loans by loan type?"
- "Show me loans by branch"
- "What are the top 10 loan officers by volume?"

---

## 14. Key Features Summary

| Feature | Description |
|---------|-------------|
| **Natural Language Queries** | Users ask questions in plain English |
| **Auto-Visualization** | AI determines best chart type |
| **Chart Type Switching** | Users can change bar → line → table etc. |
| **Interactive Charts** | Click data points, sort tables, pagination |
| **Save to Dashboard** | Persist visualizations with custom titles |
| **Refresh Data** | Re-run saved queries with fresh data |
| **Conversation Context** | AI maintains context of last 4-6 messages |
| **Suggested Questions** | Pre-built and dynamic follow-up suggestions |
| **Export CSV** | Download chart data as spreadsheet |
| **Multi-tenant** | Each tenant has isolated data |

---

## 15. File References

| File | Location | Lines |
|------|----------|-------|
| DataChat Page | `src/pages/DataChat.tsx` | ~518 |
| useDataChat Hook | `src/hooks/useDataChat.ts` | ~350 |
| DynamicVisualization | `src/components/visualizations/DynamicVisualization.tsx` | ~1104 |
| Backend Routes | `server/src/routes/dataChat.ts` | ~559 |
| AI Service | `server/src/services/ai/dataChatService.ts` | ~740 |
