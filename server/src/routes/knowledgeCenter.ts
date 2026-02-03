/**
 * Knowledge Center API Routes
 *
 * Tenant-facing routes for the knowledge center.
 * Allows tenant admins to view synced global docs and manage tenant-specific docs.
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  TenantRequest,
} from "../middleware/tenantContext.js";
import { z } from "zod";
import multer from "multer";
import { parseDocument } from "../services/documentParser.js";
import { chunkDocument } from "../services/documentChunker.js";
import { generateEmbeddings } from "../services/embeddingService.js";

const router = Router();

// Configure multer for document uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
      "text/html",
      "text/csv",
    ];
    if (
      allowedTypes.includes(file.mimetype) ||
      file.originalname.match(/\.(pdf|docx|doc|txt|html|csv|md)$/i)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Unsupported file type. Allowed: PDF, DOCX, DOC, TXT, HTML, CSV, MD"
        )
      );
    }
  },
});

// Validation schemas
const uploadDocumentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  category: z.string().min(1).max(100).optional(),
  tags: z.string().optional(), // JSON stringified array
});

// Helper to convert embedding array to pgvector format
function embeddingToVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// =============================================================================
// Documents - List and View
// =============================================================================

/**
 * GET /api/knowledge-center/documents
 * List all documents (global + tenant-specific) for the current tenant
 */
router.get(
  "/documents",
  authenticateToken,
  attachTenantContext,
  async (req: TenantRequest, res) => {
    try {
      const tenantPool = req.tenantContext?.tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const {
        category,
        search,
        is_global,
        limit = "50",
        offset = "0",
      } = req.query;

      let query = `
      SELECT 
        rd.id, rd.title, rd.filename, rd.file_type, rd.category, rd.tags,
        rd.is_global, rd.global_doc_id, rd.global_version,
        rd.chunk_count, rd.token_count, rd.status,
        rd.created_at, rd.updated_at
      FROM rag_documents rd
      WHERE rd.status = 'indexed'
    `;
      const params: any[] = [];
      let paramIndex = 1;

      // Filter by global/tenant
      if (is_global === "true") {
        query += ` AND rd.is_global = true`;
      } else if (is_global === "false") {
        query += ` AND rd.is_global = false`;
      }

      // Filter by category
      if (category && typeof category === "string" && category !== "all") {
        query += ` AND rd.category = $${paramIndex}`;
        params.push(category);
        paramIndex++;
      }

      // Search
      if (search && typeof search === "string" && search.trim()) {
        query += ` AND (rd.title ILIKE $${paramIndex} OR rd.filename ILIKE $${paramIndex})`;
        params.push(`%${search.trim()}%`);
        paramIndex++;
      }

      query += ` ORDER BY rd.is_global DESC, rd.updated_at DESC LIMIT $${paramIndex} OFFSET $${
        paramIndex + 1
      }`;
      params.push(
        parseInt(limit as string, 10),
        parseInt(offset as string, 10)
      );

      const result = await tenantPool.query(query, params);

      // Get total count
      let countQuery = `SELECT COUNT(*) FROM rag_documents rd WHERE rd.status = 'indexed'`;
      const countParams: any[] = [];
      let countParamIndex = 1;

      if (is_global === "true") {
        countQuery += ` AND rd.is_global = true`;
      } else if (is_global === "false") {
        countQuery += ` AND rd.is_global = false`;
      }

      if (category && typeof category === "string" && category !== "all") {
        countQuery += ` AND rd.category = $${countParamIndex}`;
        countParams.push(category);
        countParamIndex++;
      }

      const countResult = await tenantPool.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count, 10);

      res.json({
        documents: result.rows,
        pagination: {
          total,
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10),
        },
      });
    } catch (error: any) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  }
);

/**
 * GET /api/knowledge-center/documents/:id
 * Get a single document with full content
 */
router.get(
  "/documents/:id",
  authenticateToken,
  attachTenantContext,
  async (req: TenantRequest, res) => {
    try {
      const tenantPool = req.tenantContext?.tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const { id } = req.params;

      const result = await tenantPool.query(
        `SELECT * FROM rag_documents WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      const doc = result.rows[0];

      // Get chunks count for display
      const chunkResult = await tenantPool.query(
        `SELECT COUNT(*) as chunk_count FROM rag_embeddings WHERE document_id = $1`,
        [id]
      );

      res.json({
        document: {
          ...doc,
          actual_chunk_count: parseInt(chunkResult.rows[0].chunk_count, 10),
        },
      });
    } catch (error: any) {
      console.error("Error fetching document:", error);
      res.status(500).json({ error: "Failed to fetch document" });
    }
  }
);

// =============================================================================
// Knowledge Updates Feed
// =============================================================================

/**
 * GET /api/knowledge-center/updates
 * Get recent knowledge updates (new/updated/removed global docs)
 */
router.get(
  "/updates",
  authenticateToken,
  attachTenantContext,
  async (req: TenantRequest, res) => {
    try {
      const tenantPool = req.tenantContext?.tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const { acknowledged, limit = "20" } = req.query;

      let query = `
      SELECT 
        ku.id, ku.global_doc_id, ku.title, ku.category, ku.action, 
        ku.version, ku.change_summary, ku.synced_at,
        ku.acknowledged_by, ku.acknowledged_at,
        u.email as acknowledged_by_email
      FROM knowledge_updates ku
      LEFT JOIN users u ON ku.acknowledged_by = u.id
    `;

      const params: any[] = [];
      let paramIndex = 1;

      if (acknowledged === "false") {
        query += ` WHERE ku.acknowledged_at IS NULL`;
      } else if (acknowledged === "true") {
        query += ` WHERE ku.acknowledged_at IS NOT NULL`;
      }

      query += ` ORDER BY ku.synced_at DESC LIMIT $${paramIndex}`;
      params.push(parseInt(limit as string, 10));

      const result = await tenantPool.query(query, params);

      // Get unread count
      const unreadResult = await tenantPool.query(
        `SELECT COUNT(*) FROM knowledge_updates WHERE acknowledged_at IS NULL`
      );

      res.json({
        updates: result.rows,
        unreadCount: parseInt(unreadResult.rows[0].count, 10),
      });
    } catch (error: any) {
      console.error("Error fetching updates:", error);
      res.status(500).json({ error: "Failed to fetch updates" });
    }
  }
);

/**
 * POST /api/knowledge-center/updates/:id/acknowledge
 * Acknowledge a specific update
 */
router.post(
  "/updates/:id/acknowledge",
  authenticateToken,
  attachTenantContext,
  async (req: TenantRequest, res) => {
    try {
      const tenantPool = req.tenantContext?.tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const { id } = req.params;

      const result = await tenantPool.query(
        `UPDATE knowledge_updates 
       SET acknowledged_by = $1, acknowledged_at = NOW()
       WHERE id = $2 AND acknowledged_at IS NULL
       RETURNING *`,
        [req.userId, id]
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Update not found or already acknowledged" });
      }

      res.json({ update: result.rows[0] });
    } catch (error: any) {
      console.error("Error acknowledging update:", error);
      res.status(500).json({ error: "Failed to acknowledge update" });
    }
  }
);

/**
 * POST /api/knowledge-center/updates/acknowledge-all
 * Acknowledge all pending updates
 */
router.post(
  "/updates/acknowledge-all",
  authenticateToken,
  attachTenantContext,
  async (req: TenantRequest, res) => {
    try {
      const tenantPool = req.tenantContext?.tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const result = await tenantPool.query(
        `UPDATE knowledge_updates 
       SET acknowledged_by = $1, acknowledged_at = NOW()
       WHERE acknowledged_at IS NULL
       RETURNING id`,
        [req.userId]
      );

      res.json({
        message: "All updates acknowledged",
        count: result.rows.length,
      });
    } catch (error: any) {
      console.error("Error acknowledging all updates:", error);
      res.status(500).json({ error: "Failed to acknowledge updates" });
    }
  }
);

// =============================================================================
// Tenant-Specific Documents - Upload and Manage
// =============================================================================

/**
 * POST /api/knowledge-center/documents/upload
 * Upload a tenant-specific document
 */
router.post(
  "/documents/upload",
  authenticateToken,
  attachTenantContext,
  upload.single("file"),
  async (req: TenantRequest, res) => {
    try {
      const tenantPool = req.tenantContext?.tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { title, category, tags } = req.body;
      const parsedTags = tags ? JSON.parse(tags) : [];

      // Parse the document to extract text
      const parsed = await parseDocument(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      // Get or create a default source for tenant uploads
      let sourceResult = await tenantPool.query(
        `SELECT id FROM rag_document_sources WHERE name = 'Tenant Knowledge Base' LIMIT 1`
      );

      let sourceId: string;
      if (sourceResult.rows.length === 0) {
        const newSource = await tenantPool.query(
          `INSERT INTO rag_document_sources (name, source_type, status, source_config)
         VALUES ('Tenant Knowledge Base', 'upload', 'active', '{}')
         RETURNING id`
        );
        sourceId = newSource.rows[0].id;
      } else {
        sourceId = sourceResult.rows[0].id;
      }

      // Create document record
      const docResult = await tenantPool.query(
        `INSERT INTO rag_documents 
       (source_id, title, filename, file_type, file_size_bytes, content, category, tags, is_global, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'processing')
       RETURNING *`,
        [
          sourceId,
          title || req.file.originalname,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          parsed.text,
          category || "General",
          parsedTags,
        ]
      );

      const document = docResult.rows[0];

      // Process document asynchronously (generate embeddings)
      processDocument(tenantPool, document.id, parsed.text).catch((error) => {
        console.error("[KnowledgeCenter] Error processing document:", error);
      });

      res.status(201).json({
        document,
        message: "Document uploaded and processing started",
      });
    } catch (error: any) {
      console.error("Error uploading document:", error);
      res
        .status(500)
        .json({ error: "Failed to upload document", details: error.message });
    }
  }
);

/**
 * DELETE /api/knowledge-center/documents/:id
 * Delete a tenant-specific document (cannot delete global docs)
 */
router.delete(
  "/documents/:id",
  authenticateToken,
  attachTenantContext,
  async (req: TenantRequest, res) => {
    try {
      const tenantPool = req.tenantContext?.tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const { id } = req.params;

      // Check document exists and is tenant-owned
      const existing = await tenantPool.query(
        `SELECT id, title, is_global FROM rag_documents WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (existing.rows[0].is_global) {
        return res.status(403).json({
          error:
            "Cannot delete global documents. Contact your platform administrator.",
        });
      }

      // Delete (cascade will handle embeddings)
      await tenantPool.query(`DELETE FROM rag_documents WHERE id = $1`, [id]);

      res.json({ message: "Document deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  }
);

// =============================================================================
// Search
// =============================================================================

/**
 * POST /api/knowledge-center/search
 * Search documents using semantic similarity
 */
router.post(
  "/search",
  authenticateToken,
  attachTenantContext,
  async (req: TenantRequest, res) => {
    try {
      const tenantPool = req.tenantContext?.tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const { query, top_k = 10, threshold = 0.7 } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query is required" });
      }

      // Generate embedding for query
      const embeddingResults = await generateEmbeddings(
        [query],
        "openai/text-embedding-3-large"
      );
      const queryEmbedding = embeddingResults[0].embedding;

      // Search using cosine similarity
      const results = await tenantPool.query(
        `SELECT 
        e.id as chunk_id,
        e.chunk_text,
        e.chunk_index,
        d.id as document_id,
        d.title,
        d.filename,
        d.category,
        d.is_global,
        1 - (e.embedding <=> $1::vector) as similarity
       FROM rag_embeddings e
       JOIN rag_documents d ON e.document_id = d.id
       WHERE d.status = 'indexed'
         AND 1 - (e.embedding <=> $1::vector) >= $2
       ORDER BY e.embedding <=> $1::vector
       LIMIT $3`,
        [embeddingToVector(queryEmbedding), threshold, top_k]
      );

      res.json({
        query,
        results: results.rows,
        count: results.rows.length,
      });
    } catch (error: any) {
      console.error("Error searching knowledge:", error);
      res
        .status(500)
        .json({
          error: "Failed to search knowledge base",
          details: error.message,
        });
    }
  }
);

// =============================================================================
// Categories
// =============================================================================

/**
 * GET /api/knowledge-center/categories
 * Get unique categories from all documents
 */
router.get(
  "/categories",
  authenticateToken,
  attachTenantContext,
  async (req: TenantRequest, res) => {
    try {
      const tenantPool = req.tenantContext?.tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const result = await tenantPool.query(
        `SELECT DISTINCT category, COUNT(*) as doc_count
       FROM rag_documents 
       WHERE category IS NOT NULL AND status = 'indexed'
       GROUP BY category
       ORDER BY category ASC`
      );

      res.json({ categories: result.rows });
    } catch (error: any) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  }
);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Process a document - generate embeddings and store
 */
async function processDocument(
  tenantPool: any,
  documentId: string,
  content: string
): Promise<void> {
  try {
    // Chunk the document
    const chunks = chunkDocument(content, {
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    if (chunks.length === 0) {
      throw new Error("Document produced no chunks");
    }

    // Generate embeddings
    const texts = chunks.map((c) => c.text);
    const embeddingResults = await generateEmbeddings(
      texts,
      "openai/text-embedding-3-large"
    );

    // Store embeddings
    let totalTokens = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddingResults[i];

      await tenantPool.query(
        `INSERT INTO rag_embeddings (document_id, chunk_index, chunk_text, embedding, token_count)
         VALUES ($1, $2, $3, $4::vector, $5)
         ON CONFLICT (document_id, chunk_index) DO UPDATE
         SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding`,
        [
          documentId,
          chunk.index,
          chunk.text,
          embeddingToVector(embedding.embedding),
          chunk.tokenCount,
        ]
      );

      totalTokens += chunk.tokenCount;
    }

    // Update document with stats
    await tenantPool.query(
      `UPDATE rag_documents 
       SET chunk_count = $1, token_count = $2, status = 'indexed', indexed_at = NOW()
       WHERE id = $3`,
      [chunks.length, totalTokens, documentId]
    );

    console.log(
      `[KnowledgeCenter] Processed document ${documentId}: ${chunks.length} chunks, ${totalTokens} tokens`
    );
  } catch (error: any) {
    // Update with error
    await tenantPool.query(
      `UPDATE rag_documents SET status = 'error', error_message = $1 WHERE id = $2`,
      [error.message, documentId]
    );
    throw error;
  }
}

export default router;
