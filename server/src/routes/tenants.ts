/**
 * Tenant Management Routes
 * API endpoints for tenant provisioning and management
 */

import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import {
  createTenant,
  getTenant,
  getTenantBySlug,
  listTenants,
  updateTenantStatus,
  deleteTenant,
  CreateTenantOptions,
} from '../services/tenantProvisioningService.js';
import { z } from 'zod';

const router = Router();

/**
 * POST /api/tenants
 * Create a new tenant (super_admin only)
 */
router.post(
  '/',
  authenticateToken,
  requireRole('super_admin', 'tenant_admin'),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
        deployment_type: z.enum(['cloud', 'on_premise', 'per_lender_aws']),
        database_host: z.string().min(1),
        database_port: z.number().optional(),
        database_user: z.string().min(1),
        database_password: z.string().min(1),
        aws_account_id: z.string().optional(),
        rds_instance_id: z.string().optional(),
      });

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
      console.error('[Tenants] Error creating tenant:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      res.status(500).json({ error: error.message || 'Failed to create tenant' });
    }
  }
);

/**
 * GET /api/tenants
 * List all tenants (super_admin only)
 */
router.get(
  '/',
  authenticateToken,
  requireRole('super_admin', 'tenant_admin'),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenants = await listTenants();
      res.json(tenants);
    } catch (error: any) {
      console.error('[Tenants] Error listing tenants:', error);
      res.status(500).json({ error: 'Failed to list tenants' });
    }
  }
);

/**
 * GET /api/tenants/:id
 * Get tenant by ID
 */
router.get(
  '/:id',
  authenticateToken,
  requireRole('super_admin', 'tenant_admin'),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenant = await getTenant(req.params.id);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      res.json(tenant);
    } catch (error: any) {
      console.error('[Tenants] Error getting tenant:', error);
      res.status(500).json({ error: 'Failed to get tenant' });
    }
  }
);

/**
 * GET /api/tenants/slug/:slug
 * Get tenant by slug
 */
router.get(
  '/slug/:slug',
  authenticateToken,
  requireRole('super_admin', 'tenant_admin'),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenant = await getTenantBySlug(req.params.slug);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      res.json(tenant);
    } catch (error: any) {
      console.error('[Tenants] Error getting tenant by slug:', error);
      res.status(500).json({ error: 'Failed to get tenant' });
    }
  }
);

/**
 * PATCH /api/tenants/:id/status
 * Update tenant status (super_admin only)
 */
router.patch(
  '/:id/status',
  authenticateToken,
  requireRole('super_admin'),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        status: z.enum(['active', 'suspended', 'deleted', 'provisioning']),
      });

      const validated = schema.parse(req.body);
      await updateTenantStatus(req.params.id, validated.status);
      res.json({ message: 'Tenant status updated' });
    } catch (error: any) {
      console.error('[Tenants] Error updating tenant status:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update tenant status' });
    }
  }
);

/**
 * DELETE /api/tenants/:id
 * Delete tenant (soft delete, super_admin only)
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole('super_admin'),
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      await deleteTenant(req.params.id);
      res.json({ message: 'Tenant deleted' });
    } catch (error: any) {
      console.error('[Tenants] Error deleting tenant:', error);
      res.status(500).json({ error: 'Failed to delete tenant' });
    }
  }
);

export default router;
