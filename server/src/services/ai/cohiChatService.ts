/**
 * Cohi Chat Service
 * AI-powered natural language interface with hybrid data + knowledge capabilities
 *
 * Architecture: "Always gather, intelligently combine"
 * - Every question triggers parallel data query generation AND knowledge retrieval
 * - The LLM receives all available context and decides what's relevant
 * - This eliminates classification errors and provides richer responses
 *
 * Prompts are loaded from the database via promptConfigService (admin-configurable)
 * Schema context is dynamically generated via SchemaContextService (per-tenant introspection)
 */

import pg from "pg";
import {
  METRICS_CATALOG,
} from "../metrics/metricsService.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { decryptAPIKeys } from "../encryption.js";
import { generateEmbeddings } from "../embeddingService.js";
import { getPromptConfig, buildPrompt } from "../promptConfigService.js";
import {
  getSchemaForTenant,
  getFallbackSchemaContext,
} from "./schemaContextService.js";

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

export interface CohiChatMessage {
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
    | "horizontal_bar"
    | "stacked_bar"
    | "grouped_bar"
    | "treemap"
    | "pivot";
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
  numberFormat?: "number" | "currency" | "percent" | "compact";
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
  pivotConfig?: {
    rowKey: string;
    columnKey: string;
    valueKey: string;
    aggregation?: "sum" | "count" | "avg" | "min" | "max";
  };
}

export interface CohiChatResponse {
  message: string;
  visualization?: VisualizationConfig;
  data?: any[];
  suggestedQuestions?: string[];
  error?: string;
  /** Metric IDs from METRICS_CATALOG that were used in this query */
  metricsUsed?: string[];
  /** The SQL query that was generated and executed (for "Show SQL" feature) */
  sqlQuery?: string;
  /** Sources used to generate the response */
  sources?: {
    dataQuery?: boolean;
    knowledgeBase?: string[];
  };
}

export interface QueryResult {
  rows: any[];
  rowCount: number;
  fields: string[];
}

// ============================================================================
// Schema Context (delegated to SchemaContextService)
// ============================================================================

/**
 * Synchronous fallback for callers that don't have a tenant ID.
 * Prefer getSchemaForTenant(tenantId) whenever possible.
 */
function getSchemaContext(): string {
  return getFallbackSchemaContext();
}

// ============================================================================
// OpenAI Integration
// ============================================================================

async function getOpenAIKey(tenantId?: string): Promise<string> {
  if (tenantId) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

      // Check for rag_settings table in tenant database
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
            "[CohiChat] Found openai_api_key in rag_settings, attempting to decrypt..."
          );
          const decrypted = await decryptAPIKeys({
            openai_api_key: result.rows[0].openai_api_key,
          });
          if (decrypted.openai_api_key) {
            console.log(
              "[CohiChat] Using tenant OpenAI API key from rag_settings"
            );
            return decrypted.openai_api_key;
          }
        }
      }
    } catch (error: any) {
      console.error("[CohiChat] Error fetching tenant API key:", error.message);
    }
  }

  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    console.log("[CohiChat] Using environment OpenAI API key");
    return envKey;
  }

  throw new Error(
    "OpenAI API key not configured. Please add your OpenAI API key in Admin > Settings > RAG Settings, or set OPENAI_API_KEY environment variable on the server."
  );
}

/** Content part for OpenAI multimodal messages (vision) */
type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenAIContentPart[];
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
// RAG Context Retrieval
// ============================================================================

interface RAGSource {
  name: string;
  url: string | null;
  category: string | null;
  isGlobal: boolean;
}

interface RAGContext {
  chunks: string[];
  sources: RAGSource[];
  totalChunks: number;
}

/**
 * Format sources with markdown links when URLs are available
 */
function formatSourcesWithLinks(sources: RAGSource[]): string {
  return sources
    .map((source) => {
      const categoryStr = source.category ? ` (${source.category})` : "";
      const typeStr = source.isGlobal ? " [Global]" : "";

      if (source.url) {
        // Return as markdown link
        return `[${source.name}${categoryStr}](${source.url})${typeStr}`;
      } else {
        // Return plain text
        return `${source.name}${categoryStr}${typeStr}`;
      }
    })
    .join(", ");
}

/**
 * Retrieve relevant context from the knowledge base using RAG
 */
async function retrieveRAGContext(
  tenantId: string,
  question: string,
  topK: number = 5,
  similarityThreshold: number = 0.3 // Lowered for better recall in hybrid mode
): Promise<RAGContext> {
  try {
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);

    // Check if the rag_embeddings table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'rag_embeddings'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log("[CohiChat RAG] rag_embeddings table does not exist");
      return { chunks: [], sources: [], totalChunks: 0 };
    }

    // Generate embedding for the question
    const embeddingResults = await generateEmbeddings(
      [question],
      "openai/text-embedding-3-large"
    );

    if (!embeddingResults || embeddingResults.length === 0) {
      console.log("[CohiChat RAG] Failed to generate embedding for question");
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
        d.source_url,
        1 - (e.embedding <=> $1::vector) as similarity
       FROM rag_embeddings e
       JOIN rag_documents d ON e.document_id = d.id
       WHERE d.status = 'indexed'
         AND 1 - (e.embedding <=> $1::vector) >= $2
       ORDER BY e.embedding <=> $1::vector
       LIMIT $3`,
      [embeddingVector, similarityThreshold, topK]
    );

    if (results.rows.length > 0) {
      console.log(
        `[CohiChat RAG] Found ${results.rows.length} relevant chunks:`,
        results.rows.slice(0, 3).map((r: any) => ({
          title: r.title,
          similarity: r.similarity?.toFixed(4),
        }))
      );
    }

    const chunks = results.rows.map((r: any) => r.chunk_text);

    // Build structured sources with URLs (deduplicated)
    const sourceMap = new Map<string, RAGSource>();
    for (const r of results.rows) {
      const docName = r.title || r.filename;
      if (!sourceMap.has(docName)) {
        sourceMap.set(docName, {
          name: docName,
          url: r.source_url || null,
          category: r.category || null,
          isGlobal: r.is_global || false,
        });
      }
    }
    const sources = Array.from(sourceMap.values());

    return {
      chunks,
      sources,
      totalChunks: chunks.length,
    };
  } catch (error: any) {
    console.error("[CohiChat RAG] Error retrieving context:", error.message);
    return { chunks: [], sources: [], totalChunks: 0 };
  }
}

// ============================================================================
// Metric Detection
// ============================================================================

function detectMetricsUsed(sql: string, question: string): string[] {
  const metricsUsed: Set<string> = new Set();
  const lowerSql = sql.toLowerCase();
  const lowerQuestion = question.toLowerCase();

  for (const metric of Object.values(METRICS_CATALOG)) {
    const metricId = metric.id.toLowerCase();
    const metricName = metric.name.toLowerCase();

    if (
      lowerQuestion.includes(metricId.replace(/_/g, " ")) ||
      lowerQuestion.includes(metricName)
    ) {
      metricsUsed.add(metric.id);
    }

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

function extractKeyPatterns(sqlQuery: string): string[] {
  const patterns: string[] = [];

  const aggregateMatch = sqlQuery.match(
    /(AVG|SUM|COUNT|MAX|MIN)\s*\([^)]+\)/gi
  );
  if (aggregateMatch) {
    patterns.push(...aggregateMatch.map((m) => m.replace(/\s+/g, "")));
  }

  if (sqlQuery.includes("CASE") && sqlQuery.includes("WHEN")) {
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
  conversationHistory: CohiChatMessage[] = []
): Promise<GeneratedQuery | null> {
  try {
    const apiKey = await getOpenAIKey(context.tenantId);

    // Get tenant-specific schema context (dynamic introspection with fallback)
    const schemaContext = context.tenantId
      ? await getSchemaForTenant(context.tenantId)
      : getSchemaContext();

    // Get current date context
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentQuarter = Math.ceil(currentMonth / 3);

    // Get prompt configuration from database (with fallback to defaults)
    const promptConfig = await getPromptConfig("cohi_chat.query_generation");

    // Build the system prompt with variable substitution
    // The prompt template uses {{variableName}} syntax
    const systemPrompt = buildPrompt(promptConfig.system_prompt, {
      LOAN_SCHEMA_CONTEXT: schemaContext,
      metricsContext: schemaContext, // Schema context now includes metrics from METRICS_CATALOG
      currentDate: now.toISOString().split("T")[0],
      currentYear: currentYear.toString(),
      currentMonth: currentMonth.toString(),
      currentQuarter: currentQuarter.toString(),
    });

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
      temperature: promptConfig.temperature,
      jsonMode: promptConfig.json_mode,
      maxTokens: promptConfig.max_tokens,
    });

    const parsed = JSON.parse(response);

    // Check if this was determined to not be a data query
    if (parsed.isDataQuery === false) {
      console.log(
        `[CohiChat] Query generator determined this is not a data query: ${parsed.reason}`
      );
      return null;
    }

    return {
      sql: parsed.sql,
      params: parsed.params || [],
      explanation: parsed.explanation,
      visualizationType: parsed.visualizationType || "table",
      chartConfig: parsed.chartConfig || {},
    };
  } catch (error: any) {
    // This is expected for knowledge-only questions - not a real error
    if (error instanceof SyntaxError) {
      console.log("[CohiChat] No data query needed (knowledge-only question)");
    } else {
      console.log(
        "[CohiChat] Query generation skipped:",
        error.message || error
      );
    }
    return null;
  }
}

// ============================================================================
// Query Auto-Retry (send error back to LLM for correction)
// ============================================================================

async function retryQueryWithError(
  originalQuestion: string,
  failedSql: string,
  errorMessage: string,
  context: ChatContext
): Promise<GeneratedQuery | null> {
  try {
    const apiKey = await getOpenAIKey(context.tenantId);

    const fixPrompt = `The following PostgreSQL query was generated for the user's question but FAILED with an error.

## User's Question
${originalQuestion}

## Failed SQL
${failedSql}

## PostgreSQL Error
${errorMessage}

## Your Task
Fix the SQL query so it executes correctly. Common issues:
- ORDER BY must use column aliases or positional references (1, 2, 3) when GROUP BY uses aliases
- All non-aggregated columns must appear in GROUP BY
- DATE_TRUNC expressions in ORDER BY must match GROUP BY exactly, or use positional refs
- Column names are case-sensitive and must match the schema exactly
- ROUND(double precision, integer) does not exist in PostgreSQL — use ::numeric instead of ::float. Example: ROUND((COUNT(...)::numeric / NULLIF(..., 0) * 100), 1)

Respond with the same JSON format:
{
  "sql": "CORRECTED SELECT ...",
  "params": [],
  "explanation": "Brief explanation of the fix",
  "visualizationType": "bar|line|pie|area|table|kpi|donut|horizontal_bar|stacked_bar|grouped_bar|treemap|pivot",
  "chartConfig": { "title": "...", "xKey": "...", "yKey": "...", "yKeys": ["..."], "pivotConfig": { "rowKey": "...", "columnKey": "...", "valueKey": "...", "aggregation": "sum" } }
}`;

    const messages: OpenAIChatMessage[] = [
      { role: "system", content: fixPrompt },
    ];

    const response = await callOpenAI(messages, apiKey, {
      temperature: 0.1,
      jsonMode: true,
      maxTokens: 1500,
    });

    const parsed = JSON.parse(response);
    if (!parsed.sql) return null;

    console.log(`[CohiChat] Retry: LLM corrected SQL`);
    return {
      sql: parsed.sql,
      params: parsed.params || [],
      explanation: parsed.explanation || "",
      visualizationType: parsed.visualizationType || "table",
      chartConfig: parsed.chartConfig || {},
    };
  } catch (err: any) {
    console.log(`[CohiChat] Retry: LLM fix attempt failed: ${err.message}`);
    return null;
  }
}

// ============================================================================
// Query Sanitization & Execution
// ============================================================================

function sanitizeGeneratedSQL(sql: string): string {
  let sanitized = sql;
  sanitized = sanitized.replace(
    /INTERVAL\s*'(\d+)\s*quarters?'/gi,
    (_, num) => `INTERVAL '${parseInt(num) * 3} months'`
  );
  sanitized = sanitized.replace(
    /INTERVAL\s*'1\s*quarter'/gi,
    `INTERVAL '3 months'`
  );
  sanitized = sanitized.replace(/INTERVAL\s*"([^"]+)"/gi, `INTERVAL '$1'`);
  // Fix ROUND(::float, n) → ROUND(::numeric, n) — PostgreSQL ROUND with precision only works on numeric
  sanitized = sanitized.replace(/::float\b/gi, "::numeric");
  sanitized = sanitized.replace(/::double precision\b/gi, "::numeric");
  sanitized = sanitized.replace(/\s{2,}/g, " ");
  return sanitized.trim();
}

async function executeQuery(
  sql: string,
  params: any[],
  context: ChatContext
): Promise<QueryResult> {
  const sanitizedSql = sanitizeGeneratedSQL(sql);
  const normalizedSql = sanitizedSql.trim().toUpperCase();

  if (!normalizedSql.startsWith("SELECT") && !normalizedSql.startsWith("WITH")) {
    throw new Error("Only SELECT queries are allowed");
  }

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
  console.log(`[CohiChat] Executing SQL: ${sanitizedSql}`);
  const result = await pool.query(sanitizedSql, params);
  const executionTime = Date.now() - startTime;

  console.log(
    `[CohiChat] Query executed in ${executionTime}ms, returned ${result.rows.length} rows`
  );

  return {
    rows: result.rows,
    rowCount: result.rows.length,
    fields:
      result.fields?.map((f) => f.name) || Object.keys(result.rows[0] || {}),
  };
}

// ============================================================================
// Visualization Building
// ============================================================================

/**
 * Validate that a key actually exists in the data columns.
 * Falls back to fuzzy matching (case-insensitive, underscore/space-normalized),
 * then to a positional fallback from the actual columns.
 */
function validateKey(
  key: string | undefined,
  cols: string[],
  fallbackIndex: number,
  preferNumeric?: boolean,
  sampleRow?: Record<string, any>
): string {
  if (key && cols.includes(key)) return key;

  // Fuzzy match
  if (key) {
    const normalized = key.toLowerCase().replace(/[_\s]/g, "");
    const match = cols.find(
      (c) => c.toLowerCase().replace(/[_\s]/g, "") === normalized
    );
    if (match) {
      console.log(
        `[buildVisualizationConfig] Fuzzy-matched key "${key}" → "${match}"`
      );
      return match;
    }
  }

  // Fallback: for numeric preference, find first numeric column
  if (preferNumeric && sampleRow) {
    const numCol = cols.find((c) => typeof sampleRow[c] === "number");
    if (numCol) return numCol;
  }

  return cols[fallbackIndex] || cols[0] || key || "value";
}

function buildVisualizationConfig(
  data: any[],
  queryConfig: GeneratedQuery
): VisualizationConfig {
  const chartConfig = queryConfig.chartConfig as any;
  const humanize = (key: string): string =>
    key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const cols = Object.keys(data[0] || {});
  const sampleRow = data[0] || {};

  // Classify columns
  const sampleRows = data.slice(0, Math.min(5, data.length));
  const numericCols = cols.filter((c) =>
    sampleRows.some((row) => typeof row[c] === "number" && !isNaN(row[c]))
  );
  const nonNumericCols = cols.filter((c) => !numericCols.includes(c));

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
    case "stacked_bar":
    case "grouped_bar":
    case "line":
    case "area": {
      // Validate xKey: prefer non-numeric columns for category axis
      const xKey = validateKey(
        chartConfig.xKey,
        cols,
        0,
        false,
        sampleRow
      );
      // Validate yKey: prefer numeric columns for value axis
      const rawYKey = chartConfig.yKey;
      const yKey = validateKey(
        rawYKey,
        cols.filter((c) => c !== xKey),
        0,
        true,
        sampleRow
      );
      // Validate yKeys if present
      const validatedYKeys = chartConfig.yKeys
        ?.map((k: string) => validateKey(k, cols, 0, true, sampleRow))
        .filter((k: string) => k !== xKey);

      if (
        (chartConfig.xKey && chartConfig.xKey !== xKey) ||
        (chartConfig.yKey && chartConfig.yKey !== yKey)
      ) {
        console.warn(
          `[buildVisualizationConfig] Key validation: xKey "${chartConfig.xKey}" → "${xKey}", yKey "${chartConfig.yKey}" → "${yKey}". Columns: [${cols.join(", ")}]`
        );
      }

      return {
        ...baseConfig,
        xKey,
        yKey,
        yKeys: validatedYKeys?.length ? validatedYKeys : undefined,
        xLabel: chartConfig.xLabel || humanize(xKey),
        yLabel: chartConfig.yLabel || humanize(yKey),
        stacked:
          queryConfig.visualizationType === "stacked_bar"
            ? true
            : chartConfig.stacked,
        colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
      };
    }

    case "pie":
    case "donut": {
      const nameKey = validateKey(
        chartConfig.nameKey,
        cols,
        0,
        false,
        sampleRow
      );
      const valueKey = validateKey(
        chartConfig.valueKey,
        cols.filter((c) => c !== nameKey),
        0,
        true,
        sampleRow
      );
      return {
        ...baseConfig,
        nameKey,
        valueKey,
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
    }

    case "treemap": {
      const tmNameKey = validateKey(
        chartConfig.nameKey || chartConfig.xKey,
        cols,
        0,
        false,
        sampleRow
      );
      const tmValueKey = validateKey(
        chartConfig.valueKey || chartConfig.yKey,
        cols.filter((c) => c !== tmNameKey),
        0,
        true,
        sampleRow
      );
      return {
        ...baseConfig,
        nameKey: tmNameKey,
        valueKey: tmValueKey,
        colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
      };
    }

    case "pivot": {
      const pivotRowKey = validateKey(
        chartConfig.pivotConfig?.rowKey || chartConfig.xKey,
        cols,
        0,
        false,
        sampleRow
      );
      const pivotColKey = validateKey(
        chartConfig.pivotConfig?.columnKey,
        cols.filter((c) => c !== pivotRowKey),
        1,
        false,
        sampleRow
      );
      const pivotValKey = validateKey(
        chartConfig.pivotConfig?.valueKey || chartConfig.yKey,
        cols.filter((c) => c !== pivotRowKey && c !== pivotColKey),
        0,
        true,
        sampleRow
      );
      return {
        ...baseConfig,
        pivotConfig: {
          rowKey: pivotRowKey,
          columnKey: pivotColKey,
          valueKey: pivotValKey,
          aggregation: chartConfig.pivotConfig?.aggregation || "sum",
        },
      };
    }

    case "kpi": {
      const firstRow = data[0] || {};
      const kpiValueKey = numericCols[0] || Object.keys(firstRow)[0];
      return {
        ...baseConfig,
        yKey: kpiValueKey,
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
    }

    case "table":
    default: {
      const columns = cols.map((key) => ({
        key,
        label: humanize(key),
        format: undefined,
      }));
      return {
        ...baseConfig,
        tableConfig: { columns, sortable: true, pageSize: 10 },
      };
    }
  }
}

// ============================================================================
// Insight Metrics (for open-ended questions)
// ============================================================================

async function gatherInsightMetrics(
  context: ChatContext
): Promise<Record<string, any>> {
  const tenantPool = await tenantDbManager.getTenantPool(context.tenantId);
  const metrics: Record<string, any> = {};
  const now = new Date();
  const currentYear = now.getFullYear();

  const safeQuery = async (name: string, sql: string): Promise<any[]> => {
    try {
      const result = await tenantPool.query(sql);
      return result.rows;
    } catch (error) {
      console.log(`[CohiChat Insights] Query "${name}" failed:`, error);
      return [];
    }
  };

  // Volume summary (rolling 30-day periods)
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

  // Active loans
  const activeLoans = await safeQuery(
    "activeLoans",
    `
    SELECT 
      COUNT(CASE WHEN l.current_loan_status = 'Active Loan' AND l.application_date IS NOT NULL AND (l.is_archived IS DISTINCT FROM TRUE) THEN 1 END) as active_count,
      COALESCE(SUM(CASE WHEN l.current_loan_status = 'Active Loan' AND l.application_date IS NOT NULL AND (l.is_archived IS DISTINCT FROM TRUE) THEN l.loan_amount ELSE 0 END), 0) as active_volume
    FROM public.loans l
  `
  );
  metrics.activeLoans = activeLoans[0] || { active_count: 0, active_volume: 0 };

  // Top performers
  const topPerformers = await safeQuery(
    "topPerformers",
    `
    SELECT 
      COALESCE(loan_officer, 'Unknown') as loan_officer,
      COUNT(*) as loan_count,
      COALESCE(SUM(loan_amount), 0) as total_volume
    FROM public.loans l
    WHERE application_date >= CURRENT_DATE - INTERVAL '30 days' AND loan_officer IS NOT NULL
    GROUP BY loan_officer
    ORDER BY total_volume DESC
    LIMIT 5
  `
  );
  metrics.topPerformers = topPerformers;

  // Recent funding
  const recentFunding = await safeQuery(
    "recentFunding",
    `
    SELECT 
      COUNT(*) FILTER (WHERE funding_date >= CURRENT_DATE - INTERVAL '7 days') as funded_last_7_days,
      COUNT(*) FILTER (WHERE funding_date >= CURRENT_DATE - INTERVAL '30 days') as funded_last_30_days
    FROM public.loans l WHERE funding_date IS NOT NULL
  `
  );
  metrics.funding = recentFunding[0] || {};

  return metrics;
}

// ============================================================================
// Suggested Questions
// ============================================================================

function generateSuggestedQuestions(
  currentQuestion: string,
  hasKnowledge: boolean
): string[] {
  const q = currentQuestion.toLowerCase();

  const dataSuggestions = [
    "Show me loan volume by month",
    "Top 10 loan officers by revenue",
    "Pipeline breakdown by status",
    "Funding trends this quarter",
  ];

  const knowledgeSuggestions = [
    "What are the FHA loan requirements?",
    "Explain DTI ratio guidelines",
    "What documentation is required for VA loans?",
  ];

  const hybridSuggestions = [
    "How do our FHA loans compare to guidelines?",
    "Show me loans that might not meet compliance thresholds",
  ];

  // Mix based on context
  if (hasKnowledge) {
    return [
      ...dataSuggestions.slice(0, 2),
      ...knowledgeSuggestions.slice(0, 2),
    ];
  }

  return dataSuggestions;
}

// ============================================================================
// Main Hybrid Processing
// ============================================================================

interface GatheredContext {
  dataQueryResult?: {
    query: GeneratedQuery;
    result: QueryResult;
    formattedData: any[];
  };
  ragContext: RAGContext;
  insightMetrics?: Record<string, any>;
}

/**
 * Gather all available context in parallel
 */
async function gatherAllContext(
  question: string,
  context: ChatContext,
  conversationHistory: CohiChatMessage[]
): Promise<GatheredContext> {
  console.log(`[CohiChat] Gathering context for: "${question}"`);

  // Run all context gathering in parallel
  const [ragContext, queryConfig] = await Promise.all([
    retrieveRAGContext(context.tenantId, question, 5, 0.3),
    generateQuery(question, context, conversationHistory),
  ]);

  let dataQueryResult: GatheredContext["dataQueryResult"] = undefined;

  // If we got a valid query, try to execute it (with one auto-retry on failure)
  if (queryConfig?.sql) {
    const effectiveConfig = queryConfig;
    try {
      const result = await executeQuery(
        effectiveConfig.sql,
        effectiveConfig.params,
        context
      );
      if (result.rowCount > 0) {
        const formattedData = formatDataRows(result.rows);
        dataQueryResult = {
          query: effectiveConfig,
          result,
          formattedData,
        };
      }
    } catch (firstError: any) {
      console.log(
        `[CohiChat] Data query failed: ${firstError.message} — attempting auto-retry`
      );

      // Auto-retry: ask the LLM to fix the SQL based on the error
      try {
        const fixedConfig = await retryQueryWithError(
          question,
          effectiveConfig.sql,
          firstError.message,
          context
        );
        if (fixedConfig?.sql && fixedConfig.sql !== effectiveConfig.sql) {
          console.log(
            `[CohiChat] Retry: executing corrected SQL`
          );
          const retryResult = await executeQuery(
            fixedConfig.sql,
            fixedConfig.params,
            context
          );
          if (retryResult.rowCount > 0) {
            const formattedData = formatDataRows(retryResult.rows);
            dataQueryResult = {
              query: fixedConfig,
              result: retryResult,
              formattedData,
            };
          }
        }
      } catch (retryError: any) {
        console.log(
          `[CohiChat] Retry also failed: ${retryError.message}`
        );
      }
    }
  }

  // Gather insight metrics for open-ended questions
  let insightMetrics: Record<string, any> | undefined;
  const isOpenEnded =
    /how are we|what.*(important|happening|know)|status|update|overview/i.test(
      question
    );
  if (isOpenEnded) {
    try {
      insightMetrics = await gatherInsightMetrics(context);
    } catch (error) {
      console.log("[CohiChat] Failed to gather insight metrics");
    }
  }

  console.log(
    `[CohiChat] Context gathered - Data: ${!!dataQueryResult}, Knowledge: ${
      ragContext.totalChunks
    } chunks, Insights: ${!!insightMetrics}`
  );

  return {
    dataQueryResult,
    ragContext,
    insightMetrics,
  };
}

/**
 * Generate a unified response using all available context
 */
async function generateUnifiedResponse(
  question: string,
  context: ChatContext,
  gathered: GatheredContext
): Promise<CohiChatResponse> {
  const apiKey = await getOpenAIKey(context.tenantId);

  // Build context sections for the LLM
  const contextParts: string[] = [];

  // Add knowledge base context if available
  if (gathered.ragContext.totalChunks > 0) {
    contextParts.push("## Knowledge Base Information");
    // List source names for context
    const sourceNames = gathered.ragContext.sources
      .map((s) => s.name)
      .join(", ");
    contextParts.push(`Sources: ${sourceNames}`);
    gathered.ragContext.chunks.forEach((chunk, i) => {
      contextParts.push(`[Excerpt ${i + 1}]:\n${chunk}`);
    });
  }

  // Add loan data if available
  if (gathered.dataQueryResult) {
    contextParts.push("\n## Your Loan Data (Query Results)");
    const preview = gathered.dataQueryResult.formattedData.slice(0, 15);
    contextParts.push(`Query: ${gathered.dataQueryResult.query.explanation}`);
    contextParts.push(
      `Results (${gathered.dataQueryResult.result.rowCount} rows):`
    );
    contextParts.push(JSON.stringify(preview, null, 2));
    if (gathered.dataQueryResult.result.rowCount > 15) {
      contextParts.push(
        `... and ${gathered.dataQueryResult.result.rowCount - 15} more rows`
      );
    }
  }

  // Add insight metrics if available
  if (gathered.insightMetrics) {
    contextParts.push("\n## Current Business Metrics");
    contextParts.push(
      `Active Pipeline: ${
        gathered.insightMetrics.activeLoans?.active_count || 0
      } loans`
    );
    contextParts.push(
      `Last 30 Days: ${
        gathered.insightMetrics.volume?.recent_count || 0
      } new applications`
    );
    if (gathered.insightMetrics.topPerformers?.length > 0) {
      contextParts.push(
        "Top Performers: " +
          gathered.insightMetrics.topPerformers
            .map((p: any) => p.loan_officer)
            .join(", ")
      );
    }
  }

  const hasAnyContext = contextParts.length > 0;

  // Get prompt configuration from database (with fallback to defaults)
  const promptConfig = await getPromptConfig("cohi_chat.response");

  // Build the system prompt with variable substitution
  const systemPrompt = buildPrompt(promptConfig.system_prompt, {
    combinedContext: hasAnyContext
      ? contextParts.join("\n\n")
      : "No specific context available for this query.",
  });

  const messages: OpenAIChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: question },
  ];

  const response = await callOpenAI(messages, apiKey, {
    temperature: promptConfig.temperature,
    maxTokens: promptConfig.max_tokens,
  });

  // Build visualization if we have data
  let visualization: VisualizationConfig | undefined;
  let data: any[] | undefined;

  if (gathered.dataQueryResult) {
    visualization = buildVisualizationConfig(
      gathered.dataQueryResult.formattedData,
      gathered.dataQueryResult.query
    );
    data = gathered.dataQueryResult.formattedData;
  }

  // Add source attribution with links
  let message = response;
  if (gathered.ragContext.sources.length > 0) {
    message += `\n\n📚 **Sources:** ${formatSourcesWithLinks(
      gathered.ragContext.sources
    )}`;
  }

  return {
    message,
    visualization,
    data,
    sqlQuery: gathered.dataQueryResult?.query?.sql || undefined,
    suggestedQuestions: generateSuggestedQuestions(
      question,
      gathered.ragContext.totalChunks > 0
    ),
    sources: {
      dataQuery: !!gathered.dataQueryResult,
      knowledgeBase:
        gathered.ragContext.sources.length > 0
          ? gathered.ragContext.sources.map((s) => {
              const categoryStr = s.category ? ` (${s.category})` : "";
              const typeStr = s.isGlobal ? " [Global]" : "";
              return s.url
                ? `[${s.name}${categoryStr}](${s.url})${typeStr}`
                : `${s.name}${categoryStr}${typeStr}`;
            })
          : undefined,
    },
  };
}

// ============================================================================
// Non-Query Handlers (greetings, help, etc.)
// ============================================================================

function isGreeting(question: string): boolean {
  return /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|greetings)\b/i.test(
    question.toLowerCase().trim()
  );
}

function isHelp(question: string): boolean {
  return /^(help|what can you do|how do you work|what are you|who are you)\b/i.test(
    question.toLowerCase().trim()
  );
}

function generateGreetingResponse(): CohiChatResponse {
  return {
    message:
      "Hello! I'm Cohi, your AI assistant. I can help you with:\n\n" +
      "**📊 Data Analysis** - Ask about your loans, pipeline, performance metrics\n" +
      "**📚 Knowledge** - Questions about regulations, guidelines, policies\n" +
      "**🔍 Combined Insights** - I'll automatically find relevant data AND knowledge\n\n" +
      "What would you like to know?",
    suggestedQuestions: [
      "What's important to know today?",
      "Show me loan volume by month",
      "What are the FHA requirements?",
      "Top loan officers by revenue",
    ],
  };
}

function generateHelpResponse(): CohiChatResponse {
  return {
    message:
      "I'm Cohi, your intelligent mortgage analytics assistant! Here's how I can help:\n\n" +
      "**Ask me anything** - I automatically search both your loan data AND our knowledge base to give you the most complete answer.\n\n" +
      "**Example questions:**\n" +
      '- "Show me loans by branch" → Data visualization\n' +
      '- "What are FHA guidelines?" → Knowledge base lookup\n' +
      '- "How do our VA loans compare to requirements?" → Combined analysis\n' +
      '- "What\'s happening today?" → Executive summary\n\n' +
      "Just ask naturally - I'll figure out the best way to answer!",
    suggestedQuestions: [
      "What important info do I need to know today?",
      "Show me pipeline by status",
      "What documentation is required for VA loans?",
      "Top performers this month",
    ],
  };
}

// ============================================================================
// Main Chat Function
// ============================================================================

export async function processCohiQuestion(
  question: string,
  context: ChatContext,
  conversationHistory: CohiChatMessage[] = []
): Promise<CohiChatResponse> {
  try {
    console.log(
      `[CohiChat] Processing: "${question}" for tenant ${context.tenantId}`
    );

    // Handle simple cases first
    if (isGreeting(question)) {
      return generateGreetingResponse();
    }

    if (isHelp(question)) {
      return generateHelpResponse();
    }

    // Gather all context in parallel (the key innovation!)
    const gathered = await gatherAllContext(
      question,
      context,
      conversationHistory
    );

    // Generate unified response
    return await generateUnifiedResponse(question, context, gathered);
  } catch (error: any) {
    console.error("[CohiChat] Error processing question:", error);

    let userMessage = "I encountered an error while processing your question.";

    if (error.code === "42703") {
      userMessage =
        "I tried to use a field that doesn't exist in your data. Let me try a different approach.";
    } else if (error.message?.includes("OpenAI")) {
      userMessage =
        "I'm having trouble connecting to my AI assistant. Please try again.";
    }

    return {
      message: userMessage + " Here are some questions you can try:",
      error: error.message,
      suggestedQuestions: [
        "Show me loan volume by month",
        "Top 10 loan officers",
        "Pipeline breakdown",
        "What are the FHA requirements?",
      ],
    };
  }
}

// ============================================================================
// Refine Query
// ============================================================================

export async function refineCohiQuery(
  originalQuestion: string,
  refinement: string,
  previousResult: CohiChatResponse,
  context: ChatContext
): Promise<CohiChatResponse> {
  const combinedQuestion = `Based on the previous question "${originalQuestion}", ${refinement}`;

  const history: CohiChatMessage[] = [
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

  return processCohiQuestion(combinedQuestion, context, history);
}

// ============================================================================
// Data Formatting Utilities
// ============================================================================

function isISODateString(value: any): boolean {
  if (value instanceof Date) return true;
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/.test(value);
}

function isNumericString(value: any): boolean {
  if (typeof value !== "string") return false;
  return /^-?\d+(\.\d+)?$/.test(value);
}

function formatDateValue(value: string | Date): string {
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return String(value);

    const day = date.getDate();
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const year = date.getFullYear();

    const dayOfWeek = date.getDay();
    const isLikelyWeekStart =
      (dayOfWeek === 0 || dayOfWeek === 1) &&
      [1, 2, 7, 8, 14, 15, 21, 22, 28, 29].includes(day);
    const isFirstOfMonth = day === 1;

    if (isFirstOfMonth) {
      return `${month} ${year}`;
    } else if (isLikelyWeekStart) {
      return `Week of ${month} ${day}`;
    } else {
      return `${month} ${day}`;
    }
  } catch {
    return String(value);
  }
}

function formatDataRows(rows: any[]): any[] {
  if (!rows || rows.length === 0) return rows;

  return rows.map((row) => {
    const formatted: Record<string, any> = {};

    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) {
        formatted[key] = null;
      } else if (isISODateString(value)) {
        formatted[key] = formatDateValue(value as string);
      } else if (isNumericString(value)) {
        const num = parseFloat(value as string);
        formatted[key] = num % 1 === 0 ? num : Math.round(num * 100) / 100;
      } else if (typeof value === "number") {
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
// Exports
// ============================================================================

// ============================================================================
// Edit Widget – takes current SQL + vizConfig + user instruction, returns updated
// ============================================================================

/** A single turn in the edit-widget conversation */
export interface EditWidgetMessage {
  role: "user" | "assistant";
  content: string;
}

export async function editWidgetQuery(
  currentSql: string,
  currentVizConfig: Partial<VisualizationConfig>,
  instruction: string,
  context: ChatContext,
  history?: EditWidgetMessage[]
): Promise<{
  sql: string;
  vizConfig: VisualizationConfig;
  message: string;
  /** Whether the LLM chose to modify the query (false = conversational/clarification only) */
  modified: boolean;
}> {
  const apiKey = await getOpenAIKey(context.tenantId);
  const schemaContext = context.tenantId
    ? await getSchemaForTenant(context.tenantId)
    : getSchemaContext();

  const now = new Date();
  const systemPrompt = `You are Cohi, a friendly and expert SQL/data visualization assistant. The user is editing an existing dashboard widget and chatting with you about it.

## Database Schema
${schemaContext}

## Current Date Context
- Current date: ${now.toISOString().split("T")[0]}
- Current year: ${now.getFullYear()}

## Current Widget State
### SQL Query
\`\`\`sql
${currentSql}
\`\`\`

### Visualization Config
- Type: ${currentVizConfig.type || "bar"}
- Title: ${currentVizConfig.title || ""}
${currentVizConfig.xKey ? `- X Key: ${currentVizConfig.xKey}` : ""}
${currentVizConfig.yKey ? `- Y Key: ${currentVizConfig.yKey}` : ""}
${currentVizConfig.yKeys ? `- Y Keys: ${currentVizConfig.yKeys.join(", ")}` : ""}

## Your Behavior
- Be conversational and helpful. Explain what you're doing and why in plain, non-technical language.
- The user is a business user, NOT a developer. NEVER show SQL, code, column names, or technical details in your message text.
- Instead of showing code, describe changes in business terms (e.g. "I've updated the approved percentage to use the underwriter final approval date instead" rather than showing SQL).
- If the user asks a question (e.g. "why is this column all zeros?"), investigate the SQL and schema, explain the likely cause in plain language, and suggest or apply fixes.
- If the user asks for a change, make it and explain what changed in simple terms.
- If you're unsure what they want, ask clarifying questions.

## Response Format

**CRITICAL: Your message text must NEVER contain SQL, code blocks, column names, or technical syntax. The user cannot see or understand code.**

When you want to modify the widget, write a friendly plain-text explanation of what you changed, then include EXACTLY ONE fenced JSON block at the very END of your message. The JSON block will be stripped before the user sees your message — it is only for the system to process:

\`\`\`json
{
  "sql": "SELECT ...",
  "visualizationType": "bar"|"line"|"pie"|"area"|"table"|"kpi"|"donut"|"horizontal_bar"|"stacked_bar"|"grouped_bar"|"treemap"|"pivot",
  "chartConfig": {
    "title": "...",
    "xKey": "...",
    "yKey": "...",
    "yKeys": ["...", "..."],
    "xLabel": "...",
    "yLabel": "...",
    "nameKey": "...",
    "valueKey": "...",
    "pivotConfig": { "rowKey": "...", "columnKey": "...", "valueKey": "...", "aggregation": "sum" }
  }
}
\`\`\`
Notes: yKeys only for stacked_bar/grouped_bar. pivotConfig only for pivot type. nameKey/valueKey for pie/donut/treemap.

When you do NOT want to modify the widget (just answering or clarifying), respond in plain text only with NO code blocks of any kind.

NEVER use \`\`\`sql blocks, \`\`\`typescript blocks, or any other code fences besides the single \`\`\`json block described above. SQL goes ONLY inside the JSON block's "sql" field.

## Rules for SQL modifications
- Only generate SELECT queries. Never INSERT, UPDATE, DELETE, DROP, etc.
- The main table is public.loans aliased as "l".
- Preserve the overall intent of the original query while applying changes.
- Verify column names against the schema before using them.
- ALWAYS include the JSON block when making ANY change — even if the user's request seems simple.`;

  // Build the message list with conversation history
  const messages: OpenAIChatMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Include prior conversation turns
  if (history && history.length > 0) {
    for (const turn of history) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  // Add the latest user message
  messages.push({ role: "user", content: instruction });

  const response = await callOpenAI(messages, apiKey, {
    temperature: 0.3,
    jsonMode: false,  // We need free-form text + optional JSON
    maxTokens: 3000,
  });

  // ── Helper: strip ALL code fences from a message (safety net) ──
  function sanitizeMessage(text: string): string {
    return text
      .replace(/```[\w]*\s*[\s\S]*?```/g, "")   // fenced code blocks
      .replace(/`[^`]+`/g, (match) => {          // inline code – replace with the text inside
        const inner = match.slice(1, -1);
        // Keep it if it looks like a normal word/phrase, strip if it looks like code
        return /^[a-z_]+\.[a-z_]+|SELECT|FROM|WHERE|JOIN|GROUP|ORDER/i.test(inner) ? "" : inner;
      })
      .replace(/\n{3,}/g, "\n\n")                // collapse excessive newlines
      .trim();
  }

  // ── Try to extract a JSON block from the response ──
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);

  // Fallback: detect ```sql block (LLM sometimes ignores instructions)
  let fallbackSql: string | null = null;
  if (!jsonMatch) {
    const sqlMatch = response.match(/```sql\s*([\s\S]*?)\s*```/);
    if (sqlMatch) {
      fallbackSql = sqlMatch[1].trim();
    }
  }

  if (jsonMatch) {
    // LLM provided the structured JSON block
    const parsed = JSON.parse(jsonMatch[1]);

    if (!parsed.sql) {
      return {
        sql: currentSql,
        vizConfig: currentVizConfig as VisualizationConfig,
        message: sanitizeMessage(response),
        modified: false,
      };
    }

    const execResult = await executeQuery(parsed.sql, [], context);
    const formattedData = formatDataRows(execResult.rows);

    const queryConfig: GeneratedQuery = {
      sql: parsed.sql,
      params: [],
      explanation: "",
      visualizationType:
        parsed.visualizationType || currentVizConfig.type || "bar",
      chartConfig: parsed.chartConfig || {},
    };

    const vizConfig = buildVisualizationConfig(formattedData, queryConfig);
    vizConfig.title =
      parsed.chartConfig?.title || currentVizConfig.title || vizConfig.title;

    const cleanMessage = sanitizeMessage(response);

    return {
      sql: parsed.sql,
      vizConfig,
      message:
        cleanMessage ||
        "Done! I've updated the widget — take a look at the preview.",
      modified: true,
    };
  }

  if (fallbackSql) {
    // LLM used a ```sql block instead of ```json — still use it
    console.log("[editWidgetQuery] Fallback: extracted SQL from ```sql block");

    const execResult = await executeQuery(fallbackSql, [], context);
    const formattedData = formatDataRows(execResult.rows);

    const queryConfig: GeneratedQuery = {
      sql: fallbackSql,
      params: [],
      explanation: "",
      visualizationType: currentVizConfig.type || "bar",
      chartConfig: {},
    };

    const vizConfig = buildVisualizationConfig(formattedData, queryConfig);
    vizConfig.title = currentVizConfig.title || vizConfig.title;

    const cleanMessage = sanitizeMessage(response);

    return {
      sql: fallbackSql,
      vizConfig,
      message:
        cleanMessage ||
        "Done! I've updated the widget — take a look at the preview.",
      modified: true,
    };
  }

  // No code blocks at all → purely conversational response
  return {
    sql: currentSql,
    vizConfig: currentVizConfig as VisualizationConfig,
    message: sanitizeMessage(response),
    modified: false,
  };
}

// Export main functions
export { generateQuery, executeQuery, buildVisualizationConfig, formatDataRows, callOpenAI, getOpenAIKey };

// Re-export internal types used by dashboard image analysis
export type { OpenAIChatMessage, OpenAIContentPart, GeneratedQuery };
