/**
 * Tenant Management Routes
 * API endpoints for tenant provisioning and management
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import {
  createTenant,
  getTenant,
  getTenantBySlug,
  listTenants,
  updateTenantStatus,
  deleteTenant,
  CreateTenantOptions,
} from "../services/tenantProvisioningService.js";
import { duplicateTenantAnonymized } from "../services/tenantDuplicationService.js";
import { z } from "zod";
import { pool as managementPool } from "../config/managementDatabase.js";

const router = Router();

/**
 * POST /api/tenants
 * Create a new tenant (super_admin only)
 */
router.post(
  "/",
  authenticateToken,
  requireRole("super_admin", "tenant_admin"),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      // Base schema - database fields are optional for cloud deployments
      const schema = z
        .object({
          name: z.string().min(1),
          slug: z
            .string()
            .min(1)
            .regex(/^[a-z0-9-]+$/),
          deployment_type: z.enum(["cloud", "on_premise", "per_lender_aws"]),
          // These are only required for non-cloud deployments
          database_host: z.string().optional(),
          database_port: z.number().optional(),
          database_user: z.string().optional(),
          database_password: z.string().optional(),
          aws_account_id: z.string().optional(),
          rds_instance_id: z.string().optional(),
        })
        .refine(
          (data) => {
            // For non-cloud deployments, require database credentials
            if (data.deployment_type !== "cloud") {
              return (
                data.database_host &&
                data.database_user &&
                data.database_password
              );
            }
            return true;
          },
          {
            message:
              "Non-cloud deployments require database_host, database_user, and database_password",
          },
        );

      const validated = schema.parse(req.body);
      const options: CreateTenantOptions = {
        name: validated.name,
        slug: validated.slug,
        deployment_type: validated.deployment_type,
        database_host: validated.database_host,
        database_port: validated.database_port,
        database_user: validated.database_user,
        database_password: validated.database_password,
        aws_account_id: validated.aws_account_id,
        rds_instance_id: validated.rds_instance_id,
      };

      const tenant = await createTenant(options);
      res.status(201).json(tenant);
    } catch (error: any) {
      console.error("[Tenants] Error creating tenant:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Validation error", details: error.errors });
      }
      res
        .status(500)
        .json({ error: error.message || "Failed to create tenant" });
    }
  },
);

/**
 * GET /api/tenants
 * List all tenants (super_admin only)
 */
router.get(
  "/",
  authenticateToken,
  requireRole("super_admin", "tenant_admin"),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenants = await listTenants();
      res.json(tenants);
    } catch (error: any) {
      console.error("[Tenants] Error listing tenants:", error);
      res.status(500).json({ error: "Failed to list tenants" });
    }
  },
);

/**
 * GET /api/tenants/:id
 * Get tenant by ID
 */
router.get(
  "/:id",
  authenticateToken,
  requireRole("super_admin", "tenant_admin"),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;
      const tenant = await getTenant(id);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      res.json(tenant);
    } catch (error: any) {
      console.error("[Tenants] Error getting tenant:", error);
      res.status(500).json({ error: "Failed to get tenant" });
    }
  },
);

/**
 * GET /api/tenants/slug/:slug
 * Get tenant by slug
 */
router.get(
  "/slug/:slug",
  authenticateToken,
  requireRole("super_admin", "tenant_admin"),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const slug = req.params.slug as string;
      const tenant = await getTenantBySlug(slug);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      res.json(tenant);
    } catch (error: any) {
      console.error("[Tenants] Error getting tenant by slug:", error);
      res.status(500).json({ error: "Failed to get tenant" });
    }
  },
);

/**
 * PATCH /api/tenants/:id/status
 * Update tenant status (super_admin only)
 */
router.patch(
  "/:id/status",
  authenticateToken,
  requireRole("super_admin"),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;
      const schema = z.object({
        status: z.enum(["active", "suspended", "deleted", "provisioning"]),
      });

      const validated = schema.parse(req.body);
      await updateTenantStatus(id, validated.status);
      res.json({ message: "Tenant status updated" });
    } catch (error: any) {
      console.error("[Tenants] Error updating tenant status:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Validation error", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update tenant status" });
    }
  },
);

/**
 * PUT /api/tenants/:id/settings
 * Update tenant display settings (name, logo, contact)
 */
router.put(
  "/:id/settings",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin"),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      // Tenant admins can only update their own tenant
      if (req.userRole === "tenant_admin" && req.tenantId !== id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const schema = z.object({
        display_name: z.string().min(1).optional(),
        logo_url: z.string().optional(),
        primary_contact_email: z.string().email().optional(),
        notification_preferences: z.record(z.any()).optional(),
      });

      const validated = schema.parse(req.body);

      // Build SET clause dynamically
      const setClauses: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (validated.display_name !== undefined) {
        setClauses.push(`name = $${idx}`);
        values.push(validated.display_name);
        idx++;
      }
      if (validated.logo_url !== undefined) {
        setClauses.push(`logo_url = $${idx}`);
        values.push(validated.logo_url);
        idx++;
      }
      if (validated.primary_contact_email !== undefined) {
        setClauses.push(`primary_contact_email = $${idx}`);
        values.push(validated.primary_contact_email);
        idx++;
      }
      if (validated.notification_preferences !== undefined) {
        setClauses.push(`notification_preferences = $${idx}`);
        values.push(JSON.stringify(validated.notification_preferences));
        idx++;
      }

      if (setClauses.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(id);

      await managementPool.query(
        `UPDATE tenants SET ${setClauses.join(", ")} WHERE id = $${idx}`,
        values,
      );

      const updated = await getTenant(id);
      res.json(updated);
    } catch (error: any) {
      console.error("[Tenants] Error updating tenant settings:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Validation error", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update tenant settings" });
    }
  },
);

/**
 * DELETE /api/tenants/:id
 * Permanently delete a tenant, its database, and all related data (super_admin only)
 */
router.delete(
  "/:id",
  authenticateToken,
  requireRole("super_admin"),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const id = req.params.id as string;

      // Fetch tenant info before deletion for the response
      const tenant = await getTenant(id);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      await deleteTenant(id);
      res.json({
        message: "Tenant permanently deleted",
        deletedTenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      });
    } catch (error: any) {
      console.error("[Tenants] Error deleting tenant:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to delete tenant" });
    }
  },
);

// ── Duplication job tracking (in-memory) ─────────────────────────────
interface DuplicationJob {
  slug: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  result?: any;
  error?: string;
}
const duplicationJobs = new Map<string, DuplicationJob>();

/**
 * POST /api/tenants/:id/duplicate
 * Start an async tenant duplication with anonymized personnel data (super_admin only).
 * Returns 202 Accepted immediately with a job slug that can be polled.
 */
router.post(
  "/:id/duplicate",
  authenticateToken,
  requireRole("super_admin"),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const sourceId = req.params.id as string;

      const schema = z.object({
        name: z.string().min(1, "Tenant name is required"),
        slug: z
          .string()
          .min(1)
          .regex(
            /^[a-z0-9-]+$/,
            "Slug must be lowercase alphanumeric with hyphens",
          ),
      });

      const validated = schema.parse(req.body);

      // Check for an existing running job for this slug
      const existingJob = duplicationJobs.get(validated.slug);
      if (existingJob?.status === "running") {
        return res.status(429).json({
          error: `A duplication to slug "${validated.slug}" is already in progress`,
          jobSlug: validated.slug,
        });
      }

      console.log(
        `[Tenants] Starting async duplication: ${sourceId} -> "${validated.name}" (${validated.slug})`,
      );

      // Track the job
      const job: DuplicationJob = {
        slug: validated.slug,
        status: "running",
        startedAt: new Date(),
      };
      duplicationJobs.set(validated.slug, job);

      // Fire-and-forget: run duplication in the background
      duplicateTenantAnonymized(sourceId, validated.name, validated.slug)
        .then((result) => {
          job.status = "completed";
          job.completedAt = new Date();
          job.result = result;
          console.log(
            `[Tenants] Async duplication completed: "${validated.slug}"`,
          );
        })
        .catch((err) => {
          job.status = "failed";
          job.completedAt = new Date();
          job.error = err.message || "Unknown error";
          console.error(
            `[Tenants] Async duplication failed: "${validated.slug}":`,
            err.message,
          );
        });

      // Return immediately — the client polls GET /api/tenants/duplication-status/:slug
      res.status(202).json({
        message: "Duplication started",
        jobSlug: validated.slug,
        pollUrl: `/api/tenants/duplication-status/${validated.slug}`,
      });
    } catch (error: any) {
      console.error("[Tenants] Error starting duplication:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Validation error", details: error.errors });
      }
      if (error.message?.includes("already exists")) {
        return res.status(409).json({ error: error.message });
      }
      if (error.message?.includes("already in progress")) {
        return res.status(429).json({ error: error.message });
      }
      res
        .status(500)
        .json({ error: error.message || "Failed to start duplication" });
    }
  },
);

/**
 * GET /api/tenants/duplication-status/:slug
 * Poll the status of an async duplication job.
 */
router.get(
  "/duplication-status/:slug",
  authenticateToken,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const slug = req.params.slug as string;
    const job = duplicationJobs.get(slug);

    if (!job) {
      return res
        .status(404)
        .json({ error: "No duplication job found for this slug" });
    }

    const elapsed = Math.round((Date.now() - job.startedAt.getTime()) / 1000);

    if (job.status === "running") {
      return res.json({ status: "running", elapsedSeconds: elapsed });
    }

    if (job.status === "completed") {
      // Clean up after returning the result
      duplicationJobs.delete(slug);
      return res.json({
        status: "completed",
        elapsedSeconds: elapsed,
        result: job.result,
      });
    }

    // Failed
    duplicationJobs.delete(slug);
    return res.json({
      status: "failed",
      elapsedSeconds: elapsed,
      error: job.error,
    });
  },
);

export default router;
