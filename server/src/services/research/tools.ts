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
    const rows = result.rows.slice(0, 1000);

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
// Business Knowledge Context (Derived Metrics & Tiers)
// ============================================================================

/**
 * Returns a deterministic, hardcoded description of how tiers and composite scores
 * are calculated on this platform. This is NOT RAG — it is platform-specific business
 * logic that must be injected so the AI never looks for a "tier" column.
 *
 * Formulas are derived from server/src/utils/scorecard-utils.ts.
 */
export function getDerivedMetricContext(): string {
  return `## Platform Business Logic: Derived Metrics & Tier Calculations

IMPORTANT: "Tier" is NEVER a stored column in the loans table. Tiers are ALWAYS computed
from composite scores calculated across multiple loan-level metrics. When investigating
personnel tiers, you must compute them from scratch using the formulas below.

---

### TTS (TopTiering Score) — Sales Personnel

The TTS measures a loan officer's performance relative to the company average across 6 dimensions.

**Formula:**
  TTS = AVERAGE of 6 ratings (each weighted equally at ~16.67% when all apply):
    - Volume Rating  = (LO_funded_volume  / company_avg_funded_volume)  * 100
    - Margin Rating  = (LO_revenue_bps    / company_avg_revenue_bps)    * 100
    - Unit Rating    = (LO_funded_units   / company_avg_funded_units)   * 100
    - Pull-Through Rating = (LO_pull_through / company_avg_pull_through) * 100
    - Turn Time Rating    = (company_avg_cycle_time / LO_avg_cycle_time) * 100  ← INVERSE: faster = higher
    - Concession Rating   = (company_avg_concession / LO_concession)    * 100  ← INVERSE: lower concession = higher
  (Concession is excluded and weights are normalized if company avg concession is 0)
  Score of 100 = exactly at company average. Score > 100 = above average.

**Tier Assignment (Sales Scorecard — Pareto by rank):**
  Rank all LOs by TTS score descending:
    - Top tier:    LOs in top 20% by count
    - Second tier: Next 30% (rank positions 21%-50%)
    - Bottom tier: Remaining 50%
  Special case: < 5 LOs → #1 = top, #2 = second (if ≥3), rest = bottom

---

### OPS TTS — Operations Personnel (Processors, Underwriters, Closers)

**Formula:**
  OPS_TTS = (Units Rating × 0.70) + (Turn Time Rating × 0.15) + (Complexity Rating × 0.15)
    - Units Rating      = (person_units / company_avg_units) * 100
    - Turn Time Rating  = (company_avg_turn_time / person_turn_time) * 100  ← INVERSE
    - Complexity Rating = (person_avg_complexity / company_avg_complexity) * 100

**Tier Assignment (Operations Scorecard — Pareto by cumulative units):**
  Sort by units (descending). Assign tiers by cumulative units:
    - Top tier:    cumulative units <= 50% of total
    - Second tier: cumulative units 50%-80% of total
    - Bottom tier: remaining (>80%)

---

### Loan Complexity Score

**Formula:** Baseline 100 + additive factors (default weights):
  - Government loan (FHA/VA/USDA): +10
  - Purchase transaction:          +5
  - Low FICO score (< 680):        +10
  - Excellent FICO score (≥ 780):  -5
  - High LTV (> 80%):              +5
  - High DTI (> 43%):              +5
  - Non-owner occupied:            +5
  - Self-employed borrower:        +5

---

### TopTiering Comparison Tiers (Revenue-based Pareto)

Sort LOs by revenue (descending). Assign tiers by cumulative revenue:
  - Top tier:    cumulative revenue <= 65% of total
  - Second tier: cumulative 65%-90%
  - Bottom tier: > 90%

---

### Insights / Aletheia Revenue Tiers

Sort LOs by revenue (descending). Assign by cumulative revenue:
  - Top tier:    cumulative revenue <= 50% of total
  - Second tier: cumulative 50%-80%
  - Bottom tier: > 80%

---

### SQL Recipe: Compute LO TTS Scores and Tier Distribution

Use this CTE pattern as a starting point when asked about personnel tiers or scorecard:

\`\`\`sql
WITH lo_metrics AS (
  SELECT
    loan_officer,
    COUNT(*) FILTER (WHERE funding_date IS NOT NULL) AS funded_units,
    SUM(loan_amount) FILTER (WHERE funding_date IS NOT NULL) AS funded_volume,
    AVG(CASE WHEN rate_lock_buy_side_base_price_rate > 100
          THEN (rate_lock_buy_side_base_price_rate - 100) * 100
          ELSE 25 END) FILTER (WHERE funding_date IS NOT NULL) AS avg_bps,
    AVG(l.funding_date::date - l.application_date::date)
      FILTER (WHERE funding_date IS NOT NULL AND application_date IS NOT NULL) AS avg_cycle_days,
    COUNT(*) FILTER (WHERE current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
                       AND application_date >= CURRENT_DATE - INTERVAL '90 days') AS completed_90d,
    COUNT(*) FILTER (WHERE funding_date IS NOT NULL
                       AND application_date >= CURRENT_DATE - INTERVAL '90 days') AS funded_90d
  FROM public.loans l
  WHERE loan_officer IS NOT NULL
    AND application_date IS NOT NULL
    AND application_date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY loan_officer
  HAVING COUNT(*) FILTER (WHERE funding_date IS NOT NULL) > 0
),
company_avg AS (
  SELECT
    AVG(funded_units)  AS avg_units,
    AVG(funded_volume) AS avg_volume,
    AVG(avg_bps)       AS avg_bps,
    AVG(avg_cycle_days) AS avg_cycle
  FROM lo_metrics
),
tts_scores AS (
  SELECT
    m.loan_officer,
    m.funded_units,
    m.funded_volume,
    m.avg_bps,
    m.avg_cycle_days,
    CASE WHEN m.funded_90d > 0 THEN (m.funded_90d::float / NULLIF(m.completed_90d, 0)) * 100 END AS pull_through_pct,
    -- TTS components (each = actor/avg * 100; turn time is inverse)
    ROUND(NULLIF(m.funded_volume, 0) / NULLIF(c.avg_volume, 0) * 100, 1) AS volume_rating,
    ROUND(NULLIF(m.avg_bps, 0)       / NULLIF(c.avg_bps, 0)    * 100, 1) AS margin_rating,
    ROUND(NULLIF(m.funded_units, 0)  / NULLIF(c.avg_units, 0)  * 100, 1) AS unit_rating,
    ROUND(NULLIF(c.avg_cycle, 0)     / NULLIF(m.avg_cycle_days, 0) * 100, 1) AS turn_time_rating,
    -- Simple TTS (average of available components, excluding concession if not available)
    ROUND((
      COALESCE(m.funded_volume / NULLIF(c.avg_volume, 0) * 100, 100) +
      COALESCE(m.avg_bps       / NULLIF(c.avg_bps, 0)    * 100, 100) +
      COALESCE(m.funded_units  / NULLIF(c.avg_units, 0)  * 100, 100) +
      COALESCE(c.avg_cycle     / NULLIF(m.avg_cycle_days, 0) * 100, 100)
    ) / 4.0, 1) AS tts_score
  FROM lo_metrics m CROSS JOIN company_avg c
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (ORDER BY tts_score DESC) AS rank_num,
    COUNT(*) OVER () AS total_count
  FROM tts_scores
)
SELECT
  loan_officer,
  tts_score,
  volume_rating,
  margin_rating,
  unit_rating,
  turn_time_rating,
  funded_units,
  ROUND(funded_volume::numeric, 0) AS funded_volume,
  ROUND(avg_cycle_days::numeric, 1) AS avg_cycle_days,
  ROUND(pull_through_pct::numeric, 1) AS pull_through_pct,
  CASE
    WHEN rank_num::float / total_count <= 0.20 THEN 'Top'
    WHEN rank_num::float / total_count <= 0.50 THEN 'Second'
    ELSE 'Bottom'
  END AS tier
FROM ranked
ORDER BY tts_score DESC
\`\`\`

Adapt date windows, add branch/team grouping, or swap components as the investigation requires.
`;
}

// ============================================================================
// Tracked Insight Context
// ============================================================================

/**
 * Fetch active tracked insights and their most recent snapshot values.
 * Provides the agent with awareness of what the organization is actively
 * monitoring and any recently detected trends.
 * Graceful: returns empty string on any failure.
 */
export async function getTrackedInsightContext(
  tenantPool: pg.Pool
): Promise<string> {
  try {
    // Check if tracked_insights table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tracked_insights'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) return "";

    // Fetch active tracked insights with their latest snapshot
    const result = await tenantPool.query(`
      SELECT
        ti.id,
        ti.metric_name,
        ti.description,
        ti.current_value,
        ti.previous_value,
        ti.trend,
        ti.last_evaluated_at,
        ti.metric_signature
      FROM tracked_insights ti
      WHERE ti.is_active = true
        OR ti.is_active IS NULL
      ORDER BY ti.last_evaluated_at DESC NULLS LAST
      LIMIT 15
    `);

    if (result.rows.length === 0) return "";

    let context = "## Actively Monitored Metrics (Tracked Insights)\n";
    context += "These are metrics the organization is actively watching. Reference them when relevant:\n\n";

    for (const row of result.rows) {
      const current = row.current_value != null ? String(row.current_value) : "N/A";
      const previous = row.previous_value != null ? String(row.previous_value) : null;
      const trend = row.trend || "unknown";
      const name = row.metric_name || row.description || "Unnamed metric";

      let line = `- **${name}**: current=${current}`;
      if (previous) line += `, previous=${previous}`;
      if (trend !== "unknown") line += ` (trend: ${trend})`;
      if (row.last_evaluated_at) {
        const evalDate = new Date(row.last_evaluated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        line += ` [as of ${evalDate}]`;
      }
      context += line + "\n";
    }

    console.log(`[Research-TrackedInsights] Loaded ${result.rows.length} tracked insights for context`);
    return context;
  } catch (err: any) {
    console.warn(`[Research-TrackedInsights] Failed to load tracked insight context (non-fatal): ${err.message}`);
    return "";
  }
}

// ============================================================================
// Utility: Format query results for LLM context
// ============================================================================

export function formatResultsForLLM(result: QueryResult, maxRows: number = 50): string {
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
