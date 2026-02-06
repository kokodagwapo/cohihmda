/**
 * Tenant Configuration Routes
 * Self-service mapping tool for lender admins
 * Manages personas, custom fields, range rules, filters, and scoring weights
 */

import express, { Response } from "express";
import { z } from "zod";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import { logInfo, logError, logDebug } from "../services/logger.js";
import { clearTenantRevenueExpressionCache } from "../utils/scorecard-utils.js";

const router = express.Router();

// ============================================
// PERSONAS
// ============================================

/**
 * GET /api/tenant-config/personas
 * List all personas for the tenant
 */
router.get(
  "/personas",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const result = await tenantPool.query(`
      SELECT id, name, description, is_system, permissions, dashboard_config, created_at, updated_at
      FROM public.personas
      ORDER BY is_system DESC, name ASC
    `);

      res.json({ personas: result.rows });
    } catch (error: any) {
      logError("Error fetching personas", error, { userId: req.userId });
      res.status(500).json({ error: "Failed to fetch personas" });
    }
  }
);

/**
 * POST /api/tenant-config/personas
 * Create a new persona
 */
router.post(
  "/personas",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const schema = z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        permissions: z.record(z.boolean()).optional(),
        dashboard_config: z.record(z.any()).optional(),
      });

      const data = schema.parse(req.body);

      const result = await tenantPool.query(
        `
      INSERT INTO public.personas (name, description, permissions, dashboard_config, is_system, created_by)
      VALUES ($1, $2, $3, $4, FALSE, $5)
      RETURNING id, name, description, is_system, permissions, dashboard_config, created_at
    `,
        [
          data.name,
          data.description || null,
          JSON.stringify(data.permissions || {}),
          JSON.stringify(data.dashboard_config || {}),
          req.userId,
        ]
      );

      logInfo("Persona created", {
        userId: req.userId,
        personaId: result.rows[0].id,
        name: data.name,
      });
      res.status(201).json({ persona: result.rows[0] });
    } catch (error: any) {
      if (error.code === "23505") {
        return res
          .status(400)
          .json({ error: "A persona with this name already exists" });
      }
      logError("Error creating persona", error, { userId: req.userId });
      res.status(500).json({ error: "Failed to create persona" });
    }
  }
);

/**
 * PUT /api/tenant-config/personas/:id
 * Update a persona
 */
router.put(
  "/personas/:id",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;

      // Check if it's a system persona
      const checkResult = await tenantPool.query(
        "SELECT is_system FROM public.personas WHERE id = $1",
        [id]
      );
      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: "Persona not found" });
      }
      if (checkResult.rows[0].is_system) {
        // Only allow updating permissions for system personas, not name
        const schema = z.object({
          permissions: z.record(z.boolean()).optional(),
          dashboard_config: z.record(z.any()).optional(),
        });
        const data = schema.parse(req.body);

        const result = await tenantPool.query(
          `
        UPDATE public.personas
        SET permissions = COALESCE($1, permissions), dashboard_config = COALESCE($2, dashboard_config), updated_at = NOW()
        WHERE id = $3
        RETURNING id, name, description, is_system, permissions, dashboard_config, updated_at
      `,
          [
            data.permissions ? JSON.stringify(data.permissions) : null,
            data.dashboard_config
              ? JSON.stringify(data.dashboard_config)
              : null,
            id,
          ]
        );

        return res.json({ persona: result.rows[0] });
      }

      const schema = z.object({
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        permissions: z.record(z.boolean()).optional(),
        dashboard_config: z.record(z.any()).optional(),
      });

      const data = schema.parse(req.body);

      const result = await tenantPool.query(
        `
      UPDATE public.personas
      SET name = COALESCE($1, name), description = COALESCE($2, description),
          permissions = COALESCE($3, permissions), dashboard_config = COALESCE($4, dashboard_config),
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, name, description, is_system, permissions, dashboard_config, updated_at
    `,
        [
          data.name,
          data.description,
          data.permissions ? JSON.stringify(data.permissions) : null,
          data.dashboard_config ? JSON.stringify(data.dashboard_config) : null,
          id,
        ]
      );

      logInfo("Persona updated", { userId: req.userId, personaId: id });
      res.json({ persona: result.rows[0] });
    } catch (error: any) {
      logError("Error updating persona", error, {
        userId: req.userId,
        personaId: req.params.id,
      });
      res.status(500).json({ error: "Failed to update persona" });
    }
  }
);

/**
 * DELETE /api/tenant-config/personas/:id
 * Delete a persona (only custom personas)
 */
router.delete(
  "/personas/:id",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;

      const checkResult = await tenantPool.query(
        "SELECT is_system FROM public.personas WHERE id = $1",
        [id]
      );
      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: "Persona not found" });
      }
      if (checkResult.rows[0].is_system) {
        return res.status(400).json({ error: "Cannot delete system personas" });
      }

      await tenantPool.query("DELETE FROM public.personas WHERE id = $1", [id]);

      logInfo("Persona deleted", { userId: req.userId, personaId: id });
      res.json({ success: true });
    } catch (error: any) {
      logError("Error deleting persona", error, {
        userId: req.userId,
        personaId: req.params.id,
      });
      res.status(500).json({ error: "Failed to delete persona" });
    }
  }
);

// ============================================
// CUSTOM FIELDS
// ============================================

/**
 * GET /api/tenant-config/fields
 * List all custom fields
 */
router.get(
  "/fields",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const result = await tenantPool.query(`
      SELECT id, los_field_id, los_field_name, coheus_alias, display_name, data_type, category,
             description, is_enabled, is_custom, visible_to_personas, formatting_rules, created_at, updated_at
      FROM public.custom_fields
      ORDER BY category, display_name
    `);

      res.json({ fields: result.rows });
    } catch (error: any) {
      logError("Error fetching custom fields", error, { userId: req.userId });
      res.status(500).json({ error: "Failed to fetch custom fields" });
    }
  }
);

/**
 * POST /api/tenant-config/fields
 * Create a custom field
 */
router.post(
  "/fields",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const schema = z.object({
        los_field_id: z.string().min(1),
        los_field_name: z.string().optional(),
        coheus_alias: z.string().optional(),
        display_name: z.string().min(1),
        data_type: z.enum([
          "string",
          "number",
          "date",
          "boolean",
          "currency",
          "percentage",
        ]),
        category: z.string().optional(),
        description: z.string().optional(),
        visible_to_personas: z.array(z.string().uuid()).optional(),
        formatting_rules: z.record(z.any()).optional(),
      });

      const data = schema.parse(req.body);

      const result = await tenantPool.query(
        `
      INSERT INTO public.custom_fields (los_field_id, los_field_name, coheus_alias, display_name, data_type, 
                                         category, description, visible_to_personas, formatting_rules, is_custom, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10)
      RETURNING *
    `,
        [
          data.los_field_id,
          data.los_field_name || null,
          data.coheus_alias || null,
          data.display_name,
          data.data_type,
          data.category || null,
          data.description || null,
          data.visible_to_personas || null,
          JSON.stringify(data.formatting_rules || {}),
          req.userId,
        ]
      );

      logInfo("Custom field created", {
        userId: req.userId,
        fieldId: result.rows[0].id,
      });
      res.status(201).json({ field: result.rows[0] });
    } catch (error: any) {
      if (error.code === "23505") {
        return res
          .status(400)
          .json({ error: "A field with this LOS field ID already exists" });
      }
      logError("Error creating custom field", error, { userId: req.userId });
      res.status(500).json({ error: "Failed to create custom field" });
    }
  }
);

/**
 * PUT /api/tenant-config/fields/:id
 * Update a custom field
 */
router.put(
  "/fields/:id",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;

      const schema = z.object({
        display_name: z.string().min(1).optional(),
        category: z.string().optional(),
        description: z.string().optional(),
        is_enabled: z.boolean().optional(),
        visible_to_personas: z.array(z.string().uuid()).optional(),
        formatting_rules: z.record(z.any()).optional(),
      });

      const data = schema.parse(req.body);

      const result = await tenantPool.query(
        `
      UPDATE public.custom_fields
      SET display_name = COALESCE($1, display_name), category = COALESCE($2, category),
          description = COALESCE($3, description), is_enabled = COALESCE($4, is_enabled),
          visible_to_personas = COALESCE($5, visible_to_personas), formatting_rules = COALESCE($6, formatting_rules),
          updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `,
        [
          data.display_name,
          data.category,
          data.description,
          data.is_enabled,
          data.visible_to_personas,
          data.formatting_rules ? JSON.stringify(data.formatting_rules) : null,
          id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Field not found" });
      }

      logInfo("Custom field updated", { userId: req.userId, fieldId: id });
      res.json({ field: result.rows[0] });
    } catch (error: any) {
      logError("Error updating custom field", error, {
        userId: req.userId,
        fieldId: req.params.id,
      });
      res.status(500).json({ error: "Failed to update custom field" });
    }
  }
);

/**
 * DELETE /api/tenant-config/fields/:id
 * Delete a custom field
 */
router.delete(
  "/fields/:id",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;

      const result = await tenantPool.query(
        "DELETE FROM public.custom_fields WHERE id = $1 RETURNING id",
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Field not found" });
      }

      logInfo("Custom field deleted", { userId: req.userId, fieldId: id });
      res.json({ success: true });
    } catch (error: any) {
      logError("Error deleting custom field", error, {
        userId: req.userId,
        fieldId: req.params.id,
      });
      res.status(500).json({ error: "Failed to delete custom field" });
    }
  }
);

// ============================================
// LOS CONNECTIONS
// ============================================

/**
 * GET /api/tenant-config/los-connections
 * List LOS connections for the tenant (used for additional field creation)
 */
router.get(
  "/los-connections",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const result = await tenantPool.query(
        `SELECT id, los_type, name, is_active
         FROM public.los_connections
         WHERE is_active = true
         ORDER BY name`
      );

      res.json({ connections: result.rows });
    } catch (error: any) {
      logError("Error fetching LOS connections", error, {
        userId: req.userId,
      });
      res.status(500).json({ error: "Failed to fetch LOS connections" });
    }
  }
);

// ============================================
// ADDITIONAL FIELDS (Dynamic Columns)
// ============================================

import {
  AdditionalFieldService,
  CreateAdditionalFieldInput,
  UpdateAdditionalFieldInput,
  DataType,
} from "../services/additionalFieldService.js";

/**
 * GET /api/tenant-config/additional-fields
 * List all additional field definitions
 */
router.get(
  "/additional-fields",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const connectionId = req.query.connection_id as string | undefined;

      const service = new AdditionalFieldService(tenantPool);
      const fields = await service.getFieldDefinitions(connectionId);

      res.json({ fields });
    } catch (error: any) {
      logError("Error fetching additional fields", error, {
        userId: req.userId,
      });
      res.status(500).json({ error: "Failed to fetch additional fields" });
    }
  }
);

/**
 * GET /api/tenant-config/additional-fields/:id
 * Get a single additional field definition
 */
router.get(
  "/additional-fields/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const id = req.params.id as string;

      const service = new AdditionalFieldService(tenantPool);
      const field = await service.getFieldDefinitionById(id);

      if (!field) {
        return res.status(404).json({ error: "Additional field not found" });
      }

      res.json({ field });
    } catch (error: any) {
      logError("Error fetching additional field", error, {
        userId: req.userId,
        fieldId: req.params.id,
      });
      res.status(500).json({ error: "Failed to fetch additional field" });
    }
  }
);

/**
 * POST /api/tenant-config/additional-fields
 * Create a new additional field (adds column to loans table)
 */
router.post(
  "/additional-fields",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool, tenantId } = getTenantContext(req);

      const schema = z.object({
        losConnectionId: z.string().uuid(),
        losFieldId: z.string().min(1),
        displayName: z.string().min(1).max(255),
        dataType: z.enum([
          "string",
          "number",
          "date",
          "boolean",
          "currency",
          "percentage",
        ]),
        category: z.string().max(100).nullish(),
        description: z.string().nullish(),
        includeInRag: z.boolean().optional().default(true),
      });

      const data = schema.parse(req.body);

      const service = new AdditionalFieldService(tenantPool);

      // Check if field ID is already defined for this connection
      const isDuplicate = await service.isFieldIdAlreadyDefined(
        data.losConnectionId,
        data.losFieldId
      );
      if (isDuplicate) {
        return res.status(400).json({
          error: "This LOS field ID is already defined for this connection",
        });
      }

      // Validate the field exists in Encompass (optional - get API server from connection)
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [data.losConnectionId]
      );
      const apiServer = connectionResult.rows[0]?.encompass_api_server;

      // Create the field (this also creates the column)
      const input: CreateAdditionalFieldInput = {
        losConnectionId: data.losConnectionId,
        losFieldId: data.losFieldId,
        displayName: data.displayName,
        dataType: data.dataType as DataType,
        category: data.category,
        description: data.description,
        includeInRag: data.includeInRag,
        createdBy: req.userId,
      };

      const field = await service.createField(input);

      logInfo("Additional field created", {
        userId: req.userId,
        fieldId: field.id,
        columnName: field.columnName,
        losFieldId: data.losFieldId,
      });

      res.status(201).json({
        field,
        message:
          "Field created successfully. Run a data sync to populate this field for existing loans.",
        requiresSync: true,
      });
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(400).json({
          error: "A field with this LOS field ID or column name already exists",
        });
      }
      logError("Error creating additional field", error, {
        userId: req.userId,
      });
      res
        .status(500)
        .json({ error: error.message || "Failed to create additional field" });
    }
  }
);

/**
 * PUT /api/tenant-config/additional-fields/:id
 * Update an additional field definition (does not change column)
 */
router.put(
  "/additional-fields/:id",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const id = req.params.id as string;

      const schema = z.object({
        displayName: z.string().min(1).max(255).optional(),
        category: z.string().max(100).nullable().optional(),
        description: z.string().nullable().optional(),
        isEnabled: z.boolean().optional(),
        includeInRag: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      });

      const data = schema.parse(req.body);

      const service = new AdditionalFieldService(tenantPool);

      const input: UpdateAdditionalFieldInput = {
        displayName: data.displayName,
        category: data.category ?? undefined,
        description: data.description ?? undefined,
        isEnabled: data.isEnabled,
        includeInRag: data.includeInRag,
        sortOrder: data.sortOrder,
      };

      const field = await service.updateField(id, input, req.userId);

      if (!field) {
        return res.status(404).json({ error: "Additional field not found" });
      }

      logInfo("Additional field updated", { userId: req.userId, fieldId: id });
      res.json({ field });
    } catch (error: any) {
      logError("Error updating additional field", error, {
        userId: req.userId,
        fieldId: req.params.id,
      });
      res.status(500).json({ error: "Failed to update additional field" });
    }
  }
);

/**
 * DELETE /api/tenant-config/additional-fields/:id
 * Delete an additional field (drops column from loans table)
 */
router.delete(
  "/additional-fields/:id",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const id = req.params.id as string;

      const service = new AdditionalFieldService(tenantPool);
      const success = await service.deleteField(id, req.userId);

      if (!success) {
        return res.status(404).json({ error: "Additional field not found" });
      }

      logInfo("Additional field deleted", { userId: req.userId, fieldId: id });
      res.json({ success: true });
    } catch (error: any) {
      logError("Error deleting additional field", error, {
        userId: req.userId,
        fieldId: req.params.id,
      });
      res.status(500).json({ error: "Failed to delete additional field" });
    }
  }
);

/**
 * POST /api/tenant-config/additional-fields/validate
 * Validate that a LOS field ID exists in Encompass
 */
router.post(
  "/additional-fields/validate",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool, tenantId } = getTenantContext(req);

      const schema = z.object({
        losConnectionId: z.string().uuid(),
        losFieldId: z.string().min(1),
      });

      const data = schema.parse(req.body);

      // Get API server from connection
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [data.losConnectionId]
      );
      const apiServer = connectionResult.rows[0]?.encompass_api_server;

      const service = new AdditionalFieldService(tenantPool);
      const result = await service.validateFieldExists(
        tenantId,
        data.losConnectionId,
        data.losFieldId,
        apiServer
      );

      res.json(result);
    } catch (error: any) {
      logError("Error validating LOS field", error, { userId: req.userId });
      res.status(500).json({ error: "Failed to validate LOS field" });
    }
  }
);

/**
 * GET /api/tenant-config/additional-fields/:id/audit
 * Get audit log for an additional field
 */
router.get(
  "/additional-fields/:id/audit",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const id = req.params.id as string;
      const limit = parseInt(req.query.limit as string) || 50;

      const service = new AdditionalFieldService(tenantPool);
      const auditLog = await service.getAuditLog(id, limit);

      res.json({ auditLog });
    } catch (error: any) {
      logError("Error fetching additional field audit log", error, {
        userId: req.userId,
        fieldId: req.params.id,
      });
      res.status(500).json({ error: "Failed to fetch audit log" });
    }
  }
);

/**
 * POST /api/tenant-config/additional-fields/generate-column-name
 * Generate a column name from a display name (for preview)
 */
router.post(
  "/additional-fields/generate-column-name",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const schema = z.object({
        displayName: z.string().min(1).max(255),
      });

      const data = schema.parse(req.body);

      const service = new AdditionalFieldService(tenantPool);
      const columnName = await service.generateUniqueColumnName(
        data.displayName
      );

      res.json({ columnName });
    } catch (error: any) {
      logError("Error generating column name", error, { userId: req.userId });
      res.status(500).json({ error: "Failed to generate column name" });
    }
  }
);

/**
 * POST /api/tenant-config/additional-fields/batch-create-for-formula
 * Create multiple additional fields with specific column names for revenue formula support
 * This allows the revenue formula to automatically add missing fields with the correct column names
 */
router.post(
  "/additional-fields/batch-create-for-formula",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const schema = z.object({
        losConnectionId: z.string().uuid(),
        fields: z
          .array(
            z.object({
              columnName: z
                .string()
                .min(1)
                .max(63)
                .regex(/^[a-z][a-z0-9_]*$/, {
                  message:
                    "Column name must start with a letter and contain only lowercase letters, numbers, and underscores",
                }),
              losFieldId: z.string().min(1),
              displayName: z.string().min(1).max(255),
              dataType: z.enum([
                "string",
                "number",
                "date",
                "boolean",
                "currency",
                "percentage",
              ]),
            })
          )
          .min(1),
      });

      const data = schema.parse(req.body);

      logInfo("Batch creating additional fields for revenue formula", {
        userId: req.userId,
        connectionId: data.losConnectionId,
        fieldCount: data.fields.length,
      });

      const results: { field: string; success: boolean; error?: string }[] = [];

      for (const fieldInput of data.fields) {
        try {
          // Check if field already exists by LOS field ID or column name
          const existingCheck = await tenantPool.query(
            `SELECT id FROM additional_field_definitions 
             WHERE los_connection_id = $1 
             AND (los_field_id = $2 OR column_name = $3)`,
            [data.losConnectionId, fieldInput.losFieldId, fieldInput.columnName]
          );

          if (existingCheck.rows.length > 0) {
            results.push({
              field: fieldInput.columnName,
              success: true,
              error: "Field already exists",
            });
            continue;
          }

          // Check if column already exists in loans table
          const columnExistsCheck = await tenantPool.query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = $1`,
            [fieldInput.columnName]
          );

          const columnAlreadyExists = columnExistsCheck.rows.length > 0;

          // Map data type to DB column type
          const dbTypeMap: Record<string, string> = {
            string: "TEXT",
            number: "DECIMAL(15,4)",
            date: "DATE",
            boolean: "BOOLEAN",
            currency: "DECIMAL(15,2)",
            percentage: "DECIMAL(8,4)",
          };
          const dbColumnType = dbTypeMap[fieldInput.dataType];

          // Create the column if it doesn't exist
          if (!columnAlreadyExists) {
            await tenantPool.query(
              `ALTER TABLE public.loans ADD COLUMN ${fieldInput.columnName} ${dbColumnType}`
            );
          }

          // Insert the field definition
          await tenantPool.query(
            `INSERT INTO additional_field_definitions (
              los_connection_id, los_field_id, column_name, display_name,
              data_type, db_column_type, category, description,
              include_in_rag, column_created, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10)`,
            [
              data.losConnectionId,
              fieldInput.losFieldId,
              fieldInput.columnName,
              fieldInput.displayName,
              fieldInput.dataType,
              dbColumnType,
              "revenue", // Category for revenue formula fields
              `Revenue formula field: ${fieldInput.displayName}`,
              true, // Include in RAG
              req.userId,
            ]
          );

          results.push({ field: fieldInput.columnName, success: true });
        } catch (fieldError: any) {
          logError("Error creating additional field", fieldError, {
            userId: req.userId,
            field: fieldInput.columnName,
          });
          results.push({
            field: fieldInput.columnName,
            success: false,
            error: fieldError.message,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failedCount = results.filter((r) => !r.success).length;

      res.json({
        success: failedCount === 0,
        message: `Created ${successCount} field(s)${
          failedCount > 0 ? `, ${failedCount} failed` : ""
        }`,
        results,
        requiresSync: successCount > 0,
      });
    } catch (error: any) {
      logError("Error batch creating additional fields", error, {
        userId: req.userId,
      });
      res
        .status(500)
        .json({ error: error.message || "Failed to create fields" });
    }
  }
);

/**
 * POST /api/tenant-config/additional-fields/batch-create-from-encompass
 * Create additional fields by fetching descriptions from Encompass RDB
 * Generates column names from the Encompass field descriptions
 */
router.post(
  "/additional-fields/batch-create-from-encompass",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool, tenantId } = getTenantContext(req);

      const schema = z.object({
        losConnectionId: z.string().uuid(),
        fields: z
          .array(
            z.object({
              losFieldId: z.string().min(1),
              fallbackDisplayName: z.string().min(1).max(255),
            })
          )
          .min(1),
      });

      const data = schema.parse(req.body);

      logInfo("Batch creating fields from Encompass RDB", {
        userId: req.userId,
        connectionId: data.losConnectionId,
        fieldCount: data.fields.length,
      });

      // Get Encompass API server from connection
      const connectionResult = await tenantPool.query(
        "SELECT encompass_api_server FROM public.los_connections WHERE id = $1",
        [data.losConnectionId]
      );
      const apiServer =
        connectionResult.rows[0]?.encompass_api_server ||
        "https://api.elliemae.com";

      // Fetch RDB fields from Encompass to get descriptions
      let rdbFields: Array<{ id: string; description: string }> = [];
      try {
        // Dynamic import to avoid circular dependencies
        const { EncompassApiService } = await import(
          "../services/encompassApiService.js"
        );
        const encompassService = new EncompassApiService(
          tenantPool,
          data.losConnectionId,
          apiServer
        );
        const rdbResult = await encompassService.getRdbFields();
        rdbFields = rdbResult.fields || [];
        logInfo(`Fetched ${rdbFields.length} RDB fields from Encompass`);
      } catch (rdbError: any) {
        logError("Failed to fetch RDB fields from Encompass", rdbError);
        // Continue with fallback display names
      }

      // Create a map of field ID -> description
      const fieldDescriptionMap = new Map(
        rdbFields.map((f) => [f.id, f.description])
      );

      // Helper to generate column name from description
      const generateColumnName = (displayName: string): string => {
        return displayName
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "") // Remove special chars
          .replace(/\s+/g, "_") // Replace spaces with underscores
          .replace(/_+/g, "_") // Remove duplicate underscores
          .replace(/^_|_$/g, "") // Remove leading/trailing underscores
          .substring(0, 63); // PostgreSQL limit
      };

      const results: Array<{
        losFieldId: string;
        columnName: string;
        displayName: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const fieldInput of data.fields) {
        try {
          // Get description from Encompass or use fallback
          const encompassDescription = fieldDescriptionMap.get(
            fieldInput.losFieldId
          );
          const displayName =
            encompassDescription || fieldInput.fallbackDisplayName;
          const columnName = generateColumnName(displayName);

          // Check if field already exists by LOS field ID or column name
          const existingCheck = await tenantPool.query(
            `SELECT id, column_name FROM additional_field_definitions 
             WHERE los_connection_id = $1 
             AND (los_field_id = $2 OR column_name = $3)`,
            [data.losConnectionId, fieldInput.losFieldId, columnName]
          );

          if (existingCheck.rows.length > 0) {
            results.push({
              losFieldId: fieldInput.losFieldId,
              columnName: existingCheck.rows[0].column_name,
              displayName,
              success: true,
              error: "Field already exists",
            });
            continue;
          }

          // Check if column already exists in loans table
          const columnExistsCheck = await tenantPool.query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = $1`,
            [columnName]
          );

          const columnAlreadyExists = columnExistsCheck.rows.length > 0;

          // Create the column if it doesn't exist (default to DECIMAL for revenue fields)
          if (!columnAlreadyExists) {
            await tenantPool.query(
              `ALTER TABLE public.loans ADD COLUMN ${columnName} DECIMAL(15,2)`
            );
          }

          // Insert the field definition
          await tenantPool.query(
            `INSERT INTO additional_field_definitions (
              los_connection_id, los_field_id, column_name, display_name,
              data_type, db_column_type, category, description,
              include_in_rag, column_created, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10)`,
            [
              data.losConnectionId,
              fieldInput.losFieldId,
              columnName,
              displayName,
              "currency",
              "DECIMAL(15,2)",
              "revenue",
              `Revenue formula field from Encompass: ${displayName}`,
              true,
              req.userId,
            ]
          );

          results.push({
            losFieldId: fieldInput.losFieldId,
            columnName,
            displayName,
            success: true,
          });

          logInfo("Created additional field from Encompass", {
            losFieldId: fieldInput.losFieldId,
            columnName,
            displayName,
            source: encompassDescription ? "encompass" : "fallback",
          });
        } catch (fieldError: any) {
          logError(
            "Error creating additional field from Encompass",
            fieldError,
            {
              userId: req.userId,
              losFieldId: fieldInput.losFieldId,
            }
          );
          results.push({
            losFieldId: fieldInput.losFieldId,
            columnName: "",
            displayName: fieldInput.fallbackDisplayName,
            success: false,
            error: fieldError.message,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failedCount = results.filter((r) => !r.success).length;

      res.json({
        success: failedCount === 0,
        message: `Created ${successCount} field(s) with names from Encompass descriptions${
          failedCount > 0 ? `, ${failedCount} failed` : ""
        }`,
        results,
        requiresSync: successCount > 0,
      });
    } catch (error: any) {
      logError("Error batch creating fields from Encompass", error, {
        userId: req.userId,
      });
      res
        .status(500)
        .json({ error: error.message || "Failed to create fields" });
    }
  }
);

// ============================================
// SAVED FILTERS
// ============================================

/**
 * GET /api/tenant-config/filters
 * List filters visible to the current user
 */
router.get(
  "/filters",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      // Get filters: personal, or org-wide, or matching user's persona
      const result = await tenantPool.query(
        `
      SELECT f.id, f.name, f.description, f.filter_expression, f.scope, f.owner_id, f.owner_persona_id,
             f.team_ids, f.is_locked, f.is_default, f.icon, f.color, f.sort_order, f.created_at, f.updated_at,
             p.name as persona_name
      FROM public.saved_filters f
      LEFT JOIN public.personas p ON f.owner_persona_id = p.id
      WHERE f.scope = 'organization'
         OR f.owner_id = $1
         OR f.scope = 'personal' AND f.owner_id = $1
      ORDER BY f.sort_order, f.name
    `,
        [req.userId]
      );

      res.json({ filters: result.rows });
    } catch (error: any) {
      logError("Error fetching filters", error, { userId: req.userId });
      res.status(500).json({ error: "Failed to fetch filters" });
    }
  }
);

/**
 * POST /api/tenant-config/filters
 * Create a saved filter
 */
router.post(
  "/filters",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const schema = z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        filter_expression: z.record(z.any()),
        scope: z.enum(["personal", "team", "persona", "organization"]),
        owner_persona_id: z.string().uuid().optional(),
        team_ids: z.array(z.string().uuid()).optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
      });

      const data = schema.parse(req.body);

      // Only admins can create org-wide filters
      if (data.scope === "organization") {
        const userRole = req.userRole || "user";
        if (!["tenant_admin", "super_admin"].includes(userRole)) {
          return res.status(403).json({
            error: "Only admins can create organization-wide filters",
          });
        }
      }

      const result = await tenantPool.query(
        `
      INSERT INTO public.saved_filters (name, description, filter_expression, scope, owner_id, owner_persona_id,
                                         team_ids, icon, color, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
        [
          data.name,
          data.description || null,
          JSON.stringify(data.filter_expression),
          data.scope,
          req.userId,
          data.owner_persona_id || null,
          data.team_ids || null,
          data.icon || null,
          data.color || null,
          req.userId,
        ]
      );

      logInfo("Filter created", {
        userId: req.userId,
        filterId: result.rows[0].id,
      });
      res.status(201).json({ filter: result.rows[0] });
    } catch (error: any) {
      logError("Error creating filter", error, { userId: req.userId });
      res.status(500).json({ error: "Failed to create filter" });
    }
  }
);

/**
 * PUT /api/tenant-config/filters/:id
 * Update a saved filter
 */
router.put(
  "/filters/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;

      // Check ownership or admin status
      const checkResult = await tenantPool.query(
        "SELECT owner_id, is_locked, scope FROM public.saved_filters WHERE id = $1",
        [id]
      );
      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: "Filter not found" });
      }

      const filter = checkResult.rows[0];
      const userRole = req.userRole || "user";
      const isAdmin = ["tenant_admin", "super_admin"].includes(userRole);

      if (filter.is_locked && !isAdmin) {
        return res
          .status(403)
          .json({ error: "This filter is locked and cannot be modified" });
      }

      if (filter.owner_id !== req.userId && !isAdmin) {
        return res
          .status(403)
          .json({ error: "You can only modify your own filters" });
      }

      const schema = z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        filter_expression: z.record(z.any()).optional(),
        is_locked: z.boolean().optional(),
        is_default: z.boolean().optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
        sort_order: z.number().optional(),
      });

      const data = schema.parse(req.body);

      const result = await tenantPool.query(
        `
      UPDATE public.saved_filters
      SET name = COALESCE($1, name), description = COALESCE($2, description),
          filter_expression = COALESCE($3, filter_expression), is_locked = COALESCE($4, is_locked),
          is_default = COALESCE($5, is_default), icon = COALESCE($6, icon), color = COALESCE($7, color),
          sort_order = COALESCE($8, sort_order), updated_at = NOW()
      WHERE id = $9
      RETURNING *
    `,
        [
          data.name,
          data.description,
          data.filter_expression
            ? JSON.stringify(data.filter_expression)
            : null,
          isAdmin ? data.is_locked : null,
          data.is_default,
          data.icon,
          data.color,
          data.sort_order,
          id,
        ]
      );

      logInfo("Filter updated", { userId: req.userId, filterId: id });
      res.json({ filter: result.rows[0] });
    } catch (error: any) {
      logError("Error updating filter", error, {
        userId: req.userId,
        filterId: req.params.id,
      });
      res.status(500).json({ error: "Failed to update filter" });
    }
  }
);

/**
 * DELETE /api/tenant-config/filters/:id
 * Delete a saved filter
 */
router.delete(
  "/filters/:id",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;

      const checkResult = await tenantPool.query(
        "SELECT owner_id, is_locked FROM public.saved_filters WHERE id = $1",
        [id]
      );
      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: "Filter not found" });
      }

      const filter = checkResult.rows[0];
      const userRole = req.userRole || "user";
      const isAdmin = ["tenant_admin", "super_admin"].includes(userRole);

      if (filter.is_locked && !isAdmin) {
        return res
          .status(403)
          .json({ error: "This filter is locked and cannot be deleted" });
      }

      if (filter.owner_id !== req.userId && !isAdmin) {
        return res
          .status(403)
          .json({ error: "You can only delete your own filters" });
      }

      await tenantPool.query("DELETE FROM public.saved_filters WHERE id = $1", [
        id,
      ]);

      logInfo("Filter deleted", { userId: req.userId, filterId: id });
      res.json({ success: true });
    } catch (error: any) {
      logError("Error deleting filter", error, {
        userId: req.userId,
        filterId: req.params.id,
      });
      res.status(500).json({ error: "Failed to delete filter" });
    }
  }
);

// ============================================
// SCORING WEIGHTS
// ============================================

/**
 * GET /api/tenant-config/scoring-weights/:scorecardType
 * Get scoring weights for a scorecard type
 */
router.get(
  "/scoring-weights/:scorecardType",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { scorecardType } = req.params;
      const personaId = req.query.persona_id as string | undefined;

      const result = await tenantPool.query(
        `
      SELECT id, scorecard_type, persona_id, metric_name, weight, is_active, description, created_at, updated_at
      FROM public.scoring_weights
      WHERE scorecard_type = $1 AND (persona_id = $2 OR persona_id IS NULL)
      ORDER BY persona_id NULLS LAST, metric_name
    `,
        [scorecardType, personaId || null]
      );

      // Group by persona_id
      const weights: Record<string, any[]> = { default: [] };
      for (const row of result.rows) {
        const key = row.persona_id || "default";
        if (!weights[key]) weights[key] = [];
        weights[key].push(row);
      }

      res.json({ weights, scorecardType });
    } catch (error: any) {
      logError("Error fetching scoring weights", error, {
        userId: req.userId,
        scorecardType: req.params.scorecardType,
      });
      res.status(500).json({ error: "Failed to fetch scoring weights" });
    }
  }
);

/**
 * PUT /api/tenant-config/scoring-weights/:scorecardType
 * Update scoring weights for a scorecard type
 */
router.put(
  "/scoring-weights/:scorecardType",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { scorecardType } = req.params;

      const schema = z.object({
        persona_id: z.string().uuid().nullable().optional(),
        weights: z.array(
          z.object({
            metric_name: z.string(),
            weight: z.number().min(0).max(1),
            description: z.string().optional(),
          })
        ),
      });

      const data = schema.parse(req.body);

      // Validate weights sum to 1.0 (with tolerance for floating point)
      const totalWeight = data.weights.reduce((sum, w) => sum + w.weight, 0);
      if (Math.abs(totalWeight - 1.0) > 0.01) {
        return res.status(400).json({
          error: `Weights must sum to 1.0 (current sum: ${totalWeight.toFixed(
            2
          )})`,
        });
      }

      // Upsert each weight
      const results = [];
      for (const w of data.weights) {
        const result = await tenantPool.query(
          `
        INSERT INTO public.scoring_weights (scorecard_type, persona_id, metric_name, weight, description, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (scorecard_type, persona_id, metric_name)
        DO UPDATE SET weight = $4, description = COALESCE($5, scoring_weights.description), updated_at = NOW()
        RETURNING *
      `,
          [
            scorecardType,
            data.persona_id || null,
            w.metric_name,
            w.weight,
            w.description || null,
            req.userId,
          ]
        );
        results.push(result.rows[0]);
      }

      logInfo("Scoring weights updated", {
        userId: req.userId,
        scorecardType,
        personaId: data.persona_id,
      });
      res.json({ weights: results });
    } catch (error: any) {
      logError("Error updating scoring weights", error, {
        userId: req.userId,
        scorecardType: req.params.scorecardType,
      });
      res.status(500).json({ error: "Failed to update scoring weights" });
    }
  }
);

// ============================================
// COMPLEXITY COMPONENTS
// ============================================

/**
 * GET /api/tenant-config/complexity
 * Get loan complexity component configurations
 */
router.get(
  "/complexity",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const result = await tenantPool.query(`
      SELECT id, component_name, condition_value, weight, description, is_active, created_at, updated_at
      FROM public.complexity_components
      ORDER BY component_name, condition_value
    `);

      // Group by component_name
      const components: Record<string, any[]> = {};
      for (const row of result.rows) {
        if (!components[row.component_name])
          components[row.component_name] = [];
        components[row.component_name].push(row);
      }

      res.json({ components });
    } catch (error: any) {
      logError("Error fetching complexity components", error, {
        userId: req.userId,
      });
      res.status(500).json({ error: "Failed to fetch complexity components" });
    }
  }
);

/**
 * PUT /api/tenant-config/complexity/:componentName
 * Update complexity component weights
 */
router.put(
  "/complexity/:componentName",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { componentName } = req.params;

      const schema = z.object({
        values: z.array(
          z.object({
            condition_value: z.string(),
            weight: z.number(),
            description: z.string().optional(),
            is_active: z.boolean().optional(),
          })
        ),
      });

      const data = schema.parse(req.body);

      const results = [];
      for (const v of data.values) {
        const result = await tenantPool.query(
          `
        INSERT INTO public.complexity_components (component_name, condition_value, weight, description, is_active, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (component_name, condition_value)
        DO UPDATE SET weight = $3, description = COALESCE($4, complexity_components.description), 
                      is_active = COALESCE($5, complexity_components.is_active), updated_at = NOW()
        RETURNING *
      `,
          [
            componentName,
            v.condition_value,
            v.weight,
            v.description || null,
            v.is_active ?? true,
            req.userId,
          ]
        );
        results.push(result.rows[0]);
      }

      logInfo("Complexity components updated", {
        userId: req.userId,
        componentName,
      });
      res.json({ components: results });
    } catch (error: any) {
      logError("Error updating complexity components", error, {
        userId: req.userId,
        componentName: req.params.componentName,
      });
      res.status(500).json({ error: "Failed to update complexity components" });
    }
  }
);

// ============================================
// CALCULATION FORMULAS (Revenue, Margin, etc.)
// ============================================

/**
 * GET /api/tenant-config/calculations/fields
 * Get available fields that can be used in formulas (based on loans table columns)
 * Includes LOS field ID mappings from field_mappings and additional_field_definitions
 *
 * IMPORTANT: This specific route MUST be defined BEFORE the parametric route
 * /calculations/:calculationType to ensure Express matches it correctly.
 */
router.get(
  "/calculations/fields",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      // Check if loans table exists
      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'loans'
        ) as table_exists
      `);

      if (!tableCheck.rows[0]?.table_exists) {
        return res.json({ fields: [], error: "loans table not found" });
      }

      // Get all numeric columns from the loans table that could be used in formulas
      const result = await tenantPool.query(`
        SELECT column_name, data_type, is_nullable, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' 
          AND table_name = 'loans'
          AND (
            data_type IN ('numeric', 'decimal', 'integer', 'bigint', 'real', 'double precision', 'smallint', 'money')
            OR udt_name IN ('numeric', 'int4', 'int8', 'float4', 'float8', 'int2', 'money')
          )
        ORDER BY column_name
      `);

      // Build a map of column name -> {displayName, losFieldId}
      const fieldInfoMap = new Map<
        string,
        { displayName: string; losFieldId?: string }
      >();

      // Get field mappings to provide friendly names and LOS field IDs (if table exists)
      try {
        const mappingsResult = await tenantPool.query(`
          SELECT coheus_alias, display_name, field_type, los_field_id
          FROM public.field_mappings
          WHERE is_active = TRUE
        `);
        for (const m of mappingsResult.rows) {
          fieldInfoMap.set(m.coheus_alias, {
            displayName: m.display_name || m.coheus_alias,
            losFieldId: m.los_field_id || undefined,
          });
        }
      } catch {
        // Table may not exist for this tenant - that's OK
      }

      // Get additional field definitions for LOS field IDs (if table exists)
      try {
        const additionalFieldsResult = await tenantPool.query(`
          SELECT column_name, display_name, los_field_id, data_type
          FROM public.additional_field_definitions
        `);
        for (const f of additionalFieldsResult.rows) {
          fieldInfoMap.set(f.column_name, {
            displayName: f.display_name || f.column_name,
            losFieldId: f.los_field_id || undefined,
          });
        }
      } catch {
        // Table may not exist for this tenant - that's OK
      }

      const fields = result.rows.map((row) => {
        const info = fieldInfoMap.get(row.column_name);
        return {
          value: row.column_name,
          label: info?.displayName || row.column_name,
          dataType: row.data_type,
          nullable: row.is_nullable === "YES",
          losFieldId: info?.losFieldId,
        };
      });

      res.json({ fields });
    } catch (error: any) {
      logError("Error fetching available fields", error, {
        userId: req.userId,
      });
      res.status(500).json({ error: "Failed to fetch available fields" });
    }
  }
);

/**
 * POST /api/tenant-config/calculations/test
 * Test a calculation formula against sample data
 *
 * IMPORTANT: This specific route MUST be defined BEFORE the parametric route
 * /calculations/:calculationType to ensure Express matches it correctly.
 */
router.post(
  "/calculations/test",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { sql_expression } = req.body;

      if (!sql_expression) {
        return res.status(400).json({ error: "SQL expression is required" });
      }

      // Validate the SQL expression by running it against a limited set of loans
      const testQuery = `
        SELECT 
          COUNT(*) as loans_tested,
          COALESCE(SUM(${sql_expression}), 0) as total_revenue,
          COALESCE(AVG(${sql_expression}), 0) as avg_revenue
        FROM public.loans
        WHERE funding_date IS NOT NULL
        LIMIT 1000
      `;

      const result = await tenantPool.query(testQuery);

      res.json({
        result: {
          loans_tested: parseInt(result.rows[0]?.loans_tested) || 0,
          total_revenue: parseFloat(result.rows[0]?.total_revenue) || 0,
          avg_revenue: parseFloat(result.rows[0]?.avg_revenue) || 0,
        },
      });
    } catch (error: any) {
      logError("Formula test failed", error, { userId: req.userId });
      res.status(400).json({
        error: `Formula validation failed: ${error.message}. Please check that all field names are correct.`,
      });
    }
  }
);

/**
 * GET /api/tenant-config/calculations/:calculationType
 * Get the active calculation formula for a type (e.g., 'revenue')
 */
router.get(
  "/calculations/:calculationType",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { calculationType } = req.params;

      // First check if the table exists
      const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'tenant_calculations'
      ) as exists
    `);

      if (!tableCheck.rows[0].exists) {
        // Table doesn't exist yet - return null formula (will use default)
        return res.json({ formula: null });
      }

      const result = await tenantPool.query(
        `
      SELECT id, calculation_type, name, description, formula_components, 
             sql_expression, is_active, is_validated, validation_result,
             created_at, updated_at
      FROM public.tenant_calculations
      WHERE calculation_type = $1 AND is_active = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `,
        [calculationType]
      );

      res.json({ formula: result.rows[0] || null });
    } catch (error: any) {
      logError("Error fetching calculation formula", error, {
        userId: req.userId,
        calculationType: req.params.calculationType,
      });
      res.status(500).json({ error: "Failed to fetch calculation formula" });
    }
  }
);

/**
 * PUT /api/tenant-config/calculations/:calculationType
 * Save/update the calculation formula for a type
 */
router.put(
  "/calculations/:calculationType",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { calculationType } = req.params;
      const {
        name,
        description,
        formula_components,
        sql_expression,
        is_active = true,
      } = req.body;

      if (
        !formula_components ||
        !Array.isArray(formula_components) ||
        formula_components.length === 0
      ) {
        return res
          .status(400)
          .json({ error: "At least one formula component is required" });
      }

      // Ensure table exists (for tenants that were created before this feature)
      await tenantPool.query(`
      CREATE TABLE IF NOT EXISTS public.tenant_calculations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        calculation_type VARCHAR(50) NOT NULL DEFAULT 'revenue',
        name VARCHAR(100) NOT NULL,
        description TEXT,
        formula_components JSONB NOT NULL DEFAULT '[]',
        sql_expression TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        is_validated BOOLEAN DEFAULT FALSE,
        last_validated_at TIMESTAMPTZ,
        validation_result TEXT,
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by UUID REFERENCES public.users(id),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(calculation_type, name)
      )
    `);

      // Deactivate any existing active formulas of this type
      await tenantPool.query(
        `
      UPDATE public.tenant_calculations 
      SET is_active = FALSE, updated_at = NOW(), updated_by = $1
      WHERE calculation_type = $2 AND is_active = TRUE
    `,
        [req.userId, calculationType]
      );

      // Insert or update the formula
      const result = await tenantPool.query(
        `
      INSERT INTO public.tenant_calculations 
        (calculation_type, name, description, formula_components, sql_expression, is_active, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      ON CONFLICT (calculation_type, name) 
      DO UPDATE SET 
        description = EXCLUDED.description,
        formula_components = EXCLUDED.formula_components,
        sql_expression = EXCLUDED.sql_expression,
        is_active = EXCLUDED.is_active,
        is_validated = FALSE,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING id, calculation_type, name, description, formula_components, sql_expression, is_active, created_at, updated_at
    `,
        [
          calculationType,
          name || "Custom Formula",
          description || "",
          JSON.stringify(formula_components),
          sql_expression || "",
          is_active,
          req.userId,
        ]
      );

      // Clear the cached revenue expression so new queries use the updated formula
      if (calculationType === "revenue") {
        clearTenantRevenueExpressionCache();
        logInfo(
          "Cleared tenant revenue expression cache after formula update",
          {
            userId: req.userId,
          }
        );
      }

      res.json({
        formula: result.rows[0],
        message: "Formula saved successfully",
      });
    } catch (error: any) {
      logError("Error saving calculation formula", error, {
        userId: req.userId,
        calculationType: req.params.calculationType,
      });
      res.status(500).json({ error: "Failed to save calculation formula" });
    }
  }
);

// ============================================
// VERSION HISTORY
// ============================================

/**
 * GET /api/tenant-config/versions/:configType
 * Get version history for a config type
 */
router.get(
  "/versions/:configType",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { configType } = req.params;
      const configId = req.query.config_id as string | undefined;

      let query = `
      SELECT v.id, v.config_type, v.config_id, v.config_data, v.version_number, v.status,
             v.created_by, v.created_at, v.published_at, v.published_by, v.notes,
             u.full_name as created_by_name, u2.full_name as published_by_name
      FROM public.config_versions v
      LEFT JOIN public.users u ON v.created_by = u.id
      LEFT JOIN public.users u2 ON v.published_by = u2.id
      WHERE v.config_type = $1
    `;
      const params: any[] = [configType];

      if (configId) {
        query += ` AND v.config_id = $2`;
        params.push(configId);
      }

      query += ` ORDER BY v.created_at DESC LIMIT 50`;

      const result = await tenantPool.query(query, params);

      res.json({ versions: result.rows });
    } catch (error: any) {
      logError("Error fetching version history", error, {
        userId: req.userId,
        configType: req.params.configType,
      });
      res.status(500).json({ error: "Failed to fetch version history" });
    }
  }
);

// ============================================
// LEGACY CONFIG IMPORT
// Import field mappings from legacy Coheus XML configuration files
// ============================================

import {
  LegacyConfigImportService,
  parseLegacyXml,
  analyzeImport,
  ImportAnalysis,
} from "../services/legacyConfigImportService.js";

/**
 * POST /api/tenant-config/legacy-import/analyze
 * Analyze a legacy XML configuration file and return what would be imported
 */
router.post(
  "/legacy-import/analyze",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        xmlContent: z.string().min(100, "XML content appears to be too short"),
      });

      const data = schema.parse(req.body);

      logInfo("Analyzing legacy config XML", {
        userId: req.userId,
        contentLength: data.xmlContent.length,
      });

      // Parse and analyze
      const parsed = parseLegacyXml(data.xmlContent);
      const analysis = analyzeImport(parsed);

      logInfo("Legacy config analysis complete", {
        userId: req.userId,
        clientId: analysis.clientId,
        fieldSwaps: analysis.fieldSwaps.length,
        additionalFields: analysis.additionalFields.length,
        matchingFields: analysis.matchingFields,
      });

      res.json({ analysis });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request",
          details: error.errors,
        });
      }
      logError("Error analyzing legacy config", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to analyze legacy configuration",
      });
    }
  }
);

/**
 * POST /api/tenant-config/legacy-import/execute
 * Execute the import from a legacy XML configuration
 */
router.post(
  "/legacy-import/execute",
  authenticateToken,
  attachTenantContext,
  requireRole("tenant_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const schema = z.object({
        losConnectionId: z.string().uuid(),
        analysis: z.object({
          clientName: z.string(),
          clientId: z.string(),
          totalFieldsInXml: z.number(),
          fieldSwaps: z.array(
            z.object({
              alias: z.string(),
              clientFieldId: z.string(),
              defaultFieldId: z.string(),
              reason: z.enum(["different_mapping", "new_field_id_swap"]),
            })
          ),
          additionalFields: z.array(
            z.object({
              alias: z.string(),
              fieldId: z.string(),
              columnName: z.string(),
              dataType: z.enum([
                "string",
                "number",
                "date",
                "boolean",
                "currency",
              ]),
              category: z.string(),
              source: z.enum(["data_dictionary", "adhoc", "field_swap"]),
            })
          ),
          matchingFields: z.number(),
          warnings: z.array(z.string()),
        }),
        options: z
          .object({
            importFieldSwaps: z.boolean().optional(),
            importAdditionalFields: z.boolean().optional(),
            selectedSwaps: z.array(z.string()).optional(),
            selectedAdditional: z.array(z.string()).optional(),
          })
          .optional(),
      });

      const data = schema.parse(req.body);

      logInfo("Executing legacy config import", {
        userId: req.userId,
        losConnectionId: data.losConnectionId,
        clientId: data.analysis.clientId,
        fieldSwaps: data.analysis.fieldSwaps.length,
        additionalFields: data.analysis.additionalFields.length,
      });

      const service = new LegacyConfigImportService(tenantPool);
      const result = await service.import(
        data.losConnectionId,
        data.analysis as ImportAnalysis,
        req.userId!,
        data.options
      );

      logInfo("Legacy config import complete", {
        userId: req.userId,
        fieldSwapsCreated: result.fieldSwapsCreated,
        additionalFieldsCreated: result.additionalFieldsCreated,
        errors: result.errors.length,
      });

      res.json({ result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request",
          details: error.errors,
        });
      }
      logError("Error executing legacy config import", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to import legacy configuration",
      });
    }
  }
);

export default router;
