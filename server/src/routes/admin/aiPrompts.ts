/**
 * AI Prompts Admin Routes
 *
 * API endpoints for managing AI prompt configurations.
 * Platform admin only - manages global defaults that all tenants inherit.
 */

import { Router, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import promptConfigService, {
  PromptUpdateInput,
  PromptExport,
} from "../../services/promptConfigService.js";

const router = Router();

// Require platform admin for all routes
const requirePlatformAdmin = requireRole("super_admin", "platform_admin");

// ============================================================================
// GET /api/admin/ai-prompts - List all prompts
// ============================================================================
router.get(
  "/",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { category } = req.query;

      const prompts = await promptConfigService.getAllPromptConfigs(
        category as string | undefined
      );

      res.json({
        prompts,
        total: prompts.length,
      });
    } catch (error: any) {
      console.error("[AI Prompts] Error listing prompts:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to list prompts" });
    }
  }
);

// ============================================================================
// GET /api/admin/ai-prompts/categories - List all categories
// ============================================================================
router.get(
  "/categories",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const categories = await promptConfigService.getCategories();
      res.json({ categories });
    } catch (error: any) {
      console.error("[AI Prompts] Error listing categories:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to list categories" });
    }
  }
);

// ============================================================================
// GET /api/admin/ai-prompts/export - Export all prompts as JSON
// ============================================================================
router.get(
  "/export",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = { email: req.userEmail, id: req.userId };
      const exportData = await promptConfigService.exportAllPrompts(
        user?.email || user?.id
      );

      // Set headers for file download
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ai-prompts-export-${
          new Date().toISOString().split("T")[0]
        }.json"`
      );

      res.json(exportData);
    } catch (error: any) {
      console.error("[AI Prompts] Error exporting prompts:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to export prompts" });
    }
  }
);

// ============================================================================
// POST /api/admin/ai-prompts/import - Import prompts from JSON
// ============================================================================
router.post(
  "/import",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { data, overwrite, selectedIds } = req.body;

      if (!data || !data.prompts) {
        return res.status(400).json({ error: "Invalid import data format" });
      }

      const user = { id: req.userId };
      const result = await promptConfigService.importPrompts(
        data as PromptExport,
        user?.id,
        { overwrite: !!overwrite, selectedIds }
      );

      res.json(result);
    } catch (error: any) {
      console.error("[AI Prompts] Error importing prompts:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to import prompts" });
    }
  }
);

// ============================================================================
// POST /api/admin/ai-prompts/seed - Seed default prompts
// ============================================================================
router.post(
  "/seed",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const seeded = await promptConfigService.seedDefaultPrompts();
      res.json({
        success: true,
        seeded,
        message: `Seeded ${seeded} default prompt configurations`,
      });
    } catch (error: any) {
      console.error("[AI Prompts] Error seeding prompts:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to seed prompts" });
    }
  }
);

// ============================================================================
// GET /api/admin/ai-prompts/:id - Get single prompt
// ============================================================================
router.get(
  "/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const prompt = await promptConfigService.getPromptConfig(id);
      res.json(prompt);
    } catch (error: any) {
      console.error(
        `[AI Prompts] Error getting prompt ${req.params.id}:`,
        error
      );

      if (error.message?.includes("not found")) {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: error.message || "Failed to get prompt" });
    }
  }
);

// ============================================================================
// PUT /api/admin/ai-prompts/:id - Update prompt
// ============================================================================
router.put(
  "/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const updates: PromptUpdateInput = req.body;

      // Validate required fields
      if (
        updates.system_prompt !== undefined &&
        !updates.system_prompt.trim()
      ) {
        return res.status(400).json({ error: "System prompt cannot be empty" });
      }

      if (
        updates.temperature !== undefined &&
        (updates.temperature < 0 || updates.temperature > 2)
      ) {
        return res
          .status(400)
          .json({ error: "Temperature must be between 0 and 2" });
      }

      if (
        updates.max_tokens !== undefined &&
        (updates.max_tokens < 1 || updates.max_tokens > 128000)
      ) {
        return res
          .status(400)
          .json({ error: "Max tokens must be between 1 and 128000" });
      }

      const updated = await promptConfigService.updatePromptConfig(
        id,
        updates,
        req.userId
      );

      res.json(updated);
    } catch (error: any) {
      console.error(
        `[AI Prompts] Error updating prompt ${req.params.id}:`,
        error
      );

      if (error.message?.includes("not found")) {
        return res.status(404).json({ error: error.message });
      }

      res
        .status(500)
        .json({ error: error.message || "Failed to update prompt" });
    }
  }
);

// ============================================================================
// POST /api/admin/ai-prompts/:id/reset - Reset to default
// ============================================================================
router.post(
  "/:id/reset",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;

      const reset = await promptConfigService.resetToDefault(id, req.userId);

      res.json({
        success: true,
        prompt: reset,
        message: "Prompt reset to default configuration",
      });
    } catch (error: any) {
      console.error(
        `[AI Prompts] Error resetting prompt ${req.params.id}:`,
        error
      );

      if (
        error.message?.includes("not found") ||
        error.message?.includes("No default")
      ) {
        return res.status(404).json({ error: error.message });
      }

      res
        .status(500)
        .json({ error: error.message || "Failed to reset prompt" });
    }
  }
);

// ============================================================================
// GET /api/admin/ai-prompts/:id/versions - Get version history
// ============================================================================
router.get(
  "/:id/versions",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const versions = await promptConfigService.getPromptVersionHistory(id);

      res.json({
        prompt_id: id,
        versions,
        total: versions.length,
      });
    } catch (error: any) {
      console.error(
        `[AI Prompts] Error getting versions for ${req.params.id}:`,
        error
      );
      res
        .status(500)
        .json({ error: error.message || "Failed to get version history" });
    }
  }
);

// ============================================================================
// POST /api/admin/ai-prompts/:id/restore/:version - Restore a specific version
// ============================================================================
router.post(
  "/:id/restore/:version",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const version = req.params.version as string;

      const restored = await promptConfigService.restoreVersion(
        id,
        parseInt(version, 10),
        req.userId
      );

      res.json({
        success: true,
        prompt: restored,
        message: `Prompt restored to version ${version}`,
      });
    } catch (error: any) {
      console.error(
        `[AI Prompts] Error restoring version ${req.params.version} for ${req.params.id}:`,
        error
      );

      if (error.message?.includes("not found")) {
        return res.status(404).json({ error: error.message });
      }

      res
        .status(500)
        .json({ error: error.message || "Failed to restore version" });
    }
  }
);

// ============================================================================
// POST /api/admin/ai-prompts/:id/test - Test a prompt with sample input
// ============================================================================
router.post(
  "/:id/test",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const { variables, testInput } = req.body;

      // Get the prompt config
      const prompt = await promptConfigService.getPromptConfig(id);

      // Build the prompt with variables
      let builtSystemPrompt = prompt.system_prompt;
      let builtUserPrompt = prompt.user_prompt_template || "";

      if (variables && typeof variables === "object") {
        builtSystemPrompt = promptConfigService.buildPrompt(
          prompt.system_prompt,
          variables
        );
        if (prompt.user_prompt_template) {
          builtUserPrompt = promptConfigService.buildPrompt(
            prompt.user_prompt_template,
            variables
          );
        }
      }

      // Return the built prompts for preview (without actually calling the API)
      // Actual API testing would require the OpenAI key and could be expensive
      res.json({
        prompt_id: id,
        built_system_prompt: builtSystemPrompt,
        built_user_prompt: builtUserPrompt,
        model: prompt.model,
        temperature: prompt.temperature,
        max_tokens: prompt.max_tokens,
        json_mode: prompt.json_mode,
        available_variables: prompt.available_variables,
        variables_used: variables || {},
        test_input: testInput,
        // Character counts for estimation
        system_prompt_chars: builtSystemPrompt.length,
        user_prompt_chars: builtUserPrompt.length,
        estimated_tokens: Math.ceil(
          (builtSystemPrompt.length + builtUserPrompt.length) / 4
        ),
      });
    } catch (error: any) {
      console.error(
        `[AI Prompts] Error testing prompt ${req.params.id}:`,
        error
      );
      res.status(500).json({ error: error.message || "Failed to test prompt" });
    }
  }
);

export default router;
