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
  createConversation,
  getConversation,
  listConversations,
  appendMessage,
  deleteConversation,
  type ConversationMessage,
} from "../services/ai/cohiConversationService.js";
import { getPromptConfig, buildPrompt } from "../promptConfigService.js";
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
  }[];
  standaloneWidgets: { id: string; type: string; title?: string }[];
  totalItems: number;
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

function buildCanvasContext(state: CanvasStateSnapshot): string {
  if (state.totalItems === 0) return "The canvas is currently empty.";

  const lines: string[] = ["## CURRENT CANVAS STATE\n"];
  if (state.groups.length > 0) {
    lines.push(`### Widget Groups (${state.groups.length})`);
    for (const g of state.groups) {
      lines.push(
        `- Group "${g.title}" (${g.sectionType}): [${g.widgetIds.join(", ")}]`
      );
    }
    lines.push("");
  }
  if (state.standaloneWidgets.length > 0) {
    lines.push(`### Standalone Items (${state.standaloneWidgets.length})`);
    for (const w of state.standaloneWidgets) {
      lines.push(`- ${w.id} (${w.type})${w.title ? ": " + w.title : ""}`);
    }
  }
  return lines.join("\n");
}

const WORKBENCH_SYSTEM_PROMPT = `You are Cohi, an AI assistant embedded in a workbench for mortgage data analytics.
You help users build, modify, and understand data visualizations on their canvas.

## Your Capabilities
1. **Add existing widgets** from the catalog using the "add_existing_widget" action
2. **Suggest full dashboards** using the "suggest_dashboard" action
3. **Create new widgets** with SQL queries using the "create_widget" action
4. **Modify widgets** on the canvas using the "modify_widget" action
5. **Delete widgets** using the "delete_widget" action
6. **Explain widgets** to teach users how they work
7. **Explain schema fields** so users understand their data

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
   {"type": "create_widget", "sql": "SELECT ...", "title": "Chart Title", "config": {"type": "bar|line|pie|area|table|kpi", "title": "...", "data": [], "xKey": "...", "yKey": "..."}, "explanation": "What this shows"}

4. **modify_widget**: Change an existing canvas widget
   {"type": "modify_widget", "instanceId": "<canvas item id>", "changes": {...}, "explanation": "What changed"}

5. **delete_widget**: Remove a widget from canvas
   {"type": "delete_widget", "instanceId": "<canvas item id>", "explanation": "Why removing"}

6. **explain_widget**: Teach about a widget
   {"type": "explain_widget", "widgetId": "<id>", "explanation": "Detailed explanation"}

7. **explain_schema**: Teach about data fields
   {"type": "explain_schema", "fields": ["field1", "field2"], "explanation": "What these fields mean"}

## Important Rules
- When the user asks for something that matches an existing widget in the catalog, ALWAYS prefer "add_existing_widget" over "create_widget"
- When suggesting a dashboard, use the section keys: companyScorecard, salesScorecard, operationsScorecard, operationsTrends, salesTrends, loanFunnel, topTieringComparison, creditRiskManagement, leaderboard
- For "create_widget", write PostgreSQL-compatible SQL against the "loans" table
- Include "teachingNotes" when explaining how data works or when the user seems to be learning
- Always be concise but informative in your "message"
- If you're unsure what the user wants, ask a clarifying question in "message" with no actions

## Time Scoping (CRITICAL)
When users ask broad or ambiguous questions, ALWAYS scope data to a RECENT time window. Never return all-time totals for "today"-style questions.
- "What's important?" / "How are we doing?" → Last 30-90 days, not all time
- "Performance update" / "Show me key metrics" → THIS MONTH or THIS QUARTER vs. prior period
- "Top performers" / "Leaderboard" → Scope to last 30-90 days of recent activity
- "Any issues?" → Show current pipeline only (active loans, recent anomalies)
- When in doubt, default to the LAST 90 DAYS as the time window

## SQL Generation Rules for create_widget (CRITICAL)
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
        .replace("{{SCHEMA_CONTEXT}}", schemaContext)
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

      const rawResponse = await callOpenAI(messages, apiKey, {
        temperature: 0.3,
        maxTokens: 3000,
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

      // Validate actions
      const validActions = (parsed.actions || []).filter(
        (a: any) =>
          a &&
          typeof a.type === "string" &&
          [
            "add_existing_widget",
            "create_widget",
            "modify_widget",
            "delete_widget",
            "suggest_dashboard",
            "explain_widget",
            "explain_schema",
          ].includes(a.type)
      );

      const response = {
        message: parsed.message || "I processed your request.",
        actions: validActions,
        teachingNotes: parsed.teachingNotes || undefined,
        suggestedQuestions: parsed.suggestedQuestions || [],
        error: undefined as string | undefined,
      };

      console.log(
        `[CohiWorkbench] Response: ${validActions.length} actions, ${
          response.teachingNotes ? "with" : "no"
        } teaching notes`
      );

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
        req.params.id,
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
        req.params.id,
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
        req.params.id,
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
