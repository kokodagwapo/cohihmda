/**
 * Platform Settings Routes
 * Manages platform-wide configuration including API keys
 *
 * Only accessible by super_admin and platform_admin roles
 */

import express from "express";
import { authenticateToken } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
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

// Validation schemas
const updateSettingSchema = z.object({
  value: z.string().nullable(),
});

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
      const { key } = req.params;

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
      const { key } = req.params;

      if (key !== "openai_api_key") {
        return res.status(400).json({
          error: "Key testing only supported for openai_api_key",
        });
      }

      const apiKey = await getPlatformSetting(key);

      if (!apiKey) {
        return res.json({
          valid: false,
          message: "API key not configured",
        });
      }

      // Test OpenAI key with a simple models list request
      try {
        const response = await fetch("https://api.openai.com/v1/models", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (response.ok) {
          res.json({
            valid: true,
            message: "API key is valid",
          });
        } else {
          const errorData = await response.json().catch(() => ({}));
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
