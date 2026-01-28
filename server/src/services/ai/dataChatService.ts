/**
 * Data Chat Service
 * AI-powered natural language interface for querying loan data
 * Generates SQL queries, executes them, and creates visualization configs
 */

import pg from 'pg';
import { METRICS_CATALOG, MetricDefinition } from '../metrics/metricsService.js';
import { tenantDbManager } from '../../config/tenantDatabaseManager.js';
import { decryptAPIKeys } from '../encryption.js';

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
  operator: 'equals' | 'in' | 'not_in' | 'contains' | 'is_current_user';
  value?: string | string[];
  dynamicSource?: string;
}

export interface DataChatMessage {
  id: string;
  role: 'user' | 'assistant';
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
  type: 'bar' | 'line' | 'pie' | 'area' | 'table' | 'kpi' | 'donut' | 'horizontal_bar';
  title: string;
  data: any[];
  xKey?: string;
  yKey?: string;
  yKeys?: string[];  // For multi-series charts
  xLabel?: string;   // Human-readable X-axis label
  yLabel?: string;   // Human-readable Y-axis label
  nameKey?: string;  // For pie charts
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
    format?: 'number' | 'currency' | 'percent';
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
## Available Loan Fields

### Core Fields
- loan_id (TEXT): Unique loan identifier
- loan_amount (DECIMAL): Total loan amount
- loan_type (TEXT): Type of loan (Conventional, FHA, VA, USDA, etc.)
- loan_purpose (TEXT): Purpose (Purchase, Refinance, Cash-Out Refinance)
- loan_program (TEXT): Loan program name
- current_loan_status (TEXT): Current status
- current_milestone (TEXT): Current milestone in pipeline

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

### Financial Fields
- interest_rate (DECIMAL): Interest rate
- ltv_ratio (DECIMAL): Loan-to-value ratio
- be_dti_ratio (DECIMAL): Debt-to-income ratio
- fico_score (INTEGER): Credit score

### Key Dates
- application_date (DATE): Application date
- started_date (DATE): Started date (aka Lock date in some contexts)
- lock_date (DATE): Rate lock date
- closing_date (DATE): Closing date
- funding_date (DATE): Funding date

### Status Indicators
- funding_date IS NOT NULL: Loan is funded
- current_loan_status = 'Active Loan': Loan is active
- lock_date IS NOT NULL: Loan is locked
`;

// ============================================================================
// OpenAI Integration
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
          const decrypted = await decryptAPIKeys({ openai_api_key: result.rows[0].openai_api_key });
          if (decrypted.openai_api_key) {
            return decrypted.openai_api_key;
          }
        }
      }
    } catch (error) {
      console.log('[DataChat] Error fetching tenant API key, falling back to env');
    }
  }
  
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  
  throw new Error('OpenAI API key not configured');
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callOpenAI(
  messages: OpenAIChatMessage[],
  apiKey: string,
  options: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const body: any = {
    model: 'gpt-4o',
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2000,
  };
  
  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json() as { error?: { message?: string } };
    throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || '';
}

// ============================================================================
// Query Generation
// ============================================================================

interface GeneratedQuery {
  sql: string;
  params: any[];
  explanation: string;
  visualizationType: VisualizationConfig['type'];
  chartConfig: Partial<VisualizationConfig>;
}

async function generateQuery(
  question: string,
  context: ChatContext,
  conversationHistory: DataChatMessage[] = []
): Promise<GeneratedQuery> {
  const apiKey = await getOpenAIKey(context.tenantId);
  
  // Build metrics context
  const metricsContext = Object.values(METRICS_CATALOG)
    .map(m => `- ${m.name} (${m.id}): ${m.description}`)
    .join('\n');

  // Get current date for context
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentQuarter = Math.ceil(currentMonth / 3);
  
  const systemPrompt = `You are a data analyst assistant that converts natural language questions about mortgage loan data into PostgreSQL queries.

${LOAN_SCHEMA_CONTEXT}

## Available Metrics
${metricsContext}

## Current Date Context
- Today: ${now.toISOString().split('T')[0]}
- Current Year: ${currentYear}
- Current Month: ${currentMonth}
- Current Quarter: Q${currentQuarter}

## PostgreSQL Syntax Rules (IMPORTANT)
1. ALWAYS use table alias "l" for the loans table: FROM public.loans l
2. Generate ONLY SELECT queries (no INSERT, UPDATE, DELETE)
3. INTERVAL syntax - ONLY use these valid formats:
   - INTERVAL '1 day', INTERVAL '7 days'
   - INTERVAL '1 week', INTERVAL '2 weeks'
   - INTERVAL '1 month', INTERVAL '3 months' (for quarters)
   - INTERVAL '1 year', INTERVAL '2 years'
   - NEVER use 'quarter' in intervals - use '3 months' instead
4. Date comparisons for common periods:
   - Last quarter: WHERE date_column >= DATE_TRUNC('quarter', CURRENT_DATE - INTERVAL '3 months')
   - This year: WHERE EXTRACT(YEAR FROM date_column) = ${currentYear}
   - Last 30 days: WHERE date_column >= CURRENT_DATE - INTERVAL '30 days'
   - This quarter: WHERE date_column >= DATE_TRUNC('quarter', CURRENT_DATE)
5. Use DATE_TRUNC for grouping: DATE_TRUNC('month', date_column)
6. For counts, use COUNT(*) or COUNT(DISTINCT field)
7. Group by all non-aggregated columns
8. Limit results to 100 rows unless specifically asked for more
9. Order results meaningfully (by count DESC, by date, etc.)
10. Use COALESCE for null handling when needed

## Visualization Selection & Data Aggregation Rules (CRITICAL)
- Time series (dates) → "line" or "area" chart, ALWAYS aggregate by date period (day, week, month, quarter, year)
- Category comparisons → "bar" chart (vertical) or "horizontal_bar" (for 5+ categories), ALWAYS aggregate by category
- Part of whole (proportions) → "pie" or "donut" chart, ALWAYS aggregate
- Single metric value → "kpi" card
- Detailed individual records → "table" ONLY when user explicitly asks for a list of individual loans/records

## IMPORTANT: Chart Data Rules
1. For bar/line/area/pie charts, NEVER return individual loan records - ALWAYS aggregate with GROUP BY
2. When user asks for "by date" or "by month" or time-based charts:
   - Use DATE_TRUNC to group: DATE_TRUNC('month', application_date) AS month
   - Aggregate values: SUM(loan_amount), COUNT(*), AVG(interest_rate), etc.
3. When user asks for "by branch" or "by loan_officer" or category-based charts:
   - Group by the category field
   - Aggregate the metric (usually COUNT or SUM)
4. Maximum 50 data points for charts (use LIMIT or broader date grouping)
5. If user asks to see individual loans as a chart, suggest using a table instead or ask for clarification

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
  const recentHistory = conversationHistory.slice(-4).map(msg => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content
  }));

  const messages: OpenAIChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: question }
  ];

  const response = await callOpenAI(messages, apiKey, { 
    temperature: 0.2, 
    jsonMode: true,
    maxTokens: 1500 
  });

  try {
    const parsed = JSON.parse(response);
    return {
      sql: parsed.sql,
      params: parsed.params || [],
      explanation: parsed.explanation,
      visualizationType: parsed.visualizationType || 'table',
      chartConfig: parsed.chartConfig || {}
    };
  } catch (error) {
    throw new Error('Failed to parse query generation response');
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
  sanitized = sanitized.replace(
    /INTERVAL\s*"([^"]+)"/gi,
    `INTERVAL '$1'`
  );
  
  // Ensure proper spacing around operators
  sanitized = sanitized.replace(/\s{2,}/g, ' ');
  
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
  if (!normalizedSql.startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed');
  }
  
  // Check for dangerous keywords
  const dangerousKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE'];
  for (const keyword of dangerousKeywords) {
    if (normalizedSql.includes(keyword + ' ') || normalizedSql.includes(keyword + '\n')) {
      throw new Error(`Query contains forbidden keyword: ${keyword}`);
    }
  }

  const pool = await tenantDbManager.getTenantPool(context.tenantId);
  
  const startTime = Date.now();
  console.log(`[DataChat] Executing sanitized SQL: ${sanitizedSql}`);
  const result = await pool.query(sanitizedSql, params);
  const executionTime = Date.now() - startTime;

  console.log(`[DataChat] Query executed in ${executionTime}ms, returned ${result.rows.length} rows`);

  return {
    rows: result.rows,
    rowCount: result.rows.length,
    fields: result.fields?.map(f => f.name) || Object.keys(result.rows[0] || {})
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
    key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  const baseConfig: VisualizationConfig = {
    type: queryConfig.visualizationType,
    title: chartConfig.title || 'Query Results',
    data,
    showLegend: true,
    showGrid: true,
  };

  switch (queryConfig.visualizationType) {
    case 'bar':
    case 'horizontal_bar':
    case 'line':
    case 'area':
      const xKey = chartConfig.xKey || Object.keys(data[0] || {})[0];
      const yKey = chartConfig.yKey || Object.keys(data[0] || {})[1];
      return {
        ...baseConfig,
        xKey,
        yKey,
        yKeys: chartConfig.yKeys,
        xLabel: chartConfig.xLabel || humanize(xKey),
        yLabel: chartConfig.yLabel || humanize(yKey),
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
      };

    case 'pie':
    case 'donut':
      return {
        ...baseConfig,
        nameKey: chartConfig.nameKey || Object.keys(data[0] || {})[0],
        valueKey: chartConfig.valueKey || Object.keys(data[0] || {})[1],
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'],
      };

    case 'kpi':
      const firstRow = data[0] || {};
      const kpiValueKey = Object.keys(firstRow)[0];
      return {
        ...baseConfig,
        kpiConfig: {
          value: firstRow[kpiValueKey],
          label: chartConfig.title || humanize(kpiValueKey),
          format: typeof firstRow[kpiValueKey] === 'number' && firstRow[kpiValueKey] > 1000 ? 'currency' : 'number',
        },
      };

    case 'table':
    default:
      const columns = Object.keys(data[0] || {}).map(key => ({
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
  const suggestions = [
    'Show me loans by branch',
    'What is the average loan amount by loan type?',
    'Show me loan volume over time',
    'Who are the top 10 loan officers by volume?',
    'What is the pull-through rate by month?',
    'Show me active loans by property state',
    'What is the average cycle time by loan type?',
    'Show me funding trends for this year',
  ];
  
  // Filter out the current question and return 3-4 random suggestions
  return suggestions
    .filter(s => s.toLowerCase() !== currentQuestion.toLowerCase())
    .sort(() => Math.random() - 0.5)
    .slice(0, 4);
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
    console.log(`[DataChat] Processing question: "${question}" for tenant ${context.tenantId}`);

    // Generate the query
    const queryConfig = await generateQuery(question, context, conversationHistory);
    console.log(`[DataChat] Generated SQL: ${queryConfig.sql}`);

    // Execute the query
    const result = await executeQuery(queryConfig.sql, queryConfig.params, context);

    // Format data for display (convert dates, clean numbers)
    const formattedData = formatDataRows(result.rows);

    // Build visualization with formatted data
    const visualization = buildVisualizationConfig(formattedData, queryConfig);

    // Generate response message
    let message = queryConfig.explanation;
    if (result.rowCount === 0) {
      message = "I didn't find any data matching your query. This could mean there's no data for the specified criteria, or you might want to adjust your filters.";
    } else if (result.rowCount === 1 && queryConfig.visualizationType === 'kpi') {
      const valueKey = Object.keys(result.rows[0])[0];
      const value = result.rows[0][valueKey];
      message = `${queryConfig.explanation}\n\nThe result is: **${formatValue(value)}**`;
    }

    return {
      message,
      visualization,
      data: formattedData,
      suggestedQuestions: generateSuggestedQuestions(question),
    };
  } catch (error: any) {
    console.error('[DataChat] Error processing question:', error);
    
    // Provide more helpful error messages based on error type
    let userMessage = "I encountered an error while processing your question.";
    
    if (error.code === '42703') {
      // Column does not exist
      userMessage = "I tried to use a field that doesn't exist in your data. Let me try a different approach.";
    } else if (error.code === '42601' || error.code === '22007') {
      // Syntax error or date/time parse error
      userMessage = "There was an issue with the query I generated. Please try rephrasing your question.";
    } else if (error.message?.includes('timeout')) {
      userMessage = "The query took too long to execute. Try asking for a smaller date range or more specific criteria.";
    } else if (error.message?.includes('OpenAI')) {
      userMessage = "I'm having trouble connecting to my AI assistant. Please try again in a moment.";
    }
    
    return {
      message: userMessage + " Here are some questions you can try:",
      error: error.message,
      suggestedQuestions: [
        'Show me total loan volume',
        'How many loans by loan type?',
        'Show me loans by branch',
        'What are the top 10 loan officers by volume?',
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
      id: 'prev-user',
      role: 'user',
      content: originalQuestion,
      timestamp: new Date(),
    },
    {
      id: 'prev-assistant',
      role: 'assistant',
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
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'number') {
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
 * Check if a string looks like an ISO date
 */
function isISODateString(value: any): boolean {
  if (typeof value !== 'string') return false;
  // Match ISO date formats like 2025-09-15T00:00:00.000Z or 2025-09-15
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/.test(value);
}

/**
 * Check if a string looks like a numeric value (from PostgreSQL)
 */
function isNumericString(value: any): boolean {
  if (typeof value !== 'string') return false;
  // Match numbers like "64632379.00" or "123.45"
  return /^-?\d+(\.\d+)?$/.test(value);
}

/**
 * Format a date value to a readable string
 */
function formatDateValue(value: string): string {
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    
    // Format as "Jan 15, 2025" or "Jan 2025" for month-only contexts
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return value;
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
  
  return rows.map(row => {
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
      } else if (typeof value === 'number') {
        // Round numbers to reasonable precision
        formatted[key] = value % 1 === 0 ? value : Math.round(value * 100) / 100;
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
