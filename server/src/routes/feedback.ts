import { Router } from "express";
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

const createFeedbackSchema = z.object({
  area: z.enum(AREA_VALUES),
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

function isSuperAdmin(req: AuthRequest): boolean {
  return req.userRole === "super_admin";
}

function deriveNameFromEmail(email: string): string {
  const prefix = String(email || "").split("@")[0] || "";
  if (!prefix) return "";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

router.post("/", authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const parsed = createFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    if (!req.userId || !req.userEmail) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { area, description } = parsed.data;
    const tenantContext = getTenantContext(req);
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
    const insertResult = await tenantContext.tenantPool.query(
      `INSERT INTO user_feedback
         (user_id, submitter_email, submitter_name, area, description, status)
       VALUES ($1, $2, $3, $4, $5, 'open')
       RETURNING id, user_id, submitter_email, submitter_name, area, description, status, admin_notes,
                 in_progress_at, resolved_at, status_changed_at, updated_by, created_at, updated_at`,
      [req.userId, req.userEmail, submitterName, area, description]
    );

    const feedback = insertResult.rows[0];
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
      feedback,
      notificationSent: notifyResult.failed.length === 0,
      notificationFailures: notifyResult.failed,
    });
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
    return res.json({ feedback: row });
  } catch (err: unknown) {
    console.error("[Feedback] GET /:id error:", err);
    return res.status(500).json({ error: "Failed to fetch feedback detail" });
  }
});

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
       RETURNING id, user_id, submitter_email, area, description, status, admin_notes,
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
