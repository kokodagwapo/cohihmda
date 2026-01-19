import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { startSync, stopRealtimeSync, getSyncStatus, handleFailover } from '../services/hybridSync.js';

const router = Router();

// Validation schemas
const provisionInstanceSchema = z.object({
  instance_type: z.enum(['cloud', 'on_premise']),
  instance_name: z.string().min(1),
  cloud_provider: z.enum(['aws', 'azure', 'gcp']).optional(),
  cloud_region: z.string().optional(),
  config: z.record(z.any()).optional(),
});

const registerInstanceSchema = z.object({
  instance_name: z.string().min(1),
  ip_address: z.string().optional(),
  hostname: z.string().optional(),
  version: z.string().optional(),
  config: z.record(z.any()).optional(),
});

const syncStartSchema = z.object({
  target_instance_id: z.string().uuid(),
  sync_type: z.enum(['full', 'incremental', 'realtime']).optional(),
});

/**
 * GET /api/deployments
 * List all deployment instances for authenticated tenant
 */
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id; allow super-admins to target a tenant via query or fall back to first tenant
    const requestedTenantId = req.query.tenant_id as string | undefined;
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    const userTenantId = profileResult.rows[0]?.tenant_id;
    const isSuperAdmin = !userTenantId;

    let tenantId: string | undefined;
    if (requestedTenantId && isSuperAdmin) {
      tenantId = requestedTenantId;
    } else if (userTenantId) {
      tenantId = userTenantId;
    } else if (isSuperAdmin) {
      const tenantResult = await pool.query(
        'SELECT id FROM public.tenants ORDER BY created_at ASC LIMIT 1'
      );
      tenantId = tenantResult.rows[0]?.id;
    }

    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const result = await pool.query(
      `SELECT 
        id, instance_type, instance_name, cloud_provider, cloud_region,
        ip_address, hostname, version, status, last_sync_at, sync_partner_id,
        config, created_at, updated_at
       FROM public.deployment_instances
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );

    res.json({ instances: result.rows });
  } catch (error: any) {
    console.error('Error fetching deployment instances:', error);
    res.status(500).json({ error: 'Failed to fetch deployment instances' });
  }
});

/**
 * POST /api/deployments/provision
 * Provision a new cloud instance
 */
router.post('/provision', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { instance_type, instance_name, cloud_provider, cloud_region, config } =
      provisionInstanceSchema.parse(req.body);

    if (instance_type === 'cloud' && (!cloud_provider || !cloud_region)) {
      return res.status(400).json({
        error: 'cloud_provider and cloud_region are required for cloud instances',
      });
    }

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Check subscription for deployment type
    const subscriptionResult = await pool.query(
      `SELECT ts.deployment_type, sp.deployment_options
       FROM public.tenant_subscriptions ts
       JOIN public.subscription_plans sp ON ts.plan_id = sp.id
       WHERE ts.tenant_id = $1 AND ts.status = 'active'`,
      [tenantId]
    );

    if (subscriptionResult.rows.length === 0) {
      return res.status(403).json({ error: 'No active subscription found' });
    }

    const subscription = subscriptionResult.rows[0];
    const allowedTypes = subscription.deployment_options || [];

    if (!allowedTypes.includes(instance_type) && !allowedTypes.includes('hybrid')) {
      return res.status(403).json({
        error: `Deployment type '${instance_type}' is not allowed for your subscription`,
      });
    }

    // Create instance record
    const result = await pool.query(
      `INSERT INTO public.deployment_instances
       (tenant_id, instance_type, instance_name, cloud_provider, cloud_region, status, config)
       VALUES ($1, $2, $3, $4, $5, 'provisioning', $6)
       RETURNING *`,
      [tenantId, instance_type, instance_name, cloud_provider || null, cloud_region || null, JSON.stringify(config || {})]
    );

    // TODO: Trigger actual cloud provisioning (Terraform, CloudFormation, etc.)
    // For now, just return the instance record

    res.status(201).json({ instance: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error provisioning instance:', error);
    res.status(500).json({ error: 'Failed to provision instance' });
  }
});

/**
 * POST /api/deployments/register
 * Register an on-premise instance (called by the on-premise server)
 */
router.post('/register', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { instance_name, ip_address, hostname, version, config } = registerInstanceSchema.parse(req.body);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Create on-premise instance record
    const result = await pool.query(
      `INSERT INTO public.deployment_instances
       (tenant_id, instance_type, instance_name, ip_address, hostname, version, status, config)
       VALUES ($1, 'on_premise', $2, $3, $4, $5, 'active', $6)
       RETURNING *`,
      [
        tenantId,
        instance_name,
        ip_address || null,
        hostname || null,
        version || null,
        JSON.stringify(config || {}),
      ]
    );

    res.status(201).json({ instance: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error registering instance:', error);
    res.status(500).json({ error: 'Failed to register instance' });
  }
});

/**
 * POST /api/deployments/sync/start
 * Start a sync operation between two instances
 */
router.post('/sync/start', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { target_instance_id, sync_type } = syncStartSchema.parse(req.body);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Get source instance (first active instance for this tenant)
    const sourceResult = await pool.query(
      `SELECT id FROM public.deployment_instances
       WHERE tenant_id = $1 AND status = 'active'
       ORDER BY created_at ASC
       LIMIT 1`,
      [tenantId]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active source instance found' });
    }

    const sourceInstanceId = sourceResult.rows[0].id;

    // Verify target instance belongs to tenant
    const targetResult = await pool.query(
      'SELECT id FROM public.deployment_instances WHERE id = $1 AND tenant_id = $2',
      [target_instance_id, tenantId]
    );

    if (targetResult.rows.length === 0) {
      return res.status(404).json({ error: 'Target instance not found' });
    }

    // Start sync operation
    const syncResult = await startSync({
      sourceInstanceId,
      targetInstanceId: target_instance_id,
      syncType: sync_type || 'incremental',
      tenantId,
    });

    if (!syncResult.success) {
      return res.status(500).json({
        error: 'Sync failed',
        details: syncResult.errors,
      });
    }

    // Get the sync event record
    const syncEventResult = await pool.query(
      `SELECT * FROM public.sync_events
       WHERE source_instance_id = $1 
         AND target_instance_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [sourceInstanceId, target_instance_id]
    );

    res.status(201).json({
      sync: syncEventResult.rows[0],
      result: syncResult,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error starting sync:', error);
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

/**
 * GET /api/deployments/sync/status
 * Get sync status for an instance
 */
router.get('/sync/status', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const instanceId = req.query.instance_id as string | undefined;

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    if (instanceId) {
      // Get sync status for specific instance pair
      const sourceResult = await pool.query(
        'SELECT id FROM public.deployment_instances WHERE tenant_id = $1 AND status = $2 ORDER BY created_at ASC LIMIT 1',
        [tenantId, 'active']
      );

      if (sourceResult.rows.length > 0) {
        const sourceInstanceId = sourceResult.rows[0].id;
        const status = await getSyncStatus(sourceInstanceId, instanceId);
        return res.json({ sync: status });
      }
    }

    // Get all sync events for tenant
    let query = `
      SELECT se.*
      FROM public.sync_events se
      JOIN public.deployment_instances di ON se.source_instance_id = di.id OR se.target_instance_id = di.id
      WHERE di.tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (instanceId) {
      query += ' AND (se.source_instance_id = $2 OR se.target_instance_id = $2)';
      params.push(instanceId);
    }

    query += ' ORDER BY se.created_at DESC LIMIT 10';

    const result = await pool.query(query, params);

    res.json({ syncs: result.rows });
  } catch (error: any) {
    console.error('Error fetching sync status:', error);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

/**
 * POST /api/deployments/failover
 * Trigger failover to secondary instance
 */
router.post('/failover', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { target_instance_id } = z.object({
      target_instance_id: z.string().uuid(),
    }).parse(req.body);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Verify target instance belongs to tenant and is active
    const targetResult = await pool.query(
      'SELECT id, status FROM public.deployment_instances WHERE id = $1 AND tenant_id = $2',
      [target_instance_id, tenantId]
    );

    if (targetResult.rows.length === 0) {
      return res.status(404).json({ error: 'Target instance not found' });
    }

    if (targetResult.rows[0].status !== 'active') {
      return res.status(400).json({ error: 'Target instance is not active' });
    }

    // Use the hybrid sync service for failover
    await handleFailover(tenantId, target_instance_id);

    res.json({ message: 'Failover completed successfully' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error triggering failover:', error);
    res.status(500).json({ error: 'Failed to trigger failover' });
  }
});

export default router;

