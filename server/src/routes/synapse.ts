/**
 * Synapse Connect Routes
 * Universal connector for vendor integrations (Accounting, Capital Markets, Servicing)
 */

import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { z } from 'zod';
import { syncLoansToVendor, testVendorConnection } from '../services/vendorConnector.js';

const router = Router();

// Known vendors by category
const VENDOR_CATALOG = {
  accounting: [
    { name: 'QuickBooks', apiEndpoint: 'https://api.quickbooks.com', authType: 'oauth2', description: 'Intuit QuickBooks Online API' },
    { name: 'Xero', apiEndpoint: 'https://api.xero.com', authType: 'oauth2', description: 'Xero Accounting API' },
    { name: 'Sage', apiEndpoint: 'https://api.sage.com', authType: 'api_key', description: 'Sage Business Cloud Accounting' },
    { name: 'NetSuite', apiEndpoint: 'https://api.netsuite.com', authType: 'oauth2', description: 'Oracle NetSuite ERP' },
    { name: 'FreshBooks', apiEndpoint: 'https://api.freshbooks.com', authType: 'oauth2', description: 'FreshBooks Accounting API' },
    { name: 'Custom Accounting System', apiEndpoint: '', authType: 'api_key', description: 'Custom accounting integration' },
  ],
  capital_markets: [
    { name: 'Bloomberg', apiEndpoint: 'https://api.bloomberg.com', authType: 'api_key', description: 'Bloomberg Terminal API' },
    { name: 'Black Knight', apiEndpoint: 'https://api.blackknight.com', authType: 'oauth2', description: 'Black Knight Capital Markets' },
    { name: 'Ellie Mae Capital Markets', apiEndpoint: 'https://api.elliemae.com/capital', authType: 'oauth2', description: 'ICE Encompass Capital Markets' },
    { name: 'Optimal Blue', apiEndpoint: 'https://api.optimalblue.com', authType: 'api_key', description: 'Optimal Blue Pricing Engine' },
    { name: 'LoanBeam', apiEndpoint: 'https://api.loanbeam.com', authType: 'api_key', description: 'LoanBeam Trading Platform' },
    { name: 'Custom Capital Markets Platform', apiEndpoint: '', authType: 'api_key', description: 'Custom capital markets integration' },
  ],
  servicing: [
    { name: 'Black Knight MSP', apiEndpoint: 'https://api.blackknight.com/msp', authType: 'oauth2', description: 'Black Knight Mortgage Servicing Platform' },
    { name: 'FICS', apiEndpoint: 'https://api.fics.com', authType: 'api_key', description: 'FICS Loan Servicing System' },
    { name: 'Sagent', apiEndpoint: 'https://api.sagent.com', authType: 'oauth2', description: 'Sagent Servicing Technology' },
    { name: 'Calyx Servicing', apiEndpoint: '', authType: 'database', description: 'Calyx Point Servicing Database' },
    { name: 'Nationstar', apiEndpoint: 'https://api.nationstar.com', authType: 'oauth2', description: 'Nationstar Mortgage Servicing' },
    { name: 'Custom Servicing System', apiEndpoint: '', authType: 'api_key', description: 'Custom servicing integration' },
  ],
};

const vendorConnectionSchema = z.object({
  vendor_name: z.string().min(1),
  vendor_category: z.enum(['accounting', 'capital_markets', 'servicing']),
  connection_type: z.enum(['vendor_initiated', 'lender_initiated']),
  vendor_api_key: z.string().optional(),
  vendor_api_endpoint: z.string().url().optional().or(z.literal('')),
  vendor_credentials: z.string().optional(),
  vendor_webhook_url: z.string().url().optional(),
  vendor_webhook_secret: z.string().optional(),
  data_mapping: z.record(z.string()).optional(),
  sync_enabled: z.boolean().optional(),
  sync_frequency: z.enum(['realtime', 'hourly', 'daily', 'weekly']).optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * GET /api/synapse/vendors
 * List available vendors by category
 */
router.get('/vendors', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { category } = req.query;

    if (category && (category === 'accounting' || category === 'capital_markets' || category === 'servicing')) {
      res.json({ vendors: VENDOR_CATALOG[category] });
    } else {
      res.json({ vendors: VENDOR_CATALOG });
    }
  } catch (error: any) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

/**
 * GET /api/synapse/connections
 * Get all vendor connections for authenticated tenant
 */
router.get('/connections', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.json({ connections: [] });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    let rows: any[] = [];
    try {
      const result = await pool.query(
        `SELECT * FROM public.vendor_connections WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId]
      );
      rows = result.rows;
    } catch (err: any) {
      if (err.code === '42P01') {
        // vendor_connections table doesn't exist yet — return empty
        return res.json({ connections: [] });
      }
      throw err;
    }

    // Mask sensitive fields
    const connections = rows.map(conn => ({
      ...conn,
      vendor_api_key: conn.vendor_api_key ? '••••••••' : null,
      vendor_credentials: conn.vendor_credentials ? '••••••••' : null,
      vendor_webhook_secret: conn.vendor_webhook_secret ? '••••••••' : null,
    }));

    res.json({ connections });
  } catch (error: any) {
    console.error('Error fetching vendor connections:', error);
    res.status(500).json({ error: 'Failed to fetch vendor connections' });
  }
});

/**
 * GET /api/synapse/connections/:id
 * Get a specific vendor connection
 */
router.get('/connections/:id', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM public.vendor_connections WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor connection not found' });
    }

    // Mask sensitive fields
    const connection = result.rows[0];
    if (connection.vendor_api_key) connection.vendor_api_key = '••••••••';
    if (connection.vendor_credentials) connection.vendor_credentials = '••••••••';
    if (connection.vendor_webhook_secret) connection.vendor_webhook_secret = '••••••••';

    res.json({ connection });
  } catch (error: any) {
    console.error('Error fetching vendor connection:', error);
    res.status(500).json({ error: 'Failed to fetch vendor connection' });
  }
});

/**
 * POST /api/synapse/connections
 * Create a new vendor connection
 */
router.post('/connections', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const data = vendorConnectionSchema.parse(req.body);

    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    const tenantId = profileResult.rows[0]?.tenant_id || '00000000-0000-0000-0000-000000000000';

    const result = await pool.query(
      `INSERT INTO public.vendor_connections (
        tenant_id, vendor_name, vendor_category, connection_type,
        vendor_api_key, vendor_api_endpoint, vendor_credentials,
        vendor_webhook_url, vendor_webhook_secret, data_mapping,
        sync_enabled, sync_frequency, metadata, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        tenantId,
        data.vendor_name,
        data.vendor_category,
        data.connection_type,
        data.vendor_api_key || null,
        data.vendor_api_endpoint || null,
        data.vendor_credentials || null,
        data.vendor_webhook_url || null,
        data.vendor_webhook_secret || null,
        data.data_mapping ? JSON.stringify(data.data_mapping) : null,
        data.sync_enabled ?? true,
        data.sync_frequency || 'hourly',
        data.metadata ? JSON.stringify(data.metadata) : null,
        req.userId,
      ]
    );

    res.json({ connection: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Error creating vendor connection:', error);
    res.status(500).json({ error: 'Failed to create vendor connection' });
  }
});

/**
 * PUT /api/synapse/connections/:id
 * Update a vendor connection
 */
router.put('/connections/:id', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = vendorConnectionSchema.partial().parse(req.body);

    // Check if connection exists
    const connectionResult = await pool.query(
      'SELECT tenant_id FROM public.vendor_connections WHERE id = $1',
      [id]
    );

    if (connectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor connection not found' });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.vendor_name) {
      updates.push(`vendor_name = $${paramIndex++}`);
      values.push(data.vendor_name);
    }
    if (data.vendor_api_key !== undefined) {
      updates.push(`vendor_api_key = $${paramIndex++}`);
      values.push(data.vendor_api_key || null);
    }
    if (data.vendor_api_endpoint !== undefined) {
      updates.push(`vendor_api_endpoint = $${paramIndex++}`);
      values.push(data.vendor_api_endpoint || null);
    }
    if (data.sync_enabled !== undefined) {
      updates.push(`sync_enabled = $${paramIndex++}`);
      values.push(data.sync_enabled);
    }
    if (data.sync_frequency) {
      updates.push(`sync_frequency = $${paramIndex++}`);
      values.push(data.sync_frequency);
    }
    if (data.data_mapping !== undefined) {
      updates.push(`data_mapping = $${paramIndex++}`);
      values.push(data.data_mapping ? JSON.stringify(data.data_mapping) : null);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    if (updates.length === 1) {
      return res.json({ connection: connectionResult.rows[0] });
    }

    const result = await pool.query(
      `UPDATE public.vendor_connections SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json({ connection: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Error updating vendor connection:', error);
    res.status(500).json({ error: 'Failed to update vendor connection' });
  }
});

/**
 * DELETE /api/synapse/connections/:id
 * Delete a vendor connection
 */
router.delete('/connections/:id', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM public.vendor_connections WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor connection not found' });
    }

    res.json({ success: true, message: 'Connection deleted' });
  } catch (error: any) {
    console.error('Error deleting vendor connection:', error);
    res.status(500).json({ error: 'Failed to delete vendor connection' });
  }
});

/**
 * POST /api/synapse/connections/:id/test
 * Test a vendor connection
 */
router.post('/connections/:id/test', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const result = await testVendorConnection(id);

    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error: any) {
    console.error('Error testing vendor connection:', error);
    res.status(500).json({ error: error.message || 'Failed to test vendor connection' });
  }
});

/**
 * POST /api/synapse/connections/:id/sync
 * Trigger manual sync for a vendor connection (reads from loans table)
 */
router.post('/connections/:id/sync', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;

    const connectionResult = await pool.query(
      'SELECT * FROM public.vendor_connections WHERE id = $1',
      [id]
    );

    if (connectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor connection not found' });
    }

    // Update sync status to pending
    await pool.query(
      `UPDATE public.vendor_connections
       SET last_synced_at = NOW(), last_sync_status = 'pending', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    // Run sync asynchronously (reads from loans table)
    syncLoansToVendor(id).catch((error) => {
      console.error('Background vendor sync error:', error);
    });

    res.json({ success: true, message: 'Sync started. Reading from LOS-synced loan data and pushing to vendor.' });
  } catch (error: any) {
    console.error('Error triggering vendor sync:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger sync' });
  }
});

/**
 * GET /api/synapse/connections/:id/logs
 * Get sync logs for a vendor connection
 */
router.get('/connections/:id/logs', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await pool.query(
      `SELECT * FROM public.vendor_sync_logs 
       WHERE vendor_connection_id = $1 
       ORDER BY started_at DESC 
       LIMIT $2`,
      [id, limit]
    );

    res.json({ logs: result.rows });
  } catch (error: any) {
    console.error('Error fetching vendor sync logs:', error);
    res.status(500).json({ error: 'Failed to fetch sync logs' });
  }
});

/**
 * POST /api/synapse/webhooks/:connectionId
 * Handle incoming webhooks from vendors (for vendor-initiated connections)
 */
router.post('/webhooks/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const webhookPayload = req.body;
    const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];

    // Get connection to verify webhook secret
    const connectionResult = await pool.query(
      'SELECT * FROM public.vendor_connections WHERE id = $1 AND connection_type = $2',
      [connectionId, 'vendor_initiated']
    );

    if (connectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor connection not found' });
    }

    const connection = connectionResult.rows[0];

    // Verify webhook signature if secret is configured
    if (connection.vendor_webhook_secret && signature) {
      // TODO: Implement signature verification (HMAC SHA256)
      // For now, we'll accept the webhook if secret is configured
      console.log('Webhook signature verification needed');
    }

    // Process webhook payload
    // This would typically update the loans table or trigger a sync
    console.log(`Webhook received for connection ${connectionId}:`, webhookPayload);

    // Log webhook receipt
    await pool.query(
      `INSERT INTO public.vendor_sync_logs (vendor_connection_id, tenant_id, sync_type, status, started_at, completed_at, metadata)
       VALUES ($1, $2, 'webhook', 'success', NOW(), NOW(), $3)`,
      [connectionId, connection.tenant_id, JSON.stringify({ payload: webhookPayload })]
    );

    res.json({ success: true, message: 'Webhook received and processed' });
  } catch (error: any) {
    console.error('Error processing vendor webhook:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

export default router;
