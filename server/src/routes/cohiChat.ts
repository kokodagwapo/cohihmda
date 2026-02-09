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
  CohiChatMessage, 
  CohiChatResponse,
  VisualizationConfig,
  ChatContext
} from '../services/ai/cohiChatService.js';
import { 
  checkSectionAccess, 
  getUserPermissions,
  QueryContext 
} from '../services/ai/queryBuilderService.js';
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
    // Strategy: inject the condition into the SQL's own WHERE clause so that
    // it references the original table columns (not an outer subquery which
    // may have aggregated or renamed them).
    let effectiveSql = sql;
    if (dateFilter && dateFilter.column && dateFilter.start && dateFilter.end) {
      const col = dateFilter.column.replace(/[^a-zA-Z0-9_.]/g, ''); // sanitise column name
      const cond = `${col} >= '${dateFilter.start}'::date AND ${col} <= '${dateFilter.end}'::date`;

      // 1. Try to append to the last WHERE clause (before GROUP BY / ORDER BY / LIMIT / HAVING)
      //    Works for the vast majority of LLM-generated queries.
      const whereRegex = /\bWHERE\b/gi;
      let lastWhereIdx = -1;
      let m: RegExpExecArray | null;
      while ((m = whereRegex.exec(sql)) !== null) {
        lastWhereIdx = m.index;
      }

      if (lastWhereIdx >= 0) {
        const afterWhere = sql.substring(lastWhereIdx + 5);
        const boundary = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|UNION|INTERSECT|EXCEPT)\b/i.exec(afterWhere);
        if (boundary) {
          const insertAt = lastWhereIdx + 5 + boundary.index;
          effectiveSql = sql.substring(0, insertAt) + ` AND ${cond} ` + sql.substring(insertAt);
        } else {
          effectiveSql = sql + ` AND ${cond}`;
        }
      } else {
        // 2. No WHERE clause – insert one before the first GROUP BY / ORDER BY / LIMIT
        const boundary = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING)\b/i.exec(sql);
        if (boundary) {
          const insertAt = boundary.index;
          effectiveSql = sql.substring(0, insertAt) + `WHERE ${cond} ` + sql.substring(insertAt);
        } else {
          effectiveSql = sql + ` WHERE ${cond}`;
        }
      }
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

export default router;
