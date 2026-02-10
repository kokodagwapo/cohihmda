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

const router = Router();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build chat context from request
 */
function buildChatContext(req: AuthRequest): ChatContext {
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

// ============================================================================
// Routes
// ============================================================================

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

    // Check section access (using data_chat for backwards compatibility)
    const queryContext = buildQueryContext(req);
    const hasAccess = await checkSectionAccess('data_chat', queryContext);
    
    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: "You don't have access to the Cohi Chat feature"
      });
    }

    // Process the question
    const chatContext = buildChatContext(req);
    const response = await processCohiQuestion(
      question.trim(),
      chatContext,
      conversationHistory || []
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
          JSON.stringify({ timestamp: new Date().toISOString() })
        ]);

        // Save assistant response
        await tenantPool.query(`
          INSERT INTO public.chat_history (user_id, session_id, role, content, metadata)
          VALUES ($1, $2, 'assistant', $3, $4)
        `, [
          req.userId,
          sessionId,
          response.message,
          JSON.stringify({
            timestamp: new Date().toISOString(),
            hasVisualization: !!response.visualization,
            visualizationType: response.visualization?.type,
            rowCount: response.data?.length || 0,
            sources: response.sources,
            error: response.error
          })
        ]);
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

    const chatContext = buildChatContext(req);
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
          JSON.stringify({ 
            timestamp: new Date().toISOString(),
            isRefinement: true,
            originalQuestion 
          })
        ]);

        await tenantPool.query(`
          INSERT INTO public.chat_history (user_id, session_id, role, content, metadata)
          VALUES ($1, $2, 'assistant', $3, $4)
        `, [
          req.userId,
          sessionId,
          response.message,
          JSON.stringify({
            timestamp: new Date().toISOString(),
            hasVisualization: !!response.visualization,
            visualizationType: response.visualization?.type,
            rowCount: response.data?.length || 0
          })
        ]);
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

/**
 * POST /api/cohi-chat/execute-sql
 * Execute a previously-generated SQL query directly without going through the LLM.
 * Used by workbench canvas widgets to refresh data for saved visualizations.
 */
router.post('/execute-sql', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { sql, dateFilter } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'sql is required' });
    }

    // Optionally inject a date-range filter into the SQL.
    // dateFilter: { column: string, start: string (YYYY-MM-DD), end: string (YYYY-MM-DD) }
    //
    // Strategy:
    //   1. Strip any existing date comparison conditions on the same column
    //      (including aliased references like l.column or loans.column) so we
    //      don't end up with contradictory ranges.
    //   2. Inject our own condition into the WHERE clause.
    let effectiveSql = sql;
    if (dateFilter && dateFilter.column && dateFilter.start && dateFilter.end) {
      const col = dateFilter.column.replace(/[^a-zA-Z0-9_.]/g, ''); // sanitise column name
      const cond = `${col} >= '${dateFilter.start}'::date AND ${col} <= '${dateFilter.end}'::date`;

      // --- Step 1: Strip existing date conditions on this column ---
      // Match patterns like:
      //   l.application_date >= '2024-01-01'
      //   application_date < '2025-01-01'::date
      //   l.application_date BETWEEN '...' AND '...'
      //   DATE_TRUNC('year', CURRENT_DATE) (when used as bound for the column)
      // Handles optional table alias (e.g. l. or loans.)
      const colEscaped = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match any alias prefix followed by the column name
      const colPattern = `(?:[a-zA-Z_][a-zA-Z0-9_]*\\.)?${colEscaped}`;

      // Remove simple comparison conditions: column >=/<=/>/< 'date-literal'(::date/::timestamp)?
      // Also handles DATE_TRUNC(...) and CURRENT_DATE expressions on the right-hand side
      const dateComparisonPattern = new RegExp(
        `\\b${colPattern}\\s*(?:>=|<=|>|<)\\s*(?:'[^']*'(?:::(?:date|timestamp))?|DATE_TRUNC\\s*\\([^)]*\\)|CURRENT_DATE(?:\\s*-\\s*INTERVAL\\s*'[^']*')?)`,
        'gi'
      );
      // Remove BETWEEN ... AND ... on this column
      const betweenPattern = new RegExp(
        `\\b${colPattern}\\s+BETWEEN\\s+'[^']*'(?:::(?:date|timestamp))?\\s+AND\\s+'[^']*'(?:::(?:date|timestamp))?`,
        'gi'
      );

      // Strip the conditions and clean up leftover AND/OR operators
      effectiveSql = effectiveSql.replace(betweenPattern, ' TRUE ');
      effectiveSql = effectiveSql.replace(dateComparisonPattern, ' TRUE ');

      // Clean up: collapse "TRUE AND TRUE" → "TRUE", "WHERE TRUE AND" → "WHERE", etc.
      // Repeated passes to handle nested cleanup
      for (let pass = 0; pass < 3; pass++) {
        effectiveSql = effectiveSql
          .replace(/\bTRUE\s+AND\s+TRUE\b/gi, 'TRUE')
          .replace(/\bTRUE\s+OR\s+TRUE\b/gi, 'TRUE')
          .replace(/\bAND\s+TRUE\b/gi, '')
          .replace(/\bTRUE\s+AND\b/gi, '')
          .replace(/\bOR\s+TRUE\b/gi, '')
          .replace(/\bTRUE\s+OR\b/gi, '')
          .replace(/\bWHERE\s+TRUE\s*(?=\bGROUP\b|\bORDER\b|\bLIMIT\b|\bHAVING\b|\bUNION\b|\bINTERSECT\b|\bEXCEPT\b|\)|$)/gi, '')
          .replace(/\bWHERE\s+TRUE\s+(?=AND|OR)\s*/gi, 'WHERE ');
      }
      // Remove any "WHERE" that's now empty (only whitespace before GROUP BY etc.)
      effectiveSql = effectiveSql.replace(/\bWHERE\s+(?=GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|UNION|INTERSECT|EXCEPT|\)|$)/gi, '');

      // --- Step 2: Inject the new date condition ---
      const whereRegex = /\bWHERE\b/gi;
      let lastWhereIdx = -1;
      let m: RegExpExecArray | null;
      while ((m = whereRegex.exec(effectiveSql)) !== null) {
        lastWhereIdx = m.index;
      }

      if (lastWhereIdx >= 0) {
        const afterWhere = effectiveSql.substring(lastWhereIdx + 5);
        const boundary = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|UNION|INTERSECT|EXCEPT)\b/i.exec(afterWhere);
        if (boundary) {
          const insertAt = lastWhereIdx + 5 + boundary.index;
          effectiveSql = effectiveSql.substring(0, insertAt) + ` AND ${cond} ` + effectiveSql.substring(insertAt);
        } else {
          effectiveSql = effectiveSql + ` AND ${cond}`;
        }
      } else {
        // No WHERE clause – insert one before the first GROUP BY / ORDER BY / LIMIT
        const boundary = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING)\b/i.exec(effectiveSql);
        if (boundary) {
          const insertAt = boundary.index;
          effectiveSql = effectiveSql.substring(0, insertAt) + `WHERE ${cond} ` + effectiveSql.substring(insertAt);
        } else {
          effectiveSql = effectiveSql + ` WHERE ${cond}`;
        }
      }

      console.log(`[CohiChat] Date filter applied on ${col} [${dateFilter.start} → ${dateFilter.end}]`);
    }

    const tenantContext = getTenantContext(req);
    const context: ChatContext = {
      tenantId: tenantContext.tenantId,
      userId: req.userId!,
      userRole: 'user',
    };

    const result = await executeQuery(effectiveSql, [], context);

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
    const chatContext = buildChatContext(req);
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
router.post('/new-session', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sessionId = uuidv4();
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

    const chatContext = buildChatContext(req);
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

    const chatContext = buildChatContext(req);
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

    const chatContext = buildChatContext(req);
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
