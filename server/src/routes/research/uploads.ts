/**
 * Research Upload Routes
 *
 * POST   /api/research/uploads              — Upload CSV/TSV file; parse, infer, store
 * GET    /api/research/uploads              — List user's uploads
 * GET    /api/research/uploads/:id          — Get upload metadata + sample rows
 * PUT    /api/research/uploads/:id/columns  — Update column overrides (type, description)
 * DELETE /api/research/uploads/:id          — Delete upload + drop temp table if any
 * POST   /api/research/uploads/:id/attach   — Link upload to a research session
 *
 * Rate limits: 30 uploads per user per hour; 50 active uploads per tenant.
 */

import { Router, type Response } from "express";
import multer from "multer";
import { authenticateToken, type AuthRequest } from "../../middleware/auth.js";
import { attachTenantContext, getTenantContext } from "../../middleware/tenantContext.js";
import {
  processUpload,
  saveUploadRecord,
  loadUploadRecord,
  dropUploadTable,
  MAX_FILE_SIZE_BYTES,
  type ColumnMeta,
  type InferredColumnType,
} from "../../services/research/uploadProcessor.js";
import { getConversationsForUpload } from "../../services/research/uploadConversationService.js";

const router = Router();

// ============================================================================
// Multer config
// ============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = ["text/csv", "text/plain", "text/tab-separated-values", "application/octet-stream"];
    const allowedExt = /\.(csv|tsv|txt)$/i;
    if (allowed.includes(file.mimetype) || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Allowed: CSV, TSV"));
    }
  },
});

// ============================================================================
// In-memory rate limiting (upload count per user per hour)
// ============================================================================

const uploadCountByUser = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_ACTIVE_UPLOADS_PER_TENANT = 50;

function checkUploadRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = uploadCountByUser.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    uploadCountByUser.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

// ============================================================================
// POST /api/research/uploads — upload a file
// ============================================================================

router.post(
  "/",
  authenticateToken,
  attachTenantContext,
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool, tenantId } = getTenantContext(req);
      const userId = req.userId || "";

      if (!req.file) {
        res.status(400).json({ error: "No file provided. Send the file as form field 'file'." });
        return;
      }

      // Rate limit
      if (!checkUploadRateLimit(userId)) {
        res.status(429).json({ error: `Upload rate limit exceeded. Max ${RATE_LIMIT_MAX} uploads per hour.` });
        return;
      }

      // Check tenant active upload count
      const activeCount = await tenantPool.query(
        `SELECT COUNT(*) FROM research_uploads WHERE tenant_id = $1 AND status = 'ready'`,
        [tenantId]
      );
      if (parseInt(activeCount.rows[0].count) >= MAX_ACTIVE_UPLOADS_PER_TENANT) {
        res.status(429).json({ error: `Tenant has reached the maximum of ${MAX_ACTIVE_UPLOADS_PER_TENANT} active uploads. Delete some before uploading more.` });
        return;
      }

      // Process the file
      const processed = await processUpload(
        req.file.buffer,
        req.file.originalname,
        req.file.size,
        tenantPool
      );

      // Save metadata to DB
      const uploadId = await saveUploadRecord(tenantId, userId, processed, tenantPool);

      res.status(201).json({
        id: uploadId,
        fileName: processed.fileName,
        originalFileName: processed.originalFileName,
        fileSizeBytes: processed.fileSizeBytes,
        rowCount: processed.rowCount,
        columnCount: processed.columnCount,
        columns: processed.columns,
        storageStrategy: processed.storageStrategy,
        tableName: processed.tableName,
        sampleRows: processed.sampleRows,
        quickInsights: processed.quickInsights,
        piiWarnings: processed.piiWarnings,
      });
    } catch (err: any) {
      console.error("[ResearchUploads] Upload error:", err.message);
      res.status(400).json({ error: err.message });
    }
  }
);

// ============================================================================
// GET /api/research/uploads — list user's uploads
// ============================================================================

router.get(
  "/",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId || "";

      const result = await tenantPool.query(
        `SELECT id, file_name, original_file_name, file_size_bytes,
                row_count, column_count, columns, storage_strategy,
                table_name, sample_rows, quick_insights, status,
                expires_at, session_id, created_at, updated_at
         FROM research_uploads
         WHERE user_id = $1 AND status != 'expired'
         ORDER BY created_at DESC
         LIMIT 100`,
        [userId]
      );

      res.json(result.rows.map((r: any) => ({
        id: r.id,
        fileName: r.file_name,
        originalFileName: r.original_file_name,
        fileSizeBytes: r.file_size_bytes,
        rowCount: r.row_count,
        columnCount: r.column_count,
        columns: r.columns,
        storageStrategy: r.storage_strategy,
        tableName: r.table_name,
        sampleRows: r.sample_rows,
        quickInsights: r.quick_insights,
        status: r.status,
        expiresAt: r.expires_at,
        sessionId: r.session_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })));
    } catch (err: any) {
      console.error("[ResearchUploads] List error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// GET /api/research/uploads/:id/conversations — chats that used this upload
// ============================================================================

router.get(
  "/:id/conversations",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId || "";
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const check = await tenantPool.query(
        `SELECT id FROM research_uploads WHERE id = $1 AND user_id = $2 AND status != 'expired'`,
        [id, userId],
      );
      if (check.rows.length === 0) {
        res.status(404).json({ error: "Upload not found." });
        return;
      }

      const conversations = await getConversationsForUpload(
        tenantPool,
        id,
        userId,
      );
      res.json({ conversations });
    } catch (err: any) {
      console.error("[ResearchUploads] Conversations list error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ============================================================================
// GET /api/research/uploads/:id — get upload detail
// ============================================================================

router.get(
  "/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId || "";
      const { id } = req.params;

      const result = await tenantPool.query(
        `SELECT * FROM research_uploads WHERE id = $1 AND user_id = $2 AND status != 'expired'`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Upload not found." });
        return;
      }

      const r = result.rows[0];
      res.json({
        id: r.id,
        fileName: r.file_name,
        originalFileName: r.original_file_name,
        fileSizeBytes: r.file_size_bytes,
        rowCount: r.row_count,
        columnCount: r.column_count,
        columns: r.columns,
        storageStrategy: r.storage_strategy,
        tableName: r.table_name,
        sampleRows: r.sample_rows,
        quickInsights: r.quick_insights,
        status: r.status,
        expiresAt: r.expires_at,
        sessionId: r.session_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    } catch (err: any) {
      console.error("[ResearchUploads] Get error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// PUT /api/research/uploads/:id/columns — update column metadata overrides
// ============================================================================

router.put(
  "/:id/columns",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId || "";
      const { id } = req.params;
      const { columns } = req.body as { columns: Partial<ColumnMeta>[] };

      if (!Array.isArray(columns)) {
        res.status(400).json({ error: "columns must be an array." });
        return;
      }

      // Load existing record
      const existing = await tenantPool.query(
        `SELECT columns FROM research_uploads WHERE id = $1 AND user_id = $2 AND status = 'ready'`,
        [id, userId]
      );
      if (existing.rows.length === 0) {
        res.status(404).json({ error: "Upload not found." });
        return;
      }

      const existingCols: ColumnMeta[] = existing.rows[0].columns || [];
      const allowedTypes: InferredColumnType[] = ["string", "number", "currency", "percentage", "date", "boolean"];

      // Merge updates by column name
      const updatedCols = existingCols.map((col) => {
        const override = columns.find((c) => c.name === col.name);
        if (!override) return col;
        return {
          ...col,
          ...(override.userOverrideType && allowedTypes.includes(override.userOverrideType)
            ? { userOverrideType: override.userOverrideType }
            : {}),
          ...(typeof override.description === "string" ? { description: override.description } : {}),
          ...(typeof override.displayName === "string" ? { displayName: override.displayName } : {}),
        };
      });

      await tenantPool.query(
        `UPDATE research_uploads SET columns = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(updatedCols), id]
      );

      res.json({ columns: updatedCols });
    } catch (err: any) {
      console.error("[ResearchUploads] Column update error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// DELETE /api/research/uploads/:id
// ============================================================================

router.delete(
  "/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId || "";
      const { id } = req.params;

      const existing = await tenantPool.query(
        `SELECT table_name, storage_strategy FROM research_uploads WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );

      if (existing.rows.length === 0) {
        res.status(404).json({ error: "Upload not found." });
        return;
      }

      const { table_name, storage_strategy } = existing.rows[0];

      // Drop temp table if applicable
      if (storage_strategy === "table" && table_name) {
        await dropUploadTable(table_name, tenantPool);
      }

      await tenantPool.query(`DELETE FROM research_uploads WHERE id = $1`, [id]);
      res.json({ deleted: true });
    } catch (err: any) {
      console.error("[ResearchUploads] Delete error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================================
// POST /api/research/uploads/:id/attach — link upload to a session
// ============================================================================

router.post(
  "/:id/attach",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId || "";
      const { id } = req.params;
      const { sessionId } = req.body as { sessionId: string };

      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required." });
        return;
      }

      // Verify ownership
      const check = await tenantPool.query(
        `SELECT id FROM research_uploads WHERE id = $1 AND user_id = $2 AND status = 'ready'`,
        [id, userId]
      );
      if (check.rows.length === 0) {
        res.status(404).json({ error: "Upload not found." });
        return;
      }

      await tenantPool.query(
        `UPDATE research_uploads SET session_id = $1, updated_at = NOW() WHERE id = $2`,
        [sessionId, id]
      );

      // Also update research_sessions.upload_ids to include this upload
      await tenantPool.query(
        `UPDATE research_sessions
         SET upload_ids = COALESCE(upload_ids, '[]'::jsonb) || $1::jsonb, updated_at = NOW()
         WHERE id = $2 AND user_id = $3`,
        [JSON.stringify([id]), sessionId, userId]
      );

      res.json({ attached: true, uploadId: id, sessionId });
    } catch (err: any) {
      console.error("[ResearchUploads] Attach error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
