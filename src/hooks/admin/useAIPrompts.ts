/**
 * useAIPrompts Hook
 *
 * React hook for managing AI prompt configurations in the admin panel.
 * Provides CRUD operations, version history, and export/import functionality.
 */

import { useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// Types
// ============================================================================

export interface PromptConfig {
  id: string;
  name: string;
  description: string;
  category: string;
  system_prompt: string;
  user_prompt_template?: string;
  model: string;
  temperature: number;
  max_tokens: number;
  json_mode: boolean;
  available_variables: string[];
  is_active: boolean;
  updated_by?: string;
  updated_at: string;
  created_at: string;
  current_version: number;
}

export interface PromptVersion {
  id: string;
  prompt_id: string;
  version: number;
  system_prompt: string;
  user_prompt_template?: string;
  model: string;
  temperature: number;
  max_tokens: number;
  json_mode: boolean;
  change_summary?: string;
  created_by?: string;
  created_at: string;
}

export interface PromptUpdateInput {
  system_prompt?: string;
  user_prompt_template?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  json_mode?: boolean;
  change_summary?: string;
}

export interface PromptExport {
  version: string;
  exportedAt: string;
  exportedBy?: string;
  prompts: PromptConfig[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  details: {
    id: string;
    status: "imported" | "skipped" | "error";
    reason?: string;
  }[];
}

export interface TestResult {
  prompt_id: string;
  built_system_prompt: string;
  built_user_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
  json_mode: boolean;
  available_variables: string[];
  variables_used: Record<string, any>;
  system_prompt_chars: number;
  user_prompt_chars: number;
  estimated_tokens: number;
}

// ============================================================================
// Hook
// ============================================================================

export const useAIPrompts = () => {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // State
  const [prompts, setPrompts] = useState<PromptConfig[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptConfig | null>(
    null
  );
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ============================================================================
  // Fetch Operations
  // ============================================================================

  /**
   * Load all prompts, optionally filtered by category
   */
  const loadPrompts = useCallback(async (category?: string) => {
    try {
      setLoading(true);
      setError(null);

      const url = category
        ? `/api/admin/ai-prompts?category=${encodeURIComponent(category)}`
        : "/api/admin/ai-prompts";

      const response = await api.request<{
        prompts: PromptConfig[];
        total: number;
      }>(url);
      setPrompts(response.prompts || []);
    } catch (error: any) {
      console.error("[useAIPrompts] Error loading prompts:", error);
      setError(error.message || "Failed to load prompts");
      toastRef.current({
        title: "Error",
        description: error.message || "Failed to load prompts",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Load available categories
   */
  const loadCategories = useCallback(async () => {
    try {
      const response = await api.request<{ categories: string[] }>(
        "/api/admin/ai-prompts/categories"
      );
      setCategories(response.categories || []);
    } catch (error: any) {
      console.error("[useAIPrompts] Error loading categories:", error);
    }
  }, []);

  /**
   * Get a single prompt by ID
   */
  const getPrompt = useCallback(
    async (id: string): Promise<PromptConfig | null> => {
      try {
        setLoading(true);
        const prompt = await api.request<PromptConfig>(
          `/api/admin/ai-prompts/${id}`
        );
        setSelectedPrompt(prompt);
        return prompt;
      } catch (error: any) {
        console.error(`[useAIPrompts] Error loading prompt ${id}:`, error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to load prompt",
          variant: "destructive",
        });
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Get version history for a prompt
   */
  const loadVersionHistory = useCallback(async (id: string) => {
    try {
      const response = await api.request<{
        versions: PromptVersion[];
        total: number;
      }>(`/api/admin/ai-prompts/${id}/versions`);
      setVersions(response.versions || []);
      return response.versions;
    } catch (error: any) {
      console.error(`[useAIPrompts] Error loading versions for ${id}:`, error);
      toastRef.current({
        title: "Error",
        description: error.message || "Failed to load version history",
        variant: "destructive",
      });
      return [];
    }
  }, []);

  // ============================================================================
  // Update Operations
  // ============================================================================

  /**
   * Update a prompt configuration
   */
  const updatePrompt = useCallback(
    async (
      id: string,
      updates: PromptUpdateInput
    ): Promise<PromptConfig | null> => {
      try {
        setSaving(true);

        const updated = await api.request<PromptConfig>(
          `/api/admin/ai-prompts/${id}`,
          {
            method: "PUT",
            body: JSON.stringify(updates),
          }
        );

        // Update local state
        setPrompts((prev) => prev.map((p) => (p.id === id ? updated : p)));
        setSelectedPrompt(updated);

        toastRef.current({
          title: "Success",
          description: "Prompt updated successfully",
        });

        return updated;
      } catch (error: any) {
        console.error(`[useAIPrompts] Error updating prompt ${id}:`, error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to update prompt",
          variant: "destructive",
        });
        return null;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  /**
   * Reset a prompt to its default configuration
   */
  const resetPrompt = useCallback(
    async (id: string): Promise<PromptConfig | null> => {
      try {
        setSaving(true);

        const response = await api.request<{
          success: boolean;
          prompt: PromptConfig;
        }>(`/api/admin/ai-prompts/${id}/reset`, { method: "POST" });

        if (response.success && response.prompt) {
          setPrompts((prev) =>
            prev.map((p) => (p.id === id ? response.prompt : p))
          );
          setSelectedPrompt(response.prompt);

          toastRef.current({
            title: "Success",
            description: "Prompt reset to default configuration",
          });

          return response.prompt;
        }

        return null;
      } catch (error: any) {
        console.error(`[useAIPrompts] Error resetting prompt ${id}:`, error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to reset prompt",
          variant: "destructive",
        });
        return null;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  /**
   * Restore a specific version
   */
  const restoreVersion = useCallback(
    async (id: string, version: number): Promise<PromptConfig | null> => {
      try {
        setSaving(true);

        const response = await api.request<{
          success: boolean;
          prompt: PromptConfig;
        }>(`/api/admin/ai-prompts/${id}/restore/${version}`, {
          method: "POST",
        });

        if (response.success && response.prompt) {
          setPrompts((prev) =>
            prev.map((p) => (p.id === id ? response.prompt : p))
          );
          setSelectedPrompt(response.prompt);

          toastRef.current({
            title: "Success",
            description: `Prompt restored to version ${version}`,
          });

          return response.prompt;
        }

        return null;
      } catch (error: any) {
        console.error(
          `[useAIPrompts] Error restoring version ${version} for ${id}:`,
          error
        );
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to restore version",
          variant: "destructive",
        });
        return null;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // ============================================================================
  // Test & Preview
  // ============================================================================

  /**
   * Test a prompt with sample variables
   */
  const testPrompt = useCallback(
    async (
      id: string,
      variables?: Record<string, any>,
      testInput?: string
    ): Promise<TestResult | null> => {
      try {
        const result = await api.request<TestResult>(
          `/api/admin/ai-prompts/${id}/test`,
          {
            method: "POST",
            body: JSON.stringify({ variables, testInput }),
          }
        );

        return result;
      } catch (error: any) {
        console.error(`[useAIPrompts] Error testing prompt ${id}:`, error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to test prompt",
          variant: "destructive",
        });
        return null;
      }
    },
    []
  );

  // ============================================================================
  // Export/Import
  // ============================================================================

  /**
   * Export all prompts as JSON
   */
  const exportPrompts = useCallback(async (): Promise<PromptExport | null> => {
    try {
      setLoading(true);

      const exportData = await api.request<PromptExport>(
        "/api/admin/ai-prompts/export"
      );

      // Trigger download
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-prompts-export-${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toastRef.current({
        title: "Success",
        description: `Exported ${exportData.prompts.length} prompts`,
      });

      return exportData;
    } catch (error: any) {
      console.error("[useAIPrompts] Error exporting prompts:", error);
      toastRef.current({
        title: "Error",
        description: error.message || "Failed to export prompts",
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Import prompts from JSON
   */
  const importPrompts = useCallback(
    async (
      data: PromptExport,
      options?: { overwrite?: boolean; selectedIds?: string[] }
    ): Promise<ImportResult | null> => {
      try {
        setLoading(true);

        const result = await api.request<ImportResult>(
          "/api/admin/ai-prompts/import",
          {
            method: "POST",
            body: JSON.stringify({
              data,
              overwrite: options?.overwrite,
              selectedIds: options?.selectedIds,
            }),
          }
        );

        // Reload prompts after import
        await loadPrompts();

        toastRef.current({
          title: "Import Complete",
          description: `Imported: ${result.imported}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`,
        });

        return result;
      } catch (error: any) {
        console.error("[useAIPrompts] Error importing prompts:", error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to import prompts",
          variant: "destructive",
        });
        return null;
      } finally {
        setLoading(false);
      }
    },
    [loadPrompts]
  );

  /**
   * Seed default prompts (useful after first migration)
   */
  const seedDefaults = useCallback(async (): Promise<number> => {
    try {
      setLoading(true);

      const response = await api.request<{
        success: boolean;
        seeded: number;
        message: string;
      }>("/api/admin/ai-prompts/seed", { method: "POST" });

      if (response.success) {
        await loadPrompts();

        toastRef.current({
          title: "Success",
          description: response.message,
        });

        return response.seeded;
      }

      return 0;
    } catch (error: any) {
      console.error("[useAIPrompts] Error seeding defaults:", error);
      toastRef.current({
        title: "Error",
        description: error.message || "Failed to seed defaults",
        variant: "destructive",
      });
      return 0;
    } finally {
      setLoading(false);
    }
  }, [loadPrompts]);

  // ============================================================================
  // Return
  // ============================================================================

  return {
    // State
    prompts,
    categories,
    selectedPrompt,
    versions,
    loading,
    saving,
    error,

    // Fetch
    loadPrompts,
    loadCategories,
    getPrompt,
    loadVersionHistory,

    // Update
    updatePrompt,
    resetPrompt,
    restoreVersion,
    setSelectedPrompt,

    // Test
    testPrompt,

    // Export/Import
    exportPrompts,
    importPrompts,
    seedDefaults,
  };
};

export default useAIPrompts;
