import { Router } from 'express';
import { pool } from '../config/database.js';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import multer from 'multer';
import { parseDocument } from '../services/documentParser.js';
import { chunkDocument } from '../services/documentChunker.js';
import { generateEmbeddings } from '../services/embeddingService.js';
import { storeEmbeddings, searchEmbeddings } from '../services/vectorDatabase.js';
import { logCostEvent } from '../middleware/costTracking.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { encryptAPIKeys, decryptAPIKeys, isEncryptionConfigured } from '../services/encryption.js';
import { auditLog, logDataAccess } from '../services/auditLogger.js';
import pg from 'pg';

/**
 * Helper function to get tenant pool for RAG settings
 * Uses tenantDatabaseManager to connect to tenant-specific database
 */
async function getTenantPoolForRag(tenantId: string): Promise<pg.Pool> {
  return tenantDbManager.getTenantPool(tenantId);
}

/**
 * Create rag_settings table in tenant database if it doesn't exist
 */
async function createRagSettingsTable(tenantPool: pg.Pool): Promise<void> {
  await tenantPool.query(`
    CREATE TABLE IF NOT EXISTS public.rag_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Embedding/RAG configuration
      embedding_model TEXT DEFAULT 'text-embedding-3-small',
      vector_database TEXT DEFAULT 'pgvector',
      chunk_size INTEGER DEFAULT 1000,
      chunk_overlap INTEGER DEFAULT 200,
      top_k INTEGER DEFAULT 5,
      similarity_threshold NUMERIC DEFAULT 0.7,
      enable_reranking BOOLEAN DEFAULT false,
      reranking_model TEXT,
      context_window INTEGER DEFAULT 8000,
      -- Chat model configuration
      chat_model TEXT DEFAULT 'gpt-4o-mini',
      temperature NUMERIC DEFAULT 0.7,
      custom_system_prompt TEXT,
      -- PII/Privacy settings
      enable_pii_sanitization BOOLEAN DEFAULT true,
      redact_ssn BOOLEAN DEFAULT true,
      redact_dob BOOLEAN DEFAULT true,
      redact_account_numbers BOOLEAN DEFAULT true,
      allow_employee_names BOOLEAN DEFAULT false,
      log_ai_interactions BOOLEAN DEFAULT true,
      -- API Keys (encrypted)
      openai_api_key TEXT,
      gemini_api_key TEXT,
      -- Voice Agentic settings
      voice_agentic_enabled BOOLEAN DEFAULT false,
      voice_model TEXT DEFAULT 'gpt-4o-mini',
      voice_name TEXT DEFAULT 'Aria',
      voice_top_k INTEGER DEFAULT 3,
      voice_similarity_threshold NUMERIC DEFAULT 0.75,
      voice_context_window INTEGER DEFAULT 4000,
      voice_temperature NUMERIC DEFAULT 0.8,
      voice_response_max_length INTEGER DEFAULT 60,
      voice_conversation_memory INTEGER DEFAULT 10,
      voice_rag_enabled BOOLEAN DEFAULT true,
      voice_system_prompt TEXT,
      voice_enable_reranking BOOLEAN DEFAULT false,
      voice_real_time_mode BOOLEAN DEFAULT false,
      -- Personality/Conversation settings
      allowed_topics TEXT,
      conversation_rules TEXT,
      personality_tone TEXT DEFAULT 'professional',
      personality_style TEXT DEFAULT 'concise',
      personality_custom TEXT,
      knowledge_base_links TEXT,
      -- Timestamps
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * Ensure rag_settings table and row exists in tenant database
 * Creates table if missing, then creates default settings if no row exists
 */
async function ensureRagSettings(tenantPool: pg.Pool): Promise<void> {
  // First, create the table if it doesn't exist
  await createRagSettingsTable(tenantPool);
  
  // Then check if a row exists
  const existing = await tenantPool.query('SELECT id FROM public.rag_settings LIMIT 1');
  if (existing.rows.length === 0) {
    // Create default settings
    const defaultAllowedTopics = `Loan origination
Underwriting
Compliance and regulatory requirements
Staff productivity and performance
TopTiering system and rankings
Fallout estimation and prediction
Market trends and industry news
Executive insights and strategic clarity
Company health signals
Profitability analysis
Cycle time optimization
Capacity management
Risk assessment
Operational bottlenecks
Performance metrics and benchmarks`;

    const defaultConversationRules = `Always ask for clarification when information is unclear
Never provide financial advice or make credit decisions
Always cite sources when referencing data or metrics
Be proactive and predictive - surface important information before being asked
Connect insights across different domains (market trends, staff performance, operational data)
Use executive-level language appropriate for leadership
Speak clearly and concisely - every word counts
Provide actionable insights that lead to decisions
Never include stage directions or bracketed text in responses
Read financial figures in full professional terms (e.g., "one point two million dollars" not "1.2M")
Stay current with mortgage industry trends and Fed announcements`;

    const defaultKnowledgeBaseLinks = `https://docs.coheus.com
https://wiki.coheus.com/knowledge-base
https://docs.coheus.com/rag
https://docs.coheus.com/voice-agentic`;

    const defaultPersonalityCustom = `Be proactive and predictive - identify patterns before they become problems. Ask smart questions the CEO didn't even think of. Connect dots others might miss across market trends, staff performance, and operational data. Surface hidden opportunities and risks. Deliver insights like a trusted advisor, not just reporting data but providing strategic intelligence. Think like a Chief of Staff - every insight should matter to leadership and lead to actionable decisions.`;

    await tenantPool.query(
      `INSERT INTO public.rag_settings (
        allowed_topics, 
        conversation_rules, 
        knowledge_base_links,
        personality_tone,
        personality_style,
        personality_custom
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [defaultAllowedTopics, defaultConversationRules, defaultKnowledgeBaseLinks, 'professional', 'concise', defaultPersonalityCustom]
    );
    
    console.log('[RAG Settings] Created rag_settings table and default row in tenant database');
  }
}

const router = Router();

// Configure multer for document uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
      'text/html',
      'text/csv',
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(pdf|docx|doc|txt|html|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: PDF, DOCX, DOC, TXT, HTML, CSV'));
    }
  },
});

// Validation schemas
const ragSettingsSchema = z.object({
  embedding_model: z.string().optional(),
  vector_database: z.enum(['pinecone', 'pgvector', 'opensearch']).optional(),
  chunk_size: z.number().int().min(1).max(8192).optional(),
  chunk_overlap: z.number().int().min(0).optional(),
  top_k: z.number().int().min(1).max(50).optional(),
  similarity_threshold: z.number().min(0).max(1).optional(),
  enable_reranking: z.boolean().optional(),
  reranking_model: z.string().optional(),
  context_window: z.number().int().min(1).max(200000).optional(),
  chat_model: z.string().optional(),
  voice_model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  custom_system_prompt: z.string().optional(),
  enable_pii_sanitization: z.boolean().optional(),
  redact_ssn: z.boolean().optional(),
  redact_dob: z.boolean().optional(),
  redact_account_numbers: z.boolean().optional(),
  allow_employee_names: z.boolean().optional(),
  log_ai_interactions: z.boolean().optional(),
  // API Keys
  openai_api_key: z.string().nullable().optional(),
  gemini_api_key: z.string().nullable().optional(),
  // Cohi Voice Agentic specific settings
  voice_agentic_enabled: z.boolean().optional(),
  voice_name: z.string().optional(),
  voice_top_k: z.number().int().min(1).max(20).optional(),
  voice_similarity_threshold: z.number().min(0).max(1).optional(),
  voice_context_window: z.number().int().min(1000).max(32000).optional(),
  voice_temperature: z.number().min(0).max(2).optional(),
  voice_response_max_length: z.number().int().min(10).max(180).optional(),
  voice_conversation_memory: z.number().int().min(5).max(50).optional(),
  voice_rag_enabled: z.boolean().optional(),
  voice_system_prompt: z.string().optional(),
  voice_enable_reranking: z.boolean().optional(),
  voice_real_time_mode: z.boolean().optional(),
  // Voice agentic configuration fields
  allowed_topics: z.string().nullable().optional(),
  conversation_rules: z.string().nullable().optional(),
  personality_tone: z.string().optional(),
  personality_style: z.string().optional(),
  personality_custom: z.string().nullable().optional(),
  knowledge_base_links: z.string().nullable().optional(),
});

const documentSourceSchema = z.object({
  name: z.string().min(1),
  source_type: z.enum(['upload', 's3', 'sharepoint', 'confluence', 'url', 'api']),
  source_config: z.record(z.any()),
  sync_frequency: z.enum(['realtime', 'hourly', 'daily', 'weekly', 'manual']).optional(),
});

/**
 * GET /api/rag/settings
 * Get RAG settings for authenticated tenant (from tenant-specific database)
 */
router.get('/settings', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const requestedTenantId = req.query.tenant_id as string | undefined;
    
    // Get user's role and tenant
    const profileResult = await pool.query(
      `SELECT u.role, p.tenant_id 
       FROM public.users u 
       LEFT JOIN public.profiles p ON u.id = p.user_id 
       WHERE u.id = $1`,
      [req.userId]
    );
    
    const userTenantId = profileResult.rows[0]?.tenant_id;
    const userRole = profileResult.rows[0]?.role;
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'admin';
    
    // Determine target tenant
    let targetTenantId: string | undefined;
    if (isSuperAdmin && requestedTenantId) {
      targetTenantId = requestedTenantId;
    } else if (userTenantId) {
      targetTenantId = userTenantId;
    }

    if (!targetTenantId) {
      return res.status(403).json({ error: 'Access denied. Tenant context required.' });
    }

    // Get tenant database pool
    const tenantPool = await getTenantPoolForRag(targetTenantId);
    
    // Ensure default settings exist
    await ensureRagSettings(tenantPool);
    
    // Get settings from tenant database (no tenant_id column)
    const result = await tenantPool.query('SELECT * FROM public.rag_settings LIMIT 1');

    if (result.rows.length === 0) {
      return res.json({ settings: {} });
    }

    const settings = result.rows[0];
    
    // Decrypt API keys before returning
    const decryptedSettings = await decryptAPIKeys(settings);
    
    // Log data access
    await logDataAccess({
      userId: req.userId!,
      tenantId: targetTenantId,
      resourceType: 'rag_settings',
      resourceId: settings.id,
      action: 'view',
      containsPII: true,
      piiFields: ['openai_api_key', 'gemini_api_key'],
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    
    res.json({ settings: decryptedSettings });
  } catch (error: any) {
    console.error('Error fetching RAG settings:', error);
    res.status(500).json({ error: 'Failed to fetch RAG settings' });
  }
});

/**
 * PUT /api/rag/settings
 * Update RAG settings for authenticated tenant (in tenant-specific database)
 */
router.put('/settings', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const updates = ragSettingsSchema.parse(req.body);
    const requestedTenantId = req.query.tenant_id as string | undefined;

    // Get user's role and tenant
    const profileResult = await pool.query(
      `SELECT u.role, p.tenant_id 
       FROM public.users u 
       LEFT JOIN public.profiles p ON u.id = p.user_id 
       WHERE u.id = $1`,
      [req.userId]
    );
    
    const userTenantId = profileResult.rows[0]?.tenant_id;
    const userRole = profileResult.rows[0]?.role;
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'admin';
    
    console.log(`[RAG Settings] User role: ${userRole}, isSuperAdmin: ${isSuperAdmin}, requestedTenantId: ${requestedTenantId}, userTenantId: ${userTenantId}`);
    
    // Determine target tenant
    let targetTenantId: string;
    if (isSuperAdmin && requestedTenantId) {
      targetTenantId = requestedTenantId;
      console.log(`[RAG Settings] Super admin updating tenant: ${targetTenantId}`);
    } else if (userTenantId) {
      targetTenantId = userTenantId;
      console.log(`[RAG Settings] Regular user updating their tenant: ${targetTenantId}`);
    } else {
      return res.status(403).json({ error: 'Access denied. Tenant context required.' });
    }

    // Get tenant database pool
    const tenantPool = await getTenantPoolForRag(targetTenantId);
    
    // Ensure rag_settings row exists
    await ensureRagSettings(tenantPool);

    // Encrypt API keys before storing
    const encryptedUpdates = await encryptAPIKeys(updates);

    // Build dynamic UPDATE query (no tenant_id column in tenant-specific DB)
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(encryptedUpdates).forEach(([key, value]) => {
      if (value !== undefined) {
        updateFields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Update the single rag_settings row in tenant database
    const query = `
      UPDATE public.rag_settings
      SET ${updateFields.join(', ')}, updated_at = NOW()
      RETURNING *
    `;

    console.log(`[RAG Settings] Updating settings in tenant database for: ${targetTenantId}`);
    console.log(`[RAG Settings] Fields being updated:`, Object.keys(encryptedUpdates).filter(k => encryptedUpdates[k] !== undefined));
    
    const result = await tenantPool.query(query, values);
    console.log(`[RAG Settings] UPDATE returned ${result.rows.length} rows`);

    if (result.rows.length === 0) {
      return res.status(500).json({ error: 'Failed to update RAG settings' });
    }

    // Decrypt before returning
    const decryptedResult = await decryptAPIKeys(result.rows[0]);
    
    // Audit log
    await auditLog({
      userId: req.userId,
      userEmail: req.userEmail,
      tenantId: targetTenantId,
      action: 'update',
      resource: 'rag_settings',
      description: 'Updated RAG settings in tenant database',
      changes: { fields: Object.keys(updates) },
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ settings: decryptedResult });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error updating RAG settings:', error);
    res.status(500).json({ error: 'Failed to update RAG settings' });
  }
});

/**
 * GET /api/rag/sources
 * List all document sources for authenticated tenant
 */
router.get('/sources', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const result = await pool.query(
      `SELECT id, name, source_type, status, document_count, total_chunks, total_tokens,
              last_sync_at, sync_frequency, created_at, updated_at
       FROM public.rag_document_sources
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );

    res.json({ sources: result.rows });
  } catch (error: any) {
    console.error('Error fetching document sources:', error);
    res.status(500).json({ error: 'Failed to fetch document sources' });
  }
});

/**
 * POST /api/rag/sources
 * Add a new document source
 */
router.post('/sources', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { name, source_type, source_config, sync_frequency } = documentSourceSchema.parse(req.body);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const result = await pool.query(
      `INSERT INTO public.rag_document_sources
       (tenant_id, name, source_type, source_config, sync_frequency, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [tenantId, name, source_type, JSON.stringify(source_config), sync_frequency || 'daily']
    );

    res.status(201).json({ source: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error creating document source:', error);
    res.status(500).json({ error: 'Failed to create document source' });
  }
});

/**
 * DELETE /api/rag/sources/:id
 * Remove a document source
 */
router.delete('/sources/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sourceId = req.params.id;

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Verify ownership
    const sourceResult = await pool.query(
      'SELECT id FROM public.rag_document_sources WHERE id = $1 AND tenant_id = $2',
      [sourceId, tenantId]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document source not found' });
    }

    // Delete (CASCADE will handle documents and embeddings)
    await pool.query(
      'DELETE FROM public.rag_document_sources WHERE id = $1',
      [sourceId]
    );

    res.json({ message: 'Document source deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting document source:', error);
    res.status(500).json({ error: 'Failed to delete document source' });
  }
});

/**
 * POST /api/rag/sources/:id/sync
 * Trigger manual sync for a document source
 */
router.post('/sources/:id/sync', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sourceId = req.params.id;

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Verify ownership and update status
    const result = await pool.query(
      `UPDATE public.rag_document_sources
       SET status = 'indexing', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [sourceId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document source not found' });
    }

    // TODO: Trigger actual sync job (queue worker, background process, etc.)
    // For now, just return success
    res.json({ message: 'Sync triggered', source: result.rows[0] });
  } catch (error: any) {
    console.error('Error triggering sync:', error);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

/**
 * POST /api/rag/documents/upload
 * Upload and process a document for RAG
 */
router.post('/documents/upload', uploadLimiter, authenticateToken, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get tenant_id and RAG settings
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Get or create default document source for uploads
    let sourceResult = await pool.query(
      `SELECT id FROM public.rag_document_sources
       WHERE tenant_id = $1 AND source_type = 'upload' AND name = 'Uploaded Documents'
       LIMIT 1`,
      [tenantId]
    );

    let sourceId: string;
    if (sourceResult.rows.length === 0) {
      const newSource = await pool.query(
        `INSERT INTO public.rag_document_sources
         (tenant_id, name, source_type, source_config, status)
         VALUES ($1, 'Uploaded Documents', 'upload', '{}', 'active')
         RETURNING id`,
        [tenantId]
      );
      sourceId = newSource.rows[0].id;
    } else {
      sourceId = sourceResult.rows[0].id;
    }

    // Get RAG settings
    const settingsResult = await pool.query(
      'SELECT * FROM public.rag_settings WHERE tenant_id = $1',
      [tenantId]
    );
    const settings = settingsResult.rows[0] || {
      embedding_model: 'openai/text-embedding-3-large',
      vector_database: 'pgvector',
      chunk_size: 512,
      chunk_overlap: 50,
    };

    // Create document record
    const docResult = await pool.query(
      `INSERT INTO public.rag_documents
       (source_id, tenant_id, filename, file_type, file_size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, 'processing')
       RETURNING *`,
      [
        sourceId,
        tenantId,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
      ]
    );

    const document = docResult.rows[0];

    // Process document asynchronously (don't wait)
    processDocument(document.id, req.file.buffer, req.file.originalname, req.file.mimetype, settings, tenantId, req.userId!)
      .catch((error) => {
        console.error('Error processing document:', error);
        // Update document status to error
        pool.query(
          `UPDATE public.rag_documents
           SET status = 'error', error_message = $1
           WHERE id = $2`,
          [error.message, document.id]
        ).catch(console.error);
      });

    res.status(201).json({
      document,
      message: 'Document uploaded and processing started',
    });
  } catch (error: any) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document', details: error.message });
  }
});

/**
 * Process a document: parse, chunk, embed, and store
 */
async function processDocument(
  documentId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  settings: any,
  tenantId: string,
  userId: string
): Promise<void> {
  try {
    // 1. Parse document
    const parsed = await parseDocument(fileBuffer, fileName, mimeType);

    // 2. Chunk document
    const chunks = chunkDocument(parsed.text, {
      chunkSize: settings.chunk_size || 512,
      chunkOverlap: settings.chunk_overlap || 50,
    });

    // 3. Generate embeddings (use tenant-specific API key if available)
    const texts = chunks.map((chunk) => chunk.text);
    const apiKey = settings.embedding_model.includes('openai') ? settings.openai_api_key : undefined;
    const embeddingResults = await generateEmbeddings(texts, settings.embedding_model, apiKey);

    // Track embedding costs
    const embeddingTokens = embeddingResults.reduce((sum, r) => sum + r.tokenCount, 0);
    const unitPrice = settings.embedding_model.includes('openai')
      ? (settings.embedding_model.includes('large') ? 0.00013 : 0.00002) / 1000
      : 0.0001 / 1000;

    await logCostEvent(tenantId, {
      serviceCategory: 'embedding',
      serviceProvider: settings.embedding_model.split('/')[0],
      serviceName: settings.embedding_model,
      usageType: 'tokens',
      usageAmount: embeddingTokens,
      usageUnit: 'tokens',
      unitPrice,
      userId,
      metadata: { documentId, chunkCount: chunks.length },
    });

    // 4. Store embeddings in vector database
    const chunksWithEmbeddings = chunks.map((chunk, index) => ({
      text: chunk.text,
      embedding: embeddingResults[index].embedding,
      index: chunk.index,
      metadata: {
        document_id: documentId,
        chunk_index: chunk.index,
      },
    }));

    await storeEmbeddings(tenantId, documentId, chunksWithEmbeddings, settings.vector_database);

    // 5. Update document record
    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
    await pool.query(
      `UPDATE public.rag_documents
       SET status = 'indexed',
           chunk_count = $1,
           token_count = $2,
           indexed_at = NOW()
       WHERE id = $3`,
      [chunks.length, totalTokens, documentId]
    );

    // 6. Update source statistics
    await pool.query(
      `UPDATE public.rag_document_sources
       SET document_count = document_count + 1,
           total_chunks = total_chunks + $1,
           total_tokens = total_tokens + $2,
           last_sync_at = NOW(),
           status = 'active'
       WHERE id = (SELECT source_id FROM public.rag_documents WHERE id = $3)`,
      [chunks.length, totalTokens, documentId]
    );
  } catch (error: any) {
    console.error('Error processing document:', error);
    throw error;
  }
}

/**
 * GET /api/rag/documents
 * List documents for authenticated tenant
 */
router.get('/documents', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sourceId = req.query.source_id as string | undefined;

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    let query = `
      SELECT id, source_id, filename, file_type, file_size_bytes, chunk_count, token_count,
             status, indexed_at, created_at, updated_at
      FROM public.rag_documents
      WHERE tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (sourceId) {
      query += ' AND source_id = $2';
      params.push(sourceId);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);

    res.json({ documents: result.rows });
  } catch (error: any) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

/**
 * GET /api/rag/embeddings/stats
 * Get embedding statistics for authenticated tenant
 */
router.get('/embeddings/stats', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const statsResult = await pool.query(
      `SELECT 
        COUNT(DISTINCT d.id) as total_documents,
        COUNT(DISTINCT ds.id) as total_sources,
        COALESCE(SUM(d.chunk_count), 0) as total_chunks,
        COALESCE(SUM(d.token_count), 0) as total_tokens,
        COUNT(e.id) as total_embeddings
       FROM public.rag_documents d
       LEFT JOIN public.rag_document_sources ds ON d.source_id = ds.id
       LEFT JOIN public.rag_embeddings e ON d.id = e.document_id
       WHERE d.tenant_id = $1 AND d.status = 'indexed'`,
      [tenantId]
    );

    res.json({ stats: statsResult.rows[0] });
  } catch (error: any) {
    console.error('Error fetching embedding stats:', error);
    res.status(500).json({ error: 'Failed to fetch embedding stats' });
  }
});

/**
 * GET /api/rag/voice
 * Get RAG voice agentic settings (Cohi voice configuration) from tenant database
 */
router.get('/voice', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const requestedTenantId = req.query.tenant_id as string | undefined;
    
    // Get user's role and tenant
    const profileResult = await pool.query(
      `SELECT u.role, p.tenant_id 
       FROM public.users u 
       LEFT JOIN public.profiles p ON u.id = p.user_id 
       WHERE u.id = $1`,
      [req.userId]
    );
    
    const userTenantId = profileResult.rows[0]?.tenant_id;
    const userRole = profileResult.rows[0]?.role;
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'admin';
    
    let targetTenantId: string;
    if (isSuperAdmin && requestedTenantId) {
      targetTenantId = requestedTenantId;
    } else if (userTenantId) {
      targetTenantId = userTenantId;
    } else {
      return res.status(403).json({ error: 'Access denied. Tenant context required.' });
    }

    // Get tenant database pool
    const tenantPool = await getTenantPoolForRag(targetTenantId);
    await ensureRagSettings(tenantPool);

    const result = await tenantPool.query(
      `SELECT 
        voice_agentic_enabled,
        voice_model,
        voice_name,
        voice_top_k,
        voice_similarity_threshold,
        voice_context_window,
        voice_temperature,
        voice_response_max_length,
        voice_conversation_memory,
        voice_rag_enabled,
        voice_system_prompt,
        voice_enable_reranking,
        voice_real_time_mode,
        allowed_topics,
        conversation_rules,
        personality_tone,
        personality_style,
        personality_custom,
        knowledge_base_links,
        gemini_api_key
       FROM public.rag_settings LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({
        voice: {
          enabled: false,
          model: 'models/gemini-2.0-flash-exp',
          voice: 'Aoede',
          settings: {},
          configuration: {},
        },
      });
    }

    const row = result.rows[0];
    res.json({
      voice: {
        enabled: row.voice_agentic_enabled || false,
        model: row.voice_model || 'models/gemini-2.0-flash-exp',
        voice: row.voice_name || 'Aoede',
        settings: {
          top_k: row.voice_top_k || 5,
          similarity_threshold: row.voice_similarity_threshold || 0.75,
          context_window: row.voice_context_window || 8000,
          temperature: row.voice_temperature || 0.7,
          response_max_length: row.voice_response_max_length || 60,
          conversation_memory: row.voice_conversation_memory || 10,
          rag_enabled: row.voice_rag_enabled || true,
          enable_reranking: row.voice_enable_reranking || false,
          real_time_mode: row.voice_real_time_mode || true,
        },
        configuration: {
          allowed_topics: row.allowed_topics || '',
          conversation_rules: row.conversation_rules || '',
          personality_tone: row.personality_tone || 'professional',
          personality_style: row.personality_style || 'concise',
          personality_custom: row.personality_custom || '',
          knowledge_base_links: row.knowledge_base_links || '',
        },
        system_prompt: row.voice_system_prompt || null,
        api_key_configured: !!row.gemini_api_key,
      },
    });
  } catch (error: any) {
    console.error('Error fetching RAG voice settings:', error);
    res.status(500).json({ error: 'Failed to fetch RAG voice settings' });
  }
});

/**
 * PUT /api/rag/voice
 * Update RAG voice agentic settings (Cohi voice configuration) in tenant database
 */
router.put('/voice', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const voiceUpdates = ragSettingsSchema.pick({
      voice_agentic_enabled: true,
      voice_model: true,
      voice_name: true,
      voice_top_k: true,
      voice_similarity_threshold: true,
      voice_context_window: true,
      voice_temperature: true,
      voice_response_max_length: true,
      voice_conversation_memory: true,
      voice_rag_enabled: true,
      voice_system_prompt: true,
      voice_enable_reranking: true,
      voice_real_time_mode: true,
      allowed_topics: true,
      conversation_rules: true,
      personality_tone: true,
      personality_style: true,
      personality_custom: true,
      knowledge_base_links: true,
      gemini_api_key: true,
    }).parse(req.body);

    const requestedTenantId = req.query.tenant_id as string | undefined;

    // Get user's role and tenant
    const profileResult = await pool.query(
      `SELECT u.role, p.tenant_id 
       FROM public.users u 
       LEFT JOIN public.profiles p ON u.id = p.user_id 
       WHERE u.id = $1`,
      [req.userId]
    );
    
    const userTenantId = profileResult.rows[0]?.tenant_id;
    const userRole = profileResult.rows[0]?.role;
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'admin';
    
    let targetTenantId: string;
    if (isSuperAdmin && requestedTenantId) {
      targetTenantId = requestedTenantId;
    } else if (userTenantId) {
      targetTenantId = userTenantId;
    } else {
      return res.status(403).json({ error: 'Access denied. Tenant context required.' });
    }

    // Get tenant database pool
    const tenantPool = await getTenantPoolForRag(targetTenantId);
    await ensureRagSettings(tenantPool);

    // Build dynamic UPDATE query (no tenant_id column)
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(voiceUpdates).forEach(([key, value]) => {
      if (value !== undefined) {
        updateFields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const query = `
      UPDATE public.rag_settings
      SET ${updateFields.join(', ')}, updated_at = NOW()
      RETURNING *
    `;

    const result = await tenantPool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(500).json({ error: 'Failed to update voice settings' });
    }

    res.json({ voice: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error updating RAG voice settings:', error);
    res.status(500).json({ error: 'Failed to update RAG voice settings' });
  }
});

/**
 * POST /api/rag/search
 * Perform RAG search using vector similarity
 */
router.post('/search', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { query, top_k } = z.object({
      query: z.string().min(1),
      top_k: z.number().int().min(1).max(50).optional(),
    }).parse(req.body);

    // Get tenant_id and RAG settings
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const settingsResult = await pool.query(
      'SELECT * FROM public.rag_settings WHERE tenant_id = $1',
      [tenantId]
    );

    if (settingsResult.rows.length === 0) {
      return res.status(404).json({ error: 'RAG settings not found' });
    }

    const settings = settingsResult.rows[0];
    const k = top_k || settings.top_k || 5;

    // Generate embedding for query
    // Use tenant-specific API key if available
    const apiKey = settings.embedding_model.includes('openai') ? settings.openai_api_key : undefined;
    const embeddingResults = await generateEmbeddings([query], settings.embedding_model, apiKey);
    const queryEmbedding = embeddingResults[0].embedding;

    // Track embedding cost
    const unitPrice = settings.embedding_model.includes('openai')
      ? (settings.embedding_model.includes('large') ? 0.00013 : 0.00002) / 1000
      : 0.0001 / 1000;

    await logCostEvent(tenantId, {
      serviceCategory: 'embedding',
      serviceProvider: settings.embedding_model.split('/')[0],
      serviceName: settings.embedding_model,
      usageType: 'tokens',
      usageAmount: embeddingResults[0].tokenCount,
      usageUnit: 'tokens',
      unitPrice,
      userId: req.userId,
      metadata: { query: query.substring(0, 100) },
    });

    // Search vector database
    const results = await searchEmbeddings(
      tenantId,
      queryEmbedding,
      k,
      settings.similarity_threshold || 0.75,
      settings.vector_database
    );

    // If reranking is enabled, rerank results
    let finalResults = results;
    if (settings.enable_reranking && results.length > 0) {
      // TODO: Implement Cohere reranking
      // For now, return results as-is
    }

    res.json({
      query,
      results: finalResults,
      count: finalResults.length,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error performing RAG search:', error);
    res.status(500).json({ error: 'Failed to perform RAG search', details: error.message });
  }
});

/**
 * GET /api/rag/costs
 * Get RAG-related costs for authenticated tenant
 */
router.get('/costs', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Check if super admin is requesting a specific tenant's costs
    const requestedTenantId = req.query.tenant_id as string | undefined;
    
    // Get user's role from users table and tenant from profiles table
    const profileResult = await pool.query(
      `SELECT u.role, p.tenant_id 
       FROM public.users u 
       LEFT JOIN public.profiles p ON u.id = p.user_id 
       WHERE u.id = $1`,
      [req.userId]
    );
    
    const userTenantId = profileResult.rows[0]?.tenant_id;
    const userRole = profileResult.rows[0]?.role;
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'admin';
    
    // Determine which tenant_id to use
    let targetTenantId: string;
    if (isSuperAdmin && requestedTenantId) {
      // Super admin can access any tenant's costs
      targetTenantId = requestedTenantId;
    } else if (userTenantId) {
      // Use user's tenant (or super admin's default tenant)
      targetTenantId = userTenantId;
    } else {
      return res.status(403).json({ error: 'Access denied. Tenant context required.' });
    }

    const tenantId = targetTenantId;

    // Get date range (default to last 30 days)
    const startDate = req.query.start_date as string || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date as string || new Date().toISOString();

    // Check if cost_events table exists
    try {
      const tableCheck = await pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'cost_events'
        )`
      );
      
      const tableExists = tableCheck.rows[0]?.exists;
      
      if (!tableExists) {
        // Table doesn't exist yet - return empty array
        console.log('cost_events table does not exist, returning empty costs array');
        return res.json({ costs: [] });
      }

      // Query RAG-related costs (embeddings, chat, voice, etc.)
      const result = await pool.query(
        `SELECT 
          id,
          service_category,
          service_provider,
          service_name,
          usage_type,
          usage_amount,
          usage_unit,
          unit_price,
          total_cost,
          created_at,
          metadata
         FROM public.cost_events
         WHERE tenant_id = $1 
           AND service_category IN ('embedding', 'chat', 'voice_ai', 'rag', 'vector_search')
           AND created_at >= $2 
           AND created_at <= $3
         ORDER BY created_at DESC
         LIMIT 1000`,
        [tenantId, startDate, endDate]
      );

      res.json({ costs: result.rows });
    } catch (dbError: any) {
      // If table doesn't exist (42P01 = relation does not exist)
      if (dbError.code === '42P01') {
        console.log('cost_events table does not exist, returning empty costs array');
        return res.json({ costs: [] });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error('Error fetching RAG costs:', error);
    res.status(500).json({ error: 'Failed to fetch RAG costs', details: error.message });
  }
});

export default router;

