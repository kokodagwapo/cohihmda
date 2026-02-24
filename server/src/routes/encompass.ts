/**
 * Encompass API Routes
 * REST API endpoints for Encompass integration
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { EncompassApiService } from "../services/encompassApiService.js";
import { EncompassEtlService } from "../services/etl/encompassEtlService.js";
import {
  getFieldSwaps,
  saveFieldSwap,
  deleteFieldSwap,
  getAllCoheusAliases,
  getDefaultFieldId,
} from "../services/encompassFieldMapper.js";
import {
  getFieldCategoryInfo,
  getAllCategories,
  inferFieldDataType,
  FIELD_CATEGORIES,
  type FieldCategory,
  type FieldDataType,
} from "../config/defaultEncompassFieldMappings.js";
import { EncompassFieldDiscoveryService } from "../services/encompassFieldDiscoveryService.js";
import {
  processEncompassWebhookPayload,
  EncompassWebhookService,
} from "../services/encompassWebhookService.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { z } from "zod";
import { createJob, updateProgress, completeJob, failJob } from "../services/jobManager.js";

const router = Router();
// apiService and etlService will be created per-request with tenant pool

/**
 * Helper to get los_connection_id from request
 * Tenant context must be attached via middleware
 */
function getConnectionInfo(req: AuthRequest): {
  tenantId: string;
  losConnectionId: string;
  tenantPool: any;
} {
  const tenantContext = getTenantContext(req);

  // Get los_connection_id from params or body
  const losConnectionId =
    req.params.connectionId ||
    req.body.losConnectionId ||
    req.query.connectionId;

  if (!losConnectionId) {
    throw new Error("LOS connection ID is required");
  }

  // Verify connection belongs to tenant (check management DB)
  // Note: This will be async in actual implementation
  // For now, we'll verify in the route handlers

  return {
    tenantId: tenantContext.tenantId,
    losConnectionId: losConnectionId as string,
    tenantPool: tenantContext.tenantPool,
  };
}

/**
 * POST /api/encompass/sync
 * Trigger full or incremental sync
 */
router.post(
  "/sync",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        losConnectionId: z.string().uuid(),
        fullSync: z.boolean().optional().default(false),
        modifiedFrom: z.string().datetime().optional(),
        limit: z.number().int().positive().optional(),
        fields: z.array(z.string()).optional(),
        folderName: z.string().optional(),
        testMode: z.boolean().optional().default(false),
      });

      const body = schema.parse(req.body);
      const { tenantId, losConnectionId, tenantPool } = getConnectionInfo(req);

      const connectionResult = await tenantPool.query(
        "SELECT id FROM public.los_connections WHERE id = $1 AND is_active = true",
        [losConnectionId]
      );

      if (connectionResult.rows.length === 0) {
        return res.status(404).json({ error: "LOS connection not found" });
      }

      if (body.losConnectionId !== losConnectionId) {
        return res.status(400).json({ error: "Connection ID mismatch" });
      }

      const job = createJob("encompass-sync", req.userId!, tenantId);
      res.status(202).json({ jobId: job.id, status: "processing" });

      setImmediate(async () => {
        try {
          updateProgress(job.id, 10, "Initializing Encompass sync...");

          const apiService = new EncompassApiService(tenantPool);
          const etlService = new EncompassEtlService(tenantPool);

          let syncLimit = body.limit;
          if (body.testMode && !syncLimit) {
            syncLimit = parseInt(process.env.ENCOMPASS_TEST_MODE_LIMIT || "50", 10);
          }

          updateProgress(job.id, 20, "Syncing loans from Encompass...");
          const result = await etlService.syncLoans(tenantId, losConnectionId, {
            fullSync: body.fullSync,
            modifiedFrom: body.modifiedFrom
              ? new Date(body.modifiedFrom)
              : undefined,
            limit: syncLimit,
            fields: body.fields,
            folderName: body.folderName,
          });

          completeJob(job.id, result);
        } catch (error: any) {
          console.error("Error syncing Encompass loans:", error);
          failJob(job.id, error.message || "Failed to sync loans");
        }
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid request data", details: error.errors });
      }
      console.error("Error syncing Encompass loans:", error);
      res.status(500).json({ error: error.message || "Failed to sync loans" });
    }
  }
);

/**
 * POST /api/encompass/sync-incremental
 * Trigger incremental sync (since last sync)
 * TODO: Update to use tenant-specific databases
 */
router.post(
  "/sync-incremental",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      return res
        .status(501)
        .json({
          error:
            "This endpoint needs to be updated for multi-tenant architecture",
        });
    } catch (error: any) {
      console.error("Error syncing Encompass loans:", error);
      res.status(500).json({ error: error.message || "Failed to sync loans" });
    }
  }
);

/**
 * GET /api/encompass/sync-status/:connectionId
 * Get sync status for a connection
 * TODO: Update to use tenant-specific databases
 */
router.get(
  "/sync-status/:connectionId",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      return res
        .status(501)
        .json({
          error:
            "This endpoint needs to be updated for multi-tenant architecture",
        });
    } catch (error: any) {
      console.error("Error getting sync status:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to get sync status" });
    }
  }
);

/**
 * GET /api/encompass/test-connection/:connectionId
 * Test Encompass connection
 * TODO: Update to use tenant-specific databases
 */
router.get(
  "/test-connection/:connectionId",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      return res
        .status(501)
        .json({
          error:
            "This endpoint needs to be updated for multi-tenant architecture",
        });
    } catch (error: any) {
      console.error("Error testing connection:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Connection test failed",
      });
    }
  }
);

/**
 * GET /api/encompass/fields/:connectionId
 * Get available fields from Encompass RDB
 */
router.get(
  "/fields/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);
      const losConnectionId = req.params.connectionId as string;

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get API server URL from connection
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [losConnectionId]
      );
      const apiServer =
        connectionResult.rows[0]?.encompass_api_server ||
        "https://api.elliemae.com";

      console.log("[Fields GET] Using API server:", apiServer);

      const apiService = new EncompassApiService(tenantPool, apiServer);

      console.log("[Fields GET] Fetching canonical (RDB) fields from Encompass...");

      try {
        const canonicalResponse = await apiService.getCanonicalFields(
          tenantId,
          losConnectionId
        );
        const rdbFields = canonicalResponse.data.map((cf) => ({
          fieldID: cf.canonicalName,
          description: cf.displayName,
          fieldType: 0,
          format: undefined,
          dataType: cf.dataType,
        }));
        console.log(
          "[Fields GET] Successfully fetched canonical RDB fields:",
          rdbFields.length
        );

        res.json({
          rdbFields,
          concurrency: canonicalResponse.concurrency,
        });
      } catch (apiError: any) {
        console.error(
          "[Fields GET] Error fetching canonical RDB fields from Encompass:",
          {
            message: apiError.message,
            status: apiError.response?.status,
            statusText: apiError.response?.statusText,
            data: apiError.response?.data,
          }
        );

        if (apiError.response?.status === 401) {
          console.warn(
            "[Fields GET] Authentication failed - returning empty RDB fields."
          );
          return res.json({
            rdbFields: [],
            concurrency: undefined,
            warning:
              "Unable to authenticate with Encompass API. Field validation will be disabled.",
          });
        }

        console.error(
          "[Fields GET] Non-auth error fetching canonical RDB fields:",
          apiError.message
        );
        return res.json({
          rdbFields: [],
          concurrency: undefined,
          warning: `Unable to fetch RDB fields: ${apiError.message}`,
        });
      }
    } catch (error: any) {
      console.error("[Fields GET] Error getting fields:", {
        message: error.message,
        stack: error.stack,
      });
      // Return empty array instead of error to allow UI to work
      res.json({
        rdbFields: [],
        concurrency: undefined,
        error: error.message || "Failed to get fields",
      });
    }
  }
);

/**
 * GET /api/encompass/folders/:connectionId
 * Get available loan folders from Encompass
 */
router.get(
  "/folders/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);
      const losConnectionId = req.params.connectionId as string;

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get API server URL from connection
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [losConnectionId]
      );
      const apiServer =
        connectionResult.rows[0]?.encompass_api_server ||
        "https://api.elliemae.com";

      console.log("[Folders GET] Using API server:", apiServer);

      // Create API service with tenant pool and API server
      const apiService = new EncompassApiService(tenantPool, apiServer);

      console.log("[Folders GET] Fetching loan folders from Encompass...");

      try {
        const foldersResponse = await apiService.getLoanFolders(
          tenantId,
          losConnectionId
        );
        console.log(
          "[Folders GET] Successfully fetched folders:",
          foldersResponse.data.length
        );

        res.json({
          folders: foldersResponse.data,
          concurrency: foldersResponse.concurrency,
        });
      } catch (apiError: any) {
        console.error("[Folders GET] Error fetching folders from Encompass:", {
          message: apiError.message,
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          data: apiError.response?.data,
          stack: apiError.stack,
        });

        // Check if it's an authentication error
        if (apiError.response?.status === 401) {
          console.warn(
            "[Folders GET] Authentication failed - returning empty folders."
          );
          return res.json({
            folders: [],
            concurrency: undefined,
            warning:
              "Unable to authenticate with Encompass API. Folders cannot be loaded.",
          });
        }

        // For other errors, return empty array
        return res.json({
          folders: [],
          concurrency: undefined,
          error: apiError.message || "Failed to fetch folders",
        });
      }
    } catch (error: any) {
      console.error("[Folders GET] Error getting folders:", {
        message: error.message,
        stack: error.stack,
      });
      res.json({
        folders: [],
        concurrency: undefined,
        error: error.message || "Failed to get folders",
      });
    }
  }
);

/**
 * GET /api/encompass/field-swaps/:connectionId
 * Get field swaps for a connection
 */
router.get(
  "/field-swaps/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const losConnectionId = req.params.connectionId as string;

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }
      const swaps = await getFieldSwaps(tenantPool, losConnectionId);
      const swapsArray = Array.from(swaps.entries()).map(
        ([alias, fieldId]) => ({
          coheusAlias: alias,
          encompassFieldId: fieldId,
        })
      );

      res.json({ swaps: swapsArray });
    } catch (error: any) {
      console.error("[Field Swaps GET] Error getting field swaps:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to get field swaps" });
    }
  }
);

/**
 * POST /api/encompass/field-swaps
 * Save field swap mapping
 */
router.post(
  "/field-swaps",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        losConnectionId: z.string().uuid(),
        coheusAlias: z.string(),
        encompassFieldId: z.string(),
        swapType: z
          .enum(["Standard", "Profitability"])
          .optional()
          .default("Standard"),
      });

      const body = schema.parse(req.body);
      const { tenantPool } = getTenantContext(req);

      await saveFieldSwap(
        tenantPool,
        body.losConnectionId,
        body.coheusAlias,
        body.encompassFieldId,
        body.swapType
      );

      res.json({ success: true, message: "Field swap saved successfully" });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid request data", details: error.errors });
      }
      console.error("Error saving field swap:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to save field swap" });
    }
  }
);

/**
 * DELETE /api/encompass/field-swaps/:connectionId
 * Delete field swap mapping
 */
router.delete(
  "/field-swaps/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        coheusAlias: z.string(),
        swapType: z.enum(["Standard", "Profitability"]).optional(),
      });

      const body = schema.parse(req.body);
      const { tenantPool } = getTenantContext(req);
      const losConnectionId = req.params.connectionId as string;

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      await deleteFieldSwap(
        tenantPool,
        losConnectionId,
        body.coheusAlias,
        body.swapType
      );

      res.json({ success: true, message: "Field swap deleted successfully" });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid request data", details: error.errors });
      }
      console.error("Error deleting field swap:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to delete field swap" });
    }
  }
);

/**
 * GET /api/encompass/field-mappings
 * Get all available Coheus aliases with default Encompass field IDs
 * Enhanced with category and field type information
 */
router.get(
  "/field-mappings",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      console.log("[Field Mappings GET] Request received:", {
        userId: req.userId,
      });
      const aliases = getAllCoheusAliases();
      console.log("[Field Mappings GET] Found aliases:", aliases.length);

      const mappings = aliases.map((alias) => {
        const fieldId = getDefaultFieldId(alias);
        const categoryInfo = getFieldCategoryInfo(alias);
        const fieldType = inferFieldDataType(alias, fieldId || "");

        return {
          coheusAlias: alias,
          defaultEncompassFieldId: fieldId,
          postgresqlColumn: alias
            .replace(/\s+/g, "_")
            .replace(/[^a-zA-Z0-9_]/g, "")
            .replace(/_+/g, "_")
            .toLowerCase()
            .replace(/^_|_$/g, ""),
          category: categoryInfo.category,
          categoryLabel: categoryInfo.label,
          categoryOrder: categoryInfo.order,
          fieldType,
        };
      });

      // Also return categories for UI
      const categories = getAllCategories();

      res.json({
        mappings,
        categories,
      });
    } catch (error: any) {
      console.error("Error getting field mappings:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to get field mappings" });
    }
  }
);

// ============================================================================
// Field Discovery Routes (Auto-Mapping)
// ============================================================================

/**
 * GET /api/encompass/discovery/fields/:connectionId
 * Discover all available fields from Encompass (RDB + Custom)
 */
router.get(
  "/discovery/fields/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);
      const losConnectionId = req.params.connectionId as string;
      const useCache = req.query.use_cache !== "false";

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get API server URL from connection
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [losConnectionId]
      );
      const apiServer =
        connectionResult.rows[0]?.encompass_api_server ||
        "https://api.elliemae.com";

      // Create discovery service
      const discoveryService = new EncompassFieldDiscoveryService(
        tenantPool,
        apiServer
      );

      console.log("[Discovery Fields] Discovering fields...");
      const result = await discoveryService.discoverAvailableFields(
        tenantId,
        losConnectionId,
        useCache
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error("[Discovery Fields] Error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to discover fields" });
    }
  }
);

/**
 * POST /api/encompass/discovery/analyze/:connectionId
 * Analyze field population from sample loans
 */
router.post(
  "/discovery/analyze/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);
      const losConnectionId = req.params.connectionId as string;

      const schema = z.object({
        sampleSize: z.number().int().min(10).max(200).optional().default(50),
        fieldsToAnalyze: z.array(z.string()).optional(),
      });

      const body = schema.parse(req.body || {});

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get API server URL from connection
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [losConnectionId]
      );
      const apiServer =
        connectionResult.rows[0]?.encompass_api_server ||
        "https://api.elliemae.com";

      // Create discovery service
      const discoveryService = new EncompassFieldDiscoveryService(
        tenantPool,
        apiServer
      );

      console.log(
        `[Discovery Analyze] Analyzing ${body.sampleSize} sample loans...`
      );
      const result = await discoveryService.analyzeFieldPopulation(
        tenantId,
        losConnectionId,
        {
          sampleSize: body.sampleSize,
          fieldsToAnalyze: body.fieldsToAnalyze,
        }
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid request data", details: error.errors });
      }
      console.error("[Discovery Analyze] Error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to analyze fields" });
    }
  }
);

/**
 * GET /api/encompass/discovery/suggestions/:connectionId
 * Get auto-mapping suggestions with confidence scores
 */
router.get(
  "/discovery/suggestions/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);
      const losConnectionId = req.params.connectionId as string;
      const runAnalysis = req.query.run_analysis !== "false";
      const sampleSize = parseInt(req.query.sample_size as string) || 50;

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get API server URL from connection
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [losConnectionId]
      );
      const apiServer =
        connectionResult.rows[0]?.encompass_api_server ||
        "https://api.elliemae.com";

      // Create discovery service
      const discoveryService = new EncompassFieldDiscoveryService(
        tenantPool,
        apiServer
      );

      console.log("[Discovery Suggestions] Generating suggestions...");
      const result = await discoveryService.generateMappingSuggestions(
        tenantId,
        losConnectionId,
        {
          runAnalysis,
          sampleSize,
        }
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error("[Discovery Suggestions] Error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to generate suggestions" });
    }
  }
);

/**
 * POST /api/encompass/discovery/apply/:connectionId
 * Apply selected mapping suggestions as field swaps
 */
router.post(
  "/webhooks/:tenantId/:connectionId",
  async (req, res) => {
    try {
      const tenantId = req.params.tenantId as string;
      const connectionId = req.params.connectionId as string;
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

      const rawBody =
        (req as any).rawBody || JSON.stringify(req.body || {});
      const signature =
        (req.headers["x-elli-signature"] as string | undefined) ||
        (req.headers["elli-signature"] as string | undefined);
      const result = await processEncompassWebhookPayload({
        tenantPool,
        tenantId,
        connectionId,
        rawBody,
        signature,
        payload: req.body || {},
      });
      return res.status(result.statusCode).json(result.body);
    } catch (error: any) {
      console.error("[EncompassWebhook] Error handling webhook:", error);
      return res.status(500).json({
        error: error.message || "Failed to process webhook payload",
      });
    }
  },
);

router.get(
  "/webhook-config/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const connectionId = req.params.connectionId as string;
      const svc = new EncompassWebhookService(tenantPool);
      const config = await svc.getConnectionWebhookConfig(connectionId);
      if (!config) return res.status(404).json({ error: "Connection not found" });
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch webhook config" });
    }
  },
);

router.patch(
  "/webhook-config/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        webhook_enabled: z.boolean().optional(),
        webhook_mode: z.enum(["priority_only", "all_changes"]).optional(),
        webhook_priority_field_ids: z.array(z.string()).optional(),
        webhook_priority_field_limit: z.number().int().min(1).max(50).optional(),
        webhook_reconciliation_enabled: z.boolean().optional(),
      });
      const body = schema.parse(req.body || {});
      const { tenantPool } = getTenantContext(req);
      const connectionId = req.params.connectionId as string;

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;
      for (const [key, value] of Object.entries(body)) {
        updates.push(`${key} = $${idx++}`);
        values.push(value);
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: "No webhook config fields provided" });
      }
      values.push(connectionId);
      await tenantPool.query(
        `UPDATE public.los_connections
         SET ${updates.join(", ")}, updated_at = NOW()
         WHERE id = $${idx}`,
        values,
      );
      const svc = new EncompassWebhookService(tenantPool);
      const updated = await svc.getConnectionWebhookConfig(connectionId);
      res.json({ success: true, config: updated });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to update webhook config" });
    }
  },
);

router.get(
  "/webhook-stats/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const connectionId = req.params.connectionId as string;
      const [queueStats, eventStats] = await Promise.all([
        tenantPool.query(
          `SELECT status, COUNT(*)::int AS count
           FROM public.encompass_webhook_queue
           WHERE los_connection_id = $1
           GROUP BY status`,
          [connectionId],
        ),
        tenantPool.query(
          `SELECT status, COUNT(*)::int AS count
           FROM public.encompass_webhook_events
           WHERE los_connection_id = $1
             AND received_at >= NOW() - INTERVAL '24 hours'
           GROUP BY status`,
          [connectionId],
        ),
      ]);
      res.json({
        queue: queueStats.rows,
        events24h: eventStats.rows,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch webhook stats" });
    }
  },
);

router.post(
  "/reconcile/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);
      const connectionId = req.params.connectionId as string;
      const svc = new EncompassWebhookService(tenantPool);
      const modifiedFrom = req.body?.modifiedFrom
        ? new Date(req.body.modifiedFrom)
        : undefined;
      await svc.runReconciliation(tenantId, { connectionId, modifiedFrom });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run reconciliation" });
    }
  },
);

router.get(
  "/v3-readiness/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);
      const connectionId = req.params.connectionId as string;
      const apiService = new EncompassApiService(tenantPool);

      const startedAt = Date.now();
      const errors: Record<string, string> = {};
      const safeCall = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
        try { return await fn(); } catch (e: any) { errors[name] = e.message || String(e); return null; }
      };

      const f = await safeCall("fields", () => apiService.getRdbFields(tenantId, connectionId));
      const cf = await safeCall("customFields", () => apiService.getCustomFields(tenantId, connectionId));
      const fo = await safeCall("folders", () => apiService.getLoanFolders(tenantId, connectionId));
      const u = await safeCall("users", () => apiService.getEncompassUsers(tenantId, connectionId, { enabledOnly: true, limit: 100 }));
      const lo = await safeCall("loans", () => apiService.getLoans(tenantId, connectionId, { limit: 10, fields: ["Loan.LoanNumber", "Loan.LastModified"] }));

      return res.json({
        success: Object.keys(errors).length === 0,
        elapsedMs: Date.now() - startedAt,
        readiness: {
          fields: f?.data?.length ?? 0,
          customFields: cf?.data?.length ?? 0,
          folders: fo?.data?.length ?? 0,
          users: u?.data?.length ?? 0,
          sampleLoans: lo?.data?.length ?? 0,
        },
        concurrency: {
          fields: f?.concurrency || null,
          customFields: cf?.concurrency || null,
          users: u?.concurrency || null,
        },
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      });
    } catch (error: any) {
      console.error("[v3-readiness] Unexpected error:", error);
      return res
        .status(500)
        .json({ error: error.message || "Failed v3 readiness check" });
    }
  },
);

router.post(
  "/discovery/apply/:connectionId",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);
      const losConnectionId = req.params.connectionId as string;

      const schema = z.object({
        suggestions: z
          .array(
            z.object({
              coheusAlias: z.string(),
              fieldId: z.string(),
            })
          )
          .min(1),
      });

      const body = schema.parse(req.body);

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get API server URL from connection
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [losConnectionId]
      );
      const apiServer =
        connectionResult.rows[0]?.encompass_api_server ||
        "https://api.elliemae.com";

      // Create discovery service
      const discoveryService = new EncompassFieldDiscoveryService(
        tenantPool,
        apiServer
      );

      console.log(
        `[Discovery Apply] Applying ${body.suggestions.length} suggestions...`
      );
      const suggestions = body.suggestions as Array<{
        coheusAlias: string;
        fieldId: string;
      }>;
      const result = await discoveryService.applySuggestions(
        losConnectionId,
        suggestions
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid request data", details: error.errors });
      }
      console.error("[Discovery Apply] Error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to apply suggestions" });
    }
  }
);

export default router;
