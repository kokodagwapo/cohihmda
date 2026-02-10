/**
 * Tenant Config Export/Import Routes
 *
 * Platform admin only endpoints for exporting and importing
 * a tenant's entire configuration as JSON.
 *
 * Mounted at /api/admin/tenant-config-transfer
 */

import { Router, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../../middleware/tenantContext.js";
import { auditLog } from "../../services/auditLogger.js";
import { logInfo, logError } from "../../services/logger.js";
import {
  exportTenantConfig,
  importTenantConfig,
  validateTenantConfigImport,
  type ImportOptions,
  type TenantConfigExport,
} from "../../services/tenantConfigExportService.js";

const router = Router();

const requirePlatformAdmin = requireRole("super_admin", "platform_admin");

// ============================================================================
// GET /api/admin/tenant-config-transfer/export?tenant_id=...
// Export all configuration for the selected tenant
// ============================================================================
router.get(
  "/export",
  authenticateToken,
  requirePlatformAdmin,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool, tenantInfo } = getTenantContext(req);

      logInfo("[ConfigExport] Export requested", {
        userId: req.userId,
        tenantId: tenantInfo.id,
      });

      const exportData = await exportTenantConfig(
        tenantPool,
        tenantInfo,
        req.userEmail || req.userId || "unknown",
      );

      // Audit log the export
      auditLog({
        userId: req.userId || "unknown",
        userEmail: req.userEmail,
        userRole: req.userRole,
        tenantId: tenantInfo.id,
        action: "export",
        resource: "tenant_config",
        description: `Exported full tenant configuration for ${tenantInfo.name}`,
        status: "success",
        metadata: {
          tenantName: tenantInfo.name,
          tenantSlug: tenantInfo.slug,
          sections: Object.entries(exportData.config).map(
            ([k, v]) => `${k}: ${(v as any[]).length}`,
          ),
        },
      }).catch(() => {});

      res.json(exportData);
    } catch (error: any) {
      logError("[ConfigExport] Export failed", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: "Failed to export tenant configuration",
        details: error.message,
      });
    }
  },
);

// ============================================================================
// POST /api/admin/tenant-config-transfer/validate?tenant_id=...
// Dry-run validation of an import payload
// ============================================================================
router.post(
  "/validate",
  authenticateToken,
  requirePlatformAdmin,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { importData, options } = req.body as {
        importData: TenantConfigExport;
        options: ImportOptions;
      };

      if (!importData || !importData.config) {
        return res
          .status(400)
          .json({ error: "Invalid request: missing importData" });
      }

      const safeOptions: ImportOptions = {
        overwrite: options?.overwrite ?? false,
        connectionMapping: options?.connectionMapping ?? {},
        selectedSections: options?.selectedSections ?? [],
      };

      const report = await validateTenantConfigImport(
        tenantPool,
        importData,
        safeOptions,
      );

      res.json(report);
    } catch (error: any) {
      logError("[ConfigExport] Validation failed", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: "Failed to validate import data",
        details: error.message,
      });
    }
  },
);

// ============================================================================
// POST /api/admin/tenant-config-transfer/import?tenant_id=...
// Import configuration into the selected tenant
// ============================================================================
router.post(
  "/import",
  authenticateToken,
  requirePlatformAdmin,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool, tenantInfo } = getTenantContext(req);
      const { importData, options } = req.body as {
        importData: TenantConfigExport;
        options: ImportOptions;
      };

      if (!importData || !importData.config) {
        return res
          .status(400)
          .json({ error: "Invalid request: missing importData" });
      }

      const safeOptions: ImportOptions = {
        overwrite: options?.overwrite ?? false,
        connectionMapping: options?.connectionMapping ?? {},
        selectedSections: options?.selectedSections ?? [],
      };

      logInfo("[ConfigImport] Import requested", {
        userId: req.userId,
        tenantId: tenantInfo.id,
        sourceTenant: importData.sourceTenant?.name,
        overwrite: safeOptions.overwrite,
        sections: safeOptions.selectedSections,
      });

      const result = await importTenantConfig(
        tenantPool,
        importData,
        safeOptions,
      );

      // Audit log the import
      auditLog({
        userId: req.userId || "unknown",
        userEmail: req.userEmail,
        userRole: req.userRole,
        tenantId: tenantInfo.id,
        action: "import",
        resource: "tenant_config",
        description: `Imported tenant configuration from ${importData.sourceTenant?.name || "unknown"} into ${tenantInfo.name}`,
        status: result.success ? "success" : "partial",
        metadata: {
          sourceTenant: importData.sourceTenant?.name,
          targetTenant: tenantInfo.name,
          overwrite: safeOptions.overwrite,
          totalImported: result.totalImported,
          totalSkipped: result.totalSkipped,
          totalErrors: result.totalErrors,
        },
      }).catch(() => {});

      res.json(result);
    } catch (error: any) {
      logError("[ConfigImport] Import failed", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: "Failed to import tenant configuration",
        details: error.message,
      });
    }
  },
);

export default router;
