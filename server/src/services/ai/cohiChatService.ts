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

import {
  METRICS_CATALOG,
} from "../metrics/metricsService.js";
import {
  buildSegmentedPullThroughQuery,
  type PullThroughWindow,
} from "../metrics/canonicalMetrics.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { decryptAPIKeys } from "../encryption.js";
import { retrieveRAGContext, type RAGSource } from "./ragRetrieval.js";
import { getPromptConfig, buildPrompt } from "../promptConfigService.js";
import {
  getSchemaForTenant,
  getFallbackSchemaContext,
} from "./schemaContextService.js";
import { buildPlatformBusinessContext } from "./platformBusinessContext.js";
import { sanitizeNavigationHints } from "../chat/unifiedChatPolicy.js";
import {
  buildGuidanceResponse,
  expandEffectiveQuestionForNavigation,
  hasPullThroughKeyword,
  isCohiGuidanceIntent,
  isNavigationIntent,
  resolveNavigationAnswer,
} from "../chat/cohiNavigationCatalog.js";
import { NAVIGATION_TARGETS } from "../chat/navigationTargetCatalog.js";
import type { LoanAccessFilter } from "../userLoanAccessService.js";
import { isMetricComposerEnabledForSurface } from "../metrics/metricComposerFlags.js";
import { planMetricSpec } from "../metrics/metricPlanner.js";
import {
  composeMetricSql,
  type ComposerResult,
} from "../metrics/metricQueryComposer.js";
import { executeSafeTenantSql } from "../metrics/safeSqlExecutor.js";
import type { MetricSpec } from "../metrics/metricSpec.js";
import {
  injectLoanAccessForLoansAlias,
  mergeLoanAccessWithParameterizedSql,
} from "../metrics/accessEnforcer.js";

// ============================================================================
// Types
// ============================================================================

export interface ChatContext {
  userId: string;
  tenantId: string;
  userRole: string;
  userEmail?: string;
  permissions?: UserPermissions;
  /** Loan-level filter from getLoanAccessContext — applied to composed SQL */
  userAccessFilter?: LoanAccessFilter | null;
  /** When set, SQL generation uses only user-uploaded dataset tables. */
  uploadOnlyMode?: boolean;
  uploadSchemaContext?: string;
  datasetUploadIds?: string[];
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
  /** In-app navigation links (sanitized server-side) */
  navigationHints?: { label: string; path: string }[];
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

  const envKeyRaw = process.env.OPENAI_API_KEY;
  if (envKeyRaw) {
    const envKeyTrimmed = envKeyRaw.trim();
    if (envKeyTrimmed) {
      // Accept either a plain API key string or a JSON secret payload.
      // This avoids environment-specific breakage when Secrets Manager stores JSON.
      let resolvedEnvKey = envKeyTrimmed;
      if (envKeyTrimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(envKeyTrimmed) as {
            api_key?: string;
            apiKey?: string;
            OPENAI_API_KEY?: string;
          };
          const fromJson =
            parsed.api_key || parsed.apiKey || parsed.OPENAI_API_KEY || "";
          if (fromJson.trim()) {
            resolvedEnvKey = fromJson.trim();
          }
        } catch {
          // Keep raw value if it's not valid JSON.
        }
      }
      console.log("[CohiChat] Using environment OpenAI API key");
      return resolvedEnvKey;
    }
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
  const model = process.env.COHI_CHAT_MODEL || "gpt-5.4";
  const maxTokens = options.maxTokens ?? 2000;
  const baseBody: any = {
    model,
    messages,
    temperature: options.temperature ?? 0.3,
  };

  if (options.jsonMode) {
    baseBody.response_format = { type: "json_object" };
  }

  // GPT-5/o-series models require max_completion_tokens instead of max_tokens.
  const prefersCompletionTokens =
    /^(gpt-5|o3|o4)/i.test(model);

  async function post(body: any): Promise<Response> {
    return fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  let response = await post({
    ...baseBody,
    ...(prefersCompletionTokens
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }),
  });

  // Backward/forward compatibility fallback:
  // If OpenAI rejects one token param style, retry once with the other.
  if (!response.ok) {
    let firstErrMsg = "";
    try {
      const firstErr = (await response.json()) as { error?: { message?: string } };
      firstErrMsg = firstErr.error?.message || "";
    } catch {
      // ignore parse failures
    }

    const unsupportedMaxTokens =
      /unsupported parameter:\s*'max_tokens'/i.test(firstErrMsg);
    const unsupportedMaxCompletionTokens =
      /unsupported parameter:\s*'max_completion_tokens'/i.test(firstErrMsg);

    if (unsupportedMaxTokens || unsupportedMaxCompletionTokens) {
      response = await post({
        ...baseBody,
        ...(unsupportedMaxTokens
          ? { max_completion_tokens: maxTokens }
          : { max_tokens: maxTokens }),
      });
    } else {
      // Recreate a response-like flow for the existing error handling below
      const errorObj = { error: { message: firstErrMsg || "Unknown error" } };
      throw new Error(`OpenAI API error: ${errorObj.error.message}`);
    }
  }

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

/**
 * Stream completion tokens from OpenAI (COHI-388 Option C).
 */
export async function callOpenAIStream(
  messages: OpenAIChatMessage[],
  apiKey: string,
  onDelta: (text: string) => void,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const model = process.env.COHI_CHAT_MODEL || "gpt-5.4";
  const maxTokens = options.maxTokens ?? 2000;
  const prefersCompletionTokens = /^(gpt-5|o3|o4)/i.test(model);

  const baseBody: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    stream: true,
    ...(prefersCompletionTokens
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }),
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(baseBody),
  });

  if (!response.ok) {
    let errMsg = response.statusText;
    try {
      const err = (await response.json()) as { error?: { message?: string } };
      errMsg = err.error?.message || errMsg;
    } catch {
      /* ignore */
    }
    throw new Error(`OpenAI API error: ${errMsg}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("OpenAI stream body unavailable");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const piece = parsed.choices?.[0]?.delta?.content;
        if (piece) {
          full += piece;
          onDelta(piece);
        }
      } catch {
        /* ignore partial JSON */
      }
    }
  }

  return full;
}

// ============================================================================
// RAG Context Retrieval
// ============================================================================

interface RAGContext {
  chunks: string[];
  sources: RAGSource[];
  formatted: string;
  totalChunks: number;
}

/**
 * Retrieve relevant RAG context for a chat question (tenant-scoped).
 * Delegates to the shared ragRetrieval module. Requires tenantId to
 * resolve the tenant pool from tenantDbManager.
 */
async function retrieveRAGContextForTenant(
  tenantId: string,
  question: string,
  topK: number = 5,
  threshold: number = 0.3
): Promise<RAGContext> {
  try {
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    return await retrieveRAGContext(question, tenantPool, { topK, threshold, caller: "CohiChat-RAG" });
  } catch (error: any) {
    console.error("[CohiChat RAG] Error retrieving context:", error.message);
    return { chunks: [], sources: [], totalChunks: 0, formatted: "" };
  }
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
  /** True when loan access has already been embedded in SQL/params. */
  accessFilterApplied?: boolean;
}

function buildHeuristicDataQuery(
  question: string,
  accessFilter?: LoanAccessFilter | null
): GeneratedQuery | null {
  const q = question.toLowerCase();

  const asksPullThrough = hasPullThroughKeyword(q);
  const asksComparison = /\b(compare|comparison|rank|ranking|by)\b/.test(q);
  const branchSegment = /\bbranches?\b/.test(q);
  const officerSegment = /\b(loan officers?|officers?)\b/.test(q);
  const topMatch = q.match(/\btop\s+(\d{1,2})\b/);
  const requestedTop = topMatch ? Number.parseInt(topMatch[1], 10) : null;
  const topN =
    requestedTop && Number.isFinite(requestedTop)
      ? Math.min(Math.max(requestedTop, 1), 25)
      : null;
  const segment = branchSegment
    ? "branch"
    : officerSegment
      ? "loan_officer"
      : null;

  let window: PullThroughWindow = "all_time";
  if (/\bthis quarter\b|\bcurrent quarter\b|\bqtd\b/.test(q)) {
    window = "this_quarter";
  } else if (/\blast quarter\b|\bprevious quarter\b/.test(q)) {
    window = "last_quarter";
  } else if (/\bytd\b|\byear to date\b|\bthis year\b/.test(q)) {
    window = "ytd";
  } else if (/\b(last|past)\s+90\s+days\b/.test(q)) {
    window = "last_90_days";
  } else if (/\bthis month\b|\bmtd\b|\bmonth to date\b/.test(q)) {
    window = "this_month";
  }

  if (asksPullThrough && segment && (asksComparison || topN)) {
    const canonical = buildSegmentedPullThroughQuery({
      segment,
      window,
      topN,
      minCompleted: 5,
      accessFilter: accessFilter ?? undefined,
    });
    return {
      sql: canonical.sql,
      params: canonical.params,
      explanation: topN
        ? `Top ${topN} ${canonical.segmentLabel}s by pull-through rate for ${canonical.windowLabel} using canonical metric definitions.`
        : `${canonical.segmentLabel[0].toUpperCase() + canonical.segmentLabel.slice(1)} pull-through comparison for ${canonical.windowLabel} using canonical metric definitions.`,
      visualizationType: "horizontal_bar",
      chartConfig: {
        title: topN
          ? `Top ${topN} ${canonical.segmentLabel}s by pull-through rate — ${canonical.windowLabel}`
          : `Pull-through rate by ${canonical.segmentLabel} — ${canonical.windowLabel}`,
        xKey: canonical.segmentAlias,
        yKey: "pull_through_rate",
        xLabel:
          canonical.segmentLabel[0].toUpperCase() +
          canonical.segmentLabel.slice(1),
        yLabel: "Pull-Through Rate (%)",
      },
      accessFilterApplied: !!accessFilter?.sql,
    };
  }

  return null;
}

async function generateQuery(
  question: string,
  context: ChatContext,
  conversationHistory: CohiChatMessage[] = []
): Promise<GeneratedQuery | null> {
  try {
    const apiKey = await getOpenAIKey(context.tenantId);

    const schemaContext = context.uploadOnlyMode && context.uploadSchemaContext
      ? context.uploadSchemaContext
      : context.tenantId
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

    const heuristicFallback = context.uploadOnlyMode
      ? null
      : buildHeuristicDataQuery(question, context.userAccessFilter);

    // Check if this was determined to not be a data query
    if (parsed.isDataQuery === false) {
      if (heuristicFallback) {
        console.warn(
          "[CohiChat] Query generator returned isDataQuery=false for a deterministic data question; using heuristic fallback query."
        );
        return heuristicFallback;
      }
      console.log(
        `[CohiChat] Query generator determined this is not a data query: ${parsed.reason}`
      );
      return null;
    }

    if (!parsed.sql || typeof parsed.sql !== "string") {
      if (heuristicFallback) {
        console.warn(
          "[CohiChat] Query generator omitted SQL for deterministic data question; using heuristic fallback query."
        );
        return heuristicFallback;
      }
      console.log(
        "[CohiChat] Query generator omitted SQL (expected when isDataQuery is true)"
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
    const heuristicFallback = context.uploadOnlyMode
      ? null
      : buildHeuristicDataQuery(question, context.userAccessFilter);
    if (heuristicFallback) {
      console.warn(
        "[CohiChat] Query generation failed for deterministic data question; using heuristic fallback query."
      );
      return heuristicFallback;
    }

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

export function sanitizeGeneratedSQL(sql: string): string {
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
  // Strip trailing semicolons — they cause "syntax error at or near AND" when
  // conditions are injected after them by the execute-sql filter pipeline.
  sanitized = sanitized.trimEnd().replace(/;+\s*$/, '');
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

  let sqlExec = sanitizedSql;
  let paramsExec = params ?? [];
  const af = context.userAccessFilter;
  if (af?.sql) {
    const merged = mergeLoanAccessWithParameterizedSql(sanitizedSql, params ?? [], af);
    sqlExec = merged.sql;
    paramsExec = merged.params;
  }

  const exec = await executeSafeTenantSql(
    sqlExec,
    pool,
    context.tenantId,
    paramsExec,
    { statementTimeoutMs: 30_000 }
  );

  console.log(
    `[CohiChat] Query executed in ${exec.executionTimeMs}ms, returned ${exec.rowCount} rows`
  );

  return {
    rows: exec.rows as any[],
    rowCount: exec.rowCount,
    fields: exec.fields,
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
      const inj = injectLoanAccessForLoansAlias(sql, context.userAccessFilter);
      const result = await tenantPool.query(inj.sql, inj.params);
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

  // Conversion reliability context:
  // short windows can look "bad" simply because funding lags application by 30-60+ days.
  const conversionReliability = await safeQuery(
    "conversionReliability",
    `
    WITH base AS (
      SELECT
        l.application_date::date AS app_date,
        l.funding_date::date AS fund_date,
        COALESCE(l.current_status_date::date, l.funding_date::date, l.application_date::date) AS status_date,
        LOWER(COALESCE(l.current_loan_status, '')) AS status_lower
      FROM public.loans l
      WHERE l.application_date IS NOT NULL
        AND (l.is_archived IS DISTINCT FROM TRUE)
    ),
    funded_cycle AS (
      SELECT
        AVG(GREATEST((fund_date - app_date), 0))::numeric AS avg_cycle_days_180d,
        COUNT(*)::int AS funded_sample_180d
      FROM base
      WHERE fund_date IS NOT NULL
        AND fund_date >= CURRENT_DATE - INTERVAL '180 days'
    )
    SELECT
      COUNT(*) FILTER (WHERE app_date >= CURRENT_DATE - INTERVAL '30 days')::int AS apps_30d,
      COUNT(*) FILTER (WHERE app_date >= CURRENT_DATE - INTERVAL '90 days')::int AS apps_90d,
      COUNT(*) FILTER (WHERE fund_date >= CURRENT_DATE - INTERVAL '30 days')::int AS funded_30d,
      COUNT(*) FILTER (WHERE fund_date >= CURRENT_DATE - INTERVAL '90 days')::int AS funded_90d,
      COUNT(*) FILTER (
        WHERE status_date >= CURRENT_DATE - INTERVAL '30 days'
          AND (
            status_lower LIKE '%withdraw%'
            OR status_lower LIKE '%not accepted%'
            OR status_lower LIKE '%incomp%'
          )
      )::int AS withdrawn_30d,
      COUNT(*) FILTER (
        WHERE status_date >= CURRENT_DATE - INTERVAL '30 days'
          AND status_lower LIKE '%denied%'
      )::int AS denied_30d,
      COALESCE((SELECT avg_cycle_days_180d FROM funded_cycle), 0)::numeric AS avg_cycle_days_180d,
      COALESCE((SELECT funded_sample_180d FROM funded_cycle), 0)::int AS funded_sample_180d
    FROM base
  `
  );
  metrics.conversionReliability = conversionReliability[0] || {};

  return metrics;
}

function buildBroadPromptReliabilityContext(
  insightMetrics?: Record<string, any>
): string | undefined {
  if (!insightMetrics) return undefined;
  const rel = insightMetrics.conversionReliability || {};
  const avgCycleDays = Number(rel.avg_cycle_days_180d || 0);
  const fundedSample = Number(rel.funded_sample_180d || 0);
  const apps30 = Number(rel.apps_30d || 0);
  const funded30 = Number(rel.funded_30d || 0);
  const apps90 = Number(rel.apps_90d || 0);
  const funded90 = Number(rel.funded_90d || 0);
  const denied30 = Number(rel.denied_30d || 0);
  const withdrawn30 = Number(rel.withdrawn_30d || 0);

  const hasCycleSignal = avgCycleDays > 0 && fundedSample >= 10;
  const shortWindowIsImmature = hasCycleSignal && avgCycleDays >= 30 && apps30 > funded30;
  const reliabilityLabel = shortWindowIsImmature
    ? "provisional-short-window"
    : "acceptable-short-window";

  return [
    "## Broad Prompt Reliability Guardrails",
    `30D snapshot: applications=${apps30}, funded=${funded30}, withdrawn=${withdrawn30}, denied=${denied30}.`,
    `90D snapshot: applications=${apps90}, funded=${funded90}.`,
    `Avg app→fund cycle (funded last 180d): ${avgCycleDays.toFixed(1)} days (sample ${fundedSample}).`,
    `Short-window reliability: ${reliabilityLabel}.`,
    "When short-window reliability is provisional, do NOT frame low funded counts as a critical operational failure by default.",
    "Use neutral wording (pipeline still seasoning) and recommend confirming on 90D/YTD conversion trend before escalation.",
    "Keep response natural and free-form, but tie claims to these metrics and reliability notes.",
  ].join("\n");
}

// ============================================================================
// Suggested Questions
// ============================================================================

function generateSuggestedQuestions(
  currentQuestion: string,
  hasKnowledge: boolean
): string[] {
  const q = currentQuestion.toLowerCase();
  const normalizedQuestion = currentQuestion.replace(/\?+$/g, "").trim();
  const researchHandoff = normalizedQuestion
    ? `Open Research Lab: ${normalizedQuestion}`
    : "Open Research Lab for deeper analysis";

  if (hasPullThroughKeyword(q) && /\bbranches?\b/.test(q)) {
    return [
      "Show top 5 branches by pull-through this quarter",
      "Show pull-through vs fallout by branch this quarter",
      "Compare this quarter vs last quarter pull-through by branch",
      researchHandoff,
    ];
  }

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
      researchHandoff,
    ];
  }

  return [...dataSuggestions, researchHandoff];
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
  platformBusinessContext?: string;
}

function enforceCatalogBackedNavigationCopy(
  question: string,
  rawMessage: string,
): string {
  if (!rawMessage?.trim()) return rawMessage;
  const nav = resolveNavigationAnswer(question);
  if (!nav || nav.hints.length === 0) return rawMessage;

  const knownRouteLabels = NAVIGATION_TARGETS.filter((t) => t.kind === "route")
    .map((t) => t.label.toLowerCase());

  const lines = rawMessage.split("\n");
  let removedUnknownDashboardLine = false;
  const keptLines: string[] = [];

  for (const line of lines) {
    const l = line.toLowerCase();
    const mentionsDashboard =
      /\bdashboard\b/.test(l) || /\binsights\s*[→>-]/.test(l);
    if (!mentionsDashboard) {
      keptLines.push(line);
      continue;
    }

    const includesKnownLabel = knownRouteLabels.some((label) =>
      l.includes(label)
    );
    if (includesKnownLabel) {
      keptLines.push(line);
      continue;
    }

    // Drop ungrounded dashboard references from freeform model text.
    removedUnknownDashboardLine = true;
  }

  if (!removedUnknownDashboardLine) return rawMessage;

  const canonicalHintLines = nav.hints
    .slice(0, 3)
    .map((h) => `- ${h.label}`)
    .join("\n");

  const base = keptLines.join("\n").trim();
  const correction = `Use these available dashboards/pages for this topic:\n${canonicalHintLines}`;
  return base ? `${base}\n\n${correction}` : correction;
}

function stripSourceAttribution(rawMessage: string): string {
  if (!rawMessage?.trim()) return rawMessage;
  return rawMessage
    .split("\n")
    .filter((line) => !/^\s*(📚\s*)?\*{0,2}\s*sources?\s*[:\-]/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPostAnswerNavigationHints(
  question: string,
  hasDataQueryResult: boolean
): { label: string; path: string }[] | undefined {
  if (!hasDataQueryResult) return undefined;
  const q = question.toLowerCase();

  if (hasPullThroughKeyword(q) && /\bbranches?\b/.test(q)) {
    return sanitizeNavigationHints([
      { label: "Company Scorecard", path: "/company-scorecard" },
      { label: "Research Lab (deeper analysis)", path: "/research" },
      { label: "Insights hub", path: "/insights" },
    ]);
  }

  return undefined;
}

function buildRecommendedNavigationHints(
  question: string,
  hasDataQueryResult: boolean
): { label: string; path: string }[] {
  const merged: { label: string; path: string }[] = [];
  const push = (items?: { label: string; path: string }[] | null) => {
    if (!items) return;
    for (const item of items) merged.push(item);
  };

  const nav = resolveNavigationAnswer(question);
  push(nav?.hints);
  push(buildPostAnswerNavigationHints(question, hasDataQueryResult));

  // Always provide stable next-step destinations.
  push([
    { label: "Insights hub", path: "/insights" },
    { label: "Research Lab", path: "/research" },
  ]);

  const sanitized = sanitizeNavigationHints(merged);
  const deduped = sanitized.filter(
    (hint, index, arr) => arr.findIndex((h) => h.path === hint.path) === index
  );
  const researchHint = deduped.find((h) => h.path === "/research") ?? {
    label: "Research Lab",
    path: "/research",
  };
  const insightsHint = deduped.find((h) => h.path === "/insights") ?? {
    label: "Insights hub",
    path: "/insights",
  };

  // Keep core app links consistently visible.
  const prioritized = [
    ...deduped.filter((h) => h.path !== "/research" && h.path !== "/insights"),
    insightsHint,
    researchHint,
  ];

  const capped = prioritized.slice(0, 4);
  if (!capped.some((h) => h.path === "/research")) {
    capped[capped.length - 1] = researchHint;
  }
  if (!capped.some((h) => h.path === "/insights")) {
    const replaceIndex = capped.findIndex((h) => h.path !== "/research");
    if (replaceIndex >= 0) capped[replaceIndex] = insightsHint;
  }
  return capped;
}

function mapComposerToGenerated(
  _spec: MetricSpec,
  composed: ComposerResult,
  question: string
): GeneratedQuery {
  const primary = composed.resolvedMetricIds[0] ?? "metric";
  const name = METRICS_CATALOG[primary]?.name ?? primary;
  const isPt =
    composed.resolvedMetricIds.includes("pull_through_rate") &&
    composed.sql.toLowerCase().includes("pull_through_rate");
  const dim = composed.resolvedDimensions[0];
  if (isPt && dim) {
    const xKey = dim === "branch" ? "branch" : "loan_officer";
    return {
      sql: composed.sql,
      params: composed.params,
      explanation: `Pull-through by ${xKey} (${composed.windowLabel}).`,
      visualizationType: "horizontal_bar",
      chartConfig: {
        title: question.slice(0, 100),
        xKey,
        yKey: "pull_through_rate",
        xLabel: xKey === "branch" ? "Branch" : "Loan officer",
        yLabel: "Pull-Through %",
      },
      accessFilterApplied: true,
    };
  }
  if (composed.resolvedDimensions.length > 0 || composed.sql.includes("group_key")) {
    return {
      sql: composed.sql,
      params: composed.params,
      explanation: `${name} by ${composed.resolvedDimensions.join(", ")} (${composed.windowLabel})`,
      visualizationType: "horizontal_bar",
      chartConfig: {
        title: question.slice(0, 100),
        xKey: "group_key",
        yKey: "metric_value",
        xLabel: "Segment",
        yLabel: name,
      },
      accessFilterApplied: true,
    };
  }
  return {
    sql: composed.sql,
    params: composed.params,
    explanation: `${name} (${composed.windowLabel})`,
    visualizationType: "table",
    chartConfig: {
      title: question.slice(0, 100),
      tableConfig: {
        columns: [{ key: "metric_value", label: name }],
      },
    },
    accessFilterApplied: true,
  };
}

/**
 * Gather all available context in parallel
 */
async function gatherAllContext(
  question: string,
  context: ChatContext,
  conversationHistory: CohiChatMessage[],
  opts?: { includeRag?: boolean },
): Promise<GatheredContext> {
  console.log(`[CohiChat] Gathering context for: "${question}"`);

  const includeRag =
    opts?.includeRag !== false && !context.uploadOnlyMode;
  const includePlatformBusinessContext = !context.uploadOnlyMode;

  let composerQuery: GeneratedQuery | null = null;
  if (!context.uploadOnlyMode && (await isMetricComposerEnabledForSurface("chat"))) {
    try {
      const spec = await planMetricSpec(question, {
        tenantId: context.tenantId,
      });
      if (spec) {
        const composed = composeMetricSql(spec, context.userAccessFilter ?? null);
        composerQuery = mapComposerToGenerated(spec, composed, question);
      }
    } catch (e: unknown) {
      console.warn(
        "[CohiChat] Metric composer planning failed:",
        e instanceof Error ? e.message : e
      );
    }
  }

  const emptyRag: RAGContext = {
    chunks: [],
    sources: [],
    formatted: "",
    totalChunks: 0,
  };

  const [ragContext, legacyQueryConfig, platformBusinessContext] =
    await Promise.all([
      includeRag
        ? retrieveRAGContextForTenant(context.tenantId, question, 5, 0.3)
        : Promise.resolve(emptyRag),
      composerQuery
        ? Promise.resolve(null as GeneratedQuery | null)
        : generateQuery(question, context, conversationHistory),
      includePlatformBusinessContext
        ? buildPlatformBusinessContext(context.tenantId)
        : Promise.resolve(undefined),
    ]);

  const queryConfig = composerQuery ?? legacyQueryConfig;

  let dataQueryResult: GatheredContext["dataQueryResult"] = undefined;

  // If we got a valid query, try to execute it (with one auto-retry on failure)
  if (queryConfig?.sql) {
    const effectiveConfig = queryConfig;
    const contextForQuery = (cfg: GeneratedQuery): ChatContext =>
      cfg.accessFilterApplied
        ? { ...context, userAccessFilter: null }
        : context;
    const heuristicFallback = context.uploadOnlyMode
      ? null
      : buildHeuristicDataQuery(question, context.userAccessFilter);
    try {
      const result = await executeQuery(
        effectiveConfig.sql,
        effectiveConfig.params,
        contextForQuery(effectiveConfig)
      );
      const formattedPrimaryData = formatDataRows(result.rows);
      dataQueryResult = {
        query: effectiveConfig,
        result,
        formattedData: formattedPrimaryData,
      };

      if (
        result.rowCount === 0 &&
        heuristicFallback &&
        sanitizeGeneratedSQL(effectiveConfig.sql) !==
          sanitizeGeneratedSQL(heuristicFallback.sql)
      ) {
        console.warn(
          "[CohiChat] Primary query returned 0 rows for deterministic data question; trying heuristic fallback query."
        );
        const fallbackResult = await executeQuery(
          heuristicFallback.sql,
          heuristicFallback.params,
          contextForQuery(heuristicFallback)
        );
        const formattedData = formatDataRows(fallbackResult.rows);
        dataQueryResult = {
          query: heuristicFallback,
          result: fallbackResult,
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
            contextForQuery(fixedConfig)
          );
          const formattedData = formatDataRows(retryResult.rows);
          dataQueryResult = {
            query: fixedConfig,
            result: retryResult,
            formattedData,
          };
        }
      } catch (retryError: any) {
        console.log(
          `[CohiChat] Retry also failed: ${retryError.message}`
        );
      }

      // Last chance for deterministic question families.
      if (!dataQueryResult && heuristicFallback) {
        try {
          console.warn(
            "[CohiChat] Using heuristic fallback query after execution failures."
          );
          const fallbackResult = await executeQuery(
            heuristicFallback.sql,
            heuristicFallback.params,
            contextForQuery(heuristicFallback)
          );
          const formattedData = formatDataRows(fallbackResult.rows);
          dataQueryResult = {
            query: heuristicFallback,
            result: fallbackResult,
            formattedData,
          };
        } catch (fallbackErr: any) {
          console.log(
            `[CohiChat] Heuristic fallback failed: ${fallbackErr.message}`
          );
        }
      }
    }
  }

  // Gather insight metrics for open-ended questions only when we did not run a data query.
  // Otherwise the response model can mix precomputed "top performers" with SQL rows and contradict the chart.
  let insightMetrics: Record<string, any> | undefined;
  const isOpenEnded =
    /how are we|what.*(important|happening|know)|status|update|overview/i.test(
      question
    );
  if (isOpenEnded && !dataQueryResult) {
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
    platformBusinessContext,
  };
}

/**
 * Generate a unified response using all available context
 */
async function generateUnifiedResponse(
  question: string,
  context: ChatContext,
  gathered: GatheredContext,
  onTextDelta?: (delta: string) => void,
): Promise<CohiChatResponse> {
  const apiKey = await getOpenAIKey(context.tenantId);
  const recommendedHints = buildRecommendedNavigationHints(
    question,
    !!gathered.dataQueryResult
  );

  // Deterministic no-rows handling for executed SQL:
  // avoid model responses that ask the user to provide "query JSON" even though
  // we already ran the query in this request.
  if (
    gathered.dataQueryResult &&
    gathered.dataQueryResult.result.rowCount === 0
  ) {
    const emptyViz = buildVisualizationConfig(
      gathered.dataQueryResult.formattedData,
      gathered.dataQueryResult.query
    );

    let noDataMessage =
      "I ran your request against your portfolio, but there are no rows for this exact filter window.";

    if (/quarter/i.test(question)) {
      noDataMessage +=
        " For this quarter, there may be no completed records yet for that breakdown.";
    }

    noDataMessage +=
      " Try widening the period (for example: last 90 days or year-to-date) to see ranked results.";

    return {
      message: noDataMessage,
      visualization: emptyViz,
      data: gathered.dataQueryResult.formattedData,
      sqlQuery: sanitizeGeneratedSQL(gathered.dataQueryResult.query.sql),
      navigationHints: recommendedHints,
      suggestedQuestions: generateSuggestedQuestions(
        question,
        gathered.ragContext.totalChunks > 0
      ),
    };
  }

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
    const dq = gathered.dataQueryResult;
    contextParts.push("\n## Your Loan Data (Query Results)");
    const preview = dq.formattedData.slice(0, 15);
    contextParts.push(`Query: ${dq.query.explanation}`);
    contextParts.push(
      `Planned visualization: ${dq.query.visualizationType} — ${(dq.query.chartConfig as { title?: string })?.title || "see chartConfig"}. Narration must match this intent and these rows only.`
    );
    contextParts.push(`Results (${dq.result.rowCount} rows):`);
    contextParts.push(JSON.stringify(preview, null, 2));
    if (dq.result.rowCount > 15) {
      contextParts.push(`... and ${dq.result.rowCount - 15} more rows`);
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
    const reliabilityContext = buildBroadPromptReliabilityContext(
      gathered.insightMetrics
    );
    if (reliabilityContext) {
      contextParts.push(`\n${reliabilityContext}`);
    }
  }

  if (gathered.platformBusinessContext) {
    contextParts.push(`\n${gathered.platformBusinessContext}`);
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

  const response = onTextDelta
    ? await callOpenAIStream(messages, apiKey, onTextDelta, {
        temperature: promptConfig.temperature,
        maxTokens: promptConfig.max_tokens,
      })
    : await callOpenAI(messages, apiKey, {
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

  // Keep message grounded to canonical dashboards only.
  let message = response;
  message = enforceCatalogBackedNavigationCopy(question, message);
  message = stripSourceAttribution(message);
  return {
    message,
    visualization,
    data,
    sqlQuery: gathered.dataQueryResult?.query?.sql
      ? sanitizeGeneratedSQL(gathered.dataQueryResult.query.sql)
      : undefined,
    navigationHints: recommendedHints,
    suggestedQuestions: generateSuggestedQuestions(
      question,
      gathered.ragContext.totalChunks > 0
    ),
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

// (generateHelpResponse removed — use buildGuidanceResponse + navigation hints)

// ============================================================================
// Main Chat Function
// ============================================================================

export async function processCohiQuestion(
  question: string,
  context: ChatContext,
  conversationHistory: CohiChatMessage[] = [],
  options?: { includeRag?: boolean },
): Promise<CohiChatResponse> {
  try {
    console.log(
      `[CohiChat] Processing: "${question}" for tenant ${context.tenantId}`
    );

    // Handle simple cases first
    if (isGreeting(question)) {
      return generateGreetingResponse();
    }

    // How-to / meta questions about Cohi (with help-center links)
    if (isCohiGuidanceIntent(question) || isHelp(question)) {
      const g = buildGuidanceResponse();
      return {
        message: g.message,
        navigationHints: sanitizeNavigationHints(g.hints),
        suggestedQuestions: g.suggestedQuestions,
      };
    }

    if (!context.uploadOnlyMode) {
      const expandedNav = expandEffectiveQuestionForNavigation(
        question,
        conversationHistory.map((m) => ({ role: m.role, content: m.content })),
      ).trim();

      const nav = resolveNavigationAnswer(expandedNav);
      const navShortcutAllowed =
        nav !== null &&
        (isNavigationIntent(expandedNav) ||
          isNavigationIntent(question.trim()) ||
          (/^(yes|yeah|yep|please|ok|okay|sure)\b/i.test(question.trim()) &&
            expandedNav !== question.trim()) ||
          /\bgive me (a )?(page|link)\b/i.test(question.trim()));

      if (navShortcutAllowed && nav) {
        return {
          message: nav.message,
          navigationHints: buildRecommendedNavigationHints(expandedNav, false),
          suggestedQuestions: nav.suggestedQuestions,
        };
      }
    }

    const gathered = await gatherAllContext(
      question,
      context,
      conversationHistory,
      { includeRag: options?.includeRag },
    );

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

/**
 * Global chat with live token streaming (COHI-388). Short-circuits match {@link processCohiQuestion}.
 */
export async function processCohiQuestionStreaming(
  question: string,
  context: ChatContext,
  conversationHistory: CohiChatMessage[] = [],
  options?: { includeRag?: boolean; onTextDelta?: (delta: string) => void },
): Promise<CohiChatResponse> {
  if (isGreeting(question)) {
    return generateGreetingResponse();
  }
  if (isCohiGuidanceIntent(question) || isHelp(question)) {
    const g = buildGuidanceResponse();
    options?.onTextDelta?.(g.message);
    return {
      message: g.message,
      navigationHints: sanitizeNavigationHints(g.hints),
      suggestedQuestions: g.suggestedQuestions,
    };
  }

  if (!context.uploadOnlyMode) {
    const expandedNav = expandEffectiveQuestionForNavigation(
      question,
      conversationHistory.map((m) => ({ role: m.role, content: m.content })),
    ).trim();

    const nav = resolveNavigationAnswer(expandedNav);
    const navShortcutAllowed =
      nav !== null &&
      (isNavigationIntent(expandedNav) ||
        isNavigationIntent(question.trim()) ||
        (/^(yes|yeah|yep|please|ok|okay|sure)\b/i.test(question.trim()) &&
          expandedNav !== question.trim()) ||
        /\bgive me (a )?(page|link)\b/i.test(question.trim()));

    if (navShortcutAllowed && nav) {
      options?.onTextDelta?.(nav.message);
      return {
        message: nav.message,
        navigationHints: buildRecommendedNavigationHints(expandedNav, false),
        suggestedQuestions: nav.suggestedQuestions,
      };
    }
  }

  const gathered = await gatherAllContext(
    question,
    context,
    conversationHistory,
    { includeRag: options?.includeRag },
  );

  return generateUnifiedResponse(
    question,
    context,
    gathered,
    options?.onTextDelta,
  );
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

    const day = date.getUTCDate();
    const month = date.toLocaleDateString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
    const year = date.getUTCFullYear();

    return `${month} ${day}, ${year}`;
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
      } else if (typeof value === "object" && !(value instanceof Date)) {
        formatted[key] = JSON.stringify(value);
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
