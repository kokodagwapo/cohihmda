/**
 * Cohi Workbench API Routes
 *
 * Workbench-specific AI endpoint that is aware of:
 *  - The tenant's database schema (via SchemaContextService)
 *  - The widget catalog (sent from the frontend)
 *  - The current canvas state (sent from the frontend)
 *  - Structured WidgetAction output format
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import {
  getSchemaForTenant,
  getFallbackSchemaContext,
} from "../services/ai/schemaContextService.js";
import {
  getVerifiedMetricsSQL,
  getTenantRevenueExpression,
} from "../services/metrics/canonicalMetrics.js";
import {
  createConversation,
  getConversation,
  listConversations,
  appendMessage,
  deleteConversation,
  type ConversationMessage,
} from "../services/ai/cohiConversationService.js";
import {
  executeQuery,
  formatDataRows,
  type ChatContext,
} from "../services/ai/cohiChatService.js";
import { getPromptConfig, buildPrompt } from "../services/promptConfigService.js";
import { decryptAPIKeys } from "../services/encryption.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";

const router = Router();

// ============================================================================
// Types
// ============================================================================

interface CanvasStateSnapshot {
  groups: {
    groupId: string;
    title: string;
    sectionType: string;
    widgetIds: string[];
    filters?: {
      dateRange?: string;
      dateField?: string;
      branch?: string;
      loanOfficer?: string;
    };
  }[];
  standaloneWidgets: { id: string; type: string; title?: string }[];
  totalItems: number;
  /** Actual data from rendered widgets */
  widgetData?: {
    itemId: string;
    widgetName: string;
    category: string;
    data: unknown;
  }[];
}

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ============================================================================
// Helpers
// ============================================================================

async function getOpenAIKey(tenantId?: string): Promise<string> {
  if (tenantId) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);
      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'rag_settings'
        ) as exists
      `);
      if (tableCheck.rows[0]?.exists) {
        const result = await tenantPool.query(
          `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
        );
        if (result.rows[0]?.openai_api_key) {
          const decrypted = await decryptAPIKeys({
            openai_api_key: result.rows[0].openai_api_key,
          });
          if (decrypted.openai_api_key) return decrypted.openai_api_key;
        }
      }
    } catch (error: any) {
      console.error(
        "[CohiWorkbench] Error fetching tenant API key:",
        error.message
      );
    }
  }
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  throw new Error("OpenAI API key not configured.");
}

async function callOpenAI(
  messages: OpenAIChatMessage[],
  apiKey: string,
  options: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  } = {}
): Promise<string> {
  const body: any = {
    model: "gpt-4o",
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 3000,
  };
  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = (await response.json()) as {
      error?: { message?: string };
    };
    throw new Error(
      `OpenAI API error: ${error.error?.message || "Unknown error"}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || "";
}

// ============================================================================
// Build workbench system prompt
// ============================================================================

// ---- Data formatting helpers for canvas context ----

/** Rough token estimation: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Format a number compactly for the LLM context */
function fmtNum(val: unknown): string {
  if (val == null) return "N/A";
  const n = Number(val);
  if (Number.isNaN(n)) return String(val);
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

/** Format KPI data into a compact readable string */
function formatKpiData(data: any): string {
  if (!data) return "";
  // Direct KPI shape: { value, label, format, subtitle }
  if (data.value !== undefined) {
    const val = data.format === "currency" ? fmtNum(data.value)
      : data.format === "percent" ? `${Number(data.value).toFixed(1)}%`
      : fmtNum(data.value);
    return data.subtitle ? `${val} (${data.subtitle})` : val;
  }
  // Fallback: stringify compactly
  return JSON.stringify(data).substring(0, 200);
}

/** Format chart data into a compact summary string */
function formatChartData(data: any): string {
  if (!data) return "";
  const chartData: any[] = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
  if (chartData.length === 0) return "(no data)";

  const xKey = data.xKey || Object.keys(chartData[0] || {})[0];
  const yKey = data.yKey || Object.keys(chartData[0] || {})[1];

  // Show first 8 data points compactly
  const points = chartData.slice(0, 8).map((row: any) => {
    const x = row[xKey] ?? "";
    const y = row[yKey] ?? "";
    return `${x}: ${fmtNum(y)}`;
  });
  const suffix = chartData.length > 8 ? ` ... (${chartData.length} total points)` : "";
  return points.join(", ") + suffix;
}

/** Format table data into a compact summary string */
function formatTableData(data: any): string {
  if (!data) return "";
  const rows: any[] = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
  if (rows.length === 0) return "(no data)";

  const keys = Object.keys(rows[0] || {}).slice(0, 6);
  const header = keys.join(" | ");
  const bodyRows = rows.slice(0, 5).map((row: any) =>
    keys.map((k) => {
      const v = row[k];
      return v == null ? "-" : typeof v === "number" ? fmtNum(v) : String(v).substring(0, 30);
    }).join(" | ")
  );
  const suffix = rows.length > 5 ? `\n... (${rows.length} total rows)` : "";
  return `${header}\n${bodyRows.join("\n")}${suffix}`;
}

/** Max chars for the data section (~4000 tokens) */
const MAX_DATA_CHARS = 16000;

function buildCanvasContext(state: CanvasStateSnapshot): string {
  if (state.totalItems === 0) return "The canvas is currently empty.";

  const lines: string[] = ["## CURRENT CANVAS STATE\n"];

  // ---- Structural info with filter context ----
  if (state.groups.length > 0) {
    lines.push(`### Dashboard Groups on Canvas (${state.groups.length})`);
    for (const g of state.groups) {
      let filterStr = "";
      if (g.filters) {
        const parts: string[] = [];
        if (g.filters.dateRange) parts.push(`Date: ${g.filters.dateRange}`);
        if (g.filters.dateField) parts.push(`Field: ${g.filters.dateField}`);
        if (g.filters.branch) parts.push(`Branch: ${g.filters.branch}`);
        if (g.filters.loanOfficer) parts.push(`LO: ${g.filters.loanOfficer}`);
        if (parts.length > 0) filterStr = ` [Filters: ${parts.join(", ")}]`;
      }
      lines.push(
        `- **${g.title}** (${g.sectionType}, ${g.widgetIds.length} widgets)${filterStr}`
      );
    }
    lines.push("");
  }

  if (state.standaloneWidgets.length > 0) {
    lines.push(`### Standalone Items (${state.standaloneWidgets.length})`);
    for (const w of state.standaloneWidgets) {
      lines.push(`- ${w.id} (${w.type})${w.title ? ": " + w.title : ""}`);
    }
    lines.push("");
  }

  // ---- Actual widget data values ----
  if (state.widgetData && state.widgetData.length > 0) {
    lines.push("### LIVE DATA VALUES (what the user currently sees)\n");

    // Sort: KPIs first (most compact and useful), then charts, then tables
    const sorted = [...state.widgetData].sort((a, b) => {
      const order: Record<string, number> = { kpi: 0, chart: 1, table: 2, embed: 3, other: 4 };
      return (order[a.category] ?? 4) - (order[b.category] ?? 4);
    });

    let charBudget = MAX_DATA_CHARS;

    for (const entry of sorted) {
      if (charBudget <= 0) {
        lines.push("... (additional widget data truncated to stay within context limits)");
        break;
      }

      let formatted = "";
      switch (entry.category) {
        case "kpi":
          formatted = `- **${entry.widgetName}**: ${formatKpiData(entry.data)}`;
          break;
        case "chart":
          formatted = `- **${entry.widgetName}** (chart): ${formatChartData(entry.data)}`;
          break;
        case "table":
          formatted = `- **${entry.widgetName}** (table):\n${formatTableData(entry.data)}`;
          break;
        default:
          formatted = `- **${entry.widgetName}**: ${JSON.stringify(entry.data).substring(0, 150)}`;
          break;
      }

      charBudget -= formatted.length;
      lines.push(formatted);
    }
  }

  return lines.join("\n");
}

const WORKBENCH_SYSTEM_PROMPT = `You are Cohi, a senior mortgage industry analyst and executive intelligence engine embedded in a workbench for mortgage data analytics.
You serve as a trusted chief of staff — turning raw data into clear, confident narratives and board-ready presentations instantly.
You help users build, modify, and understand data visualizations on their canvas.

## Your Capabilities
1. **Add existing widgets** from the catalog using the "add_existing_widget" action
2. **Suggest full dashboards** using the "suggest_dashboard" action
3. **Create new widgets** with SQL queries using the "create_widget" action
4. **Modify widgets** on the canvas using the "modify_widget" action
5. **Delete widgets** using the "delete_widget" action
6. **Explain widgets** to teach users how they work
7. **Explain schema fields** so users understand their data
8. **Query live data** from the database to answer analytical questions using "query_data"
9. **See actual data** on the canvas (KPI values, chart data, table rows) — use this to give data-driven answers
10. **Generate reports** — create full multi-slide PowerPoint/PDF presentations using the "generate_report" action

## Response Format
You MUST respond with valid JSON in this exact format:
{
  "message": "Your conversational response to the user",
  "actions": [
    // Zero or more structured actions (see action types below)
  ],
  "teachingNotes": "Optional: educational notes about how widgets/data work",
  "suggestedQuestions": ["Follow-up question 1", "Follow-up question 2"]
}

## Action Types
Each action in the "actions" array must be one of:

1. **add_existing_widget**: Add a widget from the catalog
   {"type": "add_existing_widget", "widgetId": "<id from catalog>", "explanation": "Why this widget is relevant"}

2. **suggest_dashboard**: Add an entire dashboard section
   {"type": "suggest_dashboard", "sectionKey": "<key like companyScorecard, salesScorecard, etc.>", "explanation": "Why this dashboard is useful"}

3. **create_widget**: Generate a new visualization from SQL
   {"type": "create_widget", "sql": "SELECT ...", "title": "Chart Title", "config": {"type": "bar|line|pie|area|table|kpi|donut|horizontal_bar|stacked_bar|grouped_bar|treemap|pivot", "title": "...", "data": [], "xKey": "...", "yKey": "...", "yKeys": ["...", "..."], "pivotConfig": {"rowKey":"...","columnKey":"...","valueKey":"...","aggregation":"sum"}}, "explanation": "What this shows"}
   IMPORTANT: The config.type MUST be one of: bar, line, pie, area, table, kpi, donut, horizontal_bar, stacked_bar, grouped_bar, treemap, pivot. NEVER use "chart" as a type.

4. **modify_widget**: Change an existing canvas widget
   {"type": "modify_widget", "instanceId": "<canvas item id>", "changes": {...}, "explanation": "What changed"}

5. **delete_widget**: Remove a widget from canvas
   {"type": "delete_widget", "instanceId": "<canvas item id>", "explanation": "Why removing"}

6. **explain_widget**: Teach about a widget
   {"type": "explain_widget", "widgetId": "<id>", "explanation": "Detailed explanation"}

7. **explain_schema**: Teach about data fields
   {"type": "explain_schema", "fields": ["field1", "field2"], "explanation": "What these fields mean"}

8. **create_canvas**: Build a full multi-section dashboard canvas at once
   {"type": "create_canvas", "title": "Monthly Executive Review", "sectionKeys": ["executiveDashboard", "companyScorecard", "salesScorecard"], "explanation": "Why this combination"}

9. **query_data**: Run a SQL query to answer a data question (results are returned to you automatically)
   {"type": "query_data", "sql": "SELECT ...", "explanation": "What this query checks"}
   Use query_data when:
   - The user asks a question that requires data NOT visible on the canvas
   - The user asks for deeper drill-down beyond what the current widgets show
   - You need to verify or compute something that isn't in the LIVE DATA VALUES
   PREFER answering from canvas data when possible (faster, no extra query needed).
   The query results will be automatically provided back to you so you can formulate a data-driven answer.

10. **generate_report**: Generate a full multi-slide PowerPoint/PDF report
    {"type": "generate_report", "reportDefinition": {
      "title": "Report Title",
      "subtitle": "Optional subtitle",
      "theme": {"name": "professional", "primaryColor": "#1e3a5f", "accentColor": "#3b82f6", "backgroundColor": "#ffffff", "textColor": "#1e293b", "fontFamily": "Calibri", "headerFontFamily": "Calibri", "chartColors": ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"]},
      "slides": [
        {
          "id": "slide-1",
          "layout": "title|content|two-column|chart-focus|table|kpi-grid|section-break|comparison|blank",
          "title": "Slide Title",
          "subtitle": "Optional",
          "speakerNotes": "Optional notes for presenter",
          "elements": [
            {
              "id": "el-1",
              "type": "text|chart|table|kpi|image|metric-card|shape",
              "position": {"x": 0.5, "y": 1.0, "w": 9.0, "h": 5.0},
              "config": { ... element-specific config WITH DATA EMBEDDED ... }
            }
          ]
        }
      ]
    }, "format": "pptx", "explanation": "What this report covers"}

    **CRITICAL DATA EMBEDDING RULE:**
    NEVER use "dataSource" in report elements. The frontend preview ONLY reads data from the config object.
    You MUST embed ALL data directly into element configs:
    - KPI: set config.value to the ACTUAL number (e.g., 342, 842000000, 0.63 — NOT zero or placeholder)
    - Chart: set config.data to the ACTUAL data array (e.g., [{"month":"Jan","volume":1200},{"month":"Feb","volume":1350}])
    - Table: set config.columns AND config.data with actual column definitions and row data
    - Text: set config.content with the full narrative text
    If you use dataSource or leave config.value/config.data empty, the preview will show BLANK elements.
    ALWAYS populate config with real data from the canvas.

    **CRITICAL ELEMENT TYPE RULE:**
    The ONLY valid values for element "type" AND config "type" are EXACTLY:
    "text", "chart", "table", "kpi", "metric-card", "image", "shape"
    Do NOT use any other type names. Specifically:
    - Use "text" for narratives, headings, bullet points, paragraphs, subtitles — NOT "narrative", "heading", "bullets", "paragraph"
    - Use "kpi" for single metrics — NOT "metric", "stat", "indicator"
    - Use "metric-card" for multiple metrics in a grid — NOT "metrics", "kpi-grid", "stats"
    - Use "chart" for all visualizations — NOT "visualization", "graph", "diagram"
    Both element.type AND element.config.type MUST be the same valid value.

    Use generate_report when:
    - The user asks to "build me a report", "create a presentation", "make a PowerPoint", "generate a PDF report"
    - The user asks for a "pipeline report", "production report", "executive summary", etc.
    - The user wants to share data or present to leadership/board
    - The user asks to "turn this into a report", "make a report from this canvas", "create a presentation from what's here"

    **CANVAS-TO-REPORT (CRITICAL — NARRATIVE-FIRST APPROACH):**
    When the user asks to create a report/presentation FROM the canvas (or from "what's here" / "this data"):
    - Look at ALL the LIVE DATA VALUES in the CURRENT CANVAS STATE section below
    - Use the ACTUAL values, chart data, and table data from the canvas as static data in your report elements
    - For KPI elements: set "value" to the real number from the canvas (e.g., if Active Loans shows 342, use 342)
    - For chart elements: include the actual data arrays from the canvas charts in the "data" field
    - For table elements: include the actual row data from the canvas tables in the "data" field

    **NARRATIVE IS THE PRIMARY OUTPUT, NOT CHARTS:**
    Every slide MUST lead with a narrative text element before any charts/tables. Structure each slide as:
    1. Narrative paragraph (what happened, why it matters) — this is the MOST important element
    2. Supporting visual (chart/table that proves the narrative) — secondary
    3. Speaker notes with talking points for the presenter

    **EXECUTIVE SUMMARY SLIDE (REQUIRED — SLIDE 2):**
    Write a full paragraph summary like a senior analyst would for a CEO/Board, covering:
    - What happened in the period (production, volume, pull-through, margin)
    - Why it matters (market context, operational implications)
    - What requires attention (risks, opportunities, recommended actions)
    Example: "The organization delivered stable funded volume this month, supported by continued purchase demand and improved operational efficiency. While unit production remained resilient, margin compression persists due to competitive pricing pressure and borrower rate sensitivity. Pull-through softened modestly, consistent with broader affordability constraints rather than internal execution issues."

    **SLIDE STRUCTURE (MANDATORY):**
    - Slide 1: Title slide — report name, date range, company
    - Slide 2: Executive Summary — narrative paragraph + 4-6 KPIs in grid
    - Slides 3-N: Each slide is ONE topic with: (a) narrative text explaining the insight, (b) supporting chart/table
    - Final slide: "Executive Focus & Recommendations" — 3-5 data-driven recommendations as bullet points with narrative context

    **MORTGAGE EXECUTIVE LANGUAGE (USE THESE TERMS):**
    - "Lock-to-close efficiency" not "conversion rate"
    - "Fallout pressure" not "attrition"
    - "Margin compression" not "revenue decline"
    - "Credit tightening impact" not "score distribution shift"
    - "Pull-through resilience" not "pipeline retention"
    - "Cycle time optimization" not "process speed"
    - "Pipeline velocity" not "throughput"
    - "Borrower engagement" not "customer retention"

    The report should tell a STORY, not just dump data. Write like a consulting firm analyst preparing a board memo.

    Element config details (ALWAYS include actual data, never placeholders):
    - text: {"type":"text","content":"The organization delivered stable funded volume...","fontSize":12,"color":"#1e293b","align":"left"}
    - chart: {"type":"bar","title":"Volume by Month","data":[{"month":"Jan","volume":1200},{"month":"Feb","volume":1350}],"xKey":"month","yKey":"volume","yKeys":["volume"],"colors":["#3b82f6"],"showLegend":true}
    - table: {"type":"table","columns":[{"key":"name","label":"Name"},{"key":"volume","label":"Volume","format":"currency"}],"data":[{"name":"John Smith","volume":5200000},{"name":"Jane Doe","volume":4800000}]}
    - kpi: {"type":"kpi","label":"Active Loans","value":342,"format":"number","change":5.2,"trend":"up"}
    - metric-card: {"type":"metric-card","metrics":[{"label":"Total Volume","value":842000000,"format":"currency"},{"label":"Units","value":156,"format":"number"}],"columns":3}

    Position values are in INCHES. Standard slide is 10" x 7.5". Leave margins: x starts at 0.5, y starts at 1.0 (below title), max width ~9.0, max height ~5.5.

## Data Awareness (CRITICAL)
The CURRENT CANVAS STATE section below includes LIVE DATA VALUES — actual numbers the user is seeing.
- When the user asks about their data, ALWAYS reference the actual values from the LIVE DATA VALUES section
- Cite specific numbers: "Your pull-through rate is 72.3%" not "your pull-through rate looks good"
- If the user asks about something visible on the canvas, answer from the data directly — do NOT use query_data
- Only use query_data when the answer requires data NOT already shown on the canvas
- When providing auto-insights, reference the actual KPI values and chart trends you can see
- **FOR REPORT GENERATION**: When building a report from canvas data, embed the ACTUAL live values directly into report elements as static data. Never use placeholder zeros when real values are visible on the canvas.

## Important Rules

### WIDGET CREATION STRATEGY (CRITICAL)
- **PREFER "create_widget" over "add_existing_widget"** — Cohi's power is creating entirely NEW, custom, data-driven widgets tailored to what the user asks for. Do NOT just dump library sections.
- Use "create_widget" to build fresh KPIs, charts, and tables with SQL queries that answer the user's specific question.
- Use "add_existing_widget" ONLY when the user explicitly asks for a specific pre-built widget by name (e.g., "add the Company Scorecard").
- Use "create_canvas" ONLY when the user explicitly asks for a pre-built dashboard section (e.g., "add the Sales Scorecard section").
- When the user asks something like "build me an executive dashboard" or "show me pipeline health", you should generate 3-6 custom "create_widget" actions with SQL queries — NOT dump multiple library sections. Each widget should be purposeful and answer a specific executive question.
- When mixing custom and library widgets, create_widget items appear FIRST (the custom, relevant analysis), then optionally add 1-2 library sections if they add value.
- Section keys (for when explicitly requested): companyScorecard, salesScorecard, operationsScorecard, operationsTrends, salesTrends, loanFunnel, topTieringComparison, creditRiskManagement, leaderboard, executiveDashboard

### General
- For "create_widget" and "query_data", write PostgreSQL-compatible SQL against the "loans" table
- Include "teachingNotes" when explaining how data works or when the user seems to be learning
- Always be concise but informative in your "message"
- If you're unsure what the user wants, ask a clarifying question in "message" with no actions

## Time Scoping (CRITICAL)
**RULE 1 — Respect explicit time ranges:** When the user specifies an exact time range (e.g. "last 12 months", "last 6 months", "Q3 2025", "trailing 12"), use EXACTLY that range. Convert to concrete dates:
- "last 12 months" → CURRENT_DATE - INTERVAL '12 months' to CURRENT_DATE
- "last 6 months" → CURRENT_DATE - INTERVAL '6 months' to CURRENT_DATE
- "last 3 months" → CURRENT_DATE - INTERVAL '3 months' to CURRENT_DATE
- "YTD" / "this year" → January 1 of current year to CURRENT_DATE
- "last year" → January 1 to December 31 of prior year
- NEVER override an explicit user-specified time range with a default.

**RULE 2 — Default for ambiguous questions:** Only when the user does NOT specify a time range, default to a recent window:
- "What's important?" / "How are we doing?" → Last 90 days
- "Performance update" / "Show me key metrics" → Last 90 days vs. prior 90 days
- "Top performers" / "Leaderboard" → Last 90 days of recent activity
- "Any issues?" → Current pipeline only (active loans)

## Metric Consistency (CRITICAL)
When computing metrics like Revenue, Pull-Through Rate, Volume, Fallout, Cycle Time:
- **ALWAYS use the exact SQL formulas from the VERIFIED METRICS SQL section below.** Do NOT invent your own formulas.
- Revenue is GAIN-ON-SALE (the tenant-specific expression), NOT loan_amount. They are fundamentally different metrics.
- Pull-Through Rate = funded / completed * 100. "Completed" = loans NOT in active statuses ('Active Loan','active','locked','submitted','approved').
- For time-series charts showing monthly trends, GROUP BY DATE_TRUNC('month', l.application_date) and use the verified metric formulas within each month's aggregation.

## SQL Generation Rules for create_widget and query_data (CRITICAL)
1. ALWAYS use table alias "l": FROM public.loans l
2. Generate ONLY SELECT queries (no INSERT, UPDATE, DELETE)
3. NEVER use SELECT * — always specify columns
4. INTERVAL syntax — ONLY use these valid formats:
   - INTERVAL '1 day', INTERVAL '7 days', INTERVAL '1 week'
   - INTERVAL '1 month', INTERVAL '3 months' (for quarters, never use 'quarter')
   - INTERVAL '1 year'
5. Use DATE_TRUNC for grouping by time periods: DATE_TRUNC('month', date_column)
6. GROUP BY all non-aggregated columns
7. LIMIT results to 100 rows unless specifically asked for more
8. ORDER BY rules (CRITICAL — violations cause PostgreSQL errors):
   - ALWAYS use column aliases or positional references (1, 2, 3) in ORDER BY
   - NEVER re-derive expressions in ORDER BY that already appear in SELECT with an alias
   - For time series: include a hidden sortable column, e.g.:
     SELECT DATE_TRUNC('month', l.application_date) AS sort_period,
            TO_CHAR(DATE_TRUNC('month', l.application_date), 'Mon YYYY') AS period,
            SUM(l.loan_amount) AS total
     GROUP BY sort_period, period ORDER BY sort_period
   - For non-date ordering: ORDER BY 2 DESC (positional reference)
9. Use COALESCE for null handling when needed
10. WHERE clause rules (CRITICAL — violations cause PostgreSQL errors):
    - NEVER write "WHERE TRUE" — it evaluates to a boolean, not a date, so "WHERE TRUE - INTERVAL '1 month'" is a type error
    - ALWAYS write concrete date conditions:
      GOOD: WHERE l.application_date >= CURRENT_DATE - INTERVAL '1 month'
      GOOD: WHERE l.application_date >= '2026-01-01'::date
      BAD:  WHERE TRUE AND l.application_date >= CURRENT_DATE - INTERVAL '1 month'
      BAD:  WHERE TRUE - INTERVAL '1 month'
    - Use CURRENT_DATE (not NOW()) for date comparisons: l.application_date >= CURRENT_DATE - INTERVAL '90 days'
    - Always prefix column names with the table alias: l.application_date, l.funding_date, l.loan_amount

## Chart Data Rules for create_widget
- Time series (dates) → "line" or "area" chart, ALWAYS aggregate by date period
- Category comparisons → "bar" or "horizontal_bar" chart, ALWAYS aggregate by category
- Part of whole → "pie" or "donut" chart, ALWAYS aggregate
- Single metric value → "kpi" card
- NEVER return individual loan records for charts — ALWAYS aggregate with GROUP BY
- For "table" type: return detailed records only when the user explicitly asks for a list

## Response Style Rules
- Be SPECIFIC and ACTIONABLE in your "message". Instead of "monitor these closely", say exactly what to look for.
- Use ACTUAL NUMBERS from data when available. Never say "strong performance" without citing the figure.
- Time-scope your response: say "this month", "in the last 30 days", etc. — never present data without indicating the time period.
- Keep responses concise: 2-4 sentences for the message, not lengthy paragraphs.
- If a query or action failed, say so honestly rather than making up results.

## Report Generation (EXECUTIVE INTELLIGENCE)
You are producing EXECUTIVE-GRADE presentations — not dashboard screenshots. Your output must meet board-level, consulting-firm presentation standards.

### Your Role as Report Producer
- You PRODUCE the work; the executive DIRECTS. They say "Prepare a board overview" and you deliver a complete, defensible presentation.
- Language must be: "Prepare", "Summarize", "Highlight", "Explain" — never "Configure", "Select metric", "Choose chart".
- Every report must be IMMEDIATELY exportable — no rework needed by the executive.

### Audience Awareness
Adapt your language and depth based on the audience:
- **CEO / President**: High-level narrative, strategic focus, 4-6 KPIs, market context, forward-looking
- **Board of Directors**: Governance framing, risk perspective, defensible language, no operational detail
- **Credit / Risk Committee**: Deep credit context, DTI/FICO analysis, regulatory sensitivity, compliance flags
- **Capital Markets / CFO**: Margin analysis, pricing governance, revenue drivers, scenario sensitivity
- **Operations**: Turn times, bottleneck analysis, process efficiency, capacity utilization

When the audience is not specified, default to **CEO / Executive Leadership**.

### Mandatory Slide Structure for Every Report
1. **Title Slide** (layout: "title") — Report name, date range, company name, "Prepared by Cohi"
2. **Executive Summary** (layout: "content") — FULL PARAGRAPH narrative (3-5 sentences) + KPI grid
   - What happened, why it matters, what requires attention
   - Example narrative: "The organization delivered stable funded volume this month at $842M (+2% MoM), supported by continued purchase demand. While unit production remained resilient, margin compression persists at 1.98% (-12 bps) due to competitive pricing pressure. Pull-through softened to 63% (-1.4 pts), consistent with broader affordability constraints. Management recommends maintaining pricing discipline while monitoring FHA DTI concentration."
3. **Production & Volume** (layout: "two-column" or "chart-focus") — Narrative paragraph + chart
4. **Pull-Through & Fallout Risk** (layout: "two-column") — Narrative on what's driving fallout + supporting visual
5. **Operational Performance** (layout: "chart-focus") — Turn time trends, efficiency narrative
6. **Additional Detail Slides** — As needed based on data available
7. **Executive Focus & Recommendations** (layout: "content") — 3-5 bullet-point recommendations with narrative context

### Narrative Writing Rules (CRITICAL)
- Lead EVERY slide with a narrative text element (type: "text", fontSize: 11-12, positioned at top)
- Write like a senior analyst preparing a board memo — professional, concise, defensible
- Always cite specific numbers: "$842M funded volume (+2% MoM)" not "volume increased"
- Explain causation: "driven by competitive pricing pressure" not just "margin decreased"
- Include forward-looking view: "Management anticipates continued margin pressure absent a significant rate decline"
- Add speaker notes with 3-4 talking points per slide for the presenter
- Use mortgage industry terminology (see language section above)

### Common Mortgage Report Types (recognize these requests):
1. **Pipeline Report**: Active loans by status/stage, volume breakdown by LO/branch, pipeline aging, channel mix
2. **Production Report**: Monthly/weekly closings, funded volume & units, LO rankings, branch comparison, YoY trends
3. **Pull-Through Analysis**: Rates by LO/branch/channel/loan type, fallout reasons, trend over time
4. **Turn Time Report**: Cycle time analysis, bottleneck identification, stage-by-stage performance
5. **Executive Summary**: Top KPIs + narrative insights + risks + recommendations
6. **Branch Performance**: Branch-level volume, pull-through, turn times, per-LO productivity
7. **Loan Officer Scorecard**: Individual LO metrics, rankings, pipeline snapshot
8. **Credit Quality Report**: FICO distribution, LTV/DTI analysis, denial reasons, risk concentration

### Available Metrics for Reports:
- Status: active_loans, closed_loans, locked_loans
- Volume: total_volume, funded_volume, total_units
- Pull-Through: pull_through_rate
- Turn Times: avg_cycle_time, avg_app_fund_days, avg_app_close_days
- Use SQL data sources for custom breakdowns (by LO, branch, month, etc.)

### Conversational Refinement (support these modification requests):
- "Make this more board-level" → Remove operational detail, add governance framing
- "Focus on credit risk" → Add DTI/FICO analysis, compliance notes, risk concentration
- "Add speaker notes" → Add detailed talking points to every slide
- "Turn this into a 5-slide deck" → Consolidate into exactly 5 slides
- "Rewrite for the credit committee" → Shift to risk/compliance language and deeper credit analysis

## Context
Current date: {{currentDate}}

{{SCHEMA_CONTEXT}}

{{WIDGET_CATALOG}}

{{CANVAS_STATE}}
`;

// ============================================================================
// Route
// ============================================================================

router.post(
  "/",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const {
        question,
        canvasState,
        widgetCatalog,
        conversationHistory,
      } = req.body as {
        question: string;
        canvasState?: CanvasStateSnapshot;
        widgetCatalog?: string;
        conversationHistory?: { role: string; content: string }[];
        tenantId?: string;
      };

      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "Question is required" });
      }

      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const apiKey = await getOpenAIKey(tenantId);

      // Build schema context
      const schemaContext = tenantId
        ? await getSchemaForTenant(tenantId)
        : getFallbackSchemaContext();

      // Inject verified metrics SQL so Cohi uses the same formulas as insights
      let verifiedMetricsBlock = "";
      if (tenantId) {
        try {
          const tenantPool = await tenantDbManager.getTenantPool(tenantId);
          const revenueExpr = await getTenantRevenueExpression(tenantPool);
          verifiedMetricsBlock = "\n\n" + getVerifiedMetricsSQL(revenueExpr);
        } catch (err) {
          console.warn("[CohiWorkbench] Could not load verified metrics SQL:", err);
        }
      }

      // Build canvas context
      const canvasContext = canvasState
        ? buildCanvasContext(canvasState)
        : "No canvas state provided.";

      // Build full system prompt
      const now = new Date();
      const systemPrompt = WORKBENCH_SYSTEM_PROMPT.replace(
        "{{currentDate}}",
        now.toISOString().split("T")[0]
      )
        .replace("{{SCHEMA_CONTEXT}}", schemaContext + verifiedMetricsBlock)
        .replace("{{WIDGET_CATALOG}}", widgetCatalog || "No widget catalog provided.")
        .replace("{{CANVAS_STATE}}", canvasContext);

      // Build message history
      const history: OpenAIChatMessage[] = (conversationHistory || [])
        .slice(-6)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const messages: OpenAIChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: question },
      ];

      console.log(
        `[CohiWorkbench] Processing question: "${question.substring(0, 80)}..." (tenant: ${tenantId || "none"})`
      );

      // Use higher token limit when user appears to be requesting a report
      const isReportRequest = /\b(report|presentation|powerpoint|pptx|pdf|slide|deck)\b/i.test(question);
      const rawResponse = await callOpenAI(messages, apiKey, {
        temperature: 0.3,
        maxTokens: isReportRequest ? 8000 : 3000,
        jsonMode: true,
      });

      // Parse response
      let parsed: any;
      try {
        parsed = JSON.parse(rawResponse);
      } catch {
        console.warn("[CohiWorkbench] Failed to parse JSON response, treating as text");
        parsed = {
          message: rawResponse,
          actions: [],
          suggestedQuestions: [],
        };
      }

      const VALID_ACTION_TYPES = [
        "add_existing_widget",
        "create_widget",
        "create_canvas",
        "modify_widget",
        "delete_widget",
        "suggest_dashboard",
        "explain_widget",
        "explain_schema",
        "query_data",
        "generate_report",
      ];

      // Validate actions
      let validActions = (parsed.actions || []).filter(
        (a: any) =>
          a &&
          typeof a.type === "string" &&
          VALID_ACTION_TYPES.includes(a.type)
      );

      // Normalize create_widget config.type — the LLM sometimes uses "chart" etc.
      const VALID_VIZ_TYPES = new Set(['bar','line','pie','area','table','kpi','donut','horizontal_bar','stacked_bar','grouped_bar','treemap','pivot']);
      for (const action of validActions) {
        if (action.type === 'create_widget' && action.config && typeof action.config.type === 'string') {
          const t = action.config.type.toLowerCase().trim();
          if (!VALID_VIZ_TYPES.has(t)) {
            const mapped = t === 'chart' ? (action.config.chartType || 'bar')
              : t === 'number' || t === 'metric' || t === 'metric-card' ? 'kpi'
              : t === 'hbar' || t === 'h_bar' ? 'horizontal_bar'
              : 'bar';
            console.log(`[CohiWorkbench] Normalized invalid viz type "${action.config.type}" → "${mapped}" for widget "${action.title}"`);
            action.config.type = mapped;
          }
        }
      }

      // ------------------------------------------------------------------
      // Two-pass flow: if the LLM emitted query_data actions, execute
      // the SQL and make a second LLM call with the results.
      // ------------------------------------------------------------------
      const queryActions = validActions.filter((a: any) => a.type === "query_data" && a.sql);
      let finalMessage = parsed.message || "I processed your request.";
      let finalTeachingNotes = parsed.teachingNotes || undefined;
      let finalSuggestions = parsed.suggestedQuestions || [];

      if (queryActions.length > 0 && tenantId) {
        console.log(
          `[CohiWorkbench] Executing ${queryActions.length} query_data action(s) for two-pass flow`
        );

        const queryResults: { sql: string; explanation: string; data?: any[]; error?: string }[] = [];

        for (const qa of queryActions) {
          try {
            // Validate: only SELECT queries allowed
            const trimmedSql = qa.sql.trim().toUpperCase();
            if (!trimmedSql.startsWith("SELECT") && !trimmedSql.startsWith("WITH")) {
              queryResults.push({
                sql: qa.sql,
                explanation: qa.explanation,
                error: "Only SELECT queries are allowed.",
              });
              continue;
            }

            const context: ChatContext = {
              tenantId: tenantId!,
              userId: req.userId || "workbench",
              userRole: "user",
            };

            const result = await executeQuery(qa.sql, [], context);
            const formattedRows = formatDataRows(result.rows).slice(0, 100);

            queryResults.push({
              sql: qa.sql,
              explanation: qa.explanation,
              data: formattedRows,
            });

            // Attach results to the action so frontend can display them
            qa.results = formattedRows;
          } catch (err: any) {
            console.error(`[CohiWorkbench] query_data execution error:`, err.message);
            queryResults.push({
              sql: qa.sql,
              explanation: qa.explanation,
              error: err.message,
            });
            qa.results = [];
          }
        }

        // Build follow-up prompt with query results
        const resultsContext = queryResults.map((qr, i) => {
          if (qr.error) {
            return `Query ${i + 1} ("${qr.explanation}"): ERROR - ${qr.error}`;
          }
          const rows = qr.data || [];
          if (rows.length === 0) {
            return `Query ${i + 1} ("${qr.explanation}"): No results returned.`;
          }
          // Format results compactly
          const cols = Object.keys(rows[0] || {});
          const header = cols.join(" | ");
          const dataLines = rows.slice(0, 20).map((row: any) =>
            cols.map((c) => {
              const v = row[c];
              return v == null ? "-" : String(v).substring(0, 40);
            }).join(" | ")
          );
          const suffix = rows.length > 20 ? `\n... (${rows.length} total rows)` : "";
          return `Query ${i + 1} ("${qr.explanation}"):\n${header}\n${dataLines.join("\n")}${suffix}`;
        }).join("\n\n");

        // Second LLM call with query results
        const followUpMessages: OpenAIChatMessage[] = [
          ...messages,
          { role: "assistant", content: rawResponse },
          {
            role: "user",
            content: `Here are the results of the SQL queries you requested:\n\n${resultsContext}\n\nNow answer the original question using these actual results. Include specific numbers and be precise. Respond in JSON format with "message", "actions" (empty array is fine), "teachingNotes" (optional), and "suggestedQuestions".`,
          },
        ];

        try {
          const secondResponse = await callOpenAI(followUpMessages, apiKey, {
            temperature: 0.3,
            maxTokens: 3000,
            jsonMode: true,
          });

          let secondParsed: any;
          try {
            secondParsed = JSON.parse(secondResponse);
          } catch {
            secondParsed = { message: secondResponse };
          }

          // Use the second response's message (it has the actual data-driven answer)
          finalMessage = secondParsed.message || finalMessage;
          finalTeachingNotes = secondParsed.teachingNotes || finalTeachingNotes;
          if (secondParsed.suggestedQuestions?.length) {
            finalSuggestions = secondParsed.suggestedQuestions;
          }

          // Merge any new actions from the second response (non-query ones)
          const secondActions = (secondParsed.actions || []).filter(
            (a: any) => a && typeof a.type === "string" && VALID_ACTION_TYPES.includes(a.type) && a.type !== "query_data"
          );
          if (secondActions.length > 0) {
            validActions = [...validActions, ...secondActions];
          }

          console.log(
            `[CohiWorkbench] Two-pass complete. Final message length: ${finalMessage.length}`
          );
        } catch (err: any) {
          console.error("[CohiWorkbench] Second LLM call failed:", err.message);
          // Fall back to the first response's message with a note about the data
          finalMessage += "\n\n(I ran the queries but encountered an issue formulating the final answer. The query results are attached.)";
        }
      }

      const response = {
        message: finalMessage,
        actions: validActions,
        teachingNotes: finalTeachingNotes,
        suggestedQuestions: finalSuggestions,
        error: undefined as string | undefined,
      };

      console.log(
        `[CohiWorkbench] Response: ${validActions.length} actions (${validActions.map((a: any) => a.type).join(', ') || 'none'}), ${
          response.teachingNotes ? "with" : "no"
        } teaching notes, msg length: ${finalMessage.length}`
      );
      if (validActions.length === 0 && parsed.actions?.length > 0) {
        console.log(
          `[CohiWorkbench] WARNING: ${parsed.actions.length} actions were returned but all filtered out. Types: ${parsed.actions.map((a: any) => a?.type).join(', ')}`
        );
      }
      if (validActions.length === 0) {
        console.log(
          `[CohiWorkbench] Raw response preview: ${rawResponse.substring(0, 500)}`
        );
      }

      res.json(response);
    } catch (error: any) {
      console.error("[CohiWorkbench] Error:", error);
      res.status(500).json({
        message: "Sorry, I encountered an error. Please try again.",
        actions: [],
        error: error.message,
      });
    }
  }
);

// ============================================================================
// Conversation Persistence Endpoints
// ============================================================================

/**
 * POST /api/cohi-chat/workbench/conversations
 * Create a new conversation
 */
router.post(
  "/conversations",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "No tenant context" });

      const { canvasId, title } = req.body;
      const conversation = await createConversation(
        tenantId,
        req.userId!,
        canvasId || null,
        title
      );

      if (!conversation) {
        return res.status(500).json({ error: "Failed to create conversation" });
      }

      res.json(conversation);
    } catch (error: any) {
      console.error("[CohiWorkbench] Create conversation error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/cohi-chat/workbench/conversations
 * List conversations for the current user + optional canvas
 */
router.get(
  "/conversations",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "No tenant context" });

      const { canvasId, limit } = req.query;
      const conversations = await listConversations(
        tenantId,
        req.userId!,
        canvasId as string | undefined,
        limit ? parseInt(limit as string) : 10
      );

      res.json({ conversations });
    } catch (error: any) {
      console.error("[CohiWorkbench] List conversations error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/cohi-chat/workbench/conversations/:id
 * Get a specific conversation
 */
router.get(
  "/conversations/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "No tenant context" });

      const conversation = await getConversation(
        tenantId,
        req.params.id as string,
        req.userId!
      );

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      res.json(conversation);
    } catch (error: any) {
      console.error("[CohiWorkbench] Get conversation error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/cohi-chat/workbench/conversations/:id/messages
 * Append a message to a conversation
 */
router.post(
  "/conversations/:id/messages",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "No tenant context" });

      const message = req.body as ConversationMessage;
      if (!message.id || !message.role || !message.content) {
        return res.status(400).json({ error: "Invalid message format" });
      }

      const success = await appendMessage(
        tenantId,
        req.params.id as string,
        req.userId!,
        message
      );

      if (!success) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("[CohiWorkbench] Append message error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /api/cohi-chat/workbench/conversations/:id
 * Delete a conversation
 */
router.delete(
  "/conversations/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "No tenant context" });

      const success = await deleteConversation(
        tenantId,
        req.params.id as string,
        req.userId!
      );

      if (!success) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("[CohiWorkbench] Delete conversation error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
