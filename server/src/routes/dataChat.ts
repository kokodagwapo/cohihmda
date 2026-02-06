/**
 * Data Chat API Routes
 * AI-powered natural language interface for querying loan data
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import Papa from 'papaparse';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
import { 
  processDataQuestion, 
  refineQuery, 
  DataChatMessage, 
  DataChatResponse,
  VisualizationConfig,
  ChatContext
} from '../services/ai/dataChatService.js';
import { 
  checkSectionAccess, 
  getUserPermissions,
  QueryContext 
} from '../services/ai/queryBuilderService.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build chat context from request
 * Uses tenantContext.tenantId (resolved from query param or JWT) over req.tenantId
 */
function buildChatContext(req: AuthRequest): ChatContext {
  // Use resolved tenant from middleware (handles both query param and JWT)
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
 * Uses tenantContext.tenantId (resolved from query param or JWT) over req.tenantId
 */
function buildQueryContext(req: AuthRequest): QueryContext {
  // Use resolved tenant from middleware (handles both query param and JWT)
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
 * POST /api/data-chat/ask
 * Ask a question about the data
 */
router.post('/ask', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { question, sessionId, conversationHistory } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Check section access
    const queryContext = buildQueryContext(req);
    const hasAccess = await checkSectionAccess('data_chat', queryContext);
    
    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: "You don't have access to the data chat feature"
      });
    }

    // Process the question
    const chatContext = buildChatContext(req);
    const response = await processDataQuestion(
      question.trim(),
      chatContext,
      conversationHistory || []
    );

    // Save to chat history if we have a session
    // Note: Platform staff have shadow user records auto-created by tenantContext middleware
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
            error: response.error
          })
        ]);
      } catch (historyError) {
        // Don't fail the request if history saving fails
        // This can happen if shadow user creation failed (e.g., schema migration not run)
        console.warn('[DataChat] Failed to save chat history:', historyError);
      }
    }

    res.json(response);
  } catch (error: any) {
    console.error('[DataChat] Error processing question:', error);
    res.status(500).json({ 
      error: 'Failed to process question',
      message: error.message 
    });
  }
});

/**
 * POST /api/data-chat/refine
 * Refine a previous query
 */
router.post('/refine', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { originalQuestion, refinement, previousResult, sessionId } = req.body;

    if (!originalQuestion || !refinement) {
      return res.status(400).json({ error: 'Original question and refinement are required' });
    }

    const chatContext = buildChatContext(req);
    const response = await refineQuery(
      originalQuestion,
      refinement,
      previousResult || {},
      chatContext
    );

    // Save to chat history
    // Note: Platform staff have shadow user records auto-created by tenantContext middleware
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
        console.warn('[DataChat] Failed to save chat history:', historyError);
      }
    }

    res.json(response);
  } catch (error: any) {
    console.error('[DataChat] Error refining query:', error);
    res.status(500).json({ 
      error: 'Failed to refine query',
      message: error.message 
    });
  }
});

/**
 * GET /api/data-chat/history
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
    console.error('[DataChat] Error fetching history:', error);
    res.status(500).json({ 
      error: 'Failed to fetch chat history',
      message: error.message 
    });
  }
});

/**
 * POST /api/data-chat/save-visualization
 * Save a visualization to the custom dashboard
 */
router.post('/save-visualization', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { 
      title, 
      description, 
      question, 
      visualization, 
      queryConfig,
      position = 0
    } = req.body;

    if (!title || !question || !visualization) {
      return res.status(400).json({ 
        error: 'Title, question, and visualization are required' 
      });
    }

    const tenantPool = getTenantContext(req).tenantPool;

    const result = await tenantPool.query(`
      INSERT INTO public.saved_visualizations 
        (user_id, title, description, question, visualization_type, visualization_config, query_config, data_snapshot, position)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, created_at
    `, [
      req.userId,
      title,
      description || null,
      question,
      visualization.type,
      JSON.stringify(visualization),
      JSON.stringify(queryConfig || {}),
      visualization.data ? JSON.stringify(visualization.data) : null,
      position
    ]);

    res.json({
      success: true,
      visualization: {
        id: result.rows[0].id,
        title,
        description,
        question,
        type: visualization.type,
        createdAt: result.rows[0].created_at
      }
    });
  } catch (error: any) {
    console.error('[DataChat] Error saving visualization:', error);
    res.status(500).json({ 
      error: 'Failed to save visualization',
      message: error.message 
    });
  }
});

/**
 * GET /api/data-chat/saved-visualizations
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
    console.error('[DataChat] Error fetching saved visualizations:', error);
    res.status(500).json({ 
      error: 'Failed to fetch saved visualizations',
      message: error.message 
    });
  }
});

/**
 * PUT /api/data-chat/saved-visualizations/:id
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
    console.error('[DataChat] Error updating visualization:', error);
    res.status(500).json({ 
      error: 'Failed to update visualization',
      message: error.message 
    });
  }
});

/**
 * DELETE /api/data-chat/saved-visualizations/:id
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
    console.error('[DataChat] Error deleting visualization:', error);
    res.status(500).json({ 
      error: 'Failed to delete visualization',
      message: error.message 
    });
  }
});

/**
 * POST /api/data-chat/refresh-visualization/:id
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

    const { question, query_config } = vizResult.rows[0];

    // Re-run the query
    const chatContext = buildChatContext(req);
    const response = await processDataQuestion(question, chatContext);

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
    console.error('[DataChat] Error refreshing visualization:', error);
    res.status(500).json({ 
      error: 'Failed to refresh visualization',
      message: error.message 
    });
  }
});

/**
 * POST /api/data-chat/analyze-file
 * Analyze an uploaded CSV and return a summary (and optional table visualization).
 * Only CSV is supported for structured analysis.
 */
router.post('/analyze-file', authenticateToken, apiLimiter, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const question = (req.body?.question as string)?.trim() || `Analyze this ${req.file.originalname}`;
    const mimetype = (req.file.mimetype || '').toLowerCase();
    const name = (req.file.originalname || '').toLowerCase();
    const isCsv = mimetype === 'text/csv' || name.endsWith('.csv');
    if (!isCsv) {
      return res.status(400).json({
        error: 'Only CSV files are supported for analysis',
        analysis: `Uploaded file "${req.file.originalname}" is not a CSV. Please upload a CSV file to get a structured analysis.`,
      });
    }
    let csvText = req.file.buffer.toString('utf-8');
    if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1);
    if (!csvText || !csvText.trim()) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }
    const parseResult = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    const rows = parseResult.data || [];
    const errors = parseResult.errors || [];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : (parseResult.meta?.fields || []);
    const rowCount = rows.length;
    const colCount = columns.length;
    const sample = rows.slice(0, 10);
    let analysis = `**${req.file.originalname}**\n\n`;
    analysis += `- **Rows:** ${rowCount}\n`;
    analysis += `- **Columns:** ${colCount} (${columns.join(', ')})\n\n`;
    if (errors.length > 0) {
      analysis += `Parsing notes: ${errors.length} non-fatal issue(s).\n\n`;
    }
    analysis += `**Sample (first ${sample.length} rows):**\n`;
    analysis += columns.join(' | ') + '\n';
    analysis += columns.map(() => '---').join(' | ') + '\n';
    for (const row of sample) {
      analysis += columns.map((c) => String(row[c] ?? '').slice(0, 30)).join(' | ') + '\n';
    }
    const summary = `CSV has ${rowCount} rows and ${colCount} columns: ${columns.join(', ')}.`;
    const visualization: VisualizationConfig | undefined =
      rowCount > 0 && colCount > 0
        ? {
            type: 'table',
            title: `Sample: ${req.file.originalname}`,
            data: sample,
            tableConfig: {
              columns: columns.map((key) => ({ key, label: key, format: 'text' })),
              sortable: true,
              pageSize: 10,
            },
          }
        : undefined;
    res.json({
      analysis,
      summary,
      visualization,
    });
  } catch (error: any) {
    console.error('[DataChat] analyze-file error:', error);
    res.status(500).json({
      error: 'Failed to analyze file',
      analysis: error?.message || 'An error occurred while processing the file.',
    });
  }
});

/**
 * POST /api/data-chat/new-session
 * Create a new chat session
 */
router.post('/new-session', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sessionId = uuidv4();
    res.json({ sessionId });
  } catch (error: any) {
    console.error('[DataChat] Error creating session:', error);
    res.status(500).json({ 
      error: 'Failed to create session',
      message: error.message 
    });
  }
});

/**
 * GET /api/data-chat/permissions
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
    console.error('[DataChat] Error fetching permissions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch permissions',
      message: error.message 
    });
  }
});

export default router;
