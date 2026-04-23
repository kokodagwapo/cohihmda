import { NextFunction, Response, Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { attachTenantContext, getTenantContext } from "../middleware/tenantContext.js";
import { notifySuperAdminsOfFeedback } from "../services/feedbackNotificationService.js";

const router = Router();

const AREA_VALUES = [
  "insights",
  "dashboards",
  "workbench",
  "research_lab",
  "communication_center",
  "general_feedback",
] as const;
const STATUS_VALUES = ["open", "in_progress", "resolved"] as const;
const TYPE_VALUES = ["feature_request", "bug_issue", "question"] as const;

const createFeedbackSchema = z.object({
  area: z.enum(AREA_VALUES),
  type: z.enum(TYPE_VALUES).optional().default("question"),
  description: z.string().trim().min(1).max(4000),
});

const listFeedbackQuerySchema = z.object({
  sortBy: z.enum(["created_at", "status", "area"]).optional().default("created_at"),
  sortDir: z.enum(["asc", "desc"]).optional().default("desc"),
  status: z.enum(STATUS_VALUES).optional(),
  area: z.enum(AREA_VALUES).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

const feedbackIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const patchFeedbackSchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  admin_notes: z.string().max(4000).optional(),
});

const MAX_FEEDBACK_FILES = 5;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DATA_DOC_MAX_BYTES = 50 * 1024 * 1024;
const ABSOLUTE_UPLOAD_MAX_BYTES = DATA_DOC_MAX_BYTES;
const FEEDBACK_ATTACHMENT_TTL_DAYS = 30;
const FEEDBACK_ATTACHMENT_RATE_LIMIT_MAX = 30;
const FEEDBACK_ATTACHMENT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_ACTIVE_ATTACHMENTS_PER_TENANT = 2500;

type FileKind = "image" | "data" | "document";

const ALLOWED_FILES: Record<string, { kind: FileKind; maxBytes: number; extensions: string[] }> = {
  "image/png": { kind: "image", maxBytes: IMAGE_MAX_BYTES, extensions: [".png"] },
  "image/jpeg": { kind: "image", maxBytes: IMAGE_MAX_BYTES, extensions: [".jpg", ".jpeg"] },
  "image/webp": { kind: "image", maxBytes: IMAGE_MAX_BYTES, extensions: [".webp"] },
  "text/csv": { kind: "data", maxBytes: DATA_DOC_MAX_BYTES, extensions: [".csv"] },
  "application/vnd.ms-excel": { kind: "data", maxBytes: DATA_DOC_MAX_BYTES, extensions: [".xls", ".csv"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "data",
    maxBytes: DATA_DOC_MAX_BYTES,
    extensions: [".xlsx"],
  },
  "application/pdf": { kind: "document", maxBytes: DATA_DOC_MAX_BYTES, extensions: [".pdf"] },
};

const uploadCountByUser = new Map<string, { count: number; windowStart: number }>();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: ABSOLUTE_UPLOAD_MAX_BYTES,
    files: MAX_FEEDBACK_FILES,
  },
  fileFilter: (_req, file, cb) => {
    const normalizedName = String(file.originalname || "").toLowerCase();
    const allowedByMime = ALLOWED_FILES[file.mimetype];
    const allowedByExt = Object.values(ALLOWED_FILES).some((entry) =>
      entry.extensions.some((ext) => normalizedName.endsWith(ext))
    );
    if (allowedByMime || allowedByExt) {
      cb(null, true);
      return;
    }
    cb(new Error("Unsupported file type. Allowed: png, jpg, jpeg, webp, csv, xlsx, xls, pdf"));
  },
});

type AttachmentRow = {
  id: string;
  feedback_id: string;
  original_file_name: string;
  stored_file_name: string;
  mime_type: string;
  file_size_bytes: number;
  file_kind: FileKind;
  created_at: string;
};

function getExtension(fileName: string): string {
  const normalized = String(fileName || "").trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  if (dot <= 0 || dot === normalized.length - 1) return "";
  return normalized.slice(dot);
}

function normalizeForStorageName(fileName: string): string {
  const collapsed = String(fileName || "")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .trim();
  return collapsed || "file";
}

function getTenantQueryValue(req: AuthRequest): string | null {
  const value = req.query?.tenant_id;
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0];
  return null;
}

function sanitizeDownloadFilename(fileName: string): string {
  const noControls = String(fileName || "")
    .replace(/[\r\n]/g, " ")
    .replace(/[^\x20-\x7E]+/g, "")
    .trim();
  if (!noControls) return "attachment";
  return noControls.replace(/["\\]/g, "_");
}

function classifyFile(file: Express.Multer.File): { kind: FileKind; maxBytes: number } | null {
  const byMime = ALLOWED_FILES[file.mimetype];
  if (byMime) return { kind: byMime.kind, maxBytes: byMime.maxBytes };
  const ext = getExtension(file.originalname);
  const byExt = Object.values(ALLOWED_FILES).find((entry) => entry.extensions.includes(ext));
  if (!byExt) return null;
  return { kind: byExt.kind, maxBytes: byExt.maxBytes };
}

function validateFiles(files: Express.Multer.File[]): { ok: true } | { ok: false; message: string } {
  if (files.length > MAX_FEEDBACK_FILES) {
    return { ok: false, message: "Maximum 5 files allowed" };
  }
  for (const file of files) {
    const classified = classifyFile(file);
    if (!classified) {
      return { ok: false, message: "Unsupported file type. Allowed: png, jpg, jpeg, webp, csv, xlsx, xls, pdf" };
    }
    if (file.size > classified.maxBytes) {
      const maxMb = Math.round(classified.maxBytes / 1024 / 1024);
      return { ok: false, message: `File is too large. Maximum ${maxMb}MB for ${classified.kind} files.` };
    }
  }
  return { ok: true };
}

function toAttachmentMetaRows(rows: AttachmentRow[], feedbackId: string, tenantId?: string | null) {
  const tenantQuery = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  return rows.map((row) => ({
    id: row.id,
    feedback_id: row.feedback_id,
    original_file_name: row.original_file_name,
    stored_file_name: row.stored_file_name,
    mime_type: row.mime_type,
    file_size_bytes: Number(row.file_size_bytes),
    file_kind: row.file_kind,
    created_at: row.created_at,
    download_url: `/api/feedback/${feedbackId}/attachments/${row.id}/download${tenantQuery}`,
  }));
}

function checkUploadRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = uploadCountByUser.get(userId);
  if (!entry || now - entry.windowStart > FEEDBACK_ATTACHMENT_RATE_LIMIT_WINDOW_MS) {
    uploadCountByUser.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= FEEDBACK_ATTACHMENT_RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

async function getFeedbackAttachments(
  tenantPool: { query: (sql: string, values?: unknown[]) => Promise<{ rows: AttachmentRow[] }> },
  feedbackId: string
): Promise<AttachmentRow[]> {
  const result = await tenantPool.query(
    `SELECT id,
            feedback_id,
            original_file_name,
            stored_file_name,
            mime_type,
            file_size_bytes,
            file_kind,
            created_at
     FROM user_feedback_attachments
     WHERE feedback_id = $1
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at ASC`,
    [feedbackId]
  );
  return result.rows;
}

function uploadMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  upload.array("files", MAX_FEEDBACK_FILES)(req as any, res as any, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        (res as any).status(400).json({ error: "Maximum 5 files allowed" });
        return;
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        (res as any).status(400).json({ error: "File is too large. Maximum 50MB per file." });
        return;
      }
      (res as any).status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error) {
      (res as any).status(400).json({ error: err.message });
      return;
    }
    next();
  });
}

function isSuperAdmin(req: AuthRequest): boolean {
  return req.userRole === "super_admin";
}

function deriveNameFromEmail(email: string): string {
  const prefix = String(email || "").split("@")[0] || "";
  if (!prefix) return "";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

router.post("/", authenticateToken, attachTenantContext, uploadMiddleware, async (req: AuthRequest, res) => {
  try {
    const files = ((req.files as Express.Multer.File[] | undefined) || []).filter(Boolean);
    const parsed = createFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    if (!req.userId || !req.userEmail) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (files.length > 0 && !checkUploadRateLimit(req.userId)) {
      return res
        .status(429)
        .json({ error: `Upload rate limit exceeded. Max ${FEEDBACK_ATTACHMENT_RATE_LIMIT_MAX} uploads per hour.` });
    }

    const fileValidation = validateFiles(files);
    if (!fileValidation.ok) {
      return res.status(400).json({ error: (fileValidation as { ok: false; message: string }).message });
    }

    const { area, type, description } = parsed.data;
    const tenantContext = getTenantContext(req);
    if (files.length > 0) {
      const activeCount = await tenantContext.tenantPool.query(
        `SELECT COUNT(*)::int AS count
         FROM user_feedback_attachments
         WHERE tenant_id = $1
           AND status = 'active'
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [tenantContext.tenantId]
      );
      const activeAttachmentCount = Number(activeCount.rows[0]?.count || 0);
      if (activeAttachmentCount + files.length > MAX_ACTIVE_ATTACHMENTS_PER_TENANT) {
        return res.status(429).json({
          error: `Tenant has reached the maximum of ${MAX_ACTIVE_ATTACHMENTS_PER_TENANT} active attachments. Delete or expire existing attachments before uploading more.`,
        });
      }
    }

    let submitterName = "";
    try {
      const userResult = await tenantContext.tenantPool.query(
        `SELECT full_name
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [req.userId]
      );
      const fullName = String(userResult.rows[0]?.full_name || "").trim();
      submitterName = fullName || deriveNameFromEmail(req.userEmail);
    } catch {
      submitterName = deriveNameFromEmail(req.userEmail);
    }

    await tenantContext.tenantPool.query("BEGIN");
    try {
      const insertResult = await tenantContext.tenantPool.query(
        `INSERT INTO user_feedback
           (user_id, submitter_email, submitter_name, area, type, description, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open')
         RETURNING id, user_id, submitter_email, submitter_name, area, type, description, status, admin_notes,
                   in_progress_at, resolved_at, status_changed_at, updated_by, created_at, updated_at`,
        [req.userId, req.userEmail, submitterName, area, type, description]
      );
      const feedback = insertResult.rows[0];

      const insertedAttachmentRows: AttachmentRow[] = [];
      for (const file of files) {
        const classified = classifyFile(file);
        if (!classified) {
          throw new Error("Unsupported file type. Allowed: png, jpg, jpeg, webp, csv, xlsx, xls, pdf");
        }
        const storedFileName = `${randomUUID()}_${normalizeForStorageName(file.originalname)}`;
        const attachmentResult = await tenantContext.tenantPool.query(
          `INSERT INTO user_feedback_attachments
             (feedback_id, tenant_id, user_id, original_file_name, stored_file_name, mime_type, file_size_bytes, file_kind,
              storage_provider, data, status, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'db', $9, 'active', NOW() + ($10::text || ' days')::interval)
           RETURNING id,
                     feedback_id,
                     original_file_name,
                     stored_file_name,
                     mime_type,
                     file_size_bytes,
                     file_kind,
                     created_at`,
          [
            feedback.id,
            tenantContext.tenantId,
            req.userId,
            file.originalname,
            storedFileName,
            file.mimetype || "application/octet-stream",
            file.size,
            classified.kind,
            file.buffer,
            String(FEEDBACK_ATTACHMENT_TTL_DAYS),
          ]
        );
        insertedAttachmentRows.push(attachmentResult.rows[0]);
      }

      await tenantContext.tenantPool.query("COMMIT");
      const notifyResult = await notifySuperAdminsOfFeedback({
        feedbackId: feedback.id,
        area: feedback.area,
        description: feedback.description,
        submitterEmail: feedback.submitter_email,
        submitterUserId: feedback.user_id,
        tenantId: tenantContext.tenantId,
        tenantName: tenantContext.tenantInfo.name,
      });

      return res.status(201).json({
        feedback: {
          ...feedback,
          attachments: toAttachmentMetaRows(insertedAttachmentRows, feedback.id, getTenantQueryValue(req)),
        },
        notificationSent: notifyResult.failed.length === 0,
        notificationFailures: notifyResult.failed,
      });
    } catch (insertError) {
      await tenantContext.tenantPool.query("ROLLBACK");
      throw insertError;
    }
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "42P01") {
      return res.status(503).json({
        error:
          "Feedback is not set up for this tenant. An administrator needs to run tenant migrations.",
      });
    }
    console.error("[Feedback] POST / error:", err);
    return res.status(500).json({ error: "Failed to submit feedback" });
  }
});

router.get("/", authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const parsed = listFeedbackQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

    const { sortBy, sortDir, status, area, page, limit } = parsed.data;
    const tenantContext = getTenantContext(req);
    const whereParts: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (!isSuperAdmin(req)) {
      whereParts.push(`user_id = $${i++}`);
      params.push(req.userId);
    }
    if (status) {
      whereParts.push(`status = $${i++}`);
      params.push(status);
    }
    if (area) {
      whereParts.push(`area = $${i++}`);
      params.push(area);
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const offset = (page - 1) * limit;

    const countResult = await tenantContext.tenantPool.query(
      `SELECT COUNT(*)::int AS total FROM user_feedback ${whereClause}`,
      params
    );
    const listResult = await tenantContext.tenantPool.query(
      `SELECT uf.id,
              uf.user_id,
              uf.submitter_email,
              COALESCE(NULLIF(uf.submitter_name, ''), u.full_name, '') AS submitter_name,
              uf.area,
              uf.type,
              uf.description,
              uf.status,
              uf.admin_notes,
              uf.in_progress_at,
              uf.resolved_at,
              uf.status_changed_at,
              uf.updated_by,
              uf.created_at,
              uf.updated_at
       FROM user_feedback uf
       LEFT JOIN users u ON u.id = uf.user_id
       ${whereClause}
       ORDER BY ${sortBy} ${sortDir.toUpperCase()}, created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );

    return res.json({
      feedback: listResult.rows,
      page,
      limit,
      total: countResult.rows[0]?.total ?? 0,
    });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "42P01") {
      return res.status(503).json({
        error:
          "Feedback is not set up for this tenant. An administrator needs to run tenant migrations.",
      });
    }
    console.error("[Feedback] GET / error:", err);
    return res.status(500).json({ error: "Failed to fetch feedback" });
  }
});

router.get("/:id", authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const paramsParsed = feedbackIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return res.status(400).json({ error: "Invalid request", details: paramsParsed.error.flatten() });
    }
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

    const tenantContext = getTenantContext(req);
    const result = await tenantContext.tenantPool.query(
      `SELECT uf.id,
              uf.user_id,
              uf.submitter_email,
              COALESCE(NULLIF(uf.submitter_name, ''), u.full_name, '') AS submitter_name,
              uf.area,
              uf.type,
              uf.description,
              uf.status,
              uf.admin_notes,
              uf.in_progress_at,
              uf.resolved_at,
              uf.status_changed_at,
              uf.updated_by,
              uf.created_at,
              uf.updated_at
       FROM user_feedback uf
       LEFT JOIN users u ON u.id = uf.user_id
       WHERE uf.id = $1`,
      [paramsParsed.data.id]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "Feedback not found" });
    if (!isSuperAdmin(req) && row.user_id !== req.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const attachments = await getFeedbackAttachments(tenantContext.tenantPool as any, row.id);
    return res.json({
      feedback: {
        ...row,
        attachments: toAttachmentMetaRows(attachments, row.id, getTenantQueryValue(req)),
      },
    });
  } catch (err: unknown) {
    console.error("[Feedback] GET /:id error:", err);
    return res.status(500).json({ error: "Failed to fetch feedback detail" });
  }
});

router.get(
  "/:id/attachments/:attachmentId/download",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const paramsParsed = z
        .object({
          id: z.string().uuid(),
          attachmentId: z.string().uuid(),
        })
        .safeParse(req.params);
      if (!paramsParsed.success) {
        return res.status(400).json({ error: "Invalid request", details: paramsParsed.error.flatten() });
      }
      if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

      const tenantContext = getTenantContext(req);
      const feedbackResult = await tenantContext.tenantPool.query(
        `SELECT id, user_id
         FROM user_feedback
         WHERE id = $1`,
        [paramsParsed.data.id]
      );
      const feedback = feedbackResult.rows[0] as { id: string; user_id: string } | undefined;
      if (!feedback) return res.status(404).json({ error: "Feedback not found" });
      if (!isSuperAdmin(req) && feedback.user_id !== req.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const attachmentResult = await tenantContext.tenantPool.query(
        `SELECT id,
                feedback_id,
                original_file_name,
                mime_type,
                file_size_bytes,
                storage_provider,
                data
         FROM user_feedback_attachments
         WHERE id = $1
           AND feedback_id = $2
           AND status = 'active'
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [paramsParsed.data.attachmentId, paramsParsed.data.id]
      );
      const attachment = attachmentResult.rows[0] as
        | {
            id: string;
            feedback_id: string;
            original_file_name: string;
            mime_type: string;
            file_size_bytes: number;
            storage_provider: "db" | "s3";
            data: Buffer | null;
          }
        | undefined;
      if (!attachment) return res.status(404).json({ error: "Attachment not found" });
      if (attachment.storage_provider !== "db") {
        return res.status(501).json({ error: "Attachment storage provider is not supported by this endpoint yet." });
      }
      if (!attachment.data) {
        return res.status(404).json({ error: "Attachment content is unavailable" });
      }

      const downloadName = sanitizeDownloadFilename(attachment.original_file_name);
      res.setHeader("Content-Type", attachment.mime_type || "application/octet-stream");
      res.setHeader("Content-Length", String(attachment.file_size_bytes || attachment.data.length));
      res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
      return res.status(200).send(attachment.data);
    } catch (err: unknown) {
      console.error("[Feedback] GET /:id/attachments/:attachmentId/download error:", err);
      return res.status(500).json({ error: "Failed to download attachment" });
    }
  }
);

router.patch("/:id", authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

    const paramsParsed = feedbackIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return res.status(400).json({ error: "Invalid request", details: paramsParsed.error.flatten() });
    }
    const bodyParsed = patchFeedbackSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: "Invalid request", details: bodyParsed.error.flatten() });
    }

    const { status, admin_notes } = bodyParsed.data;
    if (status === undefined && admin_notes === undefined) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const tenantContext = getTenantContext(req);
    const existingResult = await tenantContext.tenantPool.query(
      `SELECT uf.id,
              uf.user_id,
              uf.submitter_email,
              COALESCE(NULLIF(uf.submitter_name, ''), u.full_name, '') AS submitter_name,
              uf.area,
              uf.type,
              uf.description,
              uf.status,
              uf.admin_notes,
              uf.in_progress_at,
              uf.resolved_at,
              uf.status_changed_at,
              uf.updated_by,
              uf.created_at,
              uf.updated_at
       FROM user_feedback uf
       LEFT JOIN users u ON u.id = uf.user_id
       WHERE uf.id = $1`,
      [paramsParsed.data.id]
    );
    if (existingResult.rows.length === 0) return res.status(404).json({ error: "Feedback not found" });
    const existing = existingResult.rows[0] as {
      id: string;
      status: (typeof STATUS_VALUES)[number];
      admin_notes: string | null;
    };

    const updates: string[] = ["updated_by = $1"];
    const values: unknown[] = [req.userId];
    let i = 2;
    let hasChanges = false;

    if (status !== undefined && status !== existing.status) {
      hasChanges = true;
      updates.push(`status = $${i++}`);
      values.push(status);
      updates.push(`status_changed_at = NOW()`);
      if (status === "in_progress") {
        updates.push(`in_progress_at = NOW()`);
        updates.push(`resolved_at = NULL`);
      }
      if (status === "resolved") {
        updates.push(`resolved_at = NOW()`);
      }
      if (status === "open") {
        updates.push(`resolved_at = NULL`);
        updates.push(`in_progress_at = NULL`);
      }
    }

    if (admin_notes !== undefined && admin_notes !== (existing.admin_notes ?? "")) {
      hasChanges = true;
      updates.push(`admin_notes = $${i++}`);
      values.push(admin_notes);
    }

    if (!hasChanges) {
      return res.json({ feedback: existingResult.rows[0] });
    }

    values.push(paramsParsed.data.id);
    const result = await tenantContext.tenantPool.query(
      `UPDATE user_feedback
       SET ${updates.join(", ")}
       WHERE id = $${i}
       RETURNING id, user_id, submitter_email, area, type, description, status, admin_notes,
                 in_progress_at, resolved_at, status_changed_at, updated_by, created_at, updated_at`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Feedback not found" });

    const refreshedResult = await tenantContext.tenantPool.query(
      `SELECT uf.id,
              uf.user_id,
              uf.submitter_email,
              COALESCE(NULLIF(uf.submitter_name, ''), u.full_name, '') AS submitter_name,
              uf.area,
              uf.type,
              uf.description,
              uf.status,
              uf.admin_notes,
              uf.in_progress_at,
              uf.resolved_at,
              uf.status_changed_at,
              uf.updated_by,
              uf.created_at,
              uf.updated_at
       FROM user_feedback uf
       LEFT JOIN users u ON u.id = uf.user_id
       WHERE uf.id = $1`,
      [paramsParsed.data.id]
    );

    return res.json({ feedback: refreshedResult.rows[0] });
  } catch (err: unknown) {
    console.error("[Feedback] PATCH /:id error:", err);
    return res.status(500).json({ error: "Failed to update feedback" });
  }
});

export default router;
