/**
 * Research Tools
 *
 * Shared utilities for the research analyst agentic system.
 * Provides safe SQL execution, schema introspection, metric definitions,
 * and a unified LLM caller used by all research agents.
 */

import pg from "pg";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { getSchemaForTenant, getFallbackSchemaContext } from "../ai/schemaContextService.js";
import { METRICS_CATALOG, type MetricDefinition } from "../metrics/metricsService.js";
import { decryptAPIKeys } from "../encryption.js";
import { generateEmbeddings } from "../embeddingService.js";

// ============================================================================
// Types
// ============================================================================

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface QueryResult {
  rows: Record<string, any>[];
  rowCount: number;
  fields: string[];
  executionTimeMs: number;
}

// ============================================================================
// OpenAI Key Resolution
// ============================================================================

export async function getOpenAIKey(tenantId?: string): Promise<string> {
  if (tenantId) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);
      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'rag_settings'
        ) AS exists
      `);
      if (tableCheck.rows[0]?.exists) {
        const result = await tenantPool.query(
          `SELECT openai_api_key FROM public.rag_settings LIMIT 1`
        );
        if (result.rows[0]?.openai_api_key) {
          const raw = result.rows[0].openai_api_key;
          const decrypted = await decryptAPIKeys({ openai_api_key: raw });
          if (decrypted.openai_api_key) return decrypted.openai_api_key;
        }
      }
    } catch (err: any) {
      console.error("[Research] Error fetching tenant API key:", err.message);
    }
  }

  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;

  throw new Error("OpenAI API key not configured.");
}

// ============================================================================
// Safe SQL Execution
// ============================================================================

const DANGEROUS_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE",
  "ALTER", "CREATE", "GRANT", "REVOKE",
];

function sanitizeSQL(sql: string): string {
  let sanitized = sql.trim();
  if (sanitized.endsWith(";")) sanitized = sanitized.slice(0, -1).trim();
  return sanitized;
}

function validateSQL(sql: string): void {
  const upper = sql.trim().toUpperCase();
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    throw new Error("Only SELECT queries (and CTEs starting with WITH) are allowed.");
  }
  for (const kw of DANGEROUS_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\s`, "i");
    if (regex.test(upper) && !upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
      throw new Error(`Query contains forbidden keyword: ${kw}`);
    }
  }
}

const QUERY_TIMEOUT_MS = 30_000;

export async function safeExecuteSQL(
  sql: string,
  tenantPool: pg.Pool
): Promise<QueryResult> {
  const sanitized = sanitizeSQL(sql);
  validateSQL(sanitized);

  const startTime = Date.now();

  try {
    await tenantPool.query(`SET statement_timeout = '${QUERY_TIMEOUT_MS}'`);
    const result = await tenantPool.query(sanitized);
    const executionTimeMs = Date.now() - startTime;
    const rows = result.rows.slice(0, 200);

    return {
      rows,
      rowCount: result.rows.length,
      fields: result.fields?.map((f: any) => f.name) || Object.keys(rows[0] || {}),
      executionTimeMs,
    };
  } catch (err: any) {
    throw new Error(`SQL execution error: ${err.message}`);
  }
}

// ============================================================================
// Schema Context
// ============================================================================

export async function getSchemaContext(tenantId: string): Promise<string> {
  try {
    return await getSchemaForTenant(tenantId);
  } catch (err: any) {
    console.warn("[Research] Schema introspection failed, using fallback:", err.message);
    return getFallbackSchemaContext();
  }
}

// ============================================================================
// Metric Definitions
// ============================================================================

export function getMetricDefinitions(): string {
  const lines: string[] = ["## Canonical Metric Definitions\n"];
  for (const [id, def] of Object.entries(METRICS_CATALOG)) {
    lines.push(`### ${def.name} (${id})`);
    lines.push(`- Description: ${def.description}`);
    lines.push(`- Category: ${def.category}`);
    lines.push(`- SQL: ${def.sqlQuery.trim()}`);
    lines.push(`- Date field: ${def.defaultDateField}`);
    if (def.ignoreDateFilter) lines.push(`- Note: Not date-filtered (current snapshot)`);
    lines.push("");
  }
  return lines.join("\n");
}

// ============================================================================
// Unified LLM Caller
// ============================================================================

const MAX_LLM_RETRIES = 2;

export async function callLLM(
  messages: LLMMessage[],
  apiKey: string,
  options: LLMOptions = {}
): Promise<string> {
  const {
    model = "gpt-5.2",
    temperature = 0.4,
    maxTokens = 4000,
    jsonMode = false,
  } = options;

  const body: any = {
    model,
    messages,
    temperature,
    max_completion_tokens: maxTokens,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
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
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content;
    const finishReason = data.choices?.[0]?.finish_reason;

    if (content) return content;

    // Empty response — log details and retry
    console.warn(
      `[LLM] Empty response (attempt ${attempt}/${MAX_LLM_RETRIES}):`,
      {
        model,
        finishReason,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        maxTokens,
        jsonMode,
      }
    );

    if (attempt < MAX_LLM_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  throw new Error("Empty response from OpenAI after retries");
}

// ============================================================================
// Knowledge Base Context (RAG)
// ============================================================================

/**
 * Fetch relevant knowledge base context for the research topic.
 * Embeds the topic/question, searches rag_embeddings for similar chunks,
 * and returns a formatted context string for LLM injection.
 * Graceful: returns empty string on any failure.
 */
export async function getKnowledgeContext(
  tenantPool: pg.Pool,
  tenantId: string,
  topic?: string
): Promise<string> {
  try {
    // Check if rag_embeddings table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'rag_embeddings'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) return "";

    const countCheck = await tenantPool.query(`SELECT COUNT(*) as cnt FROM public.rag_embeddings`);
    if (parseInt(countCheck.rows[0]?.cnt || "0") === 0) return "";

    // Build query texts from the topic
    const queryTexts: string[] = [];
    if (topic) {
      queryTexts.push(topic);
      // Add a more specific phrasing for better recall
      queryTexts.push(`mortgage lending analysis: ${topic}`);
    } else {
      queryTexts.push("mortgage pipeline performance and risk analysis");
      queryTexts.push("loan conversion rates and fallout patterns");
    }

    const embedResults = await generateEmbeddings(queryTexts, "openai/text-embedding-3-large");
    if (!embedResults || embedResults.length === 0) return "";

    const allChunks: Array<{ text: string; score: number; source: string }> = [];
    const seenTexts = new Set<string>();

    for (const embedResult of embedResults) {
      const embStr = `[${embedResult.embedding.join(",")}]`;
      try {
        const result = await tenantPool.query(
          `SELECT
            e.chunk_text,
            d.title,
            d.filename,
            1 - (e.embedding <=> $1::vector) as similarity
          FROM rag_embeddings e
          JOIN rag_documents d ON e.document_id = d.id
          WHERE d.status = 'indexed'
            AND 1 - (e.embedding <=> $1::vector) >= 0.3
          ORDER BY e.embedding <=> $1::vector
          LIMIT 5`,
          [embStr]
        );

        for (const row of result.rows) {
          const text = row.chunk_text?.trim();
          if (!text || seenTexts.has(text)) continue;
          seenTexts.add(text);
          allChunks.push({
            text,
            score: parseFloat(row.similarity),
            source: row.title || row.filename || "Unknown",
          });
        }
      } catch (queryErr: any) {
        console.warn(`[Research-RAG] Knowledge query failed: ${queryErr.message}`);
      }
    }

    if (allChunks.length === 0) return "";

    // Sort by relevance and take top chunks
    allChunks.sort((a, b) => b.score - a.score);
    const topChunks = allChunks.slice(0, 8);

    let context = "## Relevant Knowledge Base Context\n";
    context += "The following excerpts from the tenant's uploaded documents may be relevant:\n\n";
    for (const chunk of topChunks) {
      context += `**[${chunk.source}]** (relevance: ${(chunk.score * 100).toFixed(0)}%)\n`;
      context += `${chunk.text.substring(0, 500)}\n\n`;
    }

    console.log(`[Research-RAG] Found ${topChunks.length} relevant knowledge chunks for topic: "${topic || "general"}"`);
    return context;
  } catch (err: any) {
    console.warn(`[Research-RAG] Knowledge context fetch failed (non-fatal): ${err.message}`);
    return "";
  }
}

// ============================================================================
// Utility: Format query results for LLM context
// ============================================================================

export function formatResultsForLLM(result: QueryResult, maxRows: number = 30): string {
  if (result.rowCount === 0) return "(No rows returned)";

  const { fields, rows } = result;
  const displayRows = rows.slice(0, maxRows);
  const header = fields.join(" | ");
  const dataLines = displayRows.map((row) =>
    fields.map((f) => {
      const v = row[f];
      if (v == null) return "NULL";
      const s = String(v);
      return s.length > 50 ? s.substring(0, 47) + "..." : s;
    }).join(" | ")
  );

  let text = `${header}\n${"-".repeat(header.length)}\n${dataLines.join("\n")}`;
  if (result.rowCount > maxRows) {
    text += `\n... (${result.rowCount} total rows, showing first ${maxRows})`;
  }
  return text;
}
