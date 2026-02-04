/**
 * Global Knowledge Library API Routes
 *
 * Platform admin routes for managing the global knowledge library.
 * These documents are synced to all tenant databases.
 */

import { Router } from "express";
import { pool as managementPool } from "../../config/managementDatabase.js";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { z } from "zod";
import multer from "multer";
import { parseDocument } from "../../services/documentParser.js";
import {
  syncDocumentToAllTenants,
  archiveGlobalDocument,
  restoreGlobalDocument,
  processGlobalDocument,
  getDocumentSyncStatus,
  getRecentSyncActivity,
} from "../../services/globalKnowledgeSyncService.js";
import { auditLog } from "../../services/auditLogger.js";

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
const createDocumentSchema = z.object({
  title: z.string().min(1).max(500),
  category: z.string().min(1).max(100),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source_url: z.string().url().optional().nullable(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  category: z.string().min(1).max(100).optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source_url: z.string().url().optional().nullable(),
});

// Middleware: Require platform admin role
const requirePlatformAdmin = requireRole("super_admin", "platform_admin");

// =============================================================================
// Categories
// =============================================================================

/**
 * GET /api/admin/global-knowledge/categories
 * Get all categories
 */
router.get(
  "/categories",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const result = await managementPool.query(
        `SELECT id, name, description, icon, sort_order, is_active
       FROM global_knowledge_categories
       WHERE is_active = true
       ORDER BY sort_order ASC, name ASC`
      );

      res.json({ categories: result.rows });
    } catch (error: any) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  }
);

// =============================================================================
// Documents - CRUD
// =============================================================================

/**
 * GET /api/admin/global-knowledge
 * List all global documents with filtering
 */
router.get(
  "/",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const {
        status,
        category,
        search,
        limit = "50",
        offset = "0",
      } = req.query;

      let query = `
      SELECT 
        gkl.id, gkl.title, gkl.filename, gkl.file_type, gkl.category, gkl.tags,
        gkl.version, gkl.status, gkl.chunk_count, gkl.token_count,
        gkl.processing_status, gkl.processing_error,
        gkl.created_at, gkl.updated_at, gkl.published_at, gkl.archived_at,
        gkl.archive_reason,
        cu_created.email as created_by_email,
        cu_published.email as published_by_email,
        cu_archived.email as archived_by_email
      FROM global_knowledge_library gkl
      LEFT JOIN coheus_users cu_created ON gkl.created_by = cu_created.id
      LEFT JOIN coheus_users cu_published ON gkl.published_by = cu_published.id
      LEFT JOIN coheus_users cu_archived ON gkl.archived_by = cu_archived.id
      WHERE 1=1
    `;
      const params: any[] = [];
      let paramIndex = 1;

      // Filter by status
      if (status && typeof status === "string" && status !== "all") {
        query += ` AND gkl.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      // Filter by category
      if (category && typeof category === "string" && category !== "all") {
        query += ` AND gkl.category = $${paramIndex}`;
        params.push(category);
        paramIndex++;
      }

      // Search
      if (search && typeof search === "string" && search.trim()) {
        query += ` AND (gkl.title ILIKE $${paramIndex} OR gkl.content ILIKE $${paramIndex} OR $${paramIndex} = ANY(gkl.tags))`;
        params.push(`%${search.trim()}%`);
        paramIndex++;
      }

      // Order and pagination
      query += ` ORDER BY gkl.updated_at DESC LIMIT $${paramIndex} OFFSET $${
        paramIndex + 1
      }`;
      params.push(
        parseInt(limit as string, 10),
        parseInt(offset as string, 10)
      );

      const result = await managementPool.query(query, params);

      // Get total count
      let countQuery = `SELECT COUNT(*) FROM global_knowledge_library gkl WHERE 1=1`;
      const countParams: any[] = [];
      let countParamIndex = 1;

      if (status && typeof status === "string" && status !== "all") {
        countQuery += ` AND gkl.status = $${countParamIndex}`;
        countParams.push(status);
        countParamIndex++;
      }
      if (category && typeof category === "string" && category !== "all") {
        countQuery += ` AND gkl.category = $${countParamIndex}`;
        countParams.push(category);
        countParamIndex++;
      }
      if (search && typeof search === "string" && search.trim()) {
        countQuery += ` AND (gkl.title ILIKE $${countParamIndex} OR gkl.content ILIKE $${countParamIndex})`;
        countParams.push(`%${search.trim()}%`);
      }

      const countResult = await managementPool.query(countQuery, countParams);
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
      console.error("Error fetching global documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  }
);

/**
 * GET /api/admin/global-knowledge/:id
 * Get a single document with full content
 */
router.get(
  "/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      const result = await managementPool.query(
        `SELECT 
        gkl.*,
        cu_created.email as created_by_email,
        cu_updated.email as updated_by_email,
        cu_published.email as published_by_email,
        cu_archived.email as archived_by_email
       FROM global_knowledge_library gkl
       LEFT JOIN coheus_users cu_created ON gkl.created_by = cu_created.id
       LEFT JOIN coheus_users cu_updated ON gkl.updated_by = cu_updated.id
       LEFT JOIN coheus_users cu_published ON gkl.published_by = cu_published.id
       LEFT JOIN coheus_users cu_archived ON gkl.archived_by = cu_archived.id
       WHERE gkl.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      res.json({ document: result.rows[0] });
    } catch (error: any) {
      console.error("Error fetching document:", error);
      res.status(500).json({ error: "Failed to fetch document" });
    }
  }
);

/**
 * POST /api/admin/global-knowledge
 * Create a new document (as draft)
 */
router.post(
  "/",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const data = createDocumentSchema.parse(req.body);

      const result = await managementPool.query(
        `INSERT INTO global_knowledge_library (title, category, content, tags, created_by, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       RETURNING *`,
        [
          data.title,
          data.category,
          data.content || "",
          data.tags || [],
          req.userId,
        ]
      );

      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        action: "create",
        resource: "global_knowledge_library",
        resourceId: result.rows[0].id,
        description: `Created global knowledge document: ${data.title}`,
        status: "success",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.status(201).json({ document: result.rows[0] });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid request data", details: error.errors });
      }
      console.error("Error creating document:", error);
      res.status(500).json({ error: "Failed to create document" });
    }
  }
);

/**
 * POST /api/admin/global-knowledge/upload
 * Upload a document file
 */
router.post(
  "/upload",
  authenticateToken,
  requirePlatformAdmin,
  upload.single("file"),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { title, category, tags, source_url } = req.body;
      const parsedTags = tags ? JSON.parse(tags) : [];

      // Parse the document to extract text
      const parsed = await parseDocument(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      // Create document record
      const result = await managementPool.query(
        `INSERT INTO global_knowledge_library 
       (title, filename, file_type, file_size_bytes, content, category, tags, source_url, created_by, status, processing_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', 'pending')
       RETURNING *`,
        [
          title || req.file.originalname,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          parsed.text,
          category || "General",
          parsedTags,
          source_url || null,
          req.userId,
        ]
      );

      const document = result.rows[0];

      // Process document asynchronously (generate embeddings)
      processGlobalDocument(document.id).catch((error) => {
        console.error("[GlobalKnowledge] Error processing document:", error);
      });

      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        action: "upload",
        resource: "global_knowledge_library",
        resourceId: document.id,
        description: `Uploaded global knowledge document: ${document.title}`,
        status: "success",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
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
 * PUT /api/admin/global-knowledge/:id
 * Update a document
 */
router.put(
  "/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;
      const updates = updateDocumentSchema.parse(req.body);

      // Check document exists
      const existing = await managementPool.query(
        `SELECT id, status FROM global_knowledge_library WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Build dynamic update query
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined) {
          updateFields.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      });

      if (updateFields.length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      updateFields.push(`updated_by = $${paramIndex}`);
      values.push(req.userId);
      paramIndex++;

      updateFields.push(`updated_at = NOW()`);

      values.push(id);

      const query = `
      UPDATE global_knowledge_library
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

      const result = await managementPool.query(query, values);

      // If content was updated and document is already processed, re-process
      if (updates.content && existing.rows[0].status === "published") {
        processGlobalDocument(id).catch((error) => {
          console.error(
            "[GlobalKnowledge] Error re-processing document:",
            error
          );
        });
      }

      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        action: "update",
        resource: "global_knowledge_library",
        resourceId: id,
        description: `Updated global knowledge document`,
        changes: Object.keys(updates),
        status: "success",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({ document: result.rows[0] });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid request data", details: error.errors });
      }
      console.error("Error updating document:", error);
      res.status(500).json({ error: "Failed to update document" });
    }
  }
);

/**
 * DELETE /api/admin/global-knowledge/:id
 * Permanently delete a document (only if draft or archived)
 */
router.delete(
  "/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      // Check document status - only allow deleting drafts or archived
      const existing = await managementPool.query(
        `SELECT id, title, status FROM global_knowledge_library WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (existing.rows[0].status === "published") {
        return res.status(400).json({
          error: "Cannot delete published document. Archive it first.",
        });
      }

      // Delete (cascade will handle embeddings)
      await managementPool.query(
        `DELETE FROM global_knowledge_library WHERE id = $1`,
        [id]
      );

      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        action: "delete",
        resource: "global_knowledge_library",
        resourceId: id as string,
        description: `Deleted global knowledge document: ${existing.rows[0].title}`,
        status: "success",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({ message: "Document deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  }
);

// =============================================================================
// Publish / Archive / Restore
// =============================================================================

/**
 * POST /api/admin/global-knowledge/:id/process
 * Process a document (generate embeddings)
 */
router.post(
  "/:id/process",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      // Check document exists
      const existing = await managementPool.query(
        `SELECT id, title, content FROM global_knowledge_library WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (!existing.rows[0].content) {
        return res
          .status(400)
          .json({ error: "Document has no content to process" });
      }

      // Process document
      const result = await processGlobalDocument(id);

      res.json({
        message: "Document processed successfully",
        chunkCount: result.chunkCount,
        tokenCount: result.tokenCount,
      });
    } catch (error: any) {
      console.error("Error processing document:", error);
      res
        .status(500)
        .json({ error: "Failed to process document", details: error.message });
    }
  }
);

/**
 * POST /api/admin/global-knowledge/:id/publish
 * Publish a document and sync to all tenants
 */
router.post(
  "/:id/publish",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      // Check document exists and has embeddings
      const existing = await managementPool.query(
        `SELECT gkl.id, gkl.title, gkl.status, gkl.chunk_count, gkl.processing_status
       FROM global_knowledge_library gkl
       WHERE gkl.id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      const doc = existing.rows[0];

      if (doc.processing_status !== "completed") {
        return res.status(400).json({
          error: "Document must be processed before publishing",
          processing_status: doc.processing_status,
        });
      }

      if (doc.chunk_count === 0) {
        return res
          .status(400)
          .json({ error: "Document has no chunks. Process it first." });
      }

      // Update status to published
      await managementPool.query(
        `UPDATE global_knowledge_library 
       SET status = 'published', published_by = $1, published_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
        [req.userId, id]
      );

      // Sync to all tenants
      const syncResults = await syncDocumentToAllTenants(
        id,
        req.userId || null
      );

      const successCount = syncResults.filter((r) => r.success).length;
      const failureCount = syncResults.filter((r) => !r.success).length;

      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        action: "publish",
        resource: "global_knowledge_library",
        resourceId: id as string,
        description: `Published global knowledge document: ${doc.title}`,
        changes: { syncedTenants: successCount, failedTenants: failureCount },
        status: "success",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        message: "Document published and synced",
        syncResults: {
          total: syncResults.length,
          success: successCount,
          failed: failureCount,
          details: syncResults,
        },
      });
    } catch (error: any) {
      console.error("Error publishing document:", error);
      res
        .status(500)
        .json({ error: "Failed to publish document", details: error.message });
    }
  }
);

/**
 * POST /api/admin/global-knowledge/:id/archive
 * Archive a document and remove from all tenants
 */
router.post(
  "/:id/archive",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;
      const { reason } = req.body;

      // Check document exists
      const existing = await managementPool.query(
        `SELECT id, title, status FROM global_knowledge_library WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (existing.rows[0].status === "archived") {
        return res.status(400).json({ error: "Document is already archived" });
      }

      // Archive and remove from tenants
      const syncResults = await archiveGlobalDocument(id, req.userId!, reason);

      const successCount = syncResults.filter((r) => r.success).length;

      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        action: "archive",
        resource: "global_knowledge_library",
        resourceId: id as string,
        description: `Archived global knowledge document: ${existing.rows[0].title}`,
        changes: { reason, removedFromTenants: successCount },
        status: "success",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        message: "Document archived and removed from tenants",
        syncResults: {
          total: syncResults.length,
          success: successCount,
          failed: syncResults.filter((r) => !r.success).length,
          details: syncResults,
        },
      });
    } catch (error: any) {
      console.error("Error archiving document:", error);
      res
        .status(500)
        .json({ error: "Failed to archive document", details: error.message });
    }
  }
);

/**
 * POST /api/admin/global-knowledge/:id/restore
 * Restore an archived document and re-sync to all tenants
 */
router.post(
  "/:id/restore",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      // Check document is archived
      const existing = await managementPool.query(
        `SELECT id, title, status FROM global_knowledge_library WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (existing.rows[0].status !== "archived") {
        return res.status(400).json({ error: "Document is not archived" });
      }

      // Restore and re-sync
      const syncResults = await restoreGlobalDocument(id, req.userId!);

      const successCount = syncResults.filter((r) => r.success).length;

      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        action: "restore",
        resource: "global_knowledge_library",
        resourceId: id as string,
        description: `Restored global knowledge document: ${existing.rows[0].title}`,
        changes: { resyncedTenants: successCount },
        status: "success",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        message: "Document restored and re-synced to tenants",
        syncResults: {
          total: syncResults.length,
          success: successCount,
          failed: syncResults.filter((r) => !r.success).length,
          details: syncResults,
        },
      });
    } catch (error: any) {
      console.error("Error restoring document:", error);
      res
        .status(500)
        .json({ error: "Failed to restore document", details: error.message });
    }
  }
);

// =============================================================================
// Sync Status
// =============================================================================

/**
 * GET /api/admin/global-knowledge/:id/sync-status
 * Get sync status for a document across all tenants
 */
router.get(
  "/:id/sync-status",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      const syncStatus = await getDocumentSyncStatus(id);

      res.json({ syncStatus });
    } catch (error: any) {
      console.error("Error fetching sync status:", error);
      res.status(500).json({ error: "Failed to fetch sync status" });
    }
  }
);

/**
 * GET /api/admin/global-knowledge/activity
 * Get recent sync activity across all documents
 */
router.get(
  "/sync/activity",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { limit = "50" } = req.query;

      const activity = await getRecentSyncActivity(
        parseInt(limit as string, 10)
      );

      res.json({ activity });
    } catch (error: any) {
      console.error("Error fetching sync activity:", error);
      res.status(500).json({ error: "Failed to fetch sync activity" });
    }
  }
);

/**
 * POST /api/admin/global-knowledge/:id/resync
 * Force re-sync a published document to all tenants
 */
router.post(
  "/:id/resync",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      // Check document is published
      const existing = await managementPool.query(
        `SELECT id, title, status FROM global_knowledge_library WHERE id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (existing.rows[0].status !== "published") {
        return res
          .status(400)
          .json({ error: "Document must be published to resync" });
      }

      // Re-sync to all tenants
      const syncResults = await syncDocumentToAllTenants(
        id,
        req.userId || null
      );

      const successCount = syncResults.filter((r) => r.success).length;

      res.json({
        message: "Document re-synced to all tenants",
        syncResults: {
          total: syncResults.length,
          success: successCount,
          failed: syncResults.filter((r) => !r.success).length,
          details: syncResults,
        },
      });
    } catch (error: any) {
      console.error("Error re-syncing document:", error);
      res
        .status(500)
        .json({ error: "Failed to re-sync document", details: error.message });
    }
  }
);

export default router;
