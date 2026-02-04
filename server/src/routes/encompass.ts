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
import { z } from "zod";

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
        testMode: z.boolean().optional().default(false), // Test mode flag
      });

      const body = schema.parse(req.body);
      const { tenantId, losConnectionId, tenantPool } = getConnectionInfo(req);

      // Verify connection exists in tenant database
      const connectionResult = await tenantPool.query(
        "SELECT id FROM public.los_connections WHERE id = $1 AND is_active = true",
        [losConnectionId]
      );

      if (connectionResult.rows.length === 0) {
        return res.status(404).json({ error: "LOS connection not found" });
      }

      // Verify losConnectionId matches
      if (body.losConnectionId !== losConnectionId) {
        return res.status(400).json({ error: "Connection ID mismatch" });
      }

      // Create services with tenant pool
      const apiService = new EncompassApiService(tenantPool);
      const etlService = new EncompassEtlService(tenantPool);

      // Apply test mode: use default test limit if testMode is true and no limit specified
      let syncLimit = body.limit;
      if (body.testMode && !syncLimit) {
        syncLimit = parseInt(process.env.ENCOMPASS_TEST_MODE_LIMIT || "50", 10);
        console.log(
          `[Encompass Sync] Test mode enabled: using limit of ${syncLimit} records`
        );
      }

      const result = await etlService.syncLoans(tenantId, losConnectionId, {
        fullSync: body.fullSync,
        modifiedFrom: body.modifiedFrom
          ? new Date(body.modifiedFrom)
          : undefined,
        limit: syncLimit,
        fields: body.fields,
        folderName: body.folderName,
      });

      res.json(result);
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
  (req, res, next) => {
    console.log("[Fields GET] ====== MIDDLEWARE BEFORE AUTH ======");
    console.log("[Fields GET] Method:", req.method);
    console.log("[Fields GET] URL:", req.url);
    console.log("[Fields GET] Path:", req.path);
    console.log("[Fields GET] Params:", req.params);
    console.log("[Fields GET] Query:", req.query);
    next();
  },
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    console.log("[Fields GET] ====== ROUTE HANDLER HIT ======");
    console.log("[Fields GET] URL:", req.url);
    console.log("[Fields GET] Params:", req.params);
    console.log("[Fields GET] Query:", req.query);

    try {
      const tenantId = req.query.tenant_id as string | undefined;
      const losConnectionId = req.params.connectionId as string;

      console.log("[Fields GET] Request received:", {
        tenantId,
        losConnectionId,
        userId: req.userId,
      });

      if (!tenantId) {
        return res
          .status(400)
          .json({ error: "tenant_id query parameter is required" });
      }

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get tenant database pool
      const { tenantDbManager } = await import(
        "../config/tenantDatabaseManager.js"
      );
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

      // Get API server URL from connection
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [losConnectionId]
      );
      const apiServer =
        connectionResult.rows[0]?.encompass_api_server ||
        "https://api.elliemae.com";

      console.log("[Fields GET] Using API server:", apiServer);

      // Create API service with tenant pool and API server
      const apiService = new EncompassApiService(tenantPool, apiServer);

      console.log("[Fields GET] Fetching RDB fields from Encompass...");
      console.log("[Fields GET] Connection details:", {
        tenantId,
        losConnectionId,
      });

      try {
        const rdbFieldsResponse = await apiService.getRdbFields(
          tenantId,
          losConnectionId
        );
        console.log(
          "[Fields GET] Successfully fetched RDB fields:",
          rdbFieldsResponse.data.length
        );

        res.json({
          rdbFields: rdbFieldsResponse.data,
          concurrency: rdbFieldsResponse.concurrency,
        });
      } catch (apiError: any) {
        // If authentication fails, return empty array instead of error
        // This allows the field mapping UI to work without RDB validation
        console.error(
          "[Fields GET] Error fetching RDB fields from Encompass:",
          {
            message: apiError.message,
            status: apiError.response?.status,
            statusText: apiError.response?.statusText,
            data: apiError.response?.data,
            stack: apiError.stack,
          }
        );

        // Check if it's an authentication error
        if (apiError.response?.status === 401) {
          console.warn(
            "[Fields GET] Authentication failed - returning empty RDB fields. Field mapping UI will work but without validation."
          );
          return res.json({
            rdbFields: [],
            concurrency: undefined,
            warning:
              "Unable to authenticate with Encompass API. Field validation will be disabled.",
          });
        }

        // For other errors, still return empty array but log the error
        console.error(
          "[Fields GET] Non-auth error fetching RDB fields:",
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
  apiLimiter,
  async (req: AuthRequest, res) => {
    console.log("[Folders GET] Request received");
    try {
      const tenantId = req.query.tenant_id as string | undefined;
      const losConnectionId = req.params.connectionId as string;

      console.log("[Folders GET] Request received:", {
        tenantId,
        losConnectionId,
        userId: req.userId,
      });

      if (!tenantId) {
        return res
          .status(400)
          .json({ error: "tenant_id query parameter is required" });
      }

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get tenant database pool
      const { tenantDbManager } = await import(
        "../config/tenantDatabaseManager.js"
      );
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

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
  (req, res, next) => {
    console.log("[Field Swaps GET] ====== MIDDLEWARE BEFORE AUTH ======");
    console.log("[Field Swaps GET] Method:", req.method);
    console.log("[Field Swaps GET] URL:", req.url);
    console.log("[Field Swaps GET] Path:", req.path);
    console.log("[Field Swaps GET] Params:", req.params);
    console.log("[Field Swaps GET] Query:", req.query);
    next();
  },
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    console.log("[Field Swaps GET] ====== ROUTE HANDLER HIT ======");
    console.log("[Field Swaps GET] URL:", req.url);
    console.log("[Field Swaps GET] Params:", req.params);
    console.log("[Field Swaps GET] Query:", req.query);

    try {
      const tenantId = req.query.tenant_id as string | undefined;
      const losConnectionId = req.params.connectionId as string;

      console.log("[Field Swaps GET] Request received:", {
        tenantId,
        losConnectionId,
        userId: req.userId,
      });

      if (!tenantId) {
        console.error("[Field Swaps GET] Missing tenant_id");
        return res
          .status(400)
          .json({ error: "tenant_id query parameter is required" });
      }

      if (!losConnectionId) {
        console.error("[Field Swaps GET] Missing connection ID");
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get tenant database pool
      const { tenantDbManager } = await import(
        "../config/tenantDatabaseManager.js"
      );
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

      console.log("[Field Swaps GET] Got tenant pool, fetching swaps...");
      const swaps = await getFieldSwaps(tenantPool, losConnectionId);
      const swapsArray = Array.from(swaps.entries()).map(
        ([alias, fieldId]) => ({
          coheusAlias: alias,
          encompassFieldId: fieldId,
        })
      );

      console.log("[Field Swaps GET] Returning swaps:", swapsArray.length);
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
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        tenantId: z.string().uuid().optional(),
        losConnectionId: z.string().uuid(),
        coheusAlias: z.string(),
        encompassFieldId: z.string(),
        swapType: z
          .enum(["Standard", "Profitability"])
          .optional()
          .default("Standard"),
      });

      const body = schema.parse(req.body);
      const tenantId = (req.query.tenant_id as string) || body.tenantId;

      if (!tenantId) {
        return res
          .status(400)
          .json({
            error: "tenant_id query parameter or body field is required",
          });
      }

      // Get tenant database pool
      const { tenantDbManager } = await import(
        "../config/tenantDatabaseManager.js"
      );
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

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
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        coheusAlias: z.string(),
        swapType: z.enum(["Standard", "Profitability"]).optional(),
      });

      const body = schema.parse(req.body);
      const tenantId = req.query.tenant_id as string | undefined;
      const losConnectionId = req.params.connectionId as string;

      if (!tenantId) {
        return res
          .status(400)
          .json({ error: "tenant_id query parameter is required" });
      }

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get tenant database pool
      const { tenantDbManager } = await import(
        "../config/tenantDatabaseManager.js"
      );
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

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
  apiLimiter,
  async (req: AuthRequest, res) => {
    console.log("[Discovery Fields] Request received");
    try {
      const tenantId = req.query.tenant_id as string | undefined;
      const losConnectionId = req.params.connectionId as string;
      const useCache = req.query.use_cache !== "false";

      if (!tenantId) {
        return res
          .status(400)
          .json({ error: "tenant_id query parameter is required" });
      }

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get tenant database pool
      const { tenantDbManager } = await import(
        "../config/tenantDatabaseManager.js"
      );
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

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
  apiLimiter,
  async (req: AuthRequest, res) => {
    console.log("[Discovery Analyze] Request received");
    try {
      const tenantId = req.query.tenant_id as string | undefined;
      const losConnectionId = req.params.connectionId as string;

      const schema = z.object({
        sampleSize: z.number().int().min(10).max(200).optional().default(50),
        fieldsToAnalyze: z.array(z.string()).optional(),
      });

      const body = schema.parse(req.body || {});

      if (!tenantId) {
        return res
          .status(400)
          .json({ error: "tenant_id query parameter is required" });
      }

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get tenant database pool
      const { tenantDbManager } = await import(
        "../config/tenantDatabaseManager.js"
      );
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

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
  apiLimiter,
  async (req: AuthRequest, res) => {
    console.log("[Discovery Suggestions] Request received");
    try {
      const tenantId = req.query.tenant_id as string | undefined;
      const losConnectionId = req.params.connectionId as string;
      const runAnalysis = req.query.run_analysis !== "false";
      const sampleSize = parseInt(req.query.sample_size as string) || 50;

      if (!tenantId) {
        return res
          .status(400)
          .json({ error: "tenant_id query parameter is required" });
      }

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get tenant database pool
      const { tenantDbManager } = await import(
        "../config/tenantDatabaseManager.js"
      );
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

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
  "/discovery/apply/:connectionId",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    console.log("[Discovery Apply] Request received");
    try {
      const tenantId = req.query.tenant_id as string | undefined;
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

      if (!tenantId) {
        return res
          .status(400)
          .json({ error: "tenant_id query parameter is required" });
      }

      if (!losConnectionId) {
        return res.status(400).json({ error: "Connection ID is required" });
      }

      // Get tenant database pool
      const { tenantDbManager } = await import(
        "../config/tenantDatabaseManager.js"
      );
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

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
