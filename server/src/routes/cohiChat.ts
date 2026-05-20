/**
 * Cohi Chat API Routes
 * AI-powered natural language interface with hybrid data + knowledge capabilities
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
import { 
  processCohiQuestion, 
  refineCohiQuery, 
  executeQuery,
  formatDataRows,
  editWidgetQuery,
  CohiChatMessage, 
  CohiChatResponse,
  VisualizationConfig,
  ChatContext
} from '../services/ai/cohiChatService.js';
import {
  analyzeDashboardImage,
  generateWidgetsFromBlueprint,
  type DashboardGroupBlueprint,
} from '../services/ai/dashboardImageService.js';
import { 
  checkSectionAccess, 
  getUserPermissions,
  QueryContext 
} from '../services/ai/queryBuilderService.js';
import {
  getFieldsForTenant,
  columnToLabel,
} from '../services/ai/schemaContextService.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { safeExecuteSQL, callLLM } from '../services/research/tools.js';
import { getSchemaForTenant, getFallbackSchemaContext } from '../services/ai/schemaContextService.js';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';
import { sanitizeGeneratedSQL } from '../services/ai/cohiChatService.js';
import { getLoanAccessContext } from '../services/userLoanAccessService.js';
import { NAVIGATION_TARGETS } from '../services/chat/navigationTargetCatalog.js';
import { evaluateUnifiedChatPolicy } from '../services/chat/unifiedChatPolicy.js';

const router = Router();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build chat context from request (includes loan-level access filter when applicable)
 */
async function buildChatContext(req: AuthRequest): Promise<ChatContext> {
  const tenantId = req.tenantContext?.tenantId || req.tenantId;
  if (!tenantId) {
    throw new Error('No tenant context available');
  }
  const tenantPool = req.tenantContext?.tenantPool;
  let userAccessFilter = null;
  if (tenantPool) {
    const ctx = await getLoanAccessContext(req, tenantPool);
    if (ctx.hasNoAccess) {
      userAccessFilter = { sql: "FALSE", params: [], paramOffset: 0 };
    } else if (!ctx.hasFullAccess && ctx.requiresFiltering) {
      userAccessFilter = ctx.getFilter("l");
    }
  }
  return {
    userId: req.userId!,
    tenantId,
    userRole: req.userRole || 'user',
    userEmail: req.userEmail,
    userAccessFilter,
  };
}

/**
 * Build query context from request
 */
function buildQueryContext(req: AuthRequest): QueryContext {
  const tenantId = req.tenantContext?.tenantId || req.tenantId;
  if (!tenantId) {
    throw new Error('No tenant context available');
  }
  return {
    userId: req.userId!,
    tenantId,
    userRole: req.userRole || 'user',
    userEmail: req.userEmail,
  };
}

function resolveQaAgentRunTag(req: AuthRequest): string | null {
  const headerTag = req.get('X-QA-Agent-Run');
  if (headerTag?.trim()) {
    return headerTag.trim();
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (typeof body?.qaAgentRunTag === 'string' && body.qaAgentRunTag.trim()) {
    return body.qaAgentRunTag.trim();
  }

  return null;
}

function withQaAgentMetadata(
  req: AuthRequest,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const qaAgentRunTag = resolveQaAgentRunTag(req);
  return qaAgentRunTag ? { ...metadata, qaAgentRunTag } : metadata;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/cohi-chat/navigation-targets
 * Canonical navigation/search target catalog used by chat + header search.
 */
router.get('/navigation-targets', authenticateToken, attachTenantContext, async (_req: AuthRequest, res) => {
  res.json({
    targets: NAVIGATION_TARGETS,
    version: 1,
  });
});

/**
 * POST /api/cohi-chat/ask
 * Ask a question - Cohi will automatically search data AND knowledge
 */
router.post('/ask', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { question, sessionId, conversationHistory } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Check section access
    const queryContext = buildQueryContext(req);
    const hasAccess = await checkSectionAccess('cohi_chat', queryContext);
    
    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: "You don't have access to the Cohi Chat feature"
      });
    }

    const chatContext = await buildChatContext(req);
    const policy = await evaluateUnifiedChatPolicy(req, { chatType: 'chat' });
    const includeRag = policy.allowed && policy.retrieval !== 'deny';

    const response = await processCohiQuestion(
      question.trim(),
      chatContext,
      conversationHistory || [],
      { includeRag },
    );

    // Save to chat history if we have a session
    if (sessionId && req.tenantContext) {
      try {
        const tenantPool = req.tenantContext.tenantPool;
        
        // Save user message
        await tenantPool.query(`
          INSERT INTO public.chat_history (user_id, session_id, role, content, metadata)
          VALUES ($1, $2, 'user', $3, $4)
        `, [
          req.userId,
          sessionId,
          question,
          JSON.stringify(withQaAgentMetadata(req, { timestamp: new Date().toISOString() }))
        ]);

        // Save assistant response
        // IMPORTANT: Persist the full `visualization` object (chart config + data)
        // and `sqlQuery` in metadata so that loading a session from history
        // re-renders the chart. Without this, the client only has a boolean
        // `hasVisualization` and shows bare text when the user reopens the chat.
        await tenantPool.query(`
          INSERT INTO public.chat_history (user_id, session_id, role, content, metadata)
          VALUES ($1, $2, 'assistant', $3, $4)
        `, [
          req.userId,
          sessionId,
          response.message,
          JSON.stringify(withQaAgentMetadata(req, {
            timestamp: new Date().toISOString(),
            hasVisualization: !!response.visualization,
            visualizationType: response.visualization?.type,
            visualization: response.visualization,
            sqlQuery: response.sqlQuery,
            rowCount: response.data?.length || 0,
            sources: response.sources,
            error: response.error
          }))
        ]);

        // Auto-title the session with the first user question & bump updated_at
        await tenantPool.query(`
          UPDATE public.chat_sessions
          SET title = CASE WHEN title = 'New conversation' THEN $1 ELSE title END,
              updated_at = NOW()
          WHERE id = $2 AND user_id = $3
        `, [question.trim().substring(0, 80), sessionId, req.userId]);
      } catch (historyError) {
        console.warn('[CohiChat] Failed to save chat history:', historyError);
      }
    }

    res.json(response);
  } catch (error: any) {
    console.error('[CohiChat] Error processing question:', error);
    res.status(500).json({ 
      error: 'Failed to process question',
      message: error.message 
    });
  }
});

/**
 * POST /api/cohi-chat/refine
 * Refine a previous query
 */
router.post('/refine', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { originalQuestion, refinement, previousResult, sessionId } = req.body;

    if (!originalQuestion || !refinement) {
      return res.status(400).json({ error: 'Original question and refinement are required' });
    }

    const chatContext = await buildChatContext(req);
    const response = await refineCohiQuery(
      originalQuestion,
      refinement,
      previousResult || {},
      chatContext
    );

    // Save to chat history
    if (sessionId && req.tenantContext) {
      try {
        const tenantPool = req.tenantContext.tenantPool;
        
        await tenantPool.query(`
          INSERT INTO public.chat_history (user_id, session_id, role, content, metadata)
          VALUES ($1, $2, 'user', $3, $4)
        `, [
          req.userId,
          sessionId,
          refinement,
          JSON.stringify(withQaAgentMetadata(req, {
            timestamp: new Date().toISOString(),
            isRefinement: true,
            originalQuestion 
          }))
        ]);

        await tenantPool.query(`
          INSERT INTO public.chat_history (user_id, session_id, role, content, metadata)
          VALUES ($1, $2, 'assistant', $3, $4)
        `, [
          req.userId,
          sessionId,
          response.message,
          JSON.stringify(withQaAgentMetadata(req, {
            timestamp: new Date().toISOString(),
            hasVisualization: !!response.visualization,
            visualizationType: response.visualization?.type,
            visualization: response.visualization,
            sqlQuery: response.sqlQuery,
            rowCount: response.data?.length || 0
          }))
        ]);

        // Bump session updated_at
        await tenantPool.query(`
          UPDATE public.chat_sessions SET updated_at = NOW()
          WHERE id = $1 AND user_id = $2
        `, [sessionId, req.userId]);
      } catch (historyError) {
        console.warn('[CohiChat] Failed to save chat history:', historyError);
      }
    }

    res.json(response);
  } catch (error: any) {
    console.error('[CohiChat] Error refining query:', error);
    res.status(500).json({ 
      error: 'Failed to refine query',
      message: error.message 
    });
  }
});

/**
 * GET /api/cohi-chat/history
 * Get user's chat history
 */
router.get('/history', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const { sessionId, limit = 50 } = req.query;

    let query = `
      SELECT id, session_id, role, content, visualization_id, metadata, created_at
      FROM public.chat_history
      WHERE user_id = $1
    `;
    const params: any[] = [req.userId];

    if (sessionId) {
      query += ` AND session_id = $2`;
      params.push(sessionId);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string, 10));

    const result = await tenantPool.query(query, params);

    // Group by session
    const sessions: Record<string, any[]> = {};
    for (const row of result.rows) {
      if (!sessions[row.session_id]) {
        sessions[row.session_id] = [];
      }
      sessions[row.session_id].push({
        id: row.id,
        role: row.role,
        content: row.content,
        visualizationId: row.visualization_id,
        metadata: row.metadata,
        createdAt: row.created_at
      });
    }

    // Sort each session's messages chronologically
    for (const sessionMessages of Object.values(sessions)) {
      sessionMessages.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    }

    res.json({ sessions });
  } catch (error: any) {
    console.error('[CohiChat] Error fetching history:', error);
    res.status(500).json({ 
      error: 'Failed to fetch chat history',
      message: error.message 
    });
  }
});

// ============================================================================
// Chat Sessions CRUD
// ============================================================================

/**
 * GET /api/cohi-chat/sessions
 * List chat sessions for the current user, ordered by most recent first.
 * Supports ?limit=25&offset=0 pagination.
 */
router.get('/sessions', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 25, 100);
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const result = await tenantPool.query(`
      SELECT
        s.id,
        s.title,
        s.created_at,
        s.updated_at,
        COUNT(h.id)::int AS message_count,
        MAX(h.created_at) AS last_message_at
      FROM public.chat_sessions s
      LEFT JOIN public.chat_history h ON h.session_id = s.id AND h.user_id = s.user_id
      WHERE s.user_id = $1
      GROUP BY s.id
      ORDER BY s.updated_at DESC
      LIMIT $2 OFFSET $3
    `, [req.userId, limit, offset]);

    const sessions = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      messageCount: row.message_count,
      lastMessageAt: row.last_message_at || row.updated_at,
      createdAt: row.created_at,
    }));

    res.json({ sessions });
  } catch (error: any) {
    console.error('[CohiChat] Error fetching sessions:', error);
    res.status(500).json({
      error: 'Failed to fetch chat sessions',
      message: error.message,
    });
  }
});

/**
 * GET /api/cohi-chat/sessions/:sessionId
 * Load all messages for a specific session.
 */
router.get('/sessions/:sessionId', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const { sessionId } = req.params;

    // Fetch session metadata
    const sessionResult = await tenantPool.query(`
      SELECT id, title, created_at, updated_at
      FROM public.chat_sessions
      WHERE id = $1 AND user_id = $2
    `, [sessionId, req.userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Fetch messages
    const messagesResult = await tenantPool.query(`
      SELECT id, role, content, visualization_id, metadata, created_at
      FROM public.chat_history
      WHERE session_id = $1 AND user_id = $2
      ORDER BY created_at ASC
    `, [sessionId, req.userId]);

    const session = sessionResult.rows[0];

    res.json({
      session: {
        id: session.id,
        title: session.title,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      },
      messages: messagesResult.rows.map(row => ({
        id: row.id,
        role: row.role,
        content: row.content,
        visualizationId: row.visualization_id,
        metadata: row.metadata,
        createdAt: row.created_at,
      })),
    });
  } catch (error: any) {
    console.error('[CohiChat] Error fetching session:', error);
    res.status(500).json({
      error: 'Failed to fetch session',
      message: error.message,
    });
  }
});

/**
 * PUT /api/cohi-chat/sessions/:sessionId
 * Rename a chat session.
 */
router.put('/sessions/:sessionId', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const { sessionId } = req.params;
    const { title } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }

    const result = await tenantPool.query(`
      UPDATE public.chat_sessions
      SET title = $1
      WHERE id = $2 AND user_id = $3
      RETURNING id, title, updated_at
    `, [title.trim().substring(0, 200), sessionId, req.userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session: result.rows[0] });
  } catch (error: any) {
    console.error('[CohiChat] Error renaming session:', error);
    res.status(500).json({
      error: 'Failed to rename session',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/cohi-chat/sessions/:sessionId
 * Delete a chat session and all its messages.
 */
router.delete('/sessions/:sessionId', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const { sessionId } = req.params;

    // Delete messages first (no FK from history -> sessions, so manual)
    await tenantPool.query(`
      DELETE FROM public.chat_history
      WHERE session_id = $1 AND user_id = $2
    `, [sessionId, req.userId]);

    // Delete session
    const result = await tenantPool.query(`
      DELETE FROM public.chat_sessions
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `, [sessionId, req.userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[CohiChat] Error deleting session:', error);
    res.status(500).json({
      error: 'Failed to delete session',
      message: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// CTE-safe SQL helpers
// ---------------------------------------------------------------------------

/**
 * Find the character offset where the final (outermost) SELECT begins.
 * For CTE queries (WITH ... AS (...) SELECT ...) this skips past all
 * CTE definitions by tracking parenthesis depth. For non-CTE queries
 * returns 0 so the entire SQL is treated as the "final body".
 */
/**
 * Asks the LLM to fix a SQL query that failed execution.
 * Returns the corrected SQL string, or null if fixing is not possible.
 */
async function autoFixSql(
  originalSql: string,
  errorMessage: string,
  schemaContext: string,
  apiKey: string,
): Promise<string | null> {
  const messages = [
    {
      role: 'system' as const,
      content: `You are a PostgreSQL expert. A SQL query failed at runtime. Fix it so it executes successfully.
Return ONLY the corrected SQL. No explanation, no markdown fences, no semicolon at the end.

Rules:
- Use table alias "l": FROM public.loans l
- NEVER use CURRENT_DATE or NOW()
- NEVER end with a semicolon
- Fix only what is broken — preserve the original query intent

Schema (first 2000 chars):
${schemaContext.substring(0, 2000)}`,
    },
    {
      role: 'user' as const,
      content: `Failed SQL:\n${originalSql}\n\nError:\n${errorMessage}\n\nFixed SQL:`,
    },
  ];

  try {
    const raw = await callLLM(messages, apiKey, { temperature: 0.1, maxTokens: 1000 });
    const fixed = raw.trim()
      .replace(/^```sql\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/, '')
      .replace(/;+\s*$/, '')
      .trim();
    if (fixed && /^(SELECT|WITH)\s/i.test(fixed)) return fixed;
  } catch {
    // swallow — caller handles null
  }
  return null;
}

function findFinalSelectOffset(sql: string): number {
  if (!/^\s*WITH\b/i.test(sql)) return 0;
  let depth = 0;
  let lastSelectAtZero = 0;
  const upper = sql.toUpperCase();
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '(') { depth++; continue; }
    if (sql[i] === ')') { depth--; continue; }
    if (depth === 0 && upper.startsWith('SELECT', i) &&
        (i === 0 || /[\s\n),]/.test(sql[i - 1])) &&
        (i + 6 >= sql.length || /[\s\n]/.test(sql[i + 6]))) {
      lastSelectAtZero = i;
    }
  }
  return lastSelectAtZero;
}

/**
 * Inject a SQL condition into the WHERE clause of a SQL body string.
 * If a WHERE exists, appends with AND before the nearest boundary clause.
 * If no WHERE exists, inserts one before GROUP BY / ORDER BY / LIMIT.
 */
function injectConditionIntoBody(body: string, condition: string): string {
  // Strip trailing semicolons so injected AND conditions don't land after ';'
  body = body.trimEnd().replace(/;+\s*$/, '').trimEnd();

  const whereRegex = /\bWHERE\b/gi;
  let lastWhereIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = whereRegex.exec(body)) !== null) {
    lastWhereIdx = m.index;
  }

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
    const insertAt = boundary.index;
    return body.substring(0, insertAt) + `WHERE ${condition} ` + body.substring(insertAt);
  }
  return body + ` WHERE ${condition}`;
}

/**
 * POST /api/cohi-chat/execute-sql
 * Execute a previously-generated SQL query directly without going through the LLM.
 * Used by workbench canvas widgets to refresh data for saved visualizations.
 */
router.post('/execute-sql', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  let _executeSqlOriginal: string | undefined;
  let _executeSqlTenantId: string | undefined;
  try {
    const { sql, dateFilter, dimensionFilters, runAsIs } = req.body;
    _executeSqlOriginal = sql;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'sql is required' });
    }

    // Research-lab widgets: run SQL exactly as stored (no sanitization, no filter injection).
    // Uses the same execution path as the research lab so CTEs with E'\n', etc. work.
    if (runAsIs) {
      const tenantContext = getTenantContext(req);
      if (!tenantContext.tenantId || !tenantContext.tenantPool) {
        return res.status(400).json({ error: 'Tenant context required for runAsIs' });
      }
      try {
        const result = await safeExecuteSQL(sql, tenantContext.tenantPool);
        const formattedRows = formatDataRows(result.rows);
        return res.json({
          data: formattedRows,
          rowCount: result.rowCount,
          fields: result.fields,
        });
      } catch (err: any) {
        console.error('[CohiChat] runAsIs SQL error:', err.message);
        return res.status(500).json({
          error: 'Failed to execute query',
          message: err.message,
        });
      }
    }

    // Strip trailing semicolons — they cause "syntax error at or near AND" when
    // filter conditions are appended after the statement terminator.
    let effectiveSql = sql.trimEnd().replace(/;+\s*$/, '').trimEnd();
    const queryParams: any[] = [];
    let paramIdx = 1;

    // Split SQL into CTE prefix and final SELECT body so that filter
    // injection never accidentally targets WHERE clauses inside CTEs.
    const finalSelectOffset = findFinalSelectOffset(effectiveSql);

    if (dateFilter && dateFilter.column && dateFilter.start && dateFilter.end) {
      const col = dateFilter.column.replace(/[^a-zA-Z0-9_.]/g, '');
      if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(col)) {
        return res.status(400).json({ error: 'Invalid date filter column name' });
      }

      // Check whether the date column is accessible in the final SELECT body.
      // For CTE queries where the column only exists inside CTEs (not the
      // outer SELECT), injecting a filter there would cause a runtime error.
      const colEscaped = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const finalBody = effectiveSql.substring(finalSelectOffset);
      const colInFinalBody = new RegExp(`\\b(?:[a-zA-Z_][a-zA-Z0-9_]*\\.)?${colEscaped}\\b`, 'i').test(finalBody);

      if (!colInFinalBody && finalSelectOffset > 0) {
        console.log(`[CohiChat] Skipping date filter: column ${col} not accessible in final SELECT (CTE query)`);
      } else {
        const dateStartParam = paramIdx++;
        const dateEndParam = paramIdx++;
        queryParams.push(dateFilter.start, dateFilter.end);
        const cond = `${col} >= $${dateStartParam}::date AND ${col} <= $${dateEndParam}::date`;

        // Additive-only injection — new widgets have clean base SQL without baked-in
        // date ranges, so we only append. For legacy widgets (dates baked in), both
        // conditions coexist; the injected range is always more restrictive and
        // effectively overrides the wider baked-in range for filtered views.
        const ctePrefix = effectiveSql.substring(0, finalSelectOffset);
        let body = effectiveSql.substring(finalSelectOffset);
        body = injectConditionIntoBody(body, cond);
        effectiveSql = ctePrefix + body;

        console.log(`[CohiChat] Date filter applied on ${col} [${dateFilter.start} → ${dateFilter.end}]`);
      }
    } else {
      console.log(`[CohiChat] No date filter applied — SQL will use its own date scoping`);
    }

    // ---------------------------------------------------------------------------
    // Dimension filters: inject equality conditions (branch, loan_officer, etc.)
    // ---------------------------------------------------------------------------
    const DIMENSION_COLUMN_MAP: Record<string, string> = { investor_name: 'investor' }; // frontend column -> DB column
    if (Array.isArray(dimensionFilters) && dimensionFilters.length > 0) {
      for (const df of dimensionFilters) {
        if (!df.column || !df.value || typeof df.column !== 'string' || typeof df.value !== 'string') continue;
        const rawCol = df.column.replace(/[^a-zA-Z0-9_.]/g, '');
        if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(rawCol)) continue;
        const dimCol = DIMENSION_COLUMN_MAP[rawCol] ?? rawCol;

        // Only inject if the column is accessible in the final SELECT body
        const dimOffset = findFinalSelectOffset(effectiveSql);
        const dimBody = effectiveSql.substring(dimOffset);
        const colEscaped = dimCol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasColumn = new RegExp(`\\b(?:[a-zA-Z_][a-zA-Z0-9_]*\\.)?${colEscaped}\\b`, 'i').test(dimBody);
        if (!hasColumn) {
          console.log(`[CohiChat] Skipping dimension filter: column ${dimCol} not accessible in final SELECT`);
          continue;
        }

        const dimParamIdx = paramIdx++;
        queryParams.push(df.value);
        const dimCond = `${dimCol} = $${dimParamIdx}`;

        const ctePrefix = effectiveSql.substring(0, dimOffset);
        let body = effectiveSql.substring(dimOffset);
        body = injectConditionIntoBody(body, dimCond);
        effectiveSql = ctePrefix + body;

        console.log(`[CohiChat] Dimension filter applied: ${dimCol} = $${dimParamIdx}`);
      }
    }

    const tenantContext = getTenantContext(req);
    _executeSqlTenantId = tenantContext.tenantId;
    const context: ChatContext = {
      tenantId: tenantContext.tenantId,
      userId: req.userId!,
      userRole: 'user',
    };

    const result = await executeQuery(effectiveSql, queryParams, context);

    // Apply the same formatting as the chat pipeline so data matches
    // the vizConfig expectations (dates formatted, numerics parsed, etc.)
    const formattedRows = formatDataRows(result.rows);

    res.json({
      data: formattedRows,
      rowCount: result.rowCount,
      fields: result.fields,
    });
  } catch (error: any) {
    console.error('[CohiChat] Error executing SQL:', error.message);

    // Auto-fix: ask the LLM to repair the SQL and retry once
    if (_executeSqlOriginal && _executeSqlTenantId) {
      try {
        const apiKeyRow = await tenantDbManager.getTenantPool(_executeSqlTenantId).then(p =>
          p.query<{ openai_api_key?: string }>(`SELECT openai_api_key FROM public.rag_settings LIMIT 1`).catch(() => ({ rows: [] }))
        );
        const apiKey: string = apiKeyRow.rows[0]?.openai_api_key || process.env.OPENAI_API_KEY || '';
        if (apiKey) {
          const schemaCtx = await getSchemaForTenant(_executeSqlTenantId).catch(() => getFallbackSchemaContext());
          const fixedSql = await autoFixSql(_executeSqlOriginal, error.message, schemaCtx, apiKey);
          if (fixedSql) {
            try {
              const tenantPool = await tenantDbManager.getTenantPool(_executeSqlTenantId);
              const fixedResult = await tenantPool.query(sanitizeGeneratedSQL(fixedSql));
              const formattedRows = formatDataRows(fixedResult.rows);
              console.log('[CohiChat] Auto-fix succeeded for SQL error');
              return res.json({
                data: formattedRows,
                rowCount: fixedResult.rowCount,
                fields: fixedResult.fields?.map((f: any) => f.name) ?? [],
                fixedSql,
              });
            } catch (fixErr: any) {
              console.warn('[CohiChat] Auto-fix SQL also failed:', fixErr.message);
            }
          }
        }
      } catch (autoFixErr: any) {
        console.warn('[CohiChat] Auto-fix attempt failed:', autoFixErr.message);
      }
    }

    res.status(500).json({
      error: 'Failed to execute query',
      message: error.message,
    });
  }
});

/**
 * GET /api/cohi-chat/saved-visualizations
 * Get user's saved visualizations
 */
router.get('/saved-visualizations', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;

    const result = await tenantPool.query(`
      SELECT 
        id, title, description, question, 
        visualization_type, visualization_config, query_config,
        data_snapshot, position, width, height, is_pinned, refresh_interval,
        created_at, updated_at
      FROM public.saved_visualizations
      WHERE user_id = $1
      ORDER BY position ASC, created_at DESC
    `, [req.userId]);

    const visualizations = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      question: row.question,
      visualizationType: row.visualization_type,
      visualizationConfig: row.visualization_config,
      queryConfig: row.query_config,
      dataSnapshot: row.data_snapshot,
      position: row.position,
      width: row.width,
      height: row.height,
      isPinned: row.is_pinned,
      refreshInterval: row.refresh_interval,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    res.json({ visualizations });
  } catch (error: any) {
    console.error('[CohiChat] Error fetching saved visualizations:', error);
    res.status(500).json({ 
      error: 'Failed to fetch saved visualizations',
      message: error.message 
    });
  }
});

/**
 * PUT /api/cohi-chat/saved-visualizations/:id
 * Update a saved visualization
 */
router.put('/saved-visualizations/:id', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title, description, position, width, height, isPinned, refreshInterval } = req.body;

    const tenantPool = getTenantContext(req).tenantPool;

    // Check ownership
    const ownership = await tenantPool.query(
      'SELECT id FROM public.saved_visualizations WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Visualization not found' });
    }

    // Build update query dynamically
    const updates: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(description);
    }
    if (position !== undefined) {
      updates.push(`position = $${paramIndex++}`);
      params.push(position);
    }
    if (width !== undefined) {
      updates.push(`width = $${paramIndex++}`);
      params.push(width);
    }
    if (height !== undefined) {
      updates.push(`height = $${paramIndex++}`);
      params.push(height);
    }
    if (isPinned !== undefined) {
      updates.push(`is_pinned = $${paramIndex++}`);
      params.push(isPinned);
    }
    if (refreshInterval !== undefined) {
      updates.push(`refresh_interval = $${paramIndex++}`);
      params.push(refreshInterval);
    }

    params.push(id);

    await tenantPool.query(
      `UPDATE public.saved_visualizations SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('[CohiChat] Error updating visualization:', error);
    res.status(500).json({ 
      error: 'Failed to update visualization',
      message: error.message 
    });
  }
});

/**
 * DELETE /api/cohi-chat/saved-visualizations/:id
 * Delete a saved visualization
 */
router.delete('/saved-visualizations/:id', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const tenantPool = getTenantContext(req).tenantPool;

    const result = await tenantPool.query(
      'DELETE FROM public.saved_visualizations WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Visualization not found' });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[CohiChat] Error deleting visualization:', error);
    res.status(500).json({ 
      error: 'Failed to delete visualization',
      message: error.message 
    });
  }
});

/**
 * POST /api/cohi-chat/refresh-visualization/:id
 * Refresh a visualization with fresh data
 */
router.post('/refresh-visualization/:id', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const tenantPool = getTenantContext(req).tenantPool;

    // Get the visualization
    const vizResult = await tenantPool.query(
      'SELECT question, query_config FROM public.saved_visualizations WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (vizResult.rows.length === 0) {
      return res.status(404).json({ error: 'Visualization not found' });
    }

    const { question } = vizResult.rows[0];

    // Re-run the query
    const chatContext = await buildChatContext(req);
    const response = await processCohiQuestion(question, chatContext);

    if (response.error) {
      return res.status(500).json({ 
        error: 'Failed to refresh visualization',
        message: response.error 
      });
    }

    // Update the data snapshot
    if (response.visualization) {
      await tenantPool.query(`
        UPDATE public.saved_visualizations 
        SET data_snapshot = $1, updated_at = NOW()
        WHERE id = $2
      `, [JSON.stringify(response.visualization.data), id]);
    }

    res.json({
      success: true,
      visualization: response.visualization,
      data: response.data
    });
  } catch (error: any) {
    console.error('[CohiChat] Error refreshing visualization:', error);
    res.status(500).json({ 
      error: 'Failed to refresh visualization',
      message: error.message 
    });
  }
});

/**
 * POST /api/cohi-chat/new-session
 * Create a new chat session
 */
router.post('/new-session', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const sessionId = uuidv4();

    // Persist the session row so it appears in the sessions list
    if (req.tenantContext) {
      try {
        const tenantPool = req.tenantContext.tenantPool;
        await tenantPool.query(`
          INSERT INTO public.chat_sessions (id, user_id, title)
          VALUES ($1, $2, 'New conversation')
          ON CONFLICT (id) DO NOTHING
        `, [sessionId, req.userId]);
      } catch (sessionErr) {
        console.warn('[CohiChat] Failed to persist session row:', sessionErr);
      }
    }

    res.json({ sessionId });
  } catch (error: any) {
    console.error('[CohiChat] Error creating session:', error);
    res.status(500).json({ 
      error: 'Failed to create session',
      message: error.message 
    });
  }
});

/**
 * GET /api/cohi-chat/permissions
 * Get current user's data access permissions
 */
router.get('/permissions', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const queryContext = buildQueryContext(req);
    const permissions = await getUserPermissions(queryContext);

    res.json({
      sectionAccess: permissions.sectionAccess,
      rowFilters: permissions.rowFilters.length,
      fieldRestrictions: permissions.fieldRestrictions
    });
  } catch (error: any) {
    console.error('[CohiChat] Error fetching permissions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch permissions',
      message: error.message 
    });
  }
});

// ============================================================================
// Edit Widget with Cohi
// ============================================================================

/**
 * POST /api/cohi-chat/edit-widget
 * Conversational widget editing – supports multi-turn chat with optional SQL modifications.
 * Body: { sql, vizConfig, instruction, history?: {role,content}[] }
 * Returns: { sql, vizConfig, message, modified }
 */
router.post('/edit-widget', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { sql, vizConfig, instruction, history } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'sql is required' });
    }
    if (!instruction || typeof instruction !== 'string') {
      return res.status(400).json({ error: 'instruction is required' });
    }

    const chatContext = await buildChatContext(req);
    console.log(`[CohiChat] Edit-widget conversation: "${instruction.substring(0, 80)}..."`);

    const result = await editWidgetQuery(
      sql,
      vizConfig || {},
      instruction,
      chatContext,
      Array.isArray(history) ? history : undefined,
    );

    console.log(`[CohiChat] Edit-widget response (modified=${result.modified}): ${result.message.substring(0, 120)}...`);

    res.json(result);
  } catch (error: any) {
    console.error('[CohiChat] Error editing widget:', error);
    res.status(500).json({
      error: 'Failed to edit widget',
      message: error.message,
    });
  }
});

// ============================================================================
// Widget Field Introspection
// ============================================================================

/**
 * POST /api/cohi-chat/widget-fields
 * Given a widget's SQL, returns which fields are being used and all available
 * fields the user could swap them for, grouped by category.
 */
router.post('/widget-fields', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { sql } = req.body;
    const tenantId = getTenantContext(req)?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenant context required' });
    }

    // Get all available fields for this tenant
    const { fields, categories } = await getFieldsForTenant(tenantId);
    const fieldNameSet = new Set(fields.map((f) => f.name));

    // Extract fields used in the SQL by matching against known column names
    const usedFields: { name: string; label: string; type: string; category: string }[] = [];
    if (sql && typeof sql === 'string') {
      const sqlLower = sql.toLowerCase();
      for (const field of fields) {
        // Match the column name as a whole word in the SQL (with optional table alias prefix)
        const pattern = new RegExp(`\\b(?:[a-z_]+\\.)?${field.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (pattern.test(sql)) {
          usedFields.push(field);
        }
      }
    }

    res.json({
      usedFields,
      availableFields: fields,
      categories,
    });
  } catch (error: any) {
    console.error('[CohiChat] Error getting widget fields:', error);
    res.status(500).json({
      error: 'Failed to get widget fields',
      message: error.message,
    });
  }
});

// ============================================================================
// Dashboard Image Analysis
// ============================================================================

/**
 * POST /api/cohi-chat/analyze-dashboard-image
 * Upload a dashboard screenshot and get a structured blueprint back
 */
router.post('/analyze-dashboard-image', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { image, description } = req.body;

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'image (base64 data URL) is required' });
    }

    // Validate it looks like a data URL or base64
    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'image must be a base64 data URL (data:image/...)' });
    }

    const chatContext = await buildChatContext(req);
    console.log(`[CohiChat] Analyzing dashboard image for tenant ${chatContext.tenantId}`);

    const blueprint = await analyzeDashboardImage(
      image,
      chatContext.tenantId,
      description
    );

    console.log(`[CohiChat] Blueprint generated: ${blueprint.title} with ${blueprint.groups.length} group(s)`);
    for (const g of blueprint.groups) {
      console.log(`  Group "${g.title}": ${g.widgets.length} widget(s)`);
    }

    res.json({ blueprint });
  } catch (error: any) {
    console.error('[CohiChat] Error analyzing dashboard image:', error);
    res.status(500).json({
      error: 'Failed to analyze dashboard image',
      message: error.message,
    });
  }
});

/**
 * POST /api/cohi-chat/generate-dashboard-widgets
 * Generate actual SQL-backed widgets from a blueprint group
 */
router.post('/generate-dashboard-widgets', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { blueprint: group } = req.body as { blueprint: DashboardGroupBlueprint };

    if (!group || !group.title || !Array.isArray(group.widgets)) {
      return res.status(400).json({ error: 'Invalid blueprint group structure' });
    }

    const chatContext = await buildChatContext(req);
    console.log(`[CohiChat] Generating ${group.widgets.length} widget(s) for group "${group.title}"`);

    const result = await generateWidgetsFromBlueprint(group, chatContext);

    console.log(`[CohiChat] Generated ${result.widgets.length} widget(s) for group "${group.title}"`);

    res.json({ group: result });
  } catch (error: any) {
    console.error('[CohiChat] Error generating dashboard widgets:', error);
    res.status(500).json({
      error: 'Failed to generate dashboard widgets',
      message: error.message,
    });
  }
});

export default router;
