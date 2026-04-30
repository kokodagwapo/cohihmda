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
  rebindConversationScope,
  type ConversationMessage,
} from "../services/ai/cohiConversationService.js";
import {
  executeQuery,
  formatDataRows,
  sanitizeGeneratedSQL,
  type ChatContext,
} from "../services/ai/cohiChatService.js";
import { getPromptConfig, buildPrompt } from "../services/promptConfigService.js";
import { decryptAPIKeys } from "../services/encryption.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { loadSession as loadResearchSession } from "../services/research/orchestrator.js";
import { callLLM, type LLMMessage } from "../services/research/tools.js";
import { AGENT_PERSONAS, type AgentPersona } from "../config/agentPersonas.js";
import { retrieveRAGContext } from "../services/ai/ragRetrieval.js";

const router = Router();

function resolveQaAgentRunTag(req: AuthRequest): string | null {
  const headerTag = req.get("X-QA-Agent-Run");
  if (headerTag?.trim()) {
    return headerTag.trim();
  }
  const body = req.body as Record<string, unknown> | undefined;
  if (typeof body?.qaAgentRunTag === "string" && body.qaAgentRunTag.trim()) {
    return body.qaAgentRunTag.trim();
  }
  return null;
}

// ============================================================================
// Types
// ============================================================================

interface CanvasStateSnapshot {
  groups: {
    groupId: string;
    title: string;
    sectionType: string;
    widgetIds: string[];
    /** Widgets in this group with stable ids (for modify_group operations) */
    widgets?: { id: string; kind: "registry" | "cohi"; defId?: string; title?: string; name?: string }[];
    /** Grid layout per widget (key = widgets[].id); 36 cols, 16px rows */
    widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
    filters?: {
      dateRange?: string;
      dateField?: string;
      branch?: string;
      loanOfficer?: string;
    };
  }[];
  standaloneWidgets: {
    id: string;
    type: string;
    title?: string;
    sourceType?: 'research' | 'chat';
    sourceSessionId?: string;
    sourceArtifactId?: string;
    artifactCapabilities?: {
      canInjectFilters?: boolean;
      canEditPresentation?: boolean;
      canEditColumns?: boolean;
      requiresSqlRewriteForLogicChanges?: boolean;
    };
    sql?: string;
    selected?: boolean;
  }[];
  totalItems: number;
  /** Actual data from rendered widgets */
  widgetData?: {
    itemId: string;
    widgetName: string;
    category: string;
    data: unknown;
  }[];
}

// ============================================================================
// Helpers
// ============================================================================

/** Pre-validates SQL for create_widget/modify_widget: must be SELECT/WITH and not obviously hallucinated. */
function isValidWidgetSql(sql: string): boolean {
  const trimmed = sql.trim();
  if (!trimmed) return false;
  const upper = trimmed.toUpperCase();
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) return false;
  const hallucinated = [
    "some_other_table",
    "example_table",
    "your_table",
    "table_name",
  ];
  const lower = trimmed.toLowerCase();
  for (const phrase of hallucinated) {
    if (lower.includes(phrase)) return false;
  }
  return true;
}

/**
 * Minimal additive filter injection for validation purposes.
 * Appends a WHERE/AND condition to the final SELECT body of a SQL string.
 * Mirrors the logic in cohiChat.ts injectConditionIntoBody.
 */
function injectConditionForValidation(sql: string, condition: string): string {
  const body = sql.trimEnd().replace(/;+\s*$/, '').trimEnd();
  const whereRegex = /\bWHERE\b/gi;
  let lastWhereIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = whereRegex.exec(body)) !== null) lastWhereIdx = m.index;

  if (lastWhereIdx >= 0) {
    const afterWhere = body.substring(lastWhereIdx + 5);
    const boundary = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|UNION|INTERSECT|EXCEPT)\b/i.exec(afterWhere);
    if (boundary) {
      const insertAt = lastWhereIdx + 5 + boundary.index;
      return body.substring(0, insertAt) + ` AND ${condition} ` + body.substring(insertAt);
    }
    return body + ` AND ${condition}`;
  }
  const boundary = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING)\b/i.exec(body);
  if (boundary) {
    return body.substring(0, boundary.index) + `WHERE ${condition} ` + body.substring(boundary.index);
  }
  return body + ` WHERE ${condition}`;
}

/**
 * Validates widget SQL by running EXPLAIN against the tenant database.
 * Phase 1: validates raw base SQL.
 * Phase 2 (if filterable): validates SQL with a synthetic date filter injected.
 * Returns { valid, error, phase } — phase indicates where the failure occurred.
 */
async function validateWidgetSql(
  sql: string,
  pool: import('pg').Pool,
  dateColumn?: string,
): Promise<{ valid: boolean; error?: string; phase?: 'base' | 'filtered' }> {
  const sanitized = sanitizeGeneratedSQL(sql);

  // Phase 1: base SQL must be parseable
  try {
    await pool.query(`EXPLAIN ${sanitized}`);
  } catch (err: any) {
    return { valid: false, error: err.message, phase: 'base' };
  }

  // Phase 2: SQL must remain valid after additive filter injection
  if (dateColumn) {
    try {
      const withFilter = injectConditionForValidation(
        sanitized,
        `l.${dateColumn} >= '2025-01-01'::date AND l.${dateColumn} <= '2025-12-31'::date`,
      );
      await pool.query(`EXPLAIN ${withFilter}`);
    } catch (err: any) {
      return { valid: false, error: err.message, phase: 'filtered' };
    }
  }

  return { valid: true };
}

/**
 * Asks the LLM to fix a SQL query that failed validation.
 * Returns the corrected SQL string, or null if the fix attempt failed.
 */
async function attemptSqlFix(
  originalSql: string,
  errorMessage: string,
  schemaContext: string,
  apiKey: string,
  phase: 'base' | 'filtered',
): Promise<string | null> {
  const phaseNote = phase === 'filtered'
    ? 'The SQL itself is syntactically valid, but it breaks when a date range filter (AND date_col >= $1 AND date_col <= $2) is appended to the WHERE clause. The most common cause is that the WHERE clause in the outermost SELECT does not reference the date column directly.'
    : 'The SQL failed to parse or plan.';

  const fixMessages: LLMMessage[] = [
    {
      role: 'system',
      content: `You are a PostgreSQL expert. Fix the SQL query so it passes EXPLAIN validation.
${phaseNote}
Return ONLY the corrected SQL. No explanation, no markdown fences, no semicolon at the end.

Schema context:
${schemaContext.substring(0, 3000)}`,
    },
    {
      role: 'user',
      content: `Original SQL:\n${originalSql}\n\nError:\n${errorMessage}\n\nFixed SQL:`,
    },
  ];

  try {
    const raw = await callLLM(fixMessages, apiKey, { temperature: 0.1, maxTokens: 1500 });
    const fixed = raw.trim().replace(/^```sql\s*/i, '').replace(/```\s*$/, '').replace(/;+\s*$/, '').trim();
    if (fixed && isValidWidgetSql(fixed)) return fixed;
  } catch {
    // swallow — caller handles null
  }
  return null;
}

function isPullThroughAction(action: any): boolean {
  const hay = `${action?.title || ""} ${action?.explanation || ""} ${action?.sql || ""}`.toLowerCase();
  return hay.includes("pull-through") || hay.includes("pull through") || hay.includes("pullthrough");
}

/**
 * Basic semantic guardrails for pull-through SQL so we avoid misleading 100% rates.
 * Returns null when SQL passes, otherwise a short error string used by auto-fix.
 */
function validatePullThroughSqlGuardrails(
  sql: string,
  opts?: { filterable?: boolean; dateColumn?: string; allowLowSamplePullThrough?: boolean },
): string | null {
  const normalized = sql.toLowerCase().replace(/\s+/g, " ");
  const hasNumerator =
    normalized.includes("current_loan_status ilike '%originated%'") &&
    normalized.includes("current_loan_status ilike '%purchased%'");
  const hasCompletedDenominator =
    normalized.includes("current_loan_status not in ('active loan','active','locked','submitted','approved')") ||
    normalized.includes("current_loan_status not in ('active loan', 'active', 'locked', 'submitted', 'approved')");
  const hasNullIf = normalized.includes("nullif(");
  const dangerousFundedBaseFilter =
    /\bwhere\b[^;]*(current_loan_status\s+ilike\s+'%originated%'|current_loan_status\s+ilike\s+'%purchased%')/i.test(sql) &&
    !/count\s*\(\s*case\s+when/i.test(sql); // allow inside CASE expression counts
  const isSegmented =
    /\bgroup\s+by\b/i.test(sql) &&
    /\b(branch|loan_officer|loan officer|product|investor|channel)\b/i.test(sql);
  const hasFundedCountAlias = /\bas\s+funded_count\b/i.test(sql);
  const hasCompletedCountAlias = /\bas\s+completed_count\b/i.test(sql);
  const hasRateAlias = /\bas\s+(pull[_\s-]?through(_rate)?)\b/i.test(sql);
  const hasSampleSizeHaving =
    /\bhaving\b[^;]*(completed_count\s*>=\s*(5|10))/i.test(sql) ||
    /\bhaving\b[^;]*count\s*\(\s*case\s+when\s+l?\.?current_loan_status\s+not\s+in\s*\('active loan'\s*,\s*'active'\s*,\s*'locked'\s*,\s*'submitted'\s*,\s*'approved'\)\s*then\s*1\s*end\s*\)\s*>=\s*(5|10)/i.test(sql);

  if (!hasNumerator) {
    return "Pull-through SQL missing canonical funded numerator (Originated/purchased statuses).";
  }
  if (!hasCompletedDenominator) {
    return "Pull-through SQL missing canonical completed denominator (NOT IN active statuses).";
  }
  if (!hasNullIf) {
    return "Pull-through SQL must use NULLIF in denominator to avoid invalid division.";
  }
  if (dangerousFundedBaseFilter) {
    return "Pull-through SQL incorrectly filters base rows to funded statuses in WHERE.";
  }
  if (opts?.filterable !== false && opts?.dateColumn && opts.dateColumn !== "application_date") {
    return "Pull-through widgets must use filterConfig.dateColumn = application_date.";
  }
  if (isSegmented) {
    if (!hasFundedCountAlias || !hasCompletedCountAlias || !hasRateAlias) {
      return "Segmented pull-through SQL must select funded_count, completed_count, and pull_through_rate aliases.";
    }
    if (!opts?.allowLowSamplePullThrough && !hasSampleSizeHaving) {
      return "Segmented pull-through SQL must include HAVING completed_count >= 5 (or >= 10) to avoid tiny-denominator artifacts.";
    }
  }
  return null;
}

/**
 * Auto-selects which persona(s) should guide this request.
 * We intentionally allow blended behavior: many questions need both
 * domain/compliance reasoning and statistical/analytical depth.
 */
function resolveAutoPersonas(
  question: string,
  canvasState?: CanvasStateSnapshot,
): AgentPersona[] {
  const q = (question || "").toLowerCase();
  const selectedWidgetPresent = !!canvasState?.standaloneWidgets?.some((w) => w.selected);

  const dataScientistSignals = [
    "distribution",
    "outlier",
    "variance",
    "percentile",
    "correlation",
    "regression",
    "statistical",
    "anomaly",
    "cohort",
    "decomposition",
  ];
  const mortgageSignals = [
    "compliance",
    "trid",
    "regulation",
    "guideline",
    "policy",
    "lock",
    "pipeline",
    "fallout",
    "underwriting",
    "denial",
    "product",
  ];

  const dsScore = dataScientistSignals.reduce((n, k) => n + (q.includes(k) ? 1 : 0), 0);
  const meScore = mortgageSignals.reduce((n, k) => n + (q.includes(k) ? 1 : 0), 0);

  // If user is editing and asks explanatory/analytical questions, blend both.
  const questionLikeWhileEditing =
    selectedWidgetPresent &&
    /\b(why|what|explain|analyze|break down|show|compare|trend)\b/i.test(question);

  const dataScientist = AGENT_PERSONAS["data-scientist"];
  const mortgageExpert = AGENT_PERSONAS["mortgage-expert"];

  if (questionLikeWhileEditing) return [mortgageExpert, dataScientist];
  if (Math.abs(dsScore - meScore) <= 1) return [mortgageExpert, dataScientist];
  if (dsScore > meScore) return [dataScientist];
  return [mortgageExpert];
}

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

/**
 * Data source to base SQL hint (for convert_to_sql_widget).
 * Registry widgets are backed by data hooks; when converting to SQL the LLM
 * should use the tenant schema. These hints document typical tables/columns
 * per source for prompt context. Expand as needed.
 */
const DATA_SOURCE_SQL_HINTS: Partial<Record<string, string>> = {
  "company-scorecard":
    "Typical tables: public.loans, public.loan_officers, public.branches. Common columns: application_date, funding_date, loan_amount, status, branch_id, loan_officer_id.",
  "sales-scorecard":
    "Similar to company-scorecard; often filtered by sales channel or product.",
  "operations-scorecard":
    "Loans and operational metrics; cycle time, fallout, pipeline stages.",
};

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

  // ---- Structural info with filter context and group widget/layout detail ----
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
      const widgetCount = g.widgets?.length ?? g.widgetIds.length;
      lines.push(
        `- **${g.title}** groupId=\`${g.groupId}\` (${g.sectionType}, ${widgetCount} widgets)${filterStr}`
      );
      if (g.widgets && g.widgets.length > 0) {
        for (const w of g.widgets) {
          const label = w.kind === "registry" ? (w.name || w.defId) : w.title;
          const layout = g.widgetLayouts?.[w.id];
          const layoutStr = layout ? ` @ grid(${layout.x},${layout.y}) size ${layout.w}x${layout.h}` : "";
          lines.push(`  - \`${w.id}\` (${w.kind}) ${label ?? ""}${layoutStr}`);
        }
      }
    }
    lines.push("");
  }

  if (state.standaloneWidgets.length > 0) {
    lines.push(`### Standalone Items (${state.standaloneWidgets.length})`);
    for (const w of state.standaloneWidgets) {
      const source = w.sourceType === 'research' ? ' [research-lab widget]' : '';
      const artifact =
        w.sourceArtifactId != null && String(w.sourceArtifactId).trim()
          ? ` [artifact=${w.sourceArtifactId}]`
          : '';
      const selectedLabel = w.selected ? ' [SELECTED]' : '';
      lines.push(`- ${w.id} (${w.type})${w.title ? ": " + w.title : ""}${source}${artifact}${selectedLabel}`);
      if (w.sql) {
        const sqlLimit = w.selected ? w.sql.length : 1000;
        const sqlSnippet = w.sql.length <= sqlLimit ? w.sql : w.sql.substring(0, sqlLimit) + '...';
        lines.push(`  SQL: \`${sqlSnippet}\``);
      }
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
          formatted = `- **${entry.widgetName}**: ${(JSON.stringify(entry.data) ?? "null").substring(0, 150)}`;
          break;
      }

      charBudget -= formatted.length;
      lines.push(formatted);
    }
  }

  return lines.join("\n");
}

/**
 * Build LLM context from research sessions referenced by canvas widgets.
 * Returns a markdown block with the research topic, findings, and SQL.
 */
async function buildResearchContext(
  state: CanvasStateSnapshot | undefined,
  tenantPool: import("pg").Pool | null
): Promise<string> {
  if (!state || !tenantPool) return "";
  const sessionIds = new Set<string>();
  for (const w of state.standaloneWidgets) {
    if (w.sourceType === "research" && w.sourceSessionId) {
      sessionIds.add(w.sourceSessionId);
    }
  }
  if (sessionIds.size === 0) return "";

  const blocks: string[] = ["\n## RESEARCH LAB CONTEXT\n"];
  blocks.push(
    "The canvas contains widgets created from Research Lab sessions. " +
    "When the user asks to modify a research widget, use the research context " +
    "below to understand the analytical intent, then generate a new SQL query " +
    "that achieves the requested change. Use the modify_widget action with a " +
    "new `sql` field.\n"
  );

  for (const sid of sessionIds) {
    try {
      const session = await loadResearchSession(sid, tenantPool);
      if (!session) continue;
      blocks.push(`### Research Session: ${session.topic || "Untitled"}`);
      blocks.push(`Session ID: ${sid}`);
      if (session.findings && session.findings.length > 0) {
        blocks.push(`\n**Findings (${session.findings.length}):**`);
        for (const f of session.findings.slice(0, 5)) {
          blocks.push(`- **${f.title}** (${f.confidence} confidence): ${(f.summary ?? "").substring(0, 200)}`);
          if (f.evidence && f.evidence.length > 0) {
            for (const ev of f.evidence.slice(0, 2)) {
              const sql = ev.sql ?? "";
              blocks.push(`  SQL: \`${sql.substring(0, 200)}${sql.length > 200 ? "..." : ""}\``);
              if (ev.explanation) blocks.push(`  Purpose: ${ev.explanation.substring(0, 150)}`);
            }
          }
        }
      }
      blocks.push("");
    } catch (err) {
      console.warn(`[CohiWorkbench] Failed to load research session ${sid}:`, err);
    }
  }

  return blocks.join("\n");
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

## Clarification Before Action
When the user's request is ambiguous or underspecified, ASK a clarifying question
instead of guessing. Return an empty "actions" array and put your question in "message".

Ask when:
- The user says "make a chart" but doesn't specify what data, metrics, or grouping
- The user says "modify the widget" but there is no [SELECTED] widget, or the change is unclear
- The user asks for analysis but multiple interpretations exist (e.g. "show me performance" -- by LO? by branch? by month?)
- The user references a field or concept you can't map to the schema

Do NOT ask when:
- The request is clear and specific (e.g. "create a bar chart of funded volume by month")
- The user is clearly referring to the [SELECTED] widget and the change is unambiguous
- You can confidently infer intent from context (canvas state, conversation history)

## Intent Routing (CRITICAL)
When a [SELECTED] widget exists, do NOT assume every message is an edit request.
You must infer intent from the user's wording:
- Use modify_widget ONLY when the user explicitly asks to change the widget (e.g. "edit", "change", "update", "replace", "remove column", "convert chart type", "fix this widget")
- If the user asks an analytical question (e.g. "why is this down?", "what is driving this?", "compare by branch", "break this down"), answer the question with query_data and/or explanation actions. Do not modify the widget unless asked.
- If the user asks both (question + change), do both in one response: first answer the question, then include the requested modify_widget action.
- If intent is unclear, ask one concise clarifying question.

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
   {"type": "create_widget", "sql": "SELECT ...", "title": "Chart Title", "config": {"type": "bar|line|pie|area|table|kpi|donut|horizontal_bar|stacked_bar|grouped_bar|treemap|pivot", "title": "...", "data": [], "xKey": "...", "yKey": "...", "yKeys": ["...", "..."], "pivotConfig": {"rowKey":"...","columnKey":"...","valueKey":"...","aggregation":"sum"}}, "filterConfig": {"filterable": true, "dateColumn": "funding_date", "defaultPreset": "L12M"}, "allowLowSamplePullThrough": false, "explanation": "What this shows"}
   IMPORTANT: The config.type MUST be one of: bar, line, pie, area, table, kpi, donut, horizontal_bar, stacked_bar, grouped_bar, treemap, pivot. NEVER use "chart" as a type.
   IMPORTANT: Every create_widget MUST include "filterConfig". See the Filter Configuration section below.

4. **modify_widget**: Change an existing canvas widget
   {"type": "modify_widget", "instanceId": "<canvas item id>", "changes": {...}, "sql": "SELECT ...", "title": "New Title", "explanation": "What changed"}
   - The instanceId MUST be the id of the widget marked [SELECTED] in the Standalone Items list. Only that widget can be modified; if you use a different id the change will be rejected. The full SQL for the [SELECTED] widget is provided so you can edit it.
   - When removing a column from a table you may use EITHER: (1) Provide a new "sql" with that column omitted from the SELECT list (copy the exact SQL above and remove only that column from the SELECT clause). (2) Provide "changes" with tableConfig.columns set to an array of {key: "<column_key>", label: "<display label>"} for every column that should REMAIN — omit the column to remove. Use the exact keys from the LIVE DATA VALUES table for that widget. Option (1) is required for research-lab widgets with complex SQL; option (2) works for any table and is simpler.
   - Do not SELECT NULL AS column_name or invent table/CTE names. Base all SQL on the EXACT SQL shown for that widget.
   - "changes" also accepts other VisualizationConfig overrides (type, xKey, yKey, etc.) for visual-only changes when data is unchanged.
   - "title" (optional) updates the widget title.
   - For research-lab widgets: these use complex CTEs and derived columns. When modifying them, always provide a complete new SQL query. Reference the RESEARCH LAB CONTEXT section below to understand the analytical intent behind the original query.
   - When a research widget lists an artifact id and capability metadata in the canvas state: if canEditPresentation is true (default), prefer modify_widget with "changes" (vizConfig / tableConfig / title) for visual-only updates without rewriting SQL. If the user asks for filter or logic changes and canInjectFilters is false or requiresSqlRewriteForLogicChanges is true, provide a full new "sql" based on the exact widget SQL shown.
   - When modifying a widget's SQL, you MUST base your new query on the EXACT SQL shown for that widget in the canvas state. Do NOT invent table names, CTEs, or columns that don't appear in the original SQL. Copy the original SQL and make only the specific change the user requested.
   - Return EXACTLY ONE modify_widget action per user request. Do NOT return multiple modify_widget actions for the same widget.

5. **delete_widget**: Remove a widget from canvas
   {"type": "delete_widget", "instanceId": "<canvas item id>", "explanation": "Why removing"}

6. **modify_group**: Rearrange, add, remove, or resize widgets within a dashboard group
   {"type": "modify_group", "groupId": "<groupId from canvas>", "operations": [...], "explanation": "What changed"}
   The canvas state lists each group with groupId= and its widgets with stable ids (e.g. company-scorecard-units__0, cohi__abc123__1). Use these exact ids in operations.
   Operations (array, applied in order):
   - {"op": "add_registry", "defId": "<widget id from catalog>", "gridPosition": {"x": 0, "y": 10, "w": 5, "h": 4}} — add a pre-built widget (grid: 36 cols, 16px rows)
   - {"op": "add_cohi", "sql": "SELECT ...", "title": "...", "vizConfig": {...}, "gridPosition": {...}} — add a SQL-backed widget
   - {"op": "remove", "widgetId": "<id from group widget list>"} — remove that widget
   - {"op": "resize", "widgetId": "<id>", "w": 12, "h": 8} — change grid size
   - {"op": "reorder", "widgetIds": ["<id1>", "<id2>", ...]} — new order (all current ids in desired order)
   - {"op": "set_title", "title": "New Section Title"}
   - {"op": "set_filters", "filters": {"year": 2025, ...}}
   Use modify_group when the user asks to add/remove widgets in a dashboard section, reorder them, resize, or change the section title.

6a. **modify_registry_widget**: Change config on a pre-built catalog widget inside a group
   {"type": "modify_registry_widget", "groupId": "<groupId>", "widgetId": "<widget id from group list, e.g. company-scorecard-units__0>", "configOverrides": {"format": "currency", "chartType": "line"}, "explanation": "What changed"}
   Use when the user wants to change how a catalog widget displays (e.g. number format, chart type) without converting it to SQL. The widgetId is the stable id shown in the canvas state for that widget (e.g. company-scorecard-units__0 or cohi__abc__1). Only keys that the widget supports (e.g. format, chartType) will take effect.

6b. **create_dashboard**: Build an entirely new dashboard from scratch (mix of catalog widgets and SQL widgets)
   {"type": "create_dashboard", "title": "My Dashboard", "groups": [{"title": "Section Title", "sectionType": "company-scorecard", "widgets": [{"kind": "registry", "defId": "company-scorecard-units"}, {"kind": "cohi", "sql": "SELECT ...", "title": "Custom Chart", "vizConfig": {...}}], "canvasPosition": {"x": 20, "y": 20, "w": 1000, "h": 800}}], "standaloneWidgets": [{"kind": "cohi", "sql": "SELECT ...", "title": "Standalone", "vizConfig": {...}}], "explanation": "What this dashboard shows"}
   - groups: array of sections; each has title, optional sectionType (company-scorecard, sales-scorecard, etc.), widgets (registry defIds or cohi sql+title+vizConfig), optional canvasPosition (pixel x, y, w, h).
   - standaloneWidgets: optional array of cohi widgets to place on the canvas outside any group.
   - Layout: use canvasPosition to place groups; if omitted, groups are stacked vertically. Grid inside groups: 36 columns, 16px row height.
   - Use create_dashboard when the user asks for a "new dashboard", "custom dashboard", or to "build a dashboard from scratch" with a specific mix of widgets.

6c. **convert_to_sql_widget**: Replace a catalog widget inside a group with a SQL-backed widget (for deep customization)
   {"type": "convert_to_sql_widget", "groupId": "<groupId>", "widgetId": "<widget id from group list>", "sql": "SELECT ...", "title": "...", "vizConfig": {...}, "explanation": "Why converted"}
   Use when the user needs changes that go beyond config overrides (e.g. filter by a specific branch, add a custom WHERE clause, change the underlying query). The registry widget is replaced by a cohi_widget that runs your SQL. Base your SQL on the tenant schema and the widget's data source (see DATA SOURCE HINTS below). The widgetId is the same stable id as in modify_registry_widget (e.g. company-scorecard-units__0).

7. **explain_widget**: Teach about a widget
   {"type": "explain_widget", "widgetId": "<id>", "explanation": "Detailed explanation"}

8. **explain_schema**: Teach about data fields
   {"type": "explain_schema", "fields": ["field1", "field2"], "explanation": "What these fields mean"}

9. **create_canvas**: Build a full multi-section dashboard canvas at once
   {"type": "create_canvas", "title": "Monthly Executive Review", "sectionKeys": ["executiveDashboard", "companyScorecard", "salesScorecard"], "explanation": "Why this combination"}

10. **query_data**: Run a SQL query to answer a data question (results are returned to you automatically)
   {"type": "query_data", "sql": "SELECT ...", "explanation": "What this query checks"}
   Use query_data when:
   - The user asks a question that requires data NOT visible on the canvas
   - The user asks for deeper drill-down beyond what the current widgets show
   - You need to verify or compute something that isn't in the LIVE DATA VALUES
   PREFER answering from canvas data when possible (faster, no extra query needed).
   The query results will be automatically provided back to you so you can formulate a data-driven answer.

11. **generate_report**: Generate a full multi-slide PowerPoint/PDF report
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

## Data Freshness (CRITICAL — READ FIRST)
**The tenant's data is available through {{DATA_MAX_DATE}}. This is NOT today's date.**
- NEVER use CURRENT_DATE or NOW() — the data does not extend to today and those queries return zero rows.
- For filterable:false widgets that must hard-code a date range, always anchor to '{{DATA_MAX_DATE}}'::date.
- For all filterable:true widgets, do NOT bake date ranges into the SQL — declare the intended range in filterConfig.defaultPreset instead. The filter system handles the actual date injection.

## Time Scoping and filterConfig.defaultPreset
Map the user's requested time range to the correct defaultPreset in filterConfig:
- "last 12 months" / no explicit range (default) → "L12M"
- "last 6 months" → "L6M"
- "last 3 months" / "last 90 days" → "L3M"
- "YTD" / "this year" / "year to date" → "YTD"
- "MTD" / "this month" / "month to date" → "MTD"
- "current year" / "CY" / "2025" / "2026" → "CY"
- "last year" / "prior year" / "PY" → "PY"
- No time constraint / "all time" / "since inception" → null
NEVER hard-code date ranges in SQL for filterable:true widgets. Use filterConfig.defaultPreset.

## Metric Consistency (CRITICAL)
When computing metrics like Revenue, Pull-Through Rate, Volume, Fallout, Cycle Time:
- **ALWAYS use the exact SQL formulas from the VERIFIED METRICS SQL section below.** Do NOT invent your own formulas.
- Revenue is GAIN-ON-SALE (the tenant-specific expression), NOT loan_amount. They are fundamentally different metrics.
- Pull-Through Rate = funded / completed * 100. "Completed" = loans NOT in active statuses ('Active Loan','active','locked','submitted','approved').
- For time-series charts showing monthly trends, GROUP BY DATE_TRUNC('month', l.application_date) and use the verified metric formulas within each month's aggregation.

## Pull-Through Guardrails (CRITICAL)
For ANY pull-through widget (especially by branch / loan officer / product), SQL MUST:
1) Use canonical numerator:
   COUNT(CASE WHEN (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%') THEN 1 END)
2) Use canonical denominator:
   COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved') THEN 1 END)
3) Compute rate with NULLIF denominator:
   funded_count * 100.0 / NULLIF(completed_count, 0)
4) Expose validation counts in SELECT for segmented views:
   include funded_count and completed_count alongside pull_through_rate
5) Avoid tiny-denominator artifacts for segmented views:
   add HAVING completed_count >= 5 (or >= 10 for very noisy data)
6) NEVER filter the base WHERE clause to only funded statuses for pull-through charts.
7) For segmented pull-through views (by branch / LO / product), SELECT MUST include:
   - funded_count
   - completed_count
   - pull_through_rate
   These counts are mandatory for auditability.
8) For filterable pull-through widgets, filterConfig.dateColumn MUST be "application_date".
9) allowLowSamplePullThrough override:
   - Default is false (enforce minimum denominator HAVING completed_count >= 5 or 10).
   - Set "allowLowSamplePullThrough": true ONLY when the user explicitly asks to include small-sample segments.
   - Even when override=true, still include funded_count and completed_count columns for transparency.

## Filter Configuration for create_widget (CRITICAL)
Every create_widget action MUST include a filterConfig object. This separates the SQL logic from the time-scoping so filters can be changed without rewriting SQL.

  filterConfig: {
    "filterable": true | false,
    "dateColumn": "application_date" | "funding_date" | "lock_date" | "started_date" | ...,
    "defaultPreset": "L12M" | "L6M" | "L3M" | "YTD" | "MTD" | "CY" | "PY" | null
  }

Rules:
1. filterable:true — for all time-series, KPI, and trend widgets. The filter system appends AND l.<dateColumn> >= $1 AND l.<dateColumn> <= $2 — do NOT put date ranges in the SQL.
2. filterable:false — ONLY for static snapshots that must never be date-filtered: current active loan count, all-time pipeline totals, status distributions. If false, the SQL must include its own date scoping using '{{DATA_MAX_DATE}}'::date.
3. dateColumn: pick the column that semantically matches the widget:
   - Pipeline / pull-through / application counts → "application_date"
   - Funded volume / revenue / cycle time → "funding_date"
   - Lock activity / fallout → "lock_date"
4. SQL for filterable:true widgets — NEVER include date-range conditions. Write only the structural query:
   - DO include: WHERE l.funding_date IS NOT NULL  (structural — keeps nulls out)
   - DO include: WHERE l.current_loan_status NOT IN (...)  (status filter — not a date)
   - DO NOT include: WHERE l.funding_date >= '2025-01-01'  (date range — the filter system handles this)
   - DO NOT include: WHERE l.application_date >= '{{DATA_MAX_DATE}}'::date - INTERVAL '12 months'

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
    - NEVER write "WHERE TRUE" — it evaluates to a boolean, not a date
    - NEVER use CURRENT_DATE or NOW() — the data does not extend to today
    - For filterable:true widgets — DO NOT write date range conditions. The filter system injects them.
    - For filterable:false widgets — anchor dates to '{{DATA_MAX_DATE}}'::date:
      GOOD: WHERE l.current_loan_status = 'Active Loan' AND l.application_date IS NOT NULL
      GOOD (filterable:false only): WHERE l.application_date >= '{{DATA_MAX_DATE}}'::date - INTERVAL '1 year'
    - Always prefix column names with the table alias: l.application_date, l.funding_date, l.loan_amount
    - NEVER end SQL with a semicolon

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

## Data source hints (for convert_to_sql_widget)
When replacing a catalog widget with a SQL-backed widget, use the tenant schema and these hints for the widget's data source:
{{DATA_SOURCE_HINTS}}

{{CANVAS_STATE}}
`;

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/cohi-chat/workbench/personas
 * Returns the available agent personas for the workbench panel UI.
 */
router.get("/personas", authenticateToken, (_req, res) => {
  res.json({
    personas: Object.values(AGENT_PERSONAS).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      suggestedQuestions: p.suggestedQuestions,
    })),
    defaultPersonaId: "mortgage-expert",
  });
});

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
      let dataMaxDate = ""; // latest date in the tenant's data
      if (tenantId) {
        try {
          const tenantPool = await tenantDbManager.getTenantPool(tenantId);
          const revenueExpr = await getTenantRevenueExpression(tenantPool);
          verifiedMetricsBlock = "\n\n" + getVerifiedMetricsSQL(revenueExpr);

          // Query the most recent date in the data so the LLM anchors time ranges correctly
          const dateResult = await tenantPool.query<{ max_date: Date | null }>(
            `SELECT GREATEST(
               MAX(funding_date),
               MAX(application_date),
               MAX(started_date)
             ) AS max_date FROM public.loans`
          );
          const raw = dateResult.rows[0]?.max_date;
          if (raw) {
            dataMaxDate = new Date(raw).toISOString().split("T")[0];
          }
        } catch (err) {
          console.warn("[CohiWorkbench] Could not load verified metrics SQL or data max date:", err);
        }
      }
      // Fall back to a reasonable recent default if query failed
      if (!dataMaxDate) {
        dataMaxDate = new Date().toISOString().split("T")[0];
      }

      // Build canvas context
      const canvasContext = canvasState
        ? buildCanvasContext(canvasState)
        : "No canvas state provided.";

      // Build research session context for any research-sourced widgets
      let researchContext = "";
      try {
        const tenantPool = tenantId
          ? await tenantDbManager.getTenantPool(tenantId)
          : null;
        researchContext = await buildResearchContext(canvasState, tenantPool);
      } catch (err) {
        console.warn("[CohiWorkbench] Could not load research context:", err);
      }

      // Auto-select persona behavior for this request (single or blended).
      const activePersonas = resolveAutoPersonas(question, canvasState);
      const personaSummary = activePersonas.map((p) => p.name).join(" + ");

      // Load persona prompt supplements from config (blended when needed)
      let personaSupplement = `\n\n## Active Agent Mode (Auto): ${personaSummary}`;
      for (const p of activePersonas) {
        try {
          const personaConfig = await getPromptConfig(p.promptConfigId);
          personaSupplement += `\n\n${personaConfig.system_prompt}`;
        } catch {
          personaSupplement += `\n\n## ${p.name}\n${p.description}`;
        }
      }

      // Fetch knowledge context scoped to all active persona categories (union)
      let knowledgeContext = "";
      if (tenantId && activePersonas.length > 0) {
        try {
          const tenantPool = await tenantDbManager.getTenantPool(tenantId);
          const categories = Array.from(
            new Set(activePersonas.flatMap((p) => p.knowledgeCategories)),
          );
          const ragResult = await retrieveRAGContext(question, tenantPool, {
            categories,
            topK: 5,
            threshold: 0.3,
            caller: `CohiWorkbench-auto-${activePersonas.map((p) => p.id).join("+")}`,
          });
          if (ragResult.totalChunks > 0) {
            knowledgeContext = `\n\n${ragResult.formatted}`;
          }
        } catch (err) {
          console.warn("[CohiWorkbench] Could not load knowledge context:", err);
        }
      }

      // Build full system prompt
      const now = new Date();
      const dataMaxYear = dataMaxDate.split("-")[0];
      const systemPrompt = WORKBENCH_SYSTEM_PROMPT.replace(
        "{{currentDate}}",
        now.toISOString().split("T")[0]
      )
        .replaceAll("{{DATA_MAX_DATE}}", dataMaxDate)
        .replaceAll("{{DATA_MAX_DATE_YEAR}}", dataMaxYear)
        .replace("{{SCHEMA_CONTEXT}}", schemaContext + verifiedMetricsBlock)
        .replace("{{WIDGET_CATALOG}}", widgetCatalog || "No widget catalog provided.")
        .replace(
          "{{DATA_SOURCE_HINTS}}",
          Object.entries(DATA_SOURCE_SQL_HINTS)
            .map(([src, hint]) => `- ${src}: ${hint}`)
            .join("\n") || "Use the schema context above and the widget's data source (e.g. company-scorecard, sales-scorecard) to write equivalent SQL."
        )
        .replace(
          "{{CANVAS_STATE}}",
          canvasContext + researchContext + personaSupplement + knowledgeContext
        );

      // Build message history
      const history: LLMMessage[] = (conversationHistory || [])
        .slice(-6)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const messages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: question },
      ];

      console.log(
        `[CohiWorkbench] Processing question: "${question.substring(0, 80)}..." (tenant: ${tenantId || "none"}, personas: ${personaSummary})`
      );

      // Use higher token limit when user appears to be requesting a report
      const isReportRequest = /\b(report|presentation|powerpoint|pptx|pdf|slide|deck)\b/i.test(question);
      const rawResponse = await callLLM(messages, apiKey, {
        temperature: 0.3,
        maxTokens: isReportRequest ? 8000 : 4096,
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
        "modify_group",
        "modify_registry_widget",
        "create_dashboard",
        "convert_to_sql_widget",
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

      // Log modify_widget actions for debugging (instanceId, sql provided?, changes keys)
      for (const action of validActions) {
        if (action.type === "modify_widget") {
          const hasSql = !!(action.sql && String(action.sql).trim());
          const changesKeys = action.changes && typeof action.changes === "object"
            ? Object.keys(action.changes)
            : [];
          console.log(
            `[CohiWorkbench] modify_widget: instanceId=${action.instanceId} hasSql=${hasSql} changesKeys=[${changesKeys.join(", ")}] title=${action.title ? "set" : "unset"}`
          );
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

      // SQL pre-validation: drop create_widget/modify_widget actions with invalid SQL
      // Step 1: Quick structural check (syntax, hallucinated tables)
      const invalidSqlActions: string[] = [];
      validActions = validActions.filter((a: any) => {
        if ((a.type !== "create_widget" && a.type !== "modify_widget") || !a.sql) return true;
        const sql = String(a.sql).trim();
        if (isValidWidgetSql(sql)) return true;
        invalidSqlActions.push(a.type);
        return false;
      });
      if (invalidSqlActions.length > 0) {
        finalMessage += "\n\nOne or more widget SQL statements were rejected (invalid or placeholder SQL). Please try a more specific request.";
        console.log(
          `[CohiWorkbench] SQL pre-validation stripped ${invalidSqlActions.length} action(s): ${invalidSqlActions.join(", ")}`
        );
      }

      // Step 2: EXPLAIN validation for create_widget/modify_widget that passed structural check
      // Validates both the base SQL and the SQL with a sample filter injected.
      // Failed actions are retried with the LLM (max 2 attempts) then dropped.
      if (tenantId) {
        try {
          const tenantPool = await tenantDbManager.getTenantPool(tenantId);
          const actionsToValidate = validActions.filter(
            (a: any) => (a.type === "create_widget" || a.type === "modify_widget") && a.sql,
          );

          for (const action of actionsToValidate) {
            const dateCol = action.filterConfig?.filterable !== false
              ? (action.filterConfig?.dateColumn ?? 'application_date')
              : undefined;

            let validation = await validateWidgetSql(String(action.sql), tenantPool, dateCol);

            // Pull-through-specific semantic guardrails
            if (action.type === "create_widget" && isPullThroughAction(action)) {
              const guardError = validatePullThroughSqlGuardrails(String(action.sql), {
                filterable: action.filterConfig?.filterable !== false,
                dateColumn: action.filterConfig?.dateColumn ?? "application_date",
                allowLowSamplePullThrough: !!action.allowLowSamplePullThrough,
              });
              if (guardError) {
                validation = { valid: false, error: guardError, phase: "base" };
              }
            }

            if (!validation.valid) {
              console.warn(`[CohiWorkbench] EXPLAIN validation failed (phase=${validation.phase}) for "${action.title}": ${validation.error}`);

              // Retry up to 2 times
              let fixed: string | null = null;
              for (let attempt = 1; attempt <= 2 && !fixed; attempt++) {
                console.log(`[CohiWorkbench] SQL fix attempt ${attempt} for "${action.title}"`);
                fixed = await attemptSqlFix(
                  String(action.sql),
                  validation.error ?? 'Unknown error',
                  schemaContext,
                  apiKey,
                  validation.phase ?? 'base',
                );
                if (fixed) {
                  const revalidation = await validateWidgetSql(fixed, tenantPool, dateCol);
                  if (!revalidation.valid) {
                    console.warn(`[CohiWorkbench] Fix attempt ${attempt} still invalid: ${revalidation.error}`);
                    fixed = null;
                    validation = revalidation;
                  } else if (action.type === "create_widget" && isPullThroughAction(action)) {
                    const postFixGuardError = validatePullThroughSqlGuardrails(fixed, {
                      filterable: action.filterConfig?.filterable !== false,
                      dateColumn: action.filterConfig?.dateColumn ?? "application_date",
                      allowLowSamplePullThrough: !!action.allowLowSamplePullThrough,
                    });
                    if (postFixGuardError) {
                      console.warn(`[CohiWorkbench] Fix attempt ${attempt} failed pull-through guardrails: ${postFixGuardError}`);
                      fixed = null;
                      validation = { valid: false, error: postFixGuardError, phase: "base" };
                    }
                  }
                }
              }

              if (fixed) {
                action.sql = fixed;
                console.log(`[CohiWorkbench] SQL auto-fixed for "${action.title}"`);
              } else {
                // Drop the action — can't produce a valid widget
                validActions = validActions.filter((a: any) => a !== action);
                finalMessage += `\n\nI couldn't generate a valid query for "${action.title || 'a widget'}" — please try rephrasing your request.`;
                console.warn(`[CohiWorkbench] Dropped action "${action.title}" after failed SQL validation`);
              }
            } else {
              console.log(`[CohiWorkbench] EXPLAIN validation passed for "${action.title}"`);
            }
          }
        } catch (validationErr: any) {
          // If validation itself fails (e.g. pool unavailable), log and continue
          console.warn('[CohiWorkbench] SQL validation step failed, skipping:', validationErr.message);
        }
      }

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
        const followUpMessages: LLMMessage[] = [
          ...messages,
          { role: "assistant", content: rawResponse },
          {
            role: "user",
            content: `Here are the results of the SQL queries you requested:\n\n${resultsContext}\n\nNow answer the original question using these actual results. Include specific numbers and be precise. Respond in JSON format with "message", "actions" (empty array is fine), "teachingNotes" (optional), and "suggestedQuestions".`,
          },
        ];

        try {
          const secondResponse = await callLLM(followUpMessages, apiKey, {
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
  "/conversations/rebind-scope",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "No tenant context" });

      const { fromScopeId, toScopeId } = req.body as {
        fromScopeId?: string;
        toScopeId?: string;
      };
      if (!fromScopeId || !toScopeId) {
        return res.status(400).json({ error: "fromScopeId and toScopeId are required" });
      }

      const moved = await rebindConversationScope(
        tenantId,
        req.userId!,
        fromScopeId,
        toScopeId
      );
      res.json({ success: true, moved });
    } catch (error: any) {
      console.error("[CohiWorkbench] Rebind scope error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

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
      const qaAgentRunTag = resolveQaAgentRunTag(req);
      if (!message.id || !message.role || !message.content) {
        return res.status(400).json({ error: "Invalid message format" });
      }

      const success = await appendMessage(
        tenantId,
        req.params.id as string,
        req.userId!,
        qaAgentRunTag ? { ...message, qaAgentRunTag } : message
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
