/**
 * Data Chat Service
 * AI-powered natural language interface for querying loan data
 * Generates SQL queries, executes them, and creates visualization configs
 */

import pg from "pg";
import {
  METRICS_CATALOG,
  MetricDefinition,
} from "../metrics/metricsService.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { decryptAPIKeys } from "../encryption.js";
import { generateEmbeddings } from "../embeddingService.js";

// ============================================================================
// Types
// ============================================================================

export interface ChatContext {
  userId: string;
  tenantId: string;
  userRole: string;
  userEmail?: string;
  permissions?: UserPermissions;
}

export interface UserPermissions {
  sectionAccess: string[];
  rowFilters: RowFilter[];
  fieldRestrictions: string[];
}

export interface RowFilter {
  field: string;
  operator: "equals" | "in" | "not_in" | "contains" | "is_current_user";
  value?: string | string[];
  dynamicSource?: string;
}

export interface DataChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  visualization?: VisualizationConfig;
  data?: any[];
  timestamp: Date;
  metadata?: {
    query?: string;
    executionTime?: number;
    rowCount?: number;
  };
}

export interface VisualizationConfig {
  type:
    | "bar"
    | "line"
    | "pie"
    | "area"
    | "table"
    | "kpi"
    | "donut"
    | "horizontal_bar";
  title: string;
  data: any[];
  xKey?: string;
  yKey?: string;
  yKeys?: string[]; // For multi-series charts
  xLabel?: string; // Human-readable X-axis label
  yLabel?: string; // Human-readable Y-axis label
  nameKey?: string; // For pie charts
  valueKey?: string; // For pie charts
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
  kpiConfig?: {
    value: number | string;
    label: string;
    change?: number;
    changeLabel?: string;
    format?: "number" | "currency" | "percent";
  };
  tableConfig?: {
    columns: { key: string; label: string; format?: string }[];
    sortable?: boolean;
    pageSize?: number;
  };
}

export interface DataChatResponse {
  message: string;
  visualization?: VisualizationConfig;
  data?: any[];
  suggestedQuestions?: string[];
  error?: string;
  /** Metric IDs from METRICS_CATALOG that were used in this query */
  metricsUsed?: string[];
}

export interface QueryResult {
  rows: any[];
  rowCount: number;
  fields: string[];
}

// ============================================================================
// Schema Context
// ============================================================================

const LOAN_SCHEMA_CONTEXT = `
## Available Loan Fields (Columns in loans table)

### Core Fields
- loan_id (TEXT): Unique loan identifier
- loan_number (TEXT): Loan number
- loan_amount (DECIMAL): Total loan amount
- loan_type (TEXT): Type of loan (Conventional, FHA, VA, USDA, FarmersHomeA, etc.)
- loan_purpose (TEXT): Purpose (Purchase, Refinance, Cash-Out Refinance)
- loan_program (TEXT): Loan program name
- current_loan_status (TEXT): Current status (e.g., 'Active Loan', 'Originated', 'Withdrawn', 'Denied')
- current_milestone (TEXT): Current milestone in pipeline
- channel (TEXT): Channel (Retail, Wholesale, Correspondent, TPO)

### Personnel Fields
- loan_officer (TEXT): Loan officer name
- loan_officer_id (TEXT): Loan officer ID
- processor (TEXT): Processor name
- underwriter (TEXT): Underwriter name
- closer (TEXT): Closer name
- branch (TEXT): Branch name/code

### Property Fields
- property_city (TEXT): Property city
- property_state (TEXT): Property state (2-letter code)
- property_county (TEXT): Property county
- property_type (TEXT): Property type (Single Family, Condo, etc.)
- occupancy_type (TEXT): Occupancy type (Primary, Investment, Second Home)

### Financial Fields (Raw Columns)
- interest_rate (DECIMAL): Interest rate percentage
- cltv (DECIMAL): Combined loan-to-value ratio
- ltv_ratio (DECIMAL): Loan-to-value ratio
- be_dti_ratio (DECIMAL): Back-end debt-to-income ratio
- fico_score (INTEGER): Credit score
- rate_lock_buy_side_base_price_rate (DECIMAL): Base buy rate (used for revenue calc)
- orig_fee_borr_pd (DECIMAL): Origination fee paid by borrower
- orig_fees_seller (DECIMAL): Origination fees from seller
- cd_lender_credits (DECIMAL): Lender credits on closing disclosure

### Key Dates
- application_date (DATE): Application date
- started_date (DATE): Started date
- lock_date (DATE): Rate lock date
- closing_date (DATE): Closing date
- funding_date (DATE): Funding date
- investor_purchase_date (DATE): Investor purchase date
- credit_pull_date (DATE): Credit pull date

## CALCULATED METRICS (NOT columns - must be computed)

IMPORTANT: These are NOT columns. You must use the formulas below to calculate them.

### Revenue (per loan)
Formula: Base Buy ($) + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits
SQL:
COALESCE(
  CASE 
    WHEN rate_lock_buy_side_base_price_rate IS NOT NULL AND rate_lock_buy_side_base_price_rate != 0 
    THEN ROUND(((rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * loan_amount, 2)
    ELSE 0 
  END, 0) +
COALESCE(orig_fee_borr_pd, 0) + 
COALESCE(orig_fees_seller, 0) - 
COALESCE(cd_lender_credits, 0)

Example: Top 10 loan officers by revenue
SELECT 
  loan_officer,
  COUNT(*) as loan_count,
  SUM(loan_amount) as total_volume,
  SUM(
    COALESCE(CASE WHEN rate_lock_buy_side_base_price_rate IS NOT NULL AND rate_lock_buy_side_base_price_rate != 0 
      THEN ROUND(((rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * loan_amount, 2) ELSE 0 END, 0) +
    COALESCE(orig_fee_borr_pd, 0) + COALESCE(orig_fees_seller, 0) - COALESCE(cd_lender_credits, 0)
  ) as total_revenue
FROM loans
WHERE loan_officer IS NOT NULL
GROUP BY loan_officer
ORDER BY total_revenue DESC
LIMIT 10

### Active Loans (current pipeline)
Definition: Loans with current_loan_status = 'Active Loan' AND application_date IS NOT NULL
This is a CURRENT STATE metric - do NOT filter by date range.
SQL: WHERE current_loan_status = 'Active Loan' AND application_date IS NOT NULL

### Funded/Closed Loans
Definition: Loans where funding_date IS NOT NULL
SQL: WHERE funding_date IS NOT NULL

### Originated Loans (Pull Through Originated Flag = Yes)
Definition: current_loan_status contains 'Originated' or 'purchased'
SQL: WHERE current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%'

### Pull-Through Rate
Formula: (Originated loans / Total applications excluding active) * 100
Only include loans that have completed their journey (not active)
SQL:
COUNT(CASE WHEN current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%' THEN 1 END)::float /
NULLIF(COUNT(CASE WHEN current_loan_status != 'Active Loan' AND application_date IS NOT NULL THEN 1 END), 0) * 100

### Cycle Time (days)
Formula: Days from application to closing (or funding if no closing)
SQL: 
CASE 
  WHEN closing_date IS NOT NULL AND application_date IS NOT NULL 
  THEN DATE(closing_date) - DATE(application_date) 
  WHEN funding_date IS NOT NULL AND application_date IS NOT NULL 
  THEN DATE(funding_date) - DATE(application_date)
  ELSE NULL 
END

### Government Loans
Definition: loan_type IN ('FHA', 'VA', 'USDA', 'FarmersHomeA', 'FarmersHomeAdministration')

### Withdrawn/Fallout
Definition: current_loan_status contains 'withdraw', 'not accepted', or 'incomp'
SQL: WHERE current_loan_status ILIKE '%withdraw%' OR current_loan_status ILIKE '%not accepted%' OR current_loan_status ILIKE '%incomp%'

### Denied
Definition: current_loan_status contains 'denied'
SQL: WHERE current_loan_status ILIKE '%denied%'

## Status Indicators (Quick Reference)
- Funded: funding_date IS NOT NULL
- Active: current_loan_status = 'Active Loan'
- Locked: lock_date IS NOT NULL
- Originated: current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%'
`;

// ============================================================================
// OpenAI Integration
// ============================================================================

async function getOpenAIKey(tenantId?: string): Promise<string> {
  if (tenantId) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

      // Check for rag_settings table in tenant database
      // (each tenant has their own database with rag_settings table - no tenant_id column)
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
          console.log(
            "[DataChat] Found openai_api_key in rag_settings, attempting to decrypt..."
          );
          const decrypted = await decryptAPIKeys({
            openai_api_key: result.rows[0].openai_api_key,
          });
          if (decrypted.openai_api_key) {
            console.log(
              "[DataChat] Using tenant OpenAI API key from rag_settings"
            );
            return decrypted.openai_api_key;
          }
        } else {
          console.log(
            "[DataChat] rag_settings exists but openai_api_key is null/empty"
          );
        }
      } else {
        console.log(
          "[DataChat] rag_settings table does not exist in tenant database"
        );
      }
    } catch (error: any) {
      console.error("[DataChat] Error fetching tenant API key:", error.message);
    }
  }

  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    console.log("[DataChat] Using environment OpenAI API key");
    return envKey;
  }

  throw new Error(
    "OpenAI API key not configured. Please add your OpenAI API key in Admin > Settings > RAG Settings, or set OPENAI_API_KEY environment variable on the server."
  );
}

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callOpenAI(
  messages: OpenAIChatMessage[],
  apiKey: string,
  options: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const body: any = {
    model: "gpt-4o",
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2000,
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
    const error = (await response.json()) as { error?: { message?: string } };
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
// Metric Detection
// ============================================================================

/**
 * Detects which metrics from METRICS_CATALOG were used or referenced in a query/response.
 * Checks both the SQL query and the question text for metric references.
 */
function detectMetricsUsed(sql: string, question: string): string[] {
  const metricsUsed: Set<string> = new Set();
  const lowerSql = sql.toLowerCase();
  const lowerQuestion = question.toLowerCase();

  // Check each metric in the catalog
  for (const metric of Object.values(METRICS_CATALOG)) {
    const metricId = metric.id.toLowerCase();
    const metricName = metric.name.toLowerCase();

    // Check if metric ID or name is mentioned in question
    if (
      lowerQuestion.includes(metricId.replace(/_/g, " ")) ||
      lowerQuestion.includes(metricName)
    ) {
      metricsUsed.add(metric.id);
    }

    // Check if the SQL query uses patterns similar to the metric's SQL
    // This is a heuristic - we look for key patterns in the metric's SQL
    if (metric.sqlQuery) {
      const sqlPatterns = extractKeyPatterns(metric.sqlQuery);
      for (const pattern of sqlPatterns) {
        if (lowerSql.includes(pattern.toLowerCase())) {
          metricsUsed.add(metric.id);
          break;
        }
      }
    }
  }

  return Array.from(metricsUsed);
}

/**
 * Extracts key patterns from a metric's SQL query for matching.
 * Returns distinguishing parts like aggregate functions, specific field combinations.
 */
function extractKeyPatterns(sqlQuery: string): string[] {
  const patterns: string[] = [];

  // Extract aggregate patterns like AVG(...), SUM(...), COUNT(...)
  const aggregateMatch = sqlQuery.match(
    /(AVG|SUM|COUNT|MAX|MIN)\s*\([^)]+\)/gi
  );
  if (aggregateMatch) {
    patterns.push(...aggregateMatch.map((m) => m.replace(/\s+/g, "")));
  }

  // Extract CASE WHEN patterns (simplified)
  if (sqlQuery.includes("CASE") && sqlQuery.includes("WHEN")) {
    // Look for the condition in the CASE
    const caseMatch = sqlQuery.match(/WHEN\s+[^T][^\n]+?\s+THEN/gi);
    if (caseMatch && caseMatch[0]) {
      patterns.push(caseMatch[0].substring(0, 50));
    }
  }

  return patterns.filter((p) => p.length > 5);
}

// ============================================================================
// Query Generation
// ============================================================================

interface GeneratedQuery {
  sql: string;
  params: any[];
  explanation: string;
  visualizationType: VisualizationConfig["type"];
  chartConfig: Partial<VisualizationConfig>;
}

async function generateQuery(
  question: string,
  context: ChatContext,
  conversationHistory: DataChatMessage[] = []
): Promise<GeneratedQuery> {
  const apiKey = await getOpenAIKey(context.tenantId);

  // Build metrics context with SQL implementations
  // This allows the LLM to use the exact SQL from METRICS_CATALOG when appropriate
  const metricsContext = Object.values(METRICS_CATALOG)
    .map((m) => {
      const sqlHint = m.sqlQuery
        ? `\n    SQL: ${m.sqlQuery
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 200)}${m.sqlQuery.length > 200 ? "..." : ""}`
        : "";
      return `- ${m.name} (${m.id}): ${m.description}${sqlHint}`;
    })
    .join("\n");

  // Get current date for context
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentQuarter = Math.ceil(currentMonth / 3);

  const systemPrompt = `You are Cohi, an expert data analyst assistant for mortgage lending companies. You convert natural language questions about loan data into PostgreSQL queries and provide clear explanations.

## Your Personality
- Be helpful, concise, and professional
- When the question is ambiguous, make reasonable assumptions and state them in your explanation
- If a question seems to be asking for insights rather than raw data, provide a relevant data query that supports the insight

${LOAN_SCHEMA_CONTEXT}

## Available Metrics
${metricsContext}

## Current Date Context
- Today: ${now.toISOString().split("T")[0]}
- Current Year: ${currentYear}
- Current Month: ${currentMonth}
- Current Quarter: Q${currentQuarter}

## Handling Ambiguous Questions
- "How are we doing?" → Show monthly loan volume trend to indicate business health
- "Any issues?" → Show loans stuck in processing or with high LTV
- "Performance update" → Show key metrics like total volume, count, average amount
- When in doubt, provide aggregate metrics that give a high-level view

## PostgreSQL Syntax Rules (IMPORTANT)
1. ALWAYS use table alias "l" for the loans table: FROM public.loans l
2. Generate ONLY SELECT queries (no INSERT, UPDATE, DELETE)
3. CALCULATED METRICS MUST USE FORMULAS - these are NOT columns:
   - "revenue" or "total_revenue" → Use the formula from CALCULATED METRICS section above
   - "active_loans" → Use WHERE current_loan_status = 'Active Loan' AND application_date IS NOT NULL
   - "pull_through_rate" → Calculate using the formula, never use as a column
   - "cycle_time" → Calculate: DATE(closing_date) - DATE(application_date)
   NEVER reference these as column names - they don't exist in the table!
4. INTERVAL syntax - ONLY use these valid formats:
   - INTERVAL '1 day', INTERVAL '7 days'
   - INTERVAL '1 week', INTERVAL '2 weeks'
   - INTERVAL '1 month', INTERVAL '3 months' (for quarters)
   - INTERVAL '1 year', INTERVAL '2 years'
   - NEVER use 'quarter' in intervals - use '3 months' instead
5. Date comparisons for common periods:
   - Last quarter: WHERE date_column >= DATE_TRUNC('quarter', CURRENT_DATE - INTERVAL '3 months')
   - This year: WHERE EXTRACT(YEAR FROM date_column) = ${currentYear}
   - Last 30 days: WHERE date_column >= CURRENT_DATE - INTERVAL '30 days'
   - This quarter: WHERE date_column >= DATE_TRUNC('quarter', CURRENT_DATE)
6. Use DATE_TRUNC for grouping: DATE_TRUNC('month', date_column)
7. For counts, use COUNT(*) or COUNT(DISTINCT field)
8. Group by all non-aggregated columns
9. Limit results to 100 rows unless specifically asked for more
10. Order results meaningfully (by count DESC, by date, etc.)
11. Use COALESCE for null handling when needed

## Visualization Selection & Data Aggregation Rules (CRITICAL)
- Time series (dates) → "line" or "area" chart, ALWAYS aggregate by date period (day, week, month, quarter, year)
- Category comparisons → "bar" chart (vertical) or "horizontal_bar" (for 5+ categories), ALWAYS aggregate by category
- Part of whole (proportions) → "pie" or "donut" chart, ALWAYS aggregate
- Single metric value → "kpi" card
- Detailed individual records → "table" ONLY when user explicitly asks for a list of individual loans/records

## IMPORTANT: Chart Data Rules
1. For bar/line/area/pie charts, NEVER return individual loan records - ALWAYS aggregate with GROUP BY
2. When user asks for "by date" or "by month" or time-based charts:
   - Use DATE_TRUNC to group AND TO_CHAR to format for display
   - Aggregate values: SUM(loan_amount), COUNT(*), AVG(interest_rate), etc.
3. DATE FORMATTING IS CRITICAL - always format dates for human readability:
   - Daily: TO_CHAR(DATE_TRUNC('day', date_col), 'Mon DD') AS period  → "Jan 15"
   - Weekly: TO_CHAR(DATE_TRUNC('week', date_col), '"Week of" Mon DD') AS period  → "Week of Jan 12"
   - Monthly: TO_CHAR(DATE_TRUNC('month', date_col), 'Mon YYYY') AS period  → "Jan 2026"
   - Quarterly: 'Q' || EXTRACT(QUARTER FROM date_col) || ' ' || EXTRACT(YEAR FROM date_col) AS period  → "Q1 2026"
   - Yearly: EXTRACT(YEAR FROM date_col)::TEXT AS period  → "2026"
   NEVER return raw timestamps like "2026-01-19T00:00:00.000Z" - always use TO_CHAR!
4. When user asks for "by branch" or "by loan_officer" or category-based charts:
   - Group by the category field
   - Aggregate the metric (usually COUNT or SUM)
5. Maximum 50 data points for charts (use LIMIT or broader date grouping)
6. If user asks to see individual loans as a chart, suggest using a table instead or ask for clarification

## Response Format
Respond with a JSON object:
{
  "sql": "SELECT ... FROM public.loans l WHERE ... GROUP BY ... ORDER BY ...",
  "params": [],
  "explanation": "Brief explanation of what this query does",
  "visualizationType": "bar|line|pie|area|table|kpi|donut|horizontal_bar",
  "chartConfig": {
    "title": "Descriptive chart title",
    "xKey": "column name for x-axis (the category/date column)",
    "yKey": "column name for y-axis (the aggregated value)",
    "xLabel": "Human-readable X-axis label (e.g., 'Application Month', 'Branch')",
    "yLabel": "Human-readable Y-axis label (e.g., 'Total Loan Amount', 'Number of Loans')",
    "nameKey": "for pie charts - category column",
    "valueKey": "for pie charts - value column"
  }
}`;

  // Build conversation context
  const recentHistory = conversationHistory.slice(-4).map((msg) => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));

  const messages: OpenAIChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory,
    { role: "user", content: question },
  ];

  const response = await callOpenAI(messages, apiKey, {
    temperature: 0.2,
    jsonMode: true,
    maxTokens: 1500,
  });

  try {
    const parsed = JSON.parse(response);
    return {
      sql: parsed.sql,
      params: parsed.params || [],
      explanation: parsed.explanation,
      visualizationType: parsed.visualizationType || "table",
      chartConfig: parsed.chartConfig || {},
    };
  } catch (error) {
    throw new Error("Failed to parse query generation response");
  }
}

// ============================================================================
// Query Sanitization
// ============================================================================

/**
 * Fix common SQL mistakes generated by the AI
 */
function sanitizeGeneratedSQL(sql: string): string {
  let sanitized = sql;

  // Fix invalid interval syntax - 'X quarter(s)' -> 'X*3 months'
  sanitized = sanitized.replace(
    /INTERVAL\s*'(\d+)\s*quarters?'/gi,
    (_, num) => `INTERVAL '${parseInt(num) * 3} months'`
  );

  // Fix '1 quarter' -> '3 months'
  sanitized = sanitized.replace(
    /INTERVAL\s*'1\s*quarter'/gi,
    `INTERVAL '3 months'`
  );

  // Fix potential double quotes around identifiers that should be single
  // But be careful not to break string literals
  sanitized = sanitized.replace(/INTERVAL\s*"([^"]+)"/gi, `INTERVAL '$1'`);

  // Ensure proper spacing around operators
  sanitized = sanitized.replace(/\s{2,}/g, " ");

  return sanitized.trim();
}

// ============================================================================
// Query Execution
// ============================================================================

async function executeQuery(
  sql: string,
  params: any[],
  context: ChatContext
): Promise<QueryResult> {
  // Sanitize the SQL first to fix common AI mistakes
  const sanitizedSql = sanitizeGeneratedSQL(sql);

  // Validate SQL is read-only
  const normalizedSql = sanitizedSql.trim().toUpperCase();
  if (!normalizedSql.startsWith("SELECT")) {
    throw new Error("Only SELECT queries are allowed");
  }

  // Check for dangerous keywords
  const dangerousKeywords = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "TRUNCATE",
    "ALTER",
    "CREATE",
    "GRANT",
    "REVOKE",
  ];
  for (const keyword of dangerousKeywords) {
    if (
      normalizedSql.includes(keyword + " ") ||
      normalizedSql.includes(keyword + "\n")
    ) {
      throw new Error(`Query contains forbidden keyword: ${keyword}`);
    }
  }

  const pool = await tenantDbManager.getTenantPool(context.tenantId);

  const startTime = Date.now();
  console.log(`[DataChat] Executing sanitized SQL: ${sanitizedSql}`);
  const result = await pool.query(sanitizedSql, params);
  const executionTime = Date.now() - startTime;

  console.log(
    `[DataChat] Query executed in ${executionTime}ms, returned ${result.rows.length} rows`
  );

  return {
    rows: result.rows,
    rowCount: result.rows.length,
    fields:
      result.fields?.map((f) => f.name) || Object.keys(result.rows[0] || {}),
  };
}

// ============================================================================
// Visualization Generation
// ============================================================================

function buildVisualizationConfig(
  data: any[],
  queryConfig: GeneratedQuery
): VisualizationConfig {
  const chartConfig = queryConfig.chartConfig as any;

  // Helper to create human-readable label from key
  const humanize = (key: string): string =>
    key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const baseConfig: VisualizationConfig = {
    type: queryConfig.visualizationType,
    title: chartConfig.title || "Query Results",
    data,
    showLegend: true,
    showGrid: true,
  };

  switch (queryConfig.visualizationType) {
    case "bar":
    case "horizontal_bar":
    case "line":
    case "area":
      const xKey = chartConfig.xKey || Object.keys(data[0] || {})[0];
      const yKey = chartConfig.yKey || Object.keys(data[0] || {})[1];
      return {
        ...baseConfig,
        xKey,
        yKey,
        yKeys: chartConfig.yKeys,
        xLabel: chartConfig.xLabel || humanize(xKey),
        yLabel: chartConfig.yLabel || humanize(yKey),
        colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
      };

    case "pie":
    case "donut":
      return {
        ...baseConfig,
        nameKey: chartConfig.nameKey || Object.keys(data[0] || {})[0],
        valueKey: chartConfig.valueKey || Object.keys(data[0] || {})[1],
        colors: [
          "#3b82f6",
          "#10b981",
          "#f59e0b",
          "#ef4444",
          "#8b5cf6",
          "#ec4899",
          "#14b8a6",
        ],
      };

    case "kpi":
      const firstRow = data[0] || {};
      const kpiValueKey = Object.keys(firstRow)[0];
      return {
        ...baseConfig,
        kpiConfig: {
          value: firstRow[kpiValueKey],
          label: chartConfig.title || humanize(kpiValueKey),
          format:
            typeof firstRow[kpiValueKey] === "number" &&
            firstRow[kpiValueKey] > 1000
              ? "currency"
              : "number",
        },
      };

    case "table":
    default:
      const columns = Object.keys(data[0] || {}).map((key) => ({
        key,
        label: humanize(key),
        format: undefined,
      }));
      return {
        ...baseConfig,
        tableConfig: {
          columns,
          sortable: true,
          pageSize: 10,
        },
      };
  }
}

// ============================================================================
// Suggested Questions
// ============================================================================

function generateSuggestedQuestions(currentQuestion: string): string[] {
  const q = currentQuestion.toLowerCase();

  // Context-aware suggestions based on current question topic
  const suggestionsByTopic: Record<string, string[]> = {
    volume: [
      "Break down volume by loan type",
      "Show volume trend by quarter",
      "Top 5 branches by volume",
      "Compare this month vs last month",
    ],
    branch: [
      "Which branch has the highest revenue?",
      "Average loan amount by branch",
      "Branch performance trend this year",
      "Loan count by branch and status",
    ],
    officer: [
      "Loan officers with fastest cycle time",
      "Bottom 10 loan officers by volume",
      "Average revenue per loan officer",
      "New loan officers this quarter",
    ],
    trend: [
      "Compare quarterly trends",
      "Show weekly funding volume",
      "Year-over-year comparison",
      "Pipeline trend by month",
    ],
    default: [
      "Show me loan volume by month",
      "Top 10 loan officers by revenue",
      "Loans by branch this year",
      "Average loan amount by loan type",
      "Funding trends this quarter",
      "Pipeline breakdown by status",
      "Cycle time by loan type",
      "Loans by property state",
    ],
  };

  // Determine topic based on current question
  let topic = "default";
  if (/volume|amount|total/i.test(q)) topic = "volume";
  else if (/branch/i.test(q)) topic = "branch";
  else if (/officer|lo |loan officer/i.test(q)) topic = "officer";
  else if (/trend|time|month|week|year/i.test(q)) topic = "trend";

  const topicSuggestions = suggestionsByTopic[topic];
  const defaultSuggestions = suggestionsByTopic.default;

  // Mix topic-specific and default suggestions
  const allSuggestions = [...topicSuggestions, ...defaultSuggestions];

  // Filter out the current question and return 4 suggestions
  return allSuggestions
    .filter((s) => s.toLowerCase() !== currentQuestion.toLowerCase())
    .filter((s, i, arr) => arr.indexOf(s) === i) // Remove duplicates
    .sort(() => Math.random() - 0.5)
    .slice(0, 4);
}

// ============================================================================
// Question Classification & Smart Routing
// ============================================================================

interface QuestionClassification {
  type:
    | "data_query"
    | "insights"
    | "help"
    | "greeting"
    | "unclear"
    | "knowledge_query"
    | "hybrid";
  confidence: number;
  suggestedRephrase?: string;
}

interface RAGContext {
  chunks: string[];
  sources: string[];
  totalChunks: number;
}

/**
 * Retrieve relevant context from the knowledge base using RAG
 * Searches the tenant's rag_embeddings table (includes both global and tenant docs)
 */
async function retrieveRAGContext(
  tenantId: string,
  question: string,
  topK: number = 5,
  similarityThreshold: number = 0.35 // Lowered from 0.7 - semantic similarity rarely exceeds 0.5 for doc retrieval
): Promise<RAGContext> {
  try {
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);

    // First check if the rag_embeddings table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'rag_embeddings'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log("[DataChat RAG] rag_embeddings table does not exist");
      return { chunks: [], sources: [], totalChunks: 0 };
    }

    // Debug: Check what documents and embeddings exist
    const docCount = await tenantPool.query(
      `SELECT COUNT(*) as total, 
              COUNT(*) FILTER (WHERE is_global = true) as global_count,
              COUNT(*) FILTER (WHERE status = 'indexed') as indexed_count
       FROM rag_documents`
    );
    const embeddingCount = await tenantPool.query(
      `SELECT COUNT(*) as total FROM rag_embeddings`
    );
    console.log(
      `[DataChat RAG] Documents in tenant DB: ${JSON.stringify(
        docCount.rows[0]
      )}`
    );
    console.log(
      `[DataChat RAG] Embeddings in tenant DB: ${embeddingCount.rows[0].total}`
    );

    // Generate embedding for the question
    const embeddingResults = await generateEmbeddings(
      [question],
      "openai/text-embedding-3-large"
    );

    if (!embeddingResults || embeddingResults.length === 0) {
      console.log("[DataChat RAG] Failed to generate embedding for question");
      return { chunks: [], sources: [], totalChunks: 0 };
    }

    const queryEmbedding = embeddingResults[0].embedding;
    const embeddingVector = `[${queryEmbedding.join(",")}]`;

    // Search for similar chunks
    const results = await tenantPool.query(
      `SELECT 
        e.chunk_text,
        d.filename,
        d.title,
        d.is_global,
        d.category,
        1 - (e.embedding <=> $1::vector) as similarity
       FROM rag_embeddings e
       JOIN rag_documents d ON e.document_id = d.id
       WHERE d.status = 'indexed'
         AND 1 - (e.embedding <=> $1::vector) >= $2
       ORDER BY e.embedding <=> $1::vector
       LIMIT $3`,
      [embeddingVector, similarityThreshold, topK]
    );

    // Debug: Log similarity scores
    if (results.rows.length > 0) {
      console.log(
        `[DataChat RAG] Top matches:`,
        results.rows.slice(0, 3).map((r: any) => ({
          title: r.title,
          similarity: r.similarity?.toFixed(4),
          is_global: r.is_global,
        }))
      );
    } else {
      // Check what the top score would be without threshold
      const debugResults = await tenantPool.query(
        `SELECT d.title, d.is_global, 1 - (e.embedding <=> $1::vector) as similarity
         FROM rag_embeddings e
         JOIN rag_documents d ON e.document_id = d.id
         WHERE d.status = 'indexed'
         ORDER BY e.embedding <=> $1::vector
         LIMIT 3`,
        [embeddingVector]
      );
      if (debugResults.rows.length > 0) {
        console.log(
          `[DataChat RAG] Best matches (below threshold ${similarityThreshold}):`,
          debugResults.rows.map((r: any) => ({
            title: r.title,
            similarity: r.similarity?.toFixed(4),
            is_global: r.is_global,
          }))
        );
      }
    }

    const chunks = results.rows.map((r: any) => r.chunk_text);
    const sources = results.rows.map((r: any) => {
      const docName = r.title || r.filename;
      const type = r.is_global ? "Global" : "Tenant";
      const category = r.category ? ` (${r.category})` : "";
      return `${docName}${category} [${type}]`;
    });

    console.log(`[DataChat RAG] Retrieved ${chunks.length} relevant chunks`);

    return {
      chunks,
      sources: [...new Set(sources)], // Deduplicate sources
      totalChunks: chunks.length,
    };
  } catch (error: any) {
    console.error("[DataChat RAG] Error retrieving context:", error.message);
    return { chunks: [], sources: [], totalChunks: 0 };
  }
}

/**
 * Classify the user's question to determine how to handle it
 */
function classifyQuestion(question: string): QuestionClassification {
  const q = question.toLowerCase().trim();

  // Greeting patterns
  const greetingPatterns =
    /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|greetings)\b/i;
  if (greetingPatterns.test(q)) {
    return { type: "greeting", confidence: 0.95 };
  }

  // Help patterns
  const helpPatterns =
    /^(help|what can you do|how do you work|what are you|who are you|what should i ask)/i;
  if (helpPatterns.test(q)) {
    return { type: "help", confidence: 0.95 };
  }

  // Follow-up/clarification patterns - questions about previous responses
  const clarificationPatterns = [
    /what do you mean/i,
    /can you explain/i,
    /what does that mean/i,
    /why did you say/i,
    /elaborate on/i,
    /tell me more about/i,
    /what about the/i,
    /i don't understand/i,
    /clarify/i,
    /^(huh|what)\??$/i,
  ];

  for (const pattern of clarificationPatterns) {
    if (pattern.test(q)) {
      return {
        type: "help",
        confidence: 0.9,
        suggestedRephrase:
          "I can help clarify! Could you ask a specific data question?",
      };
    }
  }

  // Vague/open-ended insight patterns that don't translate to SQL
  const insightPatterns = [
    /what.*(important|need to know|should i know|happening|going on)/i,
    /how.*(doing|going|business|performing).*\?*$/i,
    /any.*(issues|problems|concerns|alerts|warnings)/i,
    /what.*(update|news|highlights|summary)/i,
    /give me.*(overview|summary|rundown|brief)/i,
    /^(status|update|brief me|catch me up)/i,
    /tell me about.*(today|this week|lately)/i,
  ];

  for (const pattern of insightPatterns) {
    if (pattern.test(q)) {
      return {
        type: "insights",
        confidence: 0.85,
        suggestedRephrase:
          "Try asking specific data questions like: 'Show me loan volume by month' or 'Top loan officers by revenue'",
      };
    }
  }

  // Knowledge query indicators (regulatory, policy, guidelines, compliance)
  const knowledgeQueryIndicators = [
    /what is.*(fha|va|usda|conventional|conforming|jumbo|qm|atm)/i,
    /explain.*(rule|regulation|requirement|guideline|policy|procedure)/i,
    /what are.*(requirements|rules|guidelines|limits|thresholds)/i,
    /how do i.*(comply|handle|process|document)/i,
    /when.*(required|needed|mandatory)/i,
    /tell me about.*(regulation|compliance|policy|guideline)/i,
    /(fha|va|usda|fannie|freddie|cfpb|trid|respa|ecoa|hmda|tila).*(rules?|requirements?|guidelines?|limits?)/i,
    /what.*(documentation|documents).*(needed|required)/i,
    /compliance.*(requirements?|rules?)/i,
    /regulatory.*(requirements?|guidelines?)/i,
    /loan limits/i,
    /dti.*requirements?/i,
    /ltv.*requirements?/i,
    /credit score.*requirements?/i,
  ];

  const knowledgeQueryScore = knowledgeQueryIndicators.filter((p) =>
    p.test(q)
  ).length;

  // Data query indicators (specific, measurable)
  const dataQueryIndicators = [
    /show me/i,
    /how many/i,
    /what is the/i,
    /list/i,
    /top \d+/i,
    /by (branch|month|year|type|officer|status)/i,
    /total|average|sum|count|volume|amount/i,
    /trend|over time|by date|by month|monthly|quarterly|yearly/i,
    /compare|comparison|versus|vs/i,
    /breakdown|distribution|split/i,
    /loan(s)?/i,
    /funding|funded|closed|pipeline/i,
  ];

  const dataQueryScore = dataQueryIndicators.filter((p) => p.test(q)).length;

  // Hybrid query: Both knowledge and data indicators present
  if (knowledgeQueryScore >= 1 && dataQueryScore >= 1) {
    return { type: "hybrid", confidence: 0.85 };
  }

  // Pure knowledge query
  if (knowledgeQueryScore >= 2) {
    return { type: "knowledge_query", confidence: 0.9 };
  } else if (knowledgeQueryScore === 1 && dataQueryScore === 0) {
    return { type: "knowledge_query", confidence: 0.75 };
  }

  // Pure data query
  if (dataQueryScore >= 2) {
    return { type: "data_query", confidence: 0.9 };
  } else if (dataQueryScore === 1) {
    return { type: "data_query", confidence: 0.7 };
  }

  // If the question is too short or lacks context
  if (q.length < 15 || q.split(" ").length < 3) {
    return {
      type: "unclear",
      confidence: 0.6,
      suggestedRephrase:
        "Could you be more specific? For example: 'Show me loans by branch' or 'What's the total loan volume this month?'",
    };
  }

  // Default to data query with lower confidence
  return { type: "data_query", confidence: 0.5 };
}

/**
 * Run insight queries to gather key metrics for open-ended questions
 */
async function gatherInsightMetrics(
  context: ChatContext
): Promise<Record<string, any>> {
  const tenantPool = await tenantDbManager.getTenantPool(context.tenantId);
  const metrics: Record<string, any> = {};

  const now = new Date();
  const currentYear = now.getFullYear();

  // Helper to safely run queries
  const safeQuery = async (name: string, sql: string): Promise<any[]> => {
    try {
      const result = await tenantPool.query(sql);
      return result.rows;
    } catch (error) {
      console.log(`[DataChat Insights] Query "${name}" failed:`, error);
      return [];
    }
  };

  // 1. Volume summary using ROLLING periods (last 30 days vs previous 30 days)
  // This avoids the "0 this month" issue when it's early in the month
  const volumeSummary = await safeQuery(
    "volumeSummary",
    `
    SELECT 
      COUNT(*) FILTER (WHERE application_date >= CURRENT_DATE - INTERVAL '30 days') as recent_count,
      COALESCE(SUM(loan_amount) FILTER (WHERE application_date >= CURRENT_DATE - INTERVAL '30 days'), 0) as recent_volume,
      COUNT(*) FILTER (WHERE application_date >= CURRENT_DATE - INTERVAL '60 days' AND application_date < CURRENT_DATE - INTERVAL '30 days') as previous_count,
      COALESCE(SUM(loan_amount) FILTER (WHERE application_date >= CURRENT_DATE - INTERVAL '60 days' AND application_date < CURRENT_DATE - INTERVAL '30 days'), 0) as previous_volume
    FROM public.loans l
  `
  );
  metrics.volume = volumeSummary[0] || {};
  // Rename for clarity in the prompt
  metrics.volume.this_period_count = metrics.volume.recent_count;
  metrics.volume.this_period_volume = metrics.volume.recent_volume;
  metrics.volume.last_period_count = metrics.volume.previous_count;
  metrics.volume.last_period_volume = metrics.volume.previous_volume;

  // 2. Active Loans - uses exact "Active Loan" status per metricsService.ts definition
  // Active Loan Flag = Yes means current_loan_status = 'Active Loan'
  // This is a current state snapshot, NOT date-filtered (ignoreDateFilter: true)
  const activeLoans = await safeQuery(
    "activeLoans",
    `
    SELECT 
      COUNT(CASE 
        WHEN l.current_loan_status = 'Active Loan' 
        AND l.application_date IS NOT NULL 
        AND l.application_date::text != ''
        THEN 1 
      END) as active_count,
      COALESCE(SUM(CASE 
        WHEN l.current_loan_status = 'Active Loan' 
        AND l.application_date IS NOT NULL 
        AND l.application_date::text != ''
        THEN l.loan_amount 
        ELSE 0
      END), 0) as active_volume
    FROM public.loans l
  `
  );
  metrics.activeLoans = activeLoans[0] || { active_count: 0, active_volume: 0 };

  // 3. Top performers (last 30 days)
  const topPerformers = await safeQuery(
    "topPerformers",
    `
    SELECT 
      COALESCE(loan_officer, 'Unknown') as loan_officer,
      COUNT(*) as loan_count,
      COALESCE(SUM(loan_amount), 0) as total_volume
    FROM public.loans l
    WHERE application_date >= CURRENT_DATE - INTERVAL '30 days'
      AND loan_officer IS NOT NULL
    GROUP BY loan_officer
    ORDER BY total_volume DESC
    LIMIT 5
  `
  );
  metrics.topPerformers = topPerformers;

  // 4. Recent funding activity
  const recentFunding = await safeQuery(
    "recentFunding",
    `
    SELECT 
      COUNT(*) FILTER (WHERE funding_date >= CURRENT_DATE - INTERVAL '7 days') as funded_last_7_days,
      COUNT(*) FILTER (WHERE funding_date >= CURRENT_DATE - INTERVAL '30 days') as funded_last_30_days,
      COALESCE(SUM(loan_amount) FILTER (WHERE funding_date >= CURRENT_DATE - INTERVAL '7 days'), 0) as funded_volume_7_days,
      COALESCE(SUM(loan_amount) FILTER (WHERE funding_date >= CURRENT_DATE - INTERVAL '30 days'), 0) as funded_volume_30_days
    FROM public.loans l
    WHERE funding_date IS NOT NULL
  `
  );
  metrics.funding = recentFunding[0] || {};

  // 5. Volume by loan type
  const byLoanType = await safeQuery(
    "byLoanType",
    `
    SELECT 
      COALESCE(loan_type, 'Other') as loan_type,
      COUNT(*) as count,
      COALESCE(SUM(loan_amount), 0) as volume
    FROM public.loans l
    WHERE EXTRACT(YEAR FROM application_date) = ${currentYear}
    GROUP BY loan_type
    ORDER BY volume DESC
    LIMIT 5
  `
  );
  metrics.byLoanType = byLoanType;

  // 6. Average metrics (use cltv, not ltv per actual schema)
  const avgMetrics = await safeQuery(
    "avgMetrics",
    `
    SELECT 
      COALESCE(AVG(loan_amount), 0) as avg_loan_amount,
      COALESCE(AVG(interest_rate), 0) as avg_interest_rate,
      COALESCE(AVG(cltv), 0) as avg_ltv,
      COUNT(*) as total_loans
    FROM public.loans l
    WHERE EXTRACT(YEAR FROM application_date) = ${currentYear}
  `
  );
  metrics.averages = avgMetrics[0] || {};

  return metrics;
}

/**
 * Helper to format currency
 */
function formatCurrencyShort(value: number): string {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(1) + "M";
  } else if (value >= 1000) {
    return (value / 1000).toFixed(0) + "K";
  }
  return value.toFixed(0);
}

/**
 * Generate an AI-powered insight summary from gathered metrics
 */
async function generateInsightSummary(
  metrics: Record<string, any>,
  question: string,
  context: ChatContext
): Promise<string> {
  const apiKey = await getOpenAIKey(context.tenantId);

  const systemPrompt = `You are Cohi, an executive briefing assistant for a mortgage lending company. 
Your job is to analyze key metrics and provide a concise, actionable summary.

Guidelines:
- Be concise but insightful (2-4 paragraphs max)
- Highlight what's important: changes, trends, anomalies
- Use specific numbers and percentages
- Format currency as $X.XM or $XXK
- Use bullet points for lists when helpful
- End with 1-2 actionable insights or things to watch
- Use emoji sparingly for visual organization (📈 📉 ⚠️ ✅ 👥 etc.)
- Be conversational but professional

IMPORTANT: 
- If a section shows "No data", just skip it - do NOT tell users to "address missing data" or "investigate data gaps"
- Only discuss metrics that have actual data
- Focus on what IS available, not what's missing`;

  const userPrompt = `The user asked: "${question}"

Here are the current metrics to analyze:

## Volume Summary (Rolling 30-Day Periods)
- Last 30 days: ${
    metrics.volume?.this_period_count || 0
  } loans, $${formatCurrencyShort(
    Number(metrics.volume?.this_period_volume) || 0
  )}
- Previous 30 days (for comparison): ${
    metrics.volume?.last_period_count || 0
  } loans, $${formatCurrencyShort(
    Number(metrics.volume?.last_period_volume) || 0
  )}

## Active Loans (Current Pipeline)
Active loans are those with status "Active Loan" (still being processed, not yet funded/closed).
- Active Loan Count: ${metrics.activeLoans?.active_count || 0} loans
- Active Loan Volume: $${formatCurrencyShort(
    Number(metrics.activeLoans?.active_volume) || 0
  )}

## Top Performers (Last 30 Days)
${
  metrics.topPerformers
    ?.map(
      (p: any, i: number) =>
        `${i + 1}. ${p.loan_officer}: ${
          p.loan_count
        } loans ($${formatCurrencyShort(Number(p.total_volume))})`
    )
    .join("\n") || "No data"
}

## Recent Funding Activity
- Last 7 days: ${
    metrics.funding?.funded_last_7_days || 0
  } loans funded ($${formatCurrencyShort(
    Number(metrics.funding?.funded_volume_7_days) || 0
  )})
- Last 30 days: ${
    metrics.funding?.funded_last_30_days || 0
  } loans funded ($${formatCurrencyShort(
    Number(metrics.funding?.funded_volume_30_days) || 0
  )})

## Volume by Loan Type (YTD)
${
  metrics.byLoanType
    ?.map(
      (t: any) =>
        `- ${t.loan_type}: ${t.count} loans ($${formatCurrencyShort(
          Number(t.volume)
        )})`
    )
    .join("\n") || "No data"
}

## Averages (YTD)
- Average Loan Amount: $${formatCurrencyShort(
    Number(metrics.averages?.avg_loan_amount) || 0
  )}
- Average Interest Rate: ${(
    Number(metrics.averages?.avg_interest_rate) || 0
  ).toFixed(2)}%
- Average LTV: ${(Number(metrics.averages?.avg_ltv) || 0).toFixed(1)}%
- Total Loans: ${metrics.averages?.total_loans || 0}

Provide a helpful executive summary answering their question.`;

  const messages: OpenAIChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    const response = await callOpenAI(messages, apiKey, {
      temperature: 0.7,
      maxTokens: 800,
    });
    return response;
  } catch (error) {
    console.error("[DataChat] Error generating insight summary:", error);
    // Fallback to basic summary
    const volumeChange =
      metrics.volume?.last_period_count > 0
        ? (
            ((metrics.volume?.this_period_count -
              metrics.volume?.last_period_count) /
              metrics.volume?.last_period_count) *
            100
          ).toFixed(1)
        : "N/A";

    return (
      `📊 **Quick Summary**\n\n` +
      `**Last 30 Days**: ${
        metrics.volume?.this_period_count || 0
      } loans ($${formatCurrencyShort(
        Number(metrics.volume?.this_period_volume) || 0
      )}) — ${
        volumeChange !== "N/A"
          ? (Number(volumeChange) >= 0 ? "📈 up" : "📉 down") +
            " " +
            Math.abs(Number(volumeChange)) +
            "% vs previous 30 days"
          : "no comparison available"
      }\n\n` +
      `**Recent Funding**: ${
        metrics.funding?.funded_last_7_days || 0
      } loans in the last 7 days\n\n` +
      `**Top Performer**: ${
        metrics.topPerformers?.[0]?.loan_officer || "N/A"
      } with ${metrics.topPerformers?.[0]?.loan_count || 0} loans`
    );
  }
}

/**
 * Handle pure knowledge queries using RAG
 */
async function handleKnowledgeQuery(
  question: string,
  context: ChatContext
): Promise<DataChatResponse> {
  try {
    // Retrieve relevant context from knowledge base
    const ragContext = await retrieveRAGContext(
      context.tenantId,
      question,
      5,
      0.35 // Lower threshold for better recall
    );

    if (ragContext.totalChunks === 0) {
      return {
        message:
          "I couldn't find relevant information in the knowledge base for your question. " +
          "I'm primarily designed to help with loan data queries. Would you like to ask about your loan data instead?",
        suggestedQuestions: [
          "Show me loan volume by loan type",
          "What are the current FHA loans in pipeline?",
          "Top 10 loan officers by volume",
          "How many VA loans funded this month?",
        ],
      };
    }

    // Build context string for the LLM
    const contextString = ragContext.chunks
      .map((chunk, i) => `[Source ${i + 1}]: ${chunk}`)
      .join("\n\n");

    // Get API key
    // Get OpenAI API key using proper tenant-aware function
    const apiKey = await getOpenAIKey(context.tenantId);

    // Generate response using LLM with RAG context
    const systemPrompt = `You are Cohi, an AI assistant specialized in mortgage lending. 
You have access to a knowledge base of regulations, guidelines, and policies.

Use the following context from the knowledge base to answer the user's question.
Be specific, accurate, and helpful. If the context doesn't fully answer the question, 
say what you know and suggest they ask a more specific question or consult additional resources.

Always cite your sources by referring to the document names when relevant.

Context from Knowledge Base:
${contextString}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `OpenAI API error: ${error.error?.message || "Unknown error"}`
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer =
      data.choices?.[0]?.message?.content || "Unable to generate response.";

    // Format source references
    const sourceNote =
      ragContext.sources.length > 0
        ? `\n\n📚 **Sources:** ${ragContext.sources.join(", ")}`
        : "";

    return {
      message: answer + sourceNote,
      suggestedQuestions: [
        "Tell me more about the requirements",
        "What documentation is needed?",
        "Are there any exceptions?",
        "Show me related loan data",
      ],
    };
  } catch (error: any) {
    console.error("[DataChat] Error handling knowledge query:", error);
    return {
      message:
        "I encountered an error while searching the knowledge base. Please try again or ask a different question.",
      error: error.message,
      suggestedQuestions: [
        "Show me loan volume by type",
        "Top loan officers by volume",
        "Pipeline breakdown by status",
      ],
    };
  }
}

/**
 * Handle hybrid queries (combining data and knowledge)
 */
async function handleHybridQuery(
  question: string,
  context: ChatContext,
  conversationHistory: DataChatMessage[]
): Promise<DataChatResponse> {
  try {
    // Run both data query and RAG retrieval in parallel
    const [ragContext, queryConfigPromise] = await Promise.all([
      retrieveRAGContext(context.tenantId, question, 3, 0.35), // Lower threshold for better recall
      generateQuery(question, context, conversationHistory).catch(() => null),
    ]);

    let dataResult: QueryResult | null = null;
    let visualization: VisualizationConfig | undefined;
    let queryConfig: any = queryConfigPromise;

    // Try to execute the data query if we have one
    if (queryConfig?.sql) {
      try {
        dataResult = await executeQuery(
          queryConfig.sql,
          queryConfig.params,
          context
        );
        if (dataResult.rowCount > 0) {
          const formattedData = formatDataRows(dataResult.rows);
          visualization = buildVisualizationConfig(formattedData, queryConfig);
        }
      } catch (error) {
        console.log(
          "[DataChat] Hybrid query: Data query failed, continuing with RAG only"
        );
      }
    }

    // Build combined context for LLM
    let contextParts: string[] = [];

    if (ragContext.totalChunks > 0) {
      contextParts.push("**Knowledge Base Context:**");
      ragContext.chunks.forEach((chunk, i) => {
        contextParts.push(
          `[${ragContext.sources[i] || `Source ${i + 1}`}]: ${chunk}`
        );
      });
    }

    if (dataResult && dataResult.rowCount > 0) {
      contextParts.push("\n**Your Loan Data:**");
      const dataPreview = dataResult.rows.slice(0, 10);
      contextParts.push(JSON.stringify(dataPreview, null, 2));
      if (dataResult.rowCount > 10) {
        contextParts.push(`... and ${dataResult.rowCount - 10} more rows`);
      }
    }

    // Get API key using proper tenant-aware function
    const apiKey = await getOpenAIKey(context.tenantId);

    // Generate combined response
    const systemPrompt = `You are Cohi, an AI assistant specialized in mortgage lending.
You have access to both a knowledge base (regulations, guidelines, policies) and the user's actual loan data.

Use the following context to provide a comprehensive answer that combines regulatory knowledge 
with insights from their actual data where relevant.

${contextParts.join("\n\n")}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        temperature: 0.7,
        max_tokens: 1200,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `OpenAI API error: ${error.error?.message || "Unknown error"}`
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer =
      data.choices?.[0]?.message?.content || "Unable to generate response.";

    // Format source references
    const sourceNote =
      ragContext.sources.length > 0
        ? `\n\n📚 **Knowledge Sources:** ${ragContext.sources.join(", ")}`
        : "";

    return {
      message: answer + sourceNote,
      visualization,
      data: dataResult?.rows,
      suggestedQuestions: [
        "Tell me more about the requirements",
        "Show me this data broken down by month",
        "What are the compliance considerations?",
        "How does this compare to last month?",
      ],
    };
  } catch (error: any) {
    console.error("[DataChat] Error handling hybrid query:", error);
    return {
      message:
        "I encountered an error processing your question. Please try rephrasing it or asking separately about the data and the knowledge topic.",
      error: error.message,
      suggestedQuestions: [
        "Show me loan volume by type",
        "What are the FHA requirements?",
        "Top loan officers by volume",
      ],
    };
  }
}

/**
 * Generate a helpful response for non-data-query questions
 */
async function generateNonQueryResponse(
  classification: QuestionClassification,
  question: string,
  context: ChatContext
): Promise<DataChatResponse> {
  switch (classification.type) {
    case "greeting":
      return {
        message:
          "Hello! I'm Cohi, your data assistant. I can help you explore your loan data and provide executive insights.\n\n" +
          "**Try asking me:**\n" +
          "📊 \"What's important to know today?\" - I'll analyze your key metrics\n" +
          '📈 "Show me loan volume by month" - Data visualizations\n' +
          '👥 "Top 10 loan officers" - Performance rankings\n' +
          '🏢 "Compare branches" - Comparative analysis\n\n' +
          "What would you like to know?",
        suggestedQuestions: [
          "What important info do I need to know today?",
          "Show me loan volume trends by month",
          "Top 10 loan officers by funded volume",
          "How is our pipeline looking?",
        ],
      };

    case "help": {
      // Check if this looks like a clarification question
      const isClarification =
        /what do you mean|can you explain|clarify|tell me more|elaborate/i.test(
          question
        );

      if (isClarification) {
        return {
          message:
            "I'd be happy to clarify! However, I work best with **specific data questions**.\n\n" +
            "If you want to dig deeper into something I mentioned, try asking directly:\n" +
            '• "Show me the pipeline breakdown by status"\n' +
            '• "Who are the top loan officers?"\n' +
            '• "What\'s our funding activity this month?"\n\n' +
            "What specific data would you like to explore?",
          suggestedQuestions: [
            "Show me pipeline breakdown by status",
            "Top 10 loan officers by volume",
            "Funding activity this month",
            "Loan volume by branch",
          ],
        };
      }

      return {
        message:
          "I'm Cohi, your mortgage data analyst! I can answer questions about your loan data in two ways:\n\n" +
          "**1. Executive Insights** (open-ended questions)\n" +
          '• "What\'s important today?"\n' +
          '• "How are we doing?"\n' +
          '• "Any issues I should know about?"\n\n' +
          "**2. Data Queries** (specific questions)\n" +
          '• "Show me loans by branch"\n' +
          '• "Top 10 loan officers by volume"\n' +
          '• "Funding trends this year"\n\n' +
          "Just ask naturally - I'll figure out the best way to answer!",
        suggestedQuestions: [
          "What important info do I need to know today?",
          "Show me funding trends for this year",
          "How is our pipeline looking?",
          "Top performers this month",
        ],
      };
    }

    case "insights":
      // Actually gather and analyze metrics for insight questions
      try {
        console.log("[DataChat] Gathering insight metrics...");
        const metrics = await gatherInsightMetrics(context);
        console.log("[DataChat] Generating insight summary...");
        const summary = await generateInsightSummary(
          metrics,
          question,
          context
        );

        return {
          message: summary,
          suggestedQuestions: [
            "Show me the pipeline breakdown",
            "Top loan officers this month",
            "Funding trends by week",
            "Compare this month to last month",
          ],
        };
      } catch (error) {
        console.error("[DataChat] Error generating insights:", error);
        return {
          message:
            "I tried to gather insights but encountered an issue. Let me help you with a specific question instead:",
          suggestedQuestions: [
            "Show me loan volume this month",
            "Top 10 loan officers by volume",
            "Pipeline by status",
            "Recent funding activity",
          ],
        };
      }

    case "unclear":
      return {
        message:
          `I'd love to help! ${
            classification.suggestedRephrase ||
            "Could you be more specific about what data you'd like to see?"
          }\n\n` +
          "**You can ask me things like:**\n" +
          '• "What\'s important to know today?" - Executive summary\n' +
          '• "Show me loans by branch" - Specific data\n' +
          '• "How are we trending?" - Performance analysis',
        suggestedQuestions: [
          "What important info do I need to know today?",
          "Show me loan volume this year",
          "Top loan officers by revenue",
          "Pipeline breakdown by status",
        ],
      };

    default:
      return {
        message:
          "I'm not sure how to help with that. Try asking about your loan data or requesting an executive summary.",
        suggestedQuestions: [
          "What important info do I need to know today?",
          "Show me loan volume by month",
          "Top 10 loan officers by volume",
          "How is the pipeline looking?",
        ],
      };
  }
}

// ============================================================================
// Main Chat Function
// ============================================================================

export async function processDataQuestion(
  question: string,
  context: ChatContext,
  conversationHistory: DataChatMessage[] = []
): Promise<DataChatResponse> {
  try {
    console.log(
      `[DataChat] Processing question: "${question}" for tenant ${context.tenantId}`
    );

    // Step 1: Classify the question
    const classification = classifyQuestion(question);
    console.log(
      `[DataChat] Question classified as: ${classification.type} (confidence: ${classification.confidence})`
    );

    // Step 2: Handle knowledge queries (RAG-only)
    if (classification.type === "knowledge_query") {
      console.log(`[DataChat] Routing to knowledge query handler`);
      return await handleKnowledgeQuery(question, context);
    }

    // Step 3: Handle hybrid queries (data + knowledge)
    if (classification.type === "hybrid") {
      console.log(`[DataChat] Routing to hybrid query handler`);
      return await handleHybridQuery(question, context, conversationHistory);
    }

    // Step 4: Handle non-data-query questions gracefully
    if (
      classification.type !== "data_query" ||
      classification.confidence < 0.5
    ) {
      console.log(`[DataChat] Routing to non-query response handler`);
      return await generateNonQueryResponse(classification, question, context);
    }

    // Step 5: Generate the query for data questions
    const queryConfig = await generateQuery(
      question,
      context,
      conversationHistory
    );
    console.log(`[DataChat] Generated SQL: ${queryConfig.sql}`);

    // Execute the query
    const result = await executeQuery(
      queryConfig.sql,
      queryConfig.params,
      context
    );

    // Format data for display (convert dates, clean numbers)
    const formattedData = formatDataRows(result.rows);

    // Build visualization with formatted data
    const visualization = buildVisualizationConfig(formattedData, queryConfig);

    // Generate response message
    let message = queryConfig.explanation;
    if (result.rowCount === 0) {
      message =
        "I didn't find any data matching your query. This could mean there's no data for the specified criteria, or you might want to adjust your filters.";
    } else if (
      result.rowCount === 1 &&
      queryConfig.visualizationType === "kpi"
    ) {
      const valueKey = Object.keys(result.rows[0])[0];
      const value = result.rows[0][valueKey];
      message = `${queryConfig.explanation}\n\nThe result is: **${formatValue(
        value
      )}**`;
    }

    // Detect which metrics from the catalog were used in this query
    const metricsUsed = detectMetricsUsed(queryConfig.sql, question);
    if (metricsUsed.length > 0) {
      console.log(`[DataChat] Metrics used: ${metricsUsed.join(", ")}`);
    }

    return {
      message,
      visualization,
      data: formattedData,
      suggestedQuestions: generateSuggestedQuestions(question),
      metricsUsed: metricsUsed.length > 0 ? metricsUsed : undefined,
    };
  } catch (error: any) {
    console.error("[DataChat] Error processing question:", error);

    // Provide more helpful error messages based on error type
    let userMessage = "I encountered an error while processing your question.";

    if (error.code === "42703") {
      // Column does not exist
      userMessage =
        "I tried to use a field that doesn't exist in your data. Let me try a different approach.";
    } else if (error.code === "42601" || error.code === "22007") {
      // Syntax error or date/time parse error
      userMessage =
        "There was an issue with the query I generated. Please try rephrasing your question.";
    } else if (error.message?.includes("timeout")) {
      userMessage =
        "The query took too long to execute. Try asking for a smaller date range or more specific criteria.";
    } else if (error.message?.includes("OpenAI")) {
      userMessage =
        "I'm having trouble connecting to my AI assistant. Please try again in a moment.";
    }

    return {
      message: userMessage + " Here are some questions you can try:",
      error: error.message,
      suggestedQuestions: [
        "Show me total loan volume",
        "How many loans by loan type?",
        "Show me loans by branch",
        "What are the top 10 loan officers by volume?",
      ],
    };
  }
}

// ============================================================================
// Refine Query
// ============================================================================

export async function refineQuery(
  originalQuestion: string,
  refinement: string,
  previousResult: DataChatResponse,
  context: ChatContext
): Promise<DataChatResponse> {
  // Combine the original question with the refinement
  const combinedQuestion = `Based on the previous question "${originalQuestion}", ${refinement}`;

  // Create a mock history with the previous interaction
  const history: DataChatMessage[] = [
    {
      id: "prev-user",
      role: "user",
      content: originalQuestion,
      timestamp: new Date(),
    },
    {
      id: "prev-assistant",
      role: "assistant",
      content: previousResult.message,
      visualization: previousResult.visualization,
      timestamp: new Date(),
    },
  ];

  return processDataQuestion(combinedQuestion, context, history);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a single value for display
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "number") {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return value.toLocaleString();
    } else if (value % 1 !== 0) {
      return value.toFixed(2);
    }
    return value.toString();
  }
  return String(value);
}

/**
 * Check if a value looks like a date (ISO string or Date object)
 */
function isISODateString(value: any): boolean {
  // Handle Date objects from PostgreSQL
  if (value instanceof Date) return true;
  if (typeof value !== "string") return false;
  // Match ISO date formats like 2025-09-15T00:00:00.000Z or 2025-09-15
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/.test(value);
}

/**
 * Check if a string looks like a numeric value (from PostgreSQL)
 */
function isNumericString(value: any): boolean {
  if (typeof value !== "string") return false;
  // Match numbers like "64632379.00" or "123.45"
  return /^-?\d+(\.\d+)?$/.test(value);
}

/**
 * Format a date value to a readable string for chart labels
 * Tries to be concise - "Jan 15" for daily, "Week of Jan 12" for weekly, "Jan 2026" for monthly
 */
function formatDateValue(value: string | Date): string {
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return String(value);

    const day = date.getDate();
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const year = date.getFullYear();

    // Check if this looks like a week start (typically Monday or Sunday)
    // Week starts are usually 1, 7, 8, 14, 15, 21, 22, 28, 29
    const dayOfWeek = date.getDay();
    const isLikelyWeekStart =
      (dayOfWeek === 0 || dayOfWeek === 1) &&
      [1, 2, 7, 8, 14, 15, 21, 22, 28, 29].includes(day);

    // Check if this is the first of the month (likely monthly grouping)
    const isFirstOfMonth = day === 1;

    if (isFirstOfMonth) {
      // Monthly format: "Jan 2026"
      return `${month} ${year}`;
    } else if (isLikelyWeekStart) {
      // Weekly format: "Week of Jan 12"
      return `Week of ${month} ${day}`;
    } else {
      // Daily format: "Jan 15"
      return `${month} ${day}`;
    }
  } catch {
    return String(value);
  }
}

/**
 * Format numeric string to proper number
 */
function formatNumericValue(value: string): number {
  return parseFloat(value);
}

/**
 * Clean and format data rows for display
 * - Converts ISO date strings to readable formats
 * - Converts numeric strings to actual numbers
 * - Removes excessive precision
 */
function formatDataRows(rows: any[]): any[] {
  if (!rows || rows.length === 0) return rows;

  return rows.map((row) => {
    const formatted: Record<string, any> = {};

    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) {
        formatted[key] = null;
      } else if (isISODateString(value)) {
        // Format dates for display
        formatted[key] = formatDateValue(value as string);
      } else if (isNumericString(value)) {
        // Convert numeric strings to numbers
        const num = formatNumericValue(value as string);
        // Round to 2 decimal places if has decimals, otherwise keep as integer
        formatted[key] = num % 1 === 0 ? num : Math.round(num * 100) / 100;
      } else if (typeof value === "number") {
        // Round numbers to reasonable precision
        formatted[key] =
          value % 1 === 0 ? value : Math.round(value * 100) / 100;
      } else {
        formatted[key] = value;
      }
    }

    return formatted;
  });
}

// ============================================================================
// Exports for testing
// ============================================================================

export { generateQuery, executeQuery, buildVisualizationConfig };
