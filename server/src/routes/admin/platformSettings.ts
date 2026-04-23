/**
 * Platform Settings Routes
 * Manages platform-wide configuration including API keys
 *
 * Only accessible by super_admin and platform_admin roles
 */

import express from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { pool as managementPool } from "../../config/managementDatabase.js";
import {
  getAllPlatformSettings,
  setPlatformSetting,
  getPlatformSetting,
  platformSettingsTableExists,
} from "../../services/platformSettingsService.js";
import { z } from "zod";

const router = express.Router();

// Require platform admin access for all routes
const requirePlatformAdmin = requireRole("super_admin", "platform_admin");
const requireSuperAdmin = requireRole("super_admin");

// Validation schemas
const updateSettingSchema = z.object({
  value: z.string().nullable(),
});
const recipientIdParamSchema = z.object({
  id: z.string().uuid(),
});
const createFeedbackRecipientSchema = z
  .object({
    source: z.enum(["existing_user", "new_user"]),
    user_id: z.string().uuid().optional(),
    user_name: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().email().max(320).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === "existing_user" && !value.user_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["user_id"],
        message: "user_id is required for existing_user source",
      });
    }
    if (value.source === "new_user") {
      if (!value.user_name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["user_name"],
          message: "user_name is required for new_user source",
        });
      }
      if (!value.email) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["email"],
          message: "email is required for new_user source",
        });
      }
    }
  });

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

router.get(
  "/feedback-notification-users",
  authenticateToken,
  requireSuperAdmin,
  async (_req, res) => {
    try {
      const result = await managementPool.query(
        `SELECT id, COALESCE(NULLIF(full_name, ''), email) AS user_name, email
         FROM coheus_users
         WHERE is_active = true
           AND email IS NOT NULL
           AND TRIM(email) <> ''
         ORDER BY COALESCE(NULLIF(full_name, ''), email) ASC`
      );
      res.json({ users: result.rows });
    } catch (error: any) {
      console.error("[PlatformSettings] Error fetching feedback notification users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  },
);

router.get(
  "/feedback-notification-recipients",
  authenticateToken,
  requireSuperAdmin,
  async (_req, res) => {
    try {
      const result = await managementPool.query(
        `SELECT id, user_name, email, created_by
         FROM feedback_notification_recipients
         ORDER BY user_name ASC, email ASC`
      );
      res.json({ recipients: result.rows });
    } catch (error: any) {
      if (error?.code === "42P01") {
        return res.status(503).json({
          error: "Feedback notification recipients table not configured",
          message: "Please run management database migrations.",
        });
      }
      console.error("[PlatformSettings] Error fetching feedback notification recipients:", error);
      res.status(500).json({ error: "Failed to fetch recipients" });
    }
  },
);

router.post(
  "/feedback-notification-recipients",
  authenticateToken,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
      const parsed = createFeedbackRecipientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      let userName = "";
      let email = "";

      if (payload.source === "existing_user") {
        const userResult = await managementPool.query(
          `SELECT COALESCE(NULLIF(full_name, ''), email) AS user_name, email
           FROM coheus_users
           WHERE id = $1
             AND is_active = true
           LIMIT 1`,
          [payload.user_id]
        );
        if (userResult.rows.length === 0) {
          return res.status(404).json({ error: "Existing user not found or inactive" });
        }
        userName = String(userResult.rows[0].user_name || "").trim();
        email = normalizeEmail(String(userResult.rows[0].email || ""));
      } else {
        userName = String(payload.user_name || "").trim();
        email = normalizeEmail(String(payload.email || ""));
      }

      if (!userName || !email) {
        return res.status(400).json({ error: "user_name and email are required" });
      }

      const duplicateCheck = await managementPool.query(
        `SELECT 1
         FROM feedback_notification_recipients
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
         LIMIT 1`,
        [email]
      );
      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({ error: "Recipient with this email already exists" });
      }

      const insertResult = await managementPool.query(
        `INSERT INTO feedback_notification_recipients (user_name, email, created_by)
         VALUES ($1, $2, $3)
         RETURNING id, user_name, email, created_by`,
        [userName, email, req.userId]
      );
      res.status(201).json({ recipient: insertResult.rows[0] });
    } catch (error: any) {
      if (error?.code === "42P01") {
        return res.status(503).json({
          error: "Feedback notification recipients table not configured",
          message: "Please run management database migrations.",
        });
      }
      console.error("[PlatformSettings] Error creating feedback notification recipient:", error);
      res.status(500).json({ error: "Failed to create recipient" });
    }
  },
);

router.delete(
  "/feedback-notification-recipients/:id",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const parsed = recipientIdParamSchema.safeParse(req.params);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const result = await managementPool.query(
        `DELETE FROM feedback_notification_recipients
         WHERE id = $1
         RETURNING id`,
        [parsed.data.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Recipient not found" });
      }
      res.json({ ok: true });
    } catch (error: any) {
      if (error?.code === "42P01") {
        return res.status(503).json({
          error: "Feedback notification recipients table not configured",
          message: "Please run management database migrations.",
        });
      }
      console.error("[PlatformSettings] Error deleting feedback notification recipient:", error);
      res.status(500).json({ error: "Failed to remove recipient" });
    }
  },
);

/**
 * GET /api/admin/platform-settings
 * Get all platform settings (values masked for encrypted fields)
 */
router.get("/", authenticateToken, requirePlatformAdmin, async (req, res) => {
  try {
    // Check if table exists
    const tableExists = await platformSettingsTableExists();
    if (!tableExists) {
      return res.status(503).json({
        error: "Platform settings not configured",
        message: "Please run database migrations to enable platform settings",
      });
    }

    const settings = await getAllPlatformSettings();
    res.json({ settings });
  } catch (error: any) {
    console.error("[PlatformSettings] Error fetching settings:", error);
    res.status(500).json({ error: "Failed to fetch platform settings" });
  }
});

// ── Fallout Email Redirect Toggle ──────────────────────────────────────────
// NOTE: These specific routes must be registered BEFORE the generic /:key
// wildcard below, otherwise Express will match /fallout-redirect-toggle as :key.

const FALLOUT_REDIRECT_KEY = "fallout_email_redirect_enabled";

router.get(
  "/fallout-redirect-toggle",
  authenticateToken,
  requirePlatformAdmin,
  async (_req, res) => {
    try {
      const raw = await getPlatformSetting(FALLOUT_REDIRECT_KEY);
      res.json({ enabled: raw === "true" });
    } catch (error: any) {
      console.error("[PlatformSettings] Error fetching fallout redirect toggle:", error);
      res.status(500).json({ error: "Failed to fetch redirect toggle" });
    }
  },
);

router.put(
  "/fallout-redirect-toggle",
  authenticateToken,
  requirePlatformAdmin,
  async (req, res) => {
    try {
      const raw = req.body?.enabled;
      // Accept boolean true/false OR string "true"/"false" for robustness
      let enabled: boolean;
      if (typeof raw === "boolean") {
        enabled = raw;
      } else if (raw === "true" || raw === "false") {
        enabled = raw === "true";
      } else {
        console.error("[PlatformSettings] Invalid fallout-redirect-toggle body:", JSON.stringify(req.body));
        return res.status(400).json({ error: "enabled must be a boolean", received: typeof raw });
      }
      await setPlatformSetting(FALLOUT_REDIRECT_KEY, enabled ? "true" : "false");
      res.json({ enabled, message: `Fallout email redirect ${enabled ? "enabled" : "disabled"}` });
    } catch (error: any) {
      console.error("[PlatformSettings] Error updating fallout redirect toggle:", error);
      res.status(500).json({ error: "Failed to update redirect toggle" });
    }
  },
);

// ── Fallout Dev Allowed Emails ──────────────────────────────────────────────

const FALLOUT_DEV_EMAILS_KEY = "fallout_dev_allowed_emails";
const emailSchema = z.string().email();

function parseEmailList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e: unknown) => typeof e === "string") : [];
  } catch {
    return [];
  }
}

router.get(
  "/fallout-dev-emails",
  authenticateToken,
  requirePlatformAdmin,
  async (_req, res) => {
    try {
      const raw = await getPlatformSetting(FALLOUT_DEV_EMAILS_KEY);
      res.json({ emails: parseEmailList(raw) });
    } catch (error: any) {
      console.error("[PlatformSettings] Error fetching fallout dev emails:", error);
      res.status(500).json({ error: "Failed to fetch dev email list" });
    }
  },
);

router.post(
  "/fallout-dev-emails",
  authenticateToken,
  requirePlatformAdmin,
  async (req, res) => {
    try {
      const { email } = req.body ?? {};
      const validation = emailSchema.safeParse(email);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid email address" });
      }
      const normalizedEmail = validation.data.trim().toLowerCase();

      const raw = await getPlatformSetting(FALLOUT_DEV_EMAILS_KEY);
      const emails = parseEmailList(raw);
      if (emails.includes(normalizedEmail)) {
        return res.json({ emails, message: "Email already in list" });
      }
      emails.push(normalizedEmail);
      await setPlatformSetting(FALLOUT_DEV_EMAILS_KEY, JSON.stringify(emails));
      res.json({ emails, message: `Added ${normalizedEmail}` });
    } catch (error: any) {
      console.error("[PlatformSettings] Error adding fallout dev email:", error);
      res.status(500).json({ error: "Failed to add email" });
    }
  },
);

router.delete(
  "/fallout-dev-emails",
  authenticateToken,
  requirePlatformAdmin,
  async (req, res) => {
    try {
      const { email } = req.body ?? {};
      if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({ error: "Email is required" });
      }
      const normalizedEmail = email.trim().toLowerCase();

      const raw = await getPlatformSetting(FALLOUT_DEV_EMAILS_KEY);
      const emails = parseEmailList(raw).filter((e) => e !== normalizedEmail);
      await setPlatformSetting(FALLOUT_DEV_EMAILS_KEY, JSON.stringify(emails));
      res.json({ emails, message: `Removed ${normalizedEmail}` });
    } catch (error: any) {
      console.error("[PlatformSettings] Error removing fallout dev email:", error);
      res.status(500).json({ error: "Failed to remove email" });
    }
  },
);

/**
 * PUT /api/admin/platform-settings/:key
 * Update a specific platform setting
 */
router.put(
  "/:key",
  authenticateToken,
  requirePlatformAdmin,
  async (req, res) => {
    try {
      const key = req.params.key as string;

      // Validate request body
      const validation = updateSettingSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: validation.error.errors,
        });
      }

      const { value } = validation.data;

      // Validate the key is a known setting
      const allowedKeys = [
        "openai_api_key",
        "gemini_api_key",
        "anthropic_api_key",
        "default_embedding_model",
      ];
      if (!allowedKeys.includes(key)) {
        return res.status(400).json({
          error: "Invalid setting key",
          allowedKeys,
        });
      }

      const success = await setPlatformSetting(key, value);

      if (success) {
        res.json({
          message: `Setting "${key}" updated successfully`,
          key,
          hasValue: value !== null && value !== "",
        });
      } else {
        res.status(500).json({ error: "Failed to update setting" });
      }
    } catch (error: any) {
      console.error("[PlatformSettings] Error updating setting:", error);
      res.status(500).json({ error: "Failed to update platform setting" });
    }
  }
);

/**
 * GET /api/admin/platform-settings/:key/test
 * Test if an API key is valid (for OpenAI, etc.)
 */
router.get(
  "/:key/test",
  authenticateToken,
  requirePlatformAdmin,
  async (req, res) => {
    try {
      const key = req.params.key as string;

      if (key !== "openai_api_key" && key !== "gemini_api_key") {
        return res.status(400).json({
          error: "Key testing only supported for openai_api_key and gemini_api_key",
        });
      }

      const apiKey = await getPlatformSetting(key);

      if (!apiKey) {
        return res.json({
          valid: false,
          message: "API key not configured",
        });
      }

      // Test provider key with a simple models list request
      try {
        const response =
          key === "openai_api_key"
            ? await fetch("https://api.openai.com/v1/models", {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                },
              })
            : await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
                  apiKey
                )}`
              );

        if (response.ok) {
          res.json({
            valid: true,
            message: "API key is valid",
          });
        } else {
          const errorData = (await response.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          res.json({
            valid: false,
            message: errorData.error?.message || "API key is invalid",
          });
        }
      } catch (fetchError: any) {
        res.json({
          valid: false,
          message: `Connection error: ${fetchError.message}`,
        });
      }
    } catch (error: any) {
      console.error("[PlatformSettings] Error testing API key:", error);
      res.status(500).json({ error: "Failed to test API key" });
    }
  }
);

export default router;
