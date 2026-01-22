/**
 * LOS (Loan Origination System) Universal Connector Routes
 * Manages LOS connections, API integrations, and CSV uploads
 */

import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
import { encryptField, decryptField } from '../services/encryption.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { z } from 'zod';
import multer from 'multer';
import Papa from 'papaparse';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getTenantFieldMappings, suggestFieldMappings, applyFieldMapping } from '../services/fieldMapper.js';
import { createTestConnection, shouldUseMockApi } from '../services/mockLosHelper.js';
import { logError, logWarn, logInfo, logDebug } from '../services/logger.js';

/**
 * Ensure los_connections table has all required columns (migration helper)
 * This adds missing columns to existing databases
 */
async function ensureLosConnectionsSchema(pool: any, tenantId?: string): Promise<void> {
  try {
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'los_connections'
      )
    `);
    
    if (!tableCheck.rows[0]?.exists) {
      logDebug('los_connections table does not exist, skipping migration', { tenantId });
      return;
    }
    
    logInfo('Checking los_connections schema for missing columns', { tenantId });
    
    // Check and add encompass_api_server column
    const apiServerCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'los_connections'
        AND column_name = 'encompass_api_server'
      )
    `);
    
    if (!apiServerCheck.rows[0]?.exists) {
      logInfo('Adding encompass_api_server column to los_connections table', { tenantId });
      await pool.query(`
        ALTER TABLE public.los_connections 
        ADD COLUMN encompass_api_server TEXT DEFAULT 'https://api.elliemae.com'
      `);
      logInfo('Successfully added encompass_api_server column', { tenantId });
    }

    // Check and add encompass_selected_folders column
    const foldersColumnCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'los_connections'
        AND column_name = 'encompass_selected_folders'
      )
    `);
    
    if (!foldersColumnCheck.rows[0]?.exists) {
      logInfo('Adding encompass_selected_folders column to los_connections table', { tenantId });
      await pool.query(`
        ALTER TABLE public.los_connections 
        ADD COLUMN encompass_selected_folders JSONB DEFAULT '[]'::jsonb
      `);
      logInfo('Successfully added encompass_selected_folders column', { tenantId });
    }
    
    // Migration: Change loan_officer_id from UUID to TEXT to handle Encompass string values
    // This runs on every sync to ensure the column is migrated even if it was created before the fix
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'loans'
            AND column_name = 'loan_officer_id'
            AND data_type = 'uuid'
          ) THEN
            ALTER TABLE public.loans
            ALTER COLUMN loan_officer_id TYPE TEXT USING loan_officer_id::TEXT;
            RAISE NOTICE 'Migrated loan_officer_id from UUID to TEXT';
          END IF;
        END $$;
      `);
      console.log('[ensureLosConnectionsSchema] loan_officer_id migration check completed');
    } catch (error: any) {
      console.error('[ensureLosConnectionsSchema] Error migrating loan_officer_id:', error.message);
      // Don't throw - allow sync to continue
    }
    
    logInfo('los_connections schema check completed', { tenantId });
  } catch (schemaError: any) {
    logError('Error ensuring los_connections schema exists', schemaError, { tenantId, error: schemaError.message, stack: schemaError.stack });
    throw schemaError;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// Ensure uploads directory exists (for file-based processing if needed)
const uploadsDir = join(__dirname, '../../uploads/csv');
if (!existsSync(uploadsDir)) {
  mkdir(uploadsDir, { recursive: true }).catch((error) => {
    logError('Failed to create uploads directory', error, { uploadsDir });
  });
}

// Configure multer for CSV file uploads
// Use memory storage for column detection (consistent with dashboard routes)
// File-based storage is still available for csv/process endpoint if needed
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// LOS Types with their default configurations
const LOS_CONFIGS = {
  encompass: {
    name: 'ICE Encompass',
    authType: 'oauth2',
    defaultBaseUrl: 'https://api.elliemae.com',
    defaultAuthUrl: 'https://api.elliemae.com/oauth2/v1/authorize',
    defaultTokenUrl: 'https://api.elliemae.com/oauth2/v1/token',
    scopes: ['lp', 'lp_master_readonly'],
    documentation: 'https://mortgagetech.ice.com/resources/encompass-developer-connect',
  },
  meridianlink: {
    name: 'MeridianLink',
    authType: 'api_key',
    defaultBaseUrl: 'https://api.meridianlink.com',
    documentation: 'https://www.meridianlink.com/solutions/loan-origination-software/',
  },
  calyx: {
    name: 'Calyx Point',
    authType: 'database',
    defaultBaseUrl: '',
    documentation: 'https://www.calyxsoftware.com/',
  },
  optimalblue: {
    name: 'OptimalBlue',
    authType: 'api_key',
    defaultBaseUrl: 'https://api.optimalblue.com',
    documentation: 'https://www.optimalblue.com/',
  },
  mortgagebot: {
    name: 'MortgageBot',
    authType: 'api_key',
    defaultBaseUrl: '',
    documentation: '',
  },
  floify: {
    name: 'Floify',
    authType: 'api_key',
    defaultBaseUrl: 'https://api.floify.com',
    documentation: 'https://floify.com/',
  },
  bytepro: {
    name: 'BytePro',
    authType: 'api_key',
    defaultBaseUrl: '',
    documentation: '',
  },
  generic: {
    name: 'Generic/Custom LOS',
    authType: 'api_key',
    defaultBaseUrl: '',
    documentation: '',
  },
};

const losConnectionSchema = z.object({
  los_type: z.enum(['encompass', 'meridianlink', 'calyx', 'optimalblue', 'mortgagebot', 'floify', 'bytepro', 'generic']),
  name: z.string().min(1),
  connection_method: z.enum(['api', 'csv_upload', 'database']),
  api_base_url: z.string().optional(),
  api_client_id: z.string().optional(),
  api_client_secret: z.string().optional(),
  api_key: z.string().optional(),
  api_environment: z.enum(['sandbox', 'production']).optional(),
  oauth_authorization_url: z.string().optional(),
  oauth_token_url: z.string().optional(),
  oauth_scopes: z.string().optional(),
  sync_enabled: z.boolean().optional(),
  sync_frequency: z.enum(['realtime', 'hourly', 'daily', 'weekly']).optional(),
  webhook_enabled: z.boolean().optional(),
  webhook_url: z.string().optional(),
  webhook_secret: z.string().optional(),
  csv_upload_schedule: z.enum(['manual', 'daily', 'weekly', 'hourly']).optional(),
  csv_upload_path: z.string().optional(),
  csv_field_mapping: z.record(z.string()).optional(),
  // Database connection for Calyx
  db_host: z.string().optional(),
  db_port: z.number().optional(),
  db_name: z.string().optional(),
  db_user: z.string().optional(),
  db_password: z.string().optional(),
  // Encompass-specific fields
  encompass_instance_id: z.string().optional(),
  encompass_extraction_method: z.enum(['partner', 'ropc', 'api']).optional(),
  encompass_api_server: z.string().optional(), // API server URL (default: https://api.elliemae.com)
  encompass_secret_arn: z.string().optional(),
  encompass_sa_username: z.string().optional(),
  encompass_sa_password: z.string().optional(),
  encompass_selected_folders: z.array(z.string()).optional(), // Array of folder names to sync from
});

/**
 * GET /api/los/types
 * Get all supported LOS types with their configurations
 */
router.get('/types', authenticateToken, async (req: AuthRequest, res) => {
  const types = { ...LOS_CONFIGS };
  
  // Add mock API info if enabled
  if (shouldUseMockApi()) {
    Object.keys(types).forEach(losType => {
      const config = types[losType as keyof typeof types];
      (config as any).mockApiAvailable = true;
      (config as any).mockApiUrl = `http://localhost:${process.env.PORT || 3001}/mock-los/${losType}`;
    });
  }
  
  res.json({ types, mockApiEnabled: shouldUseMockApi() });
});

/**
 * POST /api/los/test-connection
 * Create a test connection using mock API (for development/testing)
 */
router.post('/test-connection', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    if (!shouldUseMockApi()) {
      return res.status(400).json({ 
        error: 'Mock API not enabled',
        message: 'Set MOCK_LOS_API=true or run in development mode to use test connections'
      });
    }

    const { los_type } = req.body;
    
    if (!los_type || !LOS_CONFIGS[los_type as keyof typeof LOS_CONFIGS]) {
      return res.status(400).json({ error: 'Invalid LOS type' });
    }

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    const tenantId = profileResult.rows[0]?.tenant_id || '00000000-0000-0000-0000-000000000000';

    // Create test connection
    const testConfig = createTestConnection(los_type, tenantId);

    // Save to database
    const result = await pool.query(
      `INSERT INTO public.los_connections (
        tenant_id, los_type, name, connection_method,
        api_base_url, api_client_id, api_client_secret, api_key,
        api_environment, oauth_authorization_url, oauth_token_url, oauth_scopes,
        sync_enabled, sync_frequency, webhook_enabled,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        tenantId,
        testConfig.los_type,
        testConfig.name,
        testConfig.connection_method,
        testConfig.api_base_url,
        testConfig.api_client_id || null,
        testConfig.api_client_secret || null,
        testConfig.api_key || null,
        testConfig.api_environment,
        testConfig.oauth_authorization_url || null,
        testConfig.oauth_token_url || null,
        testConfig.oauth_scopes || null,
        testConfig.sync_enabled,
        testConfig.sync_frequency,
        testConfig.webhook_enabled,
        req.userId,
      ]
    );

    res.json({ 
      connection: result.rows[0],
      message: 'Test connection created successfully. You can now test and sync with the mock API.',
    });
  } catch (error: any) {
    logError('Error creating test connection', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to create test connection' });
  }
});

/**
 * GET /api/los/connections
 * Get all LOS connections for authenticated tenant (from tenant database)
 * OR get connections for a specific tenant (management UI - requires tenant_id query param)
 */
router.get('/connections', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantId = req.query.tenant_id as string | undefined;

    // If tenant_id is provided, this is a management UI request
    // Connect to that tenant's database to get connections
    if (tenantId) {
      try {
        const { tenantDbManager } = await import('../config/tenantDatabaseManager.js');
        const tenantPool = await tenantDbManager.getTenantPool(tenantId);

        // Ensure schema is up to date (add missing columns) - MUST complete before query
        logInfo('Ensuring los_connections schema is up to date', { tenantId });
        try {
          await ensureLosConnectionsSchema(tenantPool, tenantId);
        } catch (schemaError: any) {
          logError('Schema migration failed, cannot proceed with query', schemaError, { tenantId, error: schemaError.message });
          return res.status(500).json({ 
            error: 'Database schema migration failed', 
            details: schemaError.message 
          });
        }

        // Check if los_connections table exists, if not return empty array
        let result;
        try {
          result = await tenantPool.query(
            `SELECT 
              id, los_type, name, connection_method,
              api_base_url, api_key, api_environment,
              oauth_authorization_url, oauth_token_url, oauth_scopes,
              sync_enabled, sync_frequency, webhook_enabled, webhook_url,
              csv_upload_schedule, csv_upload_path, csv_field_mapping,
              db_host, db_port, db_name, db_user,
              encompass_instance_id, encompass_api_server, encompass_extraction_method, encompass_secret_arn,
              encompass_selected_folders,
              is_active, last_synced_at, last_sync_status, last_sync_error,
              created_at, updated_at
            FROM public.los_connections 
            ORDER BY created_at DESC`
          );
        } catch (tableError: any) {
          // Table doesn't exist yet - return empty array
          if (tableError.code === '42P01') {
            logDebug('los_connections table does not exist for tenant', { tenantId });
            return res.json({ connections: [] });
          }
          // Column missing error - schema migration should have caught this
          if (tableError.message && tableError.message.includes('does not exist')) {
            logError('Column missing after migration - this should not happen', tableError, { tenantId, error: tableError.message });
            return res.status(500).json({ 
              error: 'Database schema error', 
              details: tableError.message 
            });
          }
          throw tableError;
        }

        // Mask sensitive fields
        const connections = result.rows.map(conn => ({
          ...conn,
          api_key: conn.api_key ? '••••••••' : null,
        }));

        return res.json({ connections });
      } catch (error: any) {
        logError('Error fetching LOS connections for tenant', error, { userId: req.userId, tenantId });
        // Return empty array instead of error - tenant database might not be fully provisioned yet
        return res.json({ connections: [] });
      }
    }

    // Otherwise, try to use tenant context (regular tenant user)
    // If tenant context is not available (e.g., admin panel initial load), return empty array
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;

      // Ensure schema is up to date (add missing columns) - MUST complete before query
      logInfo('Ensuring los_connections schema is up to date', { tenantId: tenantContext.tenantId });
      try {
        await ensureLosConnectionsSchema(tenantPool, tenantContext.tenantId);
      } catch (schemaError: any) {
        logError('Schema migration failed, cannot proceed with query', schemaError, { tenantId: tenantContext.tenantId, error: schemaError.message });
        return res.status(500).json({ 
          error: 'Database schema migration failed', 
          details: schemaError.message 
        });
      }

      // Get connections from tenant database
      const result = await tenantPool.query(
      `SELECT 
        id, los_type, name, connection_method,
        api_base_url, api_key, api_environment,
        oauth_authorization_url, oauth_token_url, oauth_scopes,
        sync_enabled, sync_frequency, webhook_enabled, webhook_url,
        csv_upload_schedule, csv_upload_path, csv_field_mapping,
        db_host, db_port, db_name, db_user,
        encompass_instance_id, encompass_api_server, encompass_extraction_method, encompass_secret_arn,
        encompass_selected_folders,
        is_active, last_synced_at, last_sync_status, last_sync_error,
        created_at, updated_at
      FROM public.los_connections 
      WHERE is_active = true
      ORDER BY created_at DESC`
      );

      // Mask sensitive fields (encrypted fields are never returned)
      const connections = result.rows.map(conn => ({
        ...conn,
        // Note: api_client_secret, encompass_sa_password, db_password are encrypted and not returned
        api_key: conn.api_key ? '••••••••' : null,
      }));

      return res.json({ connections });
    } catch (contextError: any) {
      // Tenant context not available - likely admin panel initial load without tenant selected
      // Return empty array instead of error
      logDebug('Tenant context not available for LOS connections', { 
        userId: req.userId,
        error: contextError.message 
      });
      return res.json({ connections: [] });
    }
  } catch (error: any) {
    logError('Error fetching LOS connections', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch LOS connections' });
  }
});

/**
 * GET /api/los/connections/:id
 * Get a specific LOS connection
 */
router.get('/connections/:id', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM public.los_connections WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'LOS connection not found' });
    }

    // Mask sensitive fields
    const connection = result.rows[0];
    if (connection.api_client_secret) {
      connection.api_client_secret = '••••••••';
    }
    if (connection.api_key) {
      connection.api_key = '••••••••';
    }
    if (connection.db_password) {
      connection.db_password = '••••••••';
    }

    res.json({ connection });
  } catch (error: any) {
    logError('Error fetching LOS connection', error, { userId: req.userId, connectionId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch LOS connection' });
  }
});

/**
 * POST /api/los/connections/test-credentials
 * Test LOS connection credentials before saving (for Encompass)
 */
router.post('/connections/test-credentials', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      los_type: z.string(),
      encompass_instance_id: z.string().optional(),
      encompass_extraction_method: z.enum(['partner', 'ropc', 'api']).optional(),
      api_client_id: z.string().optional(),
      api_client_secret: z.string().optional(),
      encompass_sa_username: z.string().optional(),
      encompass_sa_password: z.string().optional(),
    });

    const data = schema.parse(req.body);

    // Only test Encompass for now
    if (data.los_type !== 'encompass') {
      return res.json({ success: true, message: 'Credential testing not implemented for this LOS type' });
    }

    // Validate required fields
    if (!data.api_client_id || !data.api_client_secret) {
      return res.status(400).json({ 
        success: false, 
        message: 'API Client ID and Secret are required' 
      });
    }

    // Test Encompass credentials by attempting OAuth token request
    try {
      const axios = (await import('axios')).default;
      
      // Use API server from request, default to production API
      const apiServer = data.encompass_api_server || 'https://api.elliemae.com';
      
      // For Partner flow, test OAuth token endpoint
      const extractionMethod = data.encompass_extraction_method || 'partner';
      
      if (extractionMethod === 'partner') {
        // Partner OAuth requires instance_id in the body and Basic Auth
        let instanceIdForToken = data.encompass_instance_id || '';
        if (instanceIdForToken && instanceIdForToken.startsWith('30')) {
          instanceIdForToken = instanceIdForToken.replace('30', 'BE');
        }
        
        const tokenUrl = `${apiServer}/oauth2/v1/token`;
        const requestBody = new URLSearchParams({
          grant_type: 'client_credentials',
          instance_id: instanceIdForToken,
          scope: 'lp',
        });
        
        // Partner OAuth uses Basic Auth with client_id:client_secret
        const basicAuth = Buffer.from(`${data.api_client_id}:${data.api_client_secret}`).toString('base64');
        
        const tokenResponse = await axios.post(tokenUrl, requestBody, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${basicAuth}`,
          },
          timeout: 10000, // 10 second timeout
        });
        
        if (tokenResponse.status !== 200 || !tokenResponse.data.access_token) {
          throw new Error('Failed to obtain access token');
        }
        
        res.json({ success: true, message: 'Credentials validated successfully' });
      } else {
        // For ROPC/API flow, validate that credentials are provided
        if (!data.encompass_sa_username || !data.encompass_sa_password) {
          return res.status(400).json({ 
            success: false, 
            message: 'SA Username and Password are required for ROPC/API flow' 
          });
        }
        
        // For now, just validate format - full ROPC test would require actual API call
        res.json({ success: true, message: 'Credentials format validated (full ROPC test not implemented)' });
      }
    } catch (testError: any) {
      const errorMessage = testError.response?.data?.error_description || 
                          testError.response?.data?.error || 
                          testError.message || 
                          'Invalid credentials';
      
      logError('Credential test failed', testError, { userId: req.userId });
      return res.status(400).json({ 
        success: false, 
        message: 'Credential test failed', 
        details: errorMessage
      });
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error testing credentials', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to test credentials', details: error.message });
  }
});

/**
 * POST /api/los/connections
 * Create a new LOS connection
 */
router.post('/connections', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const data = losConnectionSchema.parse(req.body);
    const tenantId = req.body.tenant_id || req.query.tenant_id as string | undefined;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    let tenantPool: any;

    // If tenant_id is provided, this is a management UI request
    try {
      const { tenantDbManager } = await import('../config/tenantDatabaseManager.js');
      tenantPool = await tenantDbManager.getTenantPool(tenantId);
    } catch (error: any) {
      logError('Error getting tenant pool', error, { userId: req.userId, tenantId });
      return res.status(500).json({ error: 'Failed to connect to tenant database', details: error.message });
    }

    // Ensure los_connections table exists (create schema if needed)
    try {
      // Check if table exists first
      const tableCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'los_connections'
        )
      `);
      
      if (!tableCheck.rows[0]?.exists) {
        logInfo('Creating los_connections table for tenant', { tenantId });
        const { createTenantDatabaseSchema } = await import('../config/tenantDatabaseSchema.js');
        await createTenantDatabaseSchema(tenantPool);
      } else {
        // Table exists, check if encompass_api_server column exists and add it if missing
        const columnCheck = await tenantPool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'los_connections'
            AND column_name = 'encompass_api_server'
          )
        `);
        
        if (!columnCheck.rows[0]?.exists) {
          logInfo('Adding encompass_api_server column to los_connections table', { tenantId });
          await tenantPool.query(`
            ALTER TABLE public.los_connections 
            ADD COLUMN IF NOT EXISTS encompass_api_server TEXT DEFAULT 'https://api.elliemae.com'
          `);
        }

        // Check if encompass_selected_folders column exists and add it if missing
        const foldersColumnCheck = await tenantPool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'los_connections'
            AND column_name = 'encompass_selected_folders'
          )
        `);
        
        if (!foldersColumnCheck.rows[0]?.exists) {
          logInfo('Adding encompass_selected_folders column to los_connections table', { tenantId });
          await tenantPool.query(`
            ALTER TABLE public.los_connections 
            ADD COLUMN IF NOT EXISTS encompass_selected_folders JSONB DEFAULT '[]'::jsonb
          `);
        }
      }
    } catch (schemaError: any) {
      logError('Error ensuring tenant schema exists', schemaError, { tenantId, error: schemaError.message });
      // Continue anyway - table might already exist
    }

    // Encrypt sensitive fields
    const encryptedFields: any = {};
    if (data.api_client_secret) {
      encryptedFields.api_client_secret_encrypted = await encryptField(data.api_client_secret);
    }
    if (data.encompass_sa_password) {
      encryptedFields.encompass_sa_password_encrypted = await encryptField(data.encompass_sa_password);
    }
    if (data.encompass_sa_username) {
      encryptedFields.encompass_sa_username_encrypted = await encryptField(data.encompass_sa_username);
    }
    if (data.api_client_id) {
      encryptedFields.api_client_id_encrypted = await encryptField(data.api_client_id);
    }
    if (data.db_password) {
      encryptedFields.db_password_encrypted = await encryptField(data.db_password);
    }

    // Insert into tenant database (los_connections table)
    // Count: 29 columns, need 29 values
    const result = await tenantPool.query(
      `INSERT INTO public.los_connections (
        los_type, name, connection_method,
        api_base_url, api_key,
        api_environment, oauth_authorization_url, oauth_token_url, oauth_scopes,
        sync_enabled, sync_frequency, webhook_enabled, webhook_url, webhook_secret,
        csv_upload_schedule, csv_upload_path, csv_field_mapping,
        db_host, db_port, db_name, db_user,
        encompass_instance_id, encompass_api_server, encompass_extraction_method, encompass_secret_arn,
        encompass_selected_folders,
        api_client_id_encrypted, api_client_secret_encrypted,
        encompass_sa_username_encrypted, encompass_sa_password_encrypted,
        db_password_encrypted
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
      RETURNING id, los_type, name, connection_method, api_environment, sync_enabled, sync_frequency, is_active, created_at`,
      [
        data.los_type,
        data.name,
        data.connection_method,
        data.api_base_url || LOS_CONFIGS[data.los_type]?.defaultBaseUrl || null,
        data.api_key || null,
        data.api_environment || 'sandbox',
        data.oauth_authorization_url || (LOS_CONFIGS[data.los_type] as any)?.defaultAuthUrl || null,
        data.oauth_token_url || (LOS_CONFIGS[data.los_type] as any)?.defaultTokenUrl || null,
        data.oauth_scopes || (LOS_CONFIGS[data.los_type] as any)?.scopes?.join(' ') || null,
        data.sync_enabled ?? true,
        data.sync_frequency || 'hourly',
        data.webhook_enabled ?? false,
        data.webhook_url || null,
        data.webhook_secret || null,
        data.csv_upload_schedule || 'manual',
        data.csv_upload_path || null,
        data.csv_field_mapping ? JSON.stringify(data.csv_field_mapping) : null,
        data.db_host || null,
        data.db_port || null,
        data.db_name || null,
        data.db_user || null,
        data.encompass_instance_id || null,
        data.encompass_api_server || 'https://api.elliemae.com',
        data.encompass_extraction_method || null,
        data.encompass_secret_arn || null,
        data.encompass_selected_folders ? JSON.stringify(data.encompass_selected_folders) : '[]',
        encryptedFields.api_client_id_encrypted || null,
        encryptedFields.api_client_secret_encrypted || null,
        encryptedFields.encompass_sa_username_encrypted || null,
        encryptedFields.encompass_sa_password_encrypted || null,
        encryptedFields.db_password_encrypted || null,
      ]
    );

    res.json({ connection: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error creating LOS connection', error, { 
      userId: req.userId, 
      tenantId: req.body.tenant_id || req.query.tenant_id,
      error: error.message,
      stack: error.stack 
    });
    res.status(500).json({ error: 'Failed to create LOS connection', details: error.message });
  }
});

/**
 * PUT /api/los/connections/:id
 * Update a LOS connection
 */
router.put('/connections/:id', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = losConnectionSchema.partial().parse(req.body);
    const tenantId = req.query.tenant_id as string | undefined;

    let tenantPool: any;
    let currentTenantId: string | undefined;

    // Get the appropriate tenant pool
    if (tenantId) {
      // Management UI request - use tenant_id from query param
      const { tenantDbManager } = await import('../config/tenantDatabaseManager.js');
      tenantPool = await tenantDbManager.getTenantPool(tenantId);
      currentTenantId = tenantId;
    } else {
      // Regular tenant user request - use tenant context
      const tenantContext = getTenantContext(req);
      tenantPool = tenantContext.tenantPool;
      currentTenantId = tenantContext.tenantId;
    }

    // Ensure schema is up to date (add missing columns) - MUST complete before query
    logInfo('Ensuring los_connections schema is up to date for update', { tenantId: currentTenantId });
    try {
      await ensureLosConnectionsSchema(tenantPool, currentTenantId);
    } catch (schemaError: any) {
      logError('Schema migration failed, cannot proceed with update', schemaError, { tenantId: currentTenantId, error: schemaError.message });
      return res.status(500).json({ 
        error: 'Database schema migration failed', 
        details: schemaError.message 
      });
    }

    // Check if connection exists
    const connectionResult = await tenantPool.query(
      'SELECT id FROM public.los_connections WHERE id = $1',
      [id]
    );

    if (connectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'LOS connection not found' });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.api_base_url !== undefined) {
      updates.push(`api_base_url = $${paramIndex++}`);
      values.push(data.api_base_url || LOS_CONFIGS[data.los_type || '']?.defaultBaseUrl || null);
    }
    if (data.api_client_id !== undefined) {
      updates.push(`api_client_id = $${paramIndex++}`);
      values.push(data.api_client_id);
    }
    if (data.api_client_secret !== undefined) {
      updates.push(`api_client_secret = $${paramIndex++}`);
      values.push(data.api_client_secret);
    }
    if (data.api_key !== undefined) {
      updates.push(`api_key = $${paramIndex++}`);
      values.push(data.api_key);
    }
    if (data.sync_enabled !== undefined) {
      updates.push(`sync_enabled = $${paramIndex++}`);
      values.push(data.sync_enabled);
    }
    if (data.sync_frequency) {
      updates.push(`sync_frequency = $${paramIndex++}`);
      values.push(data.sync_frequency);
    }
    if (data.webhook_enabled !== undefined) {
      updates.push(`webhook_enabled = $${paramIndex++}`);
      values.push(data.webhook_enabled);
    }
    if (data.webhook_url !== undefined) {
      updates.push(`webhook_url = $${paramIndex++}`);
      values.push(data.webhook_url);
    }
    if (data.csv_upload_path !== undefined) {
      updates.push(`csv_upload_path = $${paramIndex++}`);
      values.push(data.csv_upload_path);
    }
    if (data.csv_field_mapping !== undefined) {
      updates.push(`csv_field_mapping = $${paramIndex++}`);
      values.push(data.csv_field_mapping ? JSON.stringify(data.csv_field_mapping) : null);
    }
    if (data.encompass_selected_folders !== undefined) {
      updates.push(`encompass_selected_folders = $${paramIndex++}`);
      values.push(JSON.stringify(data.encompass_selected_folders || []));
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    if (updates.length === 1) {
      // Only updated_at was added, return existing connection
      const existingResult = await tenantPool.query(
        'SELECT * FROM public.los_connections WHERE id = $1',
        [id]
      );
      return res.json({ connection: existingResult.rows[0] });
    }

    const result = await tenantPool.query(
      `UPDATE public.los_connections SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json({ connection: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error updating LOS connection', error, { userId: req.userId, connectionId: req.params.id, error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to update LOS connection', details: error.message });
  }
});

/**
 * DELETE /api/los/connections/:id
 * Delete a LOS connection
 */
router.delete('/connections/:id', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.query.tenant_id as string | undefined;

    console.log('[LOS Delete] Attempting to delete connection:', { connectionId: id, tenantId });

    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id query parameter is required' });
    }

    // Get tenant database pool
    const { tenantDbManager } = await import('../config/tenantDatabaseManager.js');
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);

    // First check if table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'los_connections'
      )
    `);
    
    console.log('[LOS Delete] Table exists:', tableCheck.rows[0]?.exists);
    
    if (!tableCheck.rows[0]?.exists) {
      return res.status(404).json({ error: 'LOS connections table does not exist for this tenant' });
    }

    // Check if connection exists (cast to UUID to ensure proper matching)
    const checkResult = await tenantPool.query(
      'SELECT id FROM public.los_connections WHERE id = $1::uuid',
      [id]
    );

    console.log('[LOS Delete] Connection check result:', { 
      found: checkResult.rows.length > 0,
      connectionId: id,
      tenantId,
      allConnections: (await tenantPool.query('SELECT id FROM public.los_connections')).rows.map(r => r.id)
    });

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'LOS connection not found in tenant database' });
    }

    const result = await tenantPool.query(
      'DELETE FROM public.los_connections WHERE id = $1::uuid RETURNING id',
      [id]
    );

    console.log('[LOS Delete] Delete result:', { deleted: result.rows.length > 0 });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'LOS connection not found' });
    }

    res.json({ success: true, message: 'Connection deleted' });
  } catch (error: any) {
    logError('Error deleting LOS connection', error, { userId: req.userId, connectionId: req.params.id });
    res.status(500).json({ error: 'Failed to delete LOS connection' });
  }
});

/**
 * POST /api/los/connections/:id/test
 * Test a LOS connection
 */
router.post('/connections/:id/test', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.query.tenant_id as string | undefined;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id query parameter is required' });
    }

    // Get tenant database pool
    const { tenantDbManager } = await import('../config/tenantDatabaseManager.js');
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);

    // Get connection from tenant database
    const connectionResult = await tenantPool.query(
      'SELECT * FROM public.los_connections WHERE id = $1',
      [id]
    );

    if (connectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'LOS connection not found' });
    }

    const connection = connectionResult.rows[0];
    
    // Debug: Log all connection fields to see what's actually in the database
    console.log('[LOS Test] Connection from DB:', {
      id: connection.id,
      encompass_api_server: connection.encompass_api_server,
      encompass_api_server_type: typeof connection.encompass_api_server,
      all_encompass_fields: {
        encompass_instance_id: connection.encompass_instance_id,
        encompass_api_server: connection.encompass_api_server,
        encompass_extraction_method: connection.encompass_extraction_method,
        encompass_secret_arn: connection.encompass_secret_arn
      }
    });

    // Test Encompass connections specifically
    if (connection.los_type === 'encompass' && connection.connection_method === 'api') {
      try {
        // Test by attempting to authenticate
        const axios = (await import('axios')).default;
        
        // Use API server from connection, default to production API
        const apiServer = connection.encompass_api_server || 'https://api.elliemae.com';
        
        // Use extraction method from connection, default to 'partner' if not set
        const extractionMethod = connection.encompass_extraction_method || 'partner';
        
        console.log('[LOS Test] Testing Encompass connection:', {
          connectionId: id,
          tenantId,
          hasEncryptedClientId: !!connection.api_client_id_encrypted,
          hasEncryptedClientSecret: !!connection.api_client_secret_encrypted,
          extractionMethod,
          apiServer,
          raw_encompass_api_server_from_db: connection.encompass_api_server
        });
        
        // Decrypt credentials for testing
        const { decryptField } = await import('../services/encryption.js');
        let apiClientId: string | null = null;
        let apiClientSecret: string | null = null;
        
        try {
          if (connection.api_client_id_encrypted) {
            apiClientId = await decryptField(connection.api_client_id_encrypted);
            console.log('[LOS Test] Successfully decrypted client ID');
          } else {
            console.log('[LOS Test] No encrypted client ID found');
          }
          
          if (connection.api_client_secret_encrypted) {
            apiClientSecret = await decryptField(connection.api_client_secret_encrypted);
            console.log('[LOS Test] Successfully decrypted client secret');
          } else {
            console.log('[LOS Test] No encrypted client secret found');
          }
        } catch (decryptError: any) {
          console.error('[LOS Test] Decryption error:', decryptError);
          logError('Failed to decrypt credentials for testing', decryptError, { userId: req.userId, connectionId: id });
          return res.status(400).json({ 
            success: false, 
            error: 'Failed to decrypt credentials. Please check encryption configuration.' 
          });
        }

        // Test OAuth token endpoint based on extraction method
        // OAuth token endpoint is always at /oauth2/v1/token relative to the API server
        const tokenUrl = `${apiServer}/oauth2/v1/token`;
        console.log('[LOS Test] Attempting OAuth token request to:', tokenUrl, 'with extraction method:', extractionMethod);
        
        // Prepare request body based on extraction method
        let requestBody: URLSearchParams;
        if (extractionMethod === 'partner') {
          // Partner flow requires API client ID and secret
          if (!apiClientId || !apiClientSecret) {
            console.log('[LOS Test] Missing Partner credentials:', { hasClientId: !!apiClientId, hasClientSecret: !!apiClientSecret });
            return res.status(400).json({ 
              success: false, 
              error: 'API Client ID and Secret are required for Partner flow' 
            });
          }
          // Partner OAuth requires instance_id in the body
          let instanceIdForToken = connection.encompass_instance_id || '';
          if (instanceIdForToken && instanceIdForToken.startsWith('30')) {
            instanceIdForToken = instanceIdForToken.replace('30', 'BE');
          }
          
          requestBody = new URLSearchParams({
            grant_type: 'client_credentials',
            instance_id: instanceIdForToken,
            scope: 'lp',
          });
          
          // Partner OAuth uses Basic Auth with client_id:client_secret
          const basicAuth = Buffer.from(`${apiClientId}:${apiClientSecret}`).toString('base64');
          
          const tokenResponse = await axios.post(tokenUrl, requestBody, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${basicAuth}`,
            },
            timeout: 10000,
          });
          
          if (tokenResponse.status === 200 && tokenResponse.data.access_token) {
            console.log('[LOS Test] ✅ Connection test successful');
            return res.json({ 
              success: true, 
              message: 'Connection test successful - credentials validated' 
            });
          } else {
            console.log('[LOS Test] ❌ Failed to obtain access token, status:', tokenResponse.status);
            return res.status(400).json({ 
              success: false, 
              error: 'Failed to obtain access token' 
            });
          }
        } else {
          // ROPC/API flow uses grant_type=password with SA username/password
          // Decrypt SA credentials
          let saUsername: string | null = null;
          let saPassword: string | null = null;
          
          try {
            if (connection.encompass_sa_username_encrypted) {
              saUsername = await decryptField(connection.encompass_sa_username_encrypted);
              console.log('[LOS Test] Successfully decrypted SA username');
            }
            if (connection.encompass_sa_password_encrypted) {
              saPassword = await decryptField(connection.encompass_sa_password_encrypted);
              console.log('[LOS Test] Successfully decrypted SA password');
            }
          } catch (decryptError: any) {
            console.error('[LOS Test] SA credential decryption error:', decryptError);
            return res.status(400).json({ 
              success: false, 
              error: 'Failed to decrypt SA credentials. Please check encryption configuration.' 
            });
          }

          if (!saUsername || !saPassword) {
            console.log('[LOS Test] Missing SA credentials:', { hasUsername: !!saUsername, hasPassword: !!saPassword });
            return res.status(400).json({ 
              success: false, 
              error: 'SA Username and Password are required for ROPC/API flow' 
            });
          }

          // Transform SA username with instance ID if needed
          let effectiveSAUsername = saUsername;
          const instanceId = connection.encompass_instance_id || '';
          if (instanceId && !instanceId.startsWith('TE')) {
            // Transform instance ID for username (e.g., 30XXXXX -> BEXXXXX)
            let instanceIdPart = instanceId.substring(1).replace(/^0+/, '');
            if (instanceIdPart.length < 6) {
              instanceIdPart = instanceIdPart.padStart(6, '0');
            }
            effectiveSAUsername = `${saUsername}@encompass:BE${instanceIdPart}`;
          } else if (instanceId && instanceId.startsWith('TE')) {
            effectiveSAUsername = `${saUsername}@encompass:${instanceId}`;
          }

          // ROPC flow uses grant_type=password
          requestBody = new URLSearchParams({
            grant_type: 'password',
            username: effectiveSAUsername,
            password: saPassword,
            client_id: apiClientId,
          });
          
          // Add client_secret if provided
          if (apiClientSecret) {
            requestBody.append('client_secret', apiClientSecret);
          }
          
          const tokenResponse = await axios.post(tokenUrl, requestBody, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10000,
          });
          
          if (tokenResponse.status === 200 && tokenResponse.data.access_token) {
            console.log('[LOS Test] ✅ Connection test successful (ROPC)');
            return res.json({ 
              success: true, 
              message: 'Connection test successful - credentials validated' 
            });
          } else {
            console.log('[LOS Test] ❌ Failed to obtain access token, status:', tokenResponse.status);
            return res.status(400).json({ 
              success: false, 
              error: 'Failed to obtain access token' 
            });
          }
        }
      } catch (testError: any) {
        // Extract error message from Encompass API response
        let errorMessage = 'Connection test failed';
        
        console.error('[LOS Test] ❌ Error during test:', {
          message: testError.message,
          status: testError.response?.status,
          statusText: testError.response?.statusText,
          data: testError.response?.data
        });
        
        if (testError.response) {
          // Encompass API returned an error response
          errorMessage = testError.response.data?.error_description || 
                        testError.response.data?.error || 
                        testError.response.data?.message ||
                        `Encompass API error: ${testError.response.status} ${testError.response.statusText}`;
          
          // Log the full response for debugging
          logError('Encompass connection test failed', testError, { 
            userId: req.userId, 
            connectionId: id,
            status: testError.response.status,
            statusText: testError.response.statusText,
            data: testError.response.data
          });
        } else if (testError.request) {
          // Request was made but no response received
          errorMessage = 'No response from Encompass API. Please check your network connection and API endpoint.';
          logError('Encompass connection test - no response', testError, { userId: req.userId, connectionId: id });
        } else {
          // Error setting up the request
          errorMessage = testError.message || 'Failed to test connection';
          logError('Encompass connection test - request setup failed', testError, { userId: req.userId, connectionId: id });
        }
        
        // Always return 400 (Bad Request) to the client, not the original status code
        res.status(400).json({ 
          success: false, 
          error: errorMessage 
        });
      }
    } else if (connection.connection_method === 'database') {
      // For database connections, just verify configuration
      const hasConfig = connection.db_host && connection.db_name && connection.db_user;
      res.json({
        success: hasConfig,
        message: hasConfig ? 'Database connection parameters configured' : 'Database connection not fully configured',
        details: {
          host: connection.db_host || 'Not configured',
          database: connection.db_name || 'Not configured',
          user: connection.db_user || 'Not configured',
        }
      });
    } else {
      // CSV upload - verify path is configured
      const hasPath = connection.csv_upload_path;
      res.json({
        success: hasPath,
        message: hasPath ? 'CSV upload path configured' : 'CSV upload path not configured',
        details: {
          uploadPath: connection.csv_upload_path || 'Not configured',
        }
      });
    }
  } catch (error: any) {
    logError('Error testing LOS connection', error, { userId: req.userId, connectionId: req.params.id });
    res.status(500).json({ error: error.message || 'Failed to test LOS connection' });
  }
});

/**
 * POST /api/los/connections/:id/sync
 * Trigger manual sync for a LOS connection
 */
router.post('/connections/:id/sync', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.query.tenant_id as string | undefined;
    const fullSync = req.query.fullSync === 'true';
    const clearDatabase = req.query.clearDatabase === 'true';
    const testMode = req.query.testMode === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    // Require tenant_id for sync endpoint (typically called from admin UI)
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id query parameter is required' });
    }

    // Get tenant pool
    const { tenantDbManager } = await import('../config/tenantDatabaseManager.js');
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);

    // Ensure schema is up to date
    await ensureLosConnectionsSchema(tenantPool, tenantId);

    // Get connection from tenant database
    const connectionResult = await tenantPool.query(
      'SELECT * FROM public.los_connections WHERE id = $1',
      [id]
    );

    if (connectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'LOS connection not found' });
    }

    const connection = connectionResult.rows[0];

    // IMPORTANT: Read last_synced_at BEFORE updating it, so we can use it for incremental sync
    const lastSyncedAt = connection.last_synced_at;

    // Update sync status to pending (but DON'T update last_synced_at yet - that happens after successful sync)
    await tenantPool.query(
      `UPDATE public.los_connections
       SET last_sync_status = 'pending', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    // Trigger sync based on connection method
    if (connection.connection_method === 'api' && connection.los_type === 'encompass') {
      // Use Encompass ETL service for Encompass connections
      const { EncompassEtlService } = await import('../services/etl/encompassEtlService.js');
      const etlService = new EncompassEtlService(tenantPool);
      
      // Clear database if requested (before checking loan count)
      if (clearDatabase) {
        logInfo('Clearing loans database before sync', { connectionId: id, tenantId: tenantId });
        try {
          await tenantPool.query('DELETE FROM public.loans');
          logInfo('Loans database cleared', { connectionId: id, tenantId: tenantId });
        } catch (error: any) {
          if (error.code === '42P01') {
            // Table doesn't exist, that's fine
            logInfo('Loans table does not exist, skipping clear', { connectionId: id, tenantId: tenantId });
          } else {
            throw error;
          }
        }
        // Reset last_synced_at since we're starting fresh
        await tenantPool.query(
          'UPDATE public.los_connections SET last_synced_at = NULL WHERE id = $1',
          [id]
        );
      }
      
      // Check if there are any loans in the database for this tenant
      // If no loans exist, always do a full pull (don't filter by date)
      // Note: In tenant-specific databases, loans table doesn't have tenant_id column
      let loansCount = 0;
      try {
        const loansCountResult = await tenantPool.query(
          'SELECT COUNT(*) as count FROM public.loans'
        );
        loansCount = parseInt(loansCountResult.rows[0]?.count || '0', 10);
        
        // Also get unique loan_id count to check for duplicates
        const uniqueLoansResult = await tenantPool.query(
          'SELECT COUNT(DISTINCT loan_id) as unique_count FROM public.loans'
        );
        const uniqueLoansCount = parseInt(uniqueLoansResult.rows[0]?.unique_count || '0', 10);
        
        console.log(`[Sync] Database loan counts - Total rows: ${loansCount}, Unique loan_ids: ${uniqueLoansCount}`);
        
        if (loansCount !== uniqueLoansCount) {
          console.warn(`[Sync] WARNING: Found ${loansCount - uniqueLoansCount} duplicate loan_ids in database!`);
        }
      } catch (error: any) {
        // If loans table doesn't exist, treat as 0 loans (will do full pull)
        if (error.code === '42P01') {
          loansCount = 0;
          logInfo('Loans table does not exist, treating as empty', { connectionId: id, tenantId: tenantId });
        } else {
          throw error;
        }
      }
      
      // Determine modifiedFrom date for incremental sync (use the PREVIOUS last_synced_at)
      // IMPORTANT: Only use modifiedFrom if:
      //   1. This is NOT a full sync
      //   2. We have a previous sync time
      //   3. There are existing loans in the database
      //   4. The previous sync actually synced loans (lastSyncedAt exists AND loansCount > 0)
      //   5. The last_synced_at is not too recent (within last 5 minutes) - this prevents using
      //      a timestamp from a sync that synced 0 loans before the fix was applied
      let modifiedFrom: Date | undefined = undefined; // Default to undefined
      
      // Check if lastSyncedAt is very recent (within last 5 minutes)
      const lastSyncedDate = lastSyncedAt ? new Date(lastSyncedAt) : null;
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const isLastSyncedTooRecent = lastSyncedDate && lastSyncedDate > fiveMinutesAgo;
      
      logInfo('Sync decision', {
        connectionId: id,
        tenantId: tenantId,
        fullSync: fullSync,
        lastSyncedAt: lastSyncedAt,
        loansCount: loansCount,
        isLastSyncedTooRecent: isLastSyncedTooRecent,
        willUseModifiedFrom: !fullSync && lastSyncedAt && loansCount > 0 && !isLastSyncedTooRecent
      });
      
      if (!fullSync && lastSyncedAt && loansCount > 0 && !isLastSyncedTooRecent) {
        // Incremental sync: only get loans modified since last sync (and we have existing loans)
        // AND the last sync wasn't too recent (to avoid using timestamps from failed syncs)
        modifiedFrom = new Date(lastSyncedAt);
        logInfo('Starting incremental sync', { 
          connectionId: id, 
          tenantId: tenantId,
          modifiedFrom: modifiedFrom.toISOString(),
          lastSyncedAt: lastSyncedAt,
          existingLoansCount: loansCount
        });
      } else {
        // Full sync (initial sync, explicit full sync, or clearDatabase) - limit to last 36 months (matching Qlik)
        // Use MonthStart behavior: first day of month 36 months ago
        const threeYearsAgo = new Date();
        threeYearsAgo.setMonth(threeYearsAgo.getMonth() - 36); // 36 months = 3 years (matching Qlik)
        threeYearsAgo.setDate(1); // Set to first day of month (MonthStart behavior)
        threeYearsAgo.setHours(0, 0, 0, 0); // Set to midnight
        modifiedFrom = threeYearsAgo;
        logInfo('Starting full sync (limiting to last 3 years)', { 
          connectionId: id, 
          tenantId: tenantId,
          existingLoansCount: loansCount,
          fullSyncRequested: fullSync,
          clearDatabase: clearDatabase,
          modifiedFrom: modifiedFrom.toISOString()
        });
      }
      
      // Log final decision
      logInfo('Final sync parameters', {
        connectionId: id,
        tenantId: tenantId,
        modifiedFrom: modifiedFrom?.toISOString() || 'undefined (no date filter)',
        fullSync: fullSync
      });

      // Get selected folders from connection (pass ALL folders, not just the first)
      const selectedFolders = connection.encompass_selected_folders || [];
      
      // Set loanStartDate to 36 months (3 years) ago to match Qlik's vLoanStartDate = MonthStart(Today(), -36)
      // MonthStart returns the first day of the month, so we set to first day of month 36 months ago
      // This filters by Fields.Log.MS.Date.Started >= 36 months ago
      const threeYearsAgo = new Date();
      threeYearsAgo.setMonth(threeYearsAgo.getMonth() - 36); // 36 months = 3 years (matching Qlik)
      threeYearsAgo.setDate(1); // Set to first day of month (MonthStart behavior)
      threeYearsAgo.setHours(0, 0, 0, 0); // Set to midnight
      
      // Apply test mode limit if enabled
      let syncLimit = limit;
      if (testMode && !syncLimit) {
        syncLimit = parseInt(process.env.ENCOMPASS_TEST_MODE_LIMIT || '50', 10);
        logInfo('Test mode enabled: limiting sync', { connectionId: id, tenantId, limit: syncLimit });
      }
      
      // Run sync asynchronously (don't block response)
      etlService.syncLoans(tenantId, id, {
        fullSync: fullSync,
        modifiedFrom: modifiedFrom,
        limit: syncLimit,
        loanStartDate: threeYearsAgo, // Always filter by loan start date (36 months ago, matching Qlik)
        loanStartDateField: 'Fields.Log.MS.Date.Started', // Match Qlik's field
        folderNames: selectedFolders.length > 0 ? selectedFolders : undefined, // Pass all selected folders
      }).catch((error) => {
        logError('Background sync error', error, { userId: req.userId, connectionId: id, tenantId: tenantId });
      });

      res.json({ 
        success: true, 
        message: fullSync ? 'Full sync started' : 'Incremental sync started',
        syncType: fullSync ? 'full' : 'incremental',
        modifiedFrom: modifiedFrom?.toISOString()
      });
    } else if (connection.connection_method === 'api') {
      // Import and use generic API sync service for other LOS types
      const { syncLoansFromAPI } = await import('../services/losApiService.js');
      
      // Run sync asynchronously (don't block response)
      syncLoansFromAPI(id).catch((error) => {
        logError('Background sync error', error, { userId: req.userId, connectionId: id });
      });

      res.json({ success: true, message: 'Sync started. Check sync logs for progress.' });
    } else if (connection.connection_method === 'csv_upload') {
      // Import and use CSV processor
      const { processCSVFilesFromPath } = await import('../services/csvProcessor.js');
      
      // Run CSV processing asynchronously
      processCSVFilesFromPath(id).catch((error) => {
        logError('CSV processing error', error, { userId: req.userId, connectionId: id });
      });

      res.json({ success: true, message: 'CSV processing started. Check sync logs for progress.' });
    } else {
      return res.status(400).json({ error: 'Sync not available for this connection method' });
    }
  } catch (error: any) {
    logError('Error triggering sync', error, { userId: req.userId, connectionId: req.params.id, error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to trigger sync' });
  }
});

/**
 * DELETE /api/los/clear-loans
 * Clear all loans from the tenant database
 */
router.delete('/clear-loans', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Get count before clearing
    let countBefore = 0;
    try {
      const countResult = await tenantPool.query('SELECT COUNT(*) as count FROM public.loans');
      countBefore = parseInt(countResult.rows[0]?.count || '0', 10);
    } catch (error: any) {
      if (error.code === '42P01') {
        // Table doesn't exist
        return res.json({ 
          success: true, 
          message: 'No loans table exists',
          deleted: 0 
        });
      }
      throw error;
    }
    
    // Clear all loans
    await tenantPool.query('DELETE FROM public.loans');
    
    // Reset last_synced_at on all connections
    await tenantPool.query(
      'UPDATE public.los_connections SET last_synced_at = NULL, last_sync_status = NULL, last_sync_error = NULL'
    );
    
    logInfo('Cleared all loans from tenant database', { 
      userId: req.userId, 
      tenantId: getTenantContext(req).tenantId,
      deletedCount: countBefore 
    });
    
    res.json({ 
      success: true, 
      message: `Deleted ${countBefore} loans from database`,
      deleted: countBefore 
    });
  } catch (error: any) {
    logError('Error clearing loans', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to clear loans' });
  }
});

/**
 * POST /api/los/csv/upload
 * Upload CSV file and detect columns
 * Uses Papa.parse (consistent with dashboard routes) and memory storage
 */
router.post('/csv/upload', authenticateToken, upload.single('csv'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No CSV file uploaded',
        details: 'Please select a CSV file to upload'
      });
    }

    if (!req.file.buffer) {
      return res.status(400).json({ 
        error: 'File buffer is missing',
        details: 'The uploaded file could not be read. Please try again.'
      });
    }

    // Parse CSV from buffer (consistent with dashboard routes)
    let csvText: string;
    try {
      csvText = req.file.buffer.toString('utf-8');
      
      // Remove BOM if present (common in Excel-exported CSV files)
      if (csvText.charCodeAt(0) === 0xFEFF) {
        csvText = csvText.slice(1);
      }
      
      if (!csvText || csvText.trim().length === 0) {
        return res.status(400).json({ 
          error: 'CSV file is empty',
          details: 'The uploaded file contains no data. Please check the file and try again.'
        });
      }
    } catch (bufferError: any) {
      logError('Error reading file buffer', bufferError, { userId: req.userId, fileName: req.file?.originalname });
      return res.status(400).json({ 
        error: 'Failed to read CSV file',
        details: bufferError.message || 'Could not read the file contents. Please ensure the file is a valid CSV file.'
      });
    }

    // Parse CSV with Papa.parse (consistent with dashboard routes)
    let parseResult: any;
    try {
      parseResult = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
        // Only parse first few rows to detect columns quickly
        preview: 5,
        transform: (value: string) => {
          // Handle empty strings and whitespace
          if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed === '' ? null : trimmed;
          }
          return value;
        },
      });
    } catch (parseError: any) {
      logError('CSV parsing error', parseError, { userId: req.userId, fileName: req.file?.originalname });
      return res.status(400).json({ 
        error: 'Failed to parse CSV file',
        details: parseError.message || 'The CSV file format is invalid. Please check the file structure and try again.'
      });
    }

    // Check for parsing errors (filter out non-critical warnings)
    const criticalErrors = parseResult.errors?.filter((err: any) => 
      err.type !== 'Quotes' && 
      err.type !== 'Delimiter' &&
      err.code !== 'MissingQuotes'
    ) || [];

    if (criticalErrors.length > 0) {
      logError('CSV parsing critical errors', undefined, { 
        userId: req.userId, 
        fileName: req.file?.originalname,
        errorCount: criticalErrors.length,
        errors: criticalErrors.slice(0, 5)
      });
      return res.status(400).json({
        error: 'CSV parsing errors',
        details: criticalErrors.slice(0, 5).map((err: any) => 
          `Line ${err.row}: ${err.message || err.type || 'Unknown error'}`
        ),
        suggestion: 'Please check the CSV file format. Ensure all rows have the same number of columns as the header row.'
      });
    }

    // Extract columns from parsed data
    if (!parseResult.data || parseResult.data.length === 0) {
      // If no data rows, try to get columns from meta
      const columns = parseResult.meta?.fields || [];
      if (columns.length === 0) {
        return res.status(400).json({
          error: 'No columns detected',
          details: 'Could not detect column headers in the CSV file. Please ensure the first row contains column names.'
        });
      }
      
      const suggestedMapping = suggestFieldMappings(columns);
      return res.json({
        success: true,
        columns,
        suggested_mapping: suggestedMapping,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        warning: 'CSV file contains only headers, no data rows'
      });
    }

    // Get columns from first data row (most reliable)
    const firstRow = parseResult.data[0];
    const columns = Object.keys(firstRow || {});

    if (columns.length === 0) {
      return res.status(400).json({
        error: 'No columns detected',
        details: 'Could not detect column headers in the CSV file. Please ensure the first row contains column names.'
      });
    }

    // Suggest field mappings
    const suggestedMapping = suggestFieldMappings(columns);

    res.json({
      success: true,
      columns,
      suggested_mapping: suggestedMapping,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      rowCount: parseResult.data.length,
    });
  } catch (error: any) {
    logError('Error processing CSV upload', error, { 
      userId: req.userId, 
      fileName: req.file?.originalname,
      fileSize: req.file?.size
    });
    
    // Provide more specific error messages
    let errorMessage = 'Failed to process CSV file';
    let errorDetails = error.message || String(error);
    
    if (error.message?.includes('multer')) {
      errorMessage = 'File upload error';
      errorDetails = 'Please ensure the file is a valid CSV file and does not exceed 500MB.';
    } else if (error.message?.includes('parse') || error.message?.includes('CSV')) {
      errorMessage = 'CSV parsing error';
      errorDetails = 'The CSV file format is invalid. Please check the file structure and try again.';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: errorDetails
    });
  }
});

/**
 * POST /api/los/csv/process
 * Process uploaded CSV file with field mapping
 */
router.post('/csv/process', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { filePath, connectionId, fieldMapping } = req.body;

    if (!filePath || !connectionId) {
      return res.status(400).json({ error: 'File path and connection ID are required' });
    }

    // Import CSV processor
    const { processCSVFile } = await import('../services/csvProcessor.js');

    // filePath from multer is already the full path to the uploaded file
    const result = await processCSVFile(connectionId, filePath, fieldMapping);

    res.json(result);
  } catch (error: any) {
    logError('Error processing CSV', error, { userId: req.userId, connectionId: req.body?.connectionId });
    res.status(500).json({ error: error.message || 'Failed to process CSV file' });
  }
});

/**
 * GET /api/los/connections/:id/logs
 * Get sync logs for a LOS connection
 */
router.get('/connections/:id/logs', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await pool.query(
      `SELECT * FROM public.los_sync_logs 
       WHERE los_connection_id = $1 
       ORDER BY started_at DESC 
       LIMIT $2`,
      [id, limit]
    );

    res.json({ logs: result.rows });
  } catch (error: any) {
    logError('Error fetching sync logs', error, { userId: req.userId, connectionId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch sync logs' });
  }
});

/**
 * POST /api/los/demo/upload
 * Upload demo/test CSV file with anonymized data
 * This endpoint doesn't require a LOS connection - it directly processes and stores the data
 */
router.post('/demo/upload', authenticateToken, upload.single('csv'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    // Get or create tenant_id for the user
    let profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    let tenantId: string;

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      try {
        logDebug('Creating tenant and profile for user', { userId: req.userId });
        
        // Create profile if it doesn't exist
        if (profileResult.rows.length === 0) {
          logDebug('Creating profile for user', { userId: req.userId });
          await pool.query(
            'INSERT INTO public.profiles (user_id, created_at) VALUES ($1, NOW())',
            [req.userId]
          );
          // Re-fetch profile after creation
          profileResult = await pool.query(
            'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
            [req.userId]
          );
        }

        // Check again if tenant_id was set (might have been set by trigger or another process)
        if (profileResult.rows[0]?.tenant_id) {
          tenantId = profileResult.rows[0].tenant_id;
          logDebug('Found existing tenant_id after profile creation', { userId: req.userId, tenantId });
        } else {
          // Get user email for tenant name
          const userResult = await pool.query(
            'SELECT email FROM public.users WHERE id = $1',
            [req.userId]
          );
          const userEmail = userResult.rows[0]?.email || 'demo@ailethia.com';
          logDebug('User email', { userId: req.userId, userEmail });

          // Create a default tenant for the user
          const tenantResult = await pool.query(
            `INSERT INTO public.tenants (name, created_at)
             VALUES ($1, NOW())
             RETURNING id`,
            [`Tenant for ${userEmail}`]
          );

          tenantId = tenantResult.rows[0].id;
          logInfo('Created tenant', { userId: req.userId, tenantId });

          // Update profile with tenant_id
          const updateResult = await pool.query(
            'UPDATE public.profiles SET tenant_id = $1 WHERE user_id = $2 RETURNING tenant_id',
            [tenantId, req.userId]
          );
          
          if (updateResult.rows.length === 0 || !updateResult.rows[0].tenant_id) {
            throw new Error('Failed to update profile with tenant_id');
          }
          
          logInfo('Updated profile with tenant_id', { userId: req.userId, tenantId });
        }
      } catch (tenantError: any) {
        logError('Error creating tenant', tenantError, { userId: req.userId });
        throw new Error(`Failed to create tenant: ${tenantError.message}`);
      }
    } else {
      tenantId = profileResult.rows[0].tenant_id;
      logDebug('Using existing tenant', { userId: req.userId, tenantId });
    }

    // Verify tenantId is set
    if (!tenantId) {
      throw new Error('Tenant ID is required but was not set');
    }

    // Parse CSV from in-memory buffer (multer.memoryStorage())
    let csvText = req.file.buffer.toString('utf-8');
    // Remove BOM if present (common in Excel-exported CSV files)
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.slice(1);
    }

    const parsed = Papa.parse<Record<string, any>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
    });

    // If parsing produced errors, log them but continue with best-effort data
    if (parsed.errors?.length) {
      logWarn('Demo CSV parse warnings', { userId: req.userId, errorCount: parsed.errors.length, errors: parsed.errors.slice(0, 5) });
    }

    const records = (parsed.data || []).filter((row) => row && Object.keys(row).length > 0);

    // Get tenant field mappings if available
    const tenantMappings = await getTenantFieldMappings(tenantId);
    
    // Auto-detect field mappings from CSV headers if not provided
    let effectiveMapping: Record<string, string> = {};
    if (records.length > 0) {
      const csvHeaders = Object.keys(records[0]);
      effectiveMapping = suggestFieldMappings(csvHeaders);
    }

    // Process and store loans in batches for better performance
    let recordsProcessed = 0;
    let recordsFailed = 0;
    const errors: string[] = [];
    const BATCH_SIZE = 100; // Process 100 records at a time

    // Process records in batches
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (record, batchIndex) => {
        const recordIndex = i + batchIndex;
        try {
        // Apply field mapping
        let mappedRecord = record;
        if (tenantMappings) {
          mappedRecord = applyFieldMapping(record, tenantMappings.field_mappings);
        } else if (Object.keys(effectiveMapping).length > 0) {
          // Convert simple mapping to rule format
          const mappingRules: Record<string, any> = {};
          for (const [source, target] of Object.entries(effectiveMapping)) {
            mappingRules[source] = { source, target };
          }
          mappedRecord = applyFieldMapping(record, mappingRules);
        }

        // Use the transformCSVRecordToLoan function from csvProcessor for consistency
        // Import it or use inline transformation with mapped record
        const getField = (patterns: string[], defaultValue?: any) => {
          for (const pattern of patterns) {
            if (mappedRecord[pattern] !== undefined && mappedRecord[pattern] !== null && mappedRecord[pattern] !== '') {
              return mappedRecord[pattern];
            }
          }
          return defaultValue;
        };

        const parseDate = (value: any): Date | undefined => {
          if (!value) return undefined;
          if (value instanceof Date) return value;
          const date = new Date(value);
          return isNaN(date.getTime()) ? undefined : date;
        };

        const parseNumber = (value: any): number | undefined => {
          if (value === undefined || value === null || value === '') return undefined;
          const num = typeof value === 'number' ? value : parseFloat(String(value));
          return isNaN(num) ? undefined : num;
        };

        const borrowerName = getField(['borrower_name', 'applicant_name', 'name', 'customer_name']) ||
          (() => {
            const firstName = getField(['first_name', 'borrower_first_name', 'fname']);
            const lastName = getField(['last_name', 'borrower_last_name', 'lname', 'surname']);
            if (firstName || lastName) {
              return `${firstName || ''} ${lastName || ''}`.trim();
            }
            return 'Demo Borrower';
          })();

        // Transform CSV record to loan data format using mapped record
        const loanData = {
          loan_id: getField(['loan_id', 'loan_number', 'id', 'application_id', 'loanId', 'loanNumber']) || 
                   `DEMO-${Date.now()}-${recordsProcessed}`,
          borrower_name: borrowerName,
          loan_amount: parseNumber(getField(['loan_amount', 'amount', 'requested_amount', 'principal_amount'], '0')),
          loan_type: getField(['loan_type', 'product_type', 'product', 'loan_purpose', 'loanProduct'], 'Conventional'),
          // Infer status based on dates if raw status is not a recognized loan status
          status: (() => {
            const rawStatus = String(getField(['status', 'loan_status', 'application_status', 'state', 'stage'], 'Active')).toUpperCase();
            const closingDate = parseDate(getField(['closing_date', 'close_date', 'fund_date', 'funded_date']));
            const lockDate = parseDate(getField(['lock_date', 'rate_lock_date']));

            if (closingDate) return 'Closed';
            if (lockDate) return 'Locked';
            // If raw status is a common state code, default to 'Active'
            if (['DE', 'PA', 'NJ', 'MD', 'NY', 'FL', 'VA', 'AK', 'IN'].includes(rawStatus)) return 'Active';
            // Otherwise, use the raw status if it seems like a valid loan status
            if (['ACTIVE', 'SUBMITTED', 'APPROVED', 'CTC', 'WITHDRAWN', 'DENIED', 'ORIGINATED', 'FUNDED'].includes(rawStatus)) return rawStatus;
            return 'Active'; // Default fallback
          })(),
          application_date: parseDate(getField(['application_date', 'app_date', 'submitted_date', 'created_date'])) || new Date(),
          closing_date: parseDate(getField(['closing_date', 'close_date', 'fund_date', 'funded_date'])),
          lock_date: parseDate(getField(['lock_date', 'rate_lock_date'])), // Added lock_date
          interest_rate: parseNumber(getField(['interest_rate', 'rate', 'apr', 'note_rate'])),
          raw_data: record, // Store original record for reference
        };

        // Validate required fields
        if (!loanData.loan_id) {
          throw new Error('Missing loan_id');
        }

        // Extract additional fields for Business Overview, Leaderboard, Loan Funnel, and Ops data
        const respaDate = parseDate(getField(['respa_date', 'respaDate', 'respa_application_date']));
        const creditPullDate = parseDate(getField(['credit_pull_date', 'creditPullDate', 'credit_pull']));
        const ficoScore = parseNumber(getField(['fico_score', 'fico', 'credit_score']));
        const ltv = parseNumber(getField(['ltv', 'loan_to_value', 'loan_to_value_ratio']));
        const loanPurpose = getField(['loan_purpose', 'purpose', 'loanPurpose']);
        const branch = getField(['branch', 'branch_name', 'office']);
        const loanOfficerName = getField(['loan_officer_name', 'loan_officer', 'officer_name', 'lo_name']);
        const falloutReason = getField(['fallout_reason', 'falloutReason', 'fallout']);
        const cycleTimeDays = parseNumber(getField(['cycle_time_days', 'cycleTime', 'cycle_time']));
        const complexityScore = parseNumber(getField(['complexity_score', 'complexityScore', 'complexity'])); // For TopTiering Ops scoring
        
        // Store loan data in the database - include all fields in raw_data for comprehensive access
        await pool.query(
          `INSERT INTO public.loans (
            tenant_id, loan_id, borrower_name, loan_amount, loan_type, 
            status, application_date, closing_date, lock_date, interest_rate,
            loan_purpose, branch, credit_pull_date, cycle_time_days,
            raw_data, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
          ON CONFLICT (tenant_id, loan_id) 
          DO UPDATE SET
            borrower_name = EXCLUDED.borrower_name,
            loan_amount = EXCLUDED.loan_amount,
            loan_type = EXCLUDED.loan_type,
            status = EXCLUDED.status,
            application_date = EXCLUDED.application_date,
            closing_date = EXCLUDED.closing_date,
            lock_date = EXCLUDED.lock_date,
            interest_rate = EXCLUDED.interest_rate,
            loan_purpose = EXCLUDED.loan_purpose,
            branch = EXCLUDED.branch,
            credit_pull_date = EXCLUDED.credit_pull_date,
            cycle_time_days = EXCLUDED.cycle_time_days,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()`,
          [
            tenantId,
            loanData.loan_id,
            loanData.borrower_name,
            loanData.loan_amount,
            loanData.loan_type,
            loanData.status,
            loanData.application_date,
            loanData.closing_date,
            loanData.lock_date,
            loanData.interest_rate,
            loanPurpose,
            branch,
            creditPullDate,
            cycleTimeDays || (loanData.application_date && loanData.closing_date 
              ? Math.round((new Date(loanData.closing_date).getTime() - new Date(loanData.application_date).getTime()) / (1000 * 60 * 60 * 24))
              : null),
            JSON.stringify({
              ...(typeof loanData.raw_data === 'object' && loanData.raw_data !== null ? loanData.raw_data : {}),
              ...(typeof record === 'object' && record !== null ? record : {}),
              // Ensure all fields are in raw_data for API access (Business Overview, Leaderboard, Loan Funnel, Ops)
              respa_date: respaDate, // For Ops turn time by stage calculations
              fico_score: ficoScore,
              ltv: ltv,
              loan_officer_name: loanOfficerName,
              fallout_reason: falloutReason,
              complexity_score: complexityScore, // For TopTiering Ops complexity scoring
            }),
          ]
        );
        return { success: true, recordIndex };
      } catch (e: any) {
        return { success: false, recordIndex, error: e.message };
      }
    });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Process batch results
      for (const result of batchResults) {
        if (result.success) {
          recordsProcessed++;
        } else {
          errors.push(`Row ${result.recordIndex + 1}: ${result.error}`);
          recordsFailed++;
        }
      }

      // Log progress for large files
      if (records.length > 1000 && (i + BATCH_SIZE) % 1000 === 0) {
        logInfo(`Processed ${Math.min(i + BATCH_SIZE, records.length)} of ${records.length} records`, { userId: req.userId, processed: i + BATCH_SIZE, total: records.length });
      }
    }

    res.json({
      success: recordsFailed === 0,
      records_processed: recordsProcessed,
      records_failed: recordsFailed,
      errors: errors.slice(0, 10), // Return first 10 errors
      message: `Processed ${recordsProcessed} loan records. ${recordsFailed > 0 ? `${recordsFailed} records failed.` : 'All records processed successfully.'}`,
    });
  } catch (error: any) {
    logError('Error processing demo CSV', error, {
      userId: req.userId,
      errorCode: error.code,
      fileName: req.file?.originalname,
    });
    
    // If it's a tenant error, provide more context
    if (error.message?.includes('Tenant not found') || error.message?.includes('tenant')) {
      logError('Tenant creation may have failed', undefined, { userId: req.userId });
      return res.status(500).json({ 
        error: 'Failed to create or retrieve tenant. Please try again.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
    res.status(500).json({ 
      error: error.message || 'Failed to process demo CSV file',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/los/field-population-stats
 * Get field population statistics for loans table
 */
router.get('/field-population-stats', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    if (!tenantContext?.tenantPool) {
      return res.status(400).json({ error: 'Tenant context required' });
    }

    const tenantPool = tenantContext.tenantPool;

    // Get total loan count
    const totalLoansResult = await tenantPool.query('SELECT COUNT(*) as count FROM public.loans');
    const totalLoans = parseInt(totalLoansResult.rows[0]?.count || '0');

    if (totalLoans === 0) {
      return res.json({
        totalLoans: 0,
        overallPopulationRate: 0,
        fields: [],
      });
    }

    // Get all columns from loans table (excluding system columns)
    const columnsResult = await tenantPool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'loans'
        AND column_name NOT IN ('id', 'created_at', 'updated_at', 'created_by', 'embedding', 'raw_data', 'metadata')
      ORDER BY column_name
    `);

    const fields: Array<{
      columnName: string;
      dataType: string;
      populatedCount: number;
      populationRate: number;
    }> = [];

    // Calculate population statistics for each field
    for (const row of columnsResult.rows) {
      const columnName = row.column_name;
      const dataType = row.data_type;

      // Build query to count non-null values
      // Handle different data types appropriately
      let countQuery = '';
      if (dataType === 'jsonb') {
        // For JSONB, check if it's not null and not empty object
        countQuery = `COUNT(CASE WHEN ${columnName} IS NOT NULL AND ${columnName}::text != '{}' THEN 1 END)`;
      } else if (dataType === 'text') {
        // For TEXT, check if not null and not empty string
        countQuery = `COUNT(CASE WHEN ${columnName} IS NOT NULL AND ${columnName} != '' THEN 1 END)`;
      } else {
        // For other types, just check if not null
        countQuery = `COUNT(CASE WHEN ${columnName} IS NOT NULL THEN 1 END)`;
      }

      try {
        const countResult = await tenantPool.query(`
          SELECT ${countQuery} as populated_count
          FROM public.loans
        `);

        const populatedCount = parseInt(countResult.rows[0]?.populated_count || '0');
        const populationRate = totalLoans > 0 ? (populatedCount / totalLoans) * 100 : 0;

        fields.push({
          columnName,
          dataType,
          populatedCount,
          populationRate: Math.round(populationRate * 100) / 100, // Round to 2 decimal places
        });
      } catch (error: any) {
        // Skip fields that cause errors (e.g., if column was removed)
        logWarn(`Error calculating population for field ${columnName}`, { error: error.message });
      }
    }

    // Sort by population rate (descending)
    fields.sort((a, b) => b.populationRate - a.populationRate);

    // Calculate overall population rate (average of all fields)
    const overallPopulationRate = fields.length > 0
      ? fields.reduce((sum, field) => sum + field.populationRate, 0) / fields.length
      : 0;

    res.json({
      totalLoans,
      overallPopulationRate: Math.round(overallPopulationRate * 100) / 100,
      fields,
    });
  } catch (error: any) {
    logError('Error fetching field population stats', error, { userId: req.userId });
    res.status(500).json({ 
      error: 'Failed to fetch field population statistics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/los/field-mapping-debug
 * Debug endpoint to analyze field mapping issues for empty fields
 */
router.get('/field-mapping-debug', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    if (!tenantContext?.tenantPool) {
      return res.status(400).json({ error: 'Tenant context required' });
    }

    const losConnectionId = req.query.connection_id as string;
    if (!losConnectionId) {
      return res.status(400).json({ error: 'connection_id query parameter required' });
    }

    const tenantPool = tenantContext.tenantPool;

    // Import field mapper functions
    const { 
      getAllCoheusAliases, 
      getDefaultFieldId, 
      coheusAliasToColumnName,
      getFieldSwaps 
    } = await import('../services/encompassFieldMapper.js');

    // Get all field mappings (data dictionary + swaps)
    const allAliases = getAllCoheusAliases();
    const fieldSwaps = await getFieldSwaps(tenantPool, losConnectionId);
    
    const fieldMappings: Array<{
      alias: string;
      fieldId: string;
      columnName: string;
      source: 'default' | 'swap';
      inDatabase: boolean;
      populationRate: number;
      populatedCount: number;
    }> = [];

    // Get database column list
    const columnsResult = await tenantPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'loans'
        AND column_name NOT IN ('id', 'created_at', 'updated_at', 'created_by', 'embedding', 'raw_data', 'metadata')
    `);
    const dbColumns = new Set(columnsResult.rows.map((r: any) => r.column_name));

    // Get total loans
    const totalLoansResult = await tenantPool.query('SELECT COUNT(*) as count FROM public.loans');
    const totalLoans = parseInt(totalLoansResult.rows[0]?.count || '0');

    // Analyze each mapped field
    for (const alias of allAliases) {
      const columnName = coheusAliasToColumnName(alias);
      
      // Skip if column doesn't exist in database
      if (!dbColumns.has(columnName)) {
        continue;
      }

      // Get field ID (swap or default)
      let fieldId: string | null = null;
      let source: 'default' | 'swap' = 'default';
      
      if (fieldSwaps.has(alias)) {
        fieldId = fieldSwaps.get(alias)!;
        source = 'swap';
      } else {
        fieldId = getDefaultFieldId(alias);
      }

      if (!fieldId) {
        continue;
      }

      // Check population in database
      let populatedCount = 0;
      let populationRate = 0;

      try {
        // Get column data type to build appropriate query
        const colInfo = await tenantPool.query(`
          SELECT data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'loans'
            AND column_name = $1
        `, [columnName]);

        if (colInfo.rows.length > 0) {
          const dataType = colInfo.rows[0].data_type;
          let countQuery = '';
          
          if (dataType === 'jsonb') {
            countQuery = `COUNT(CASE WHEN ${columnName} IS NOT NULL AND ${columnName}::text != '{}' THEN 1 END)`;
          } else if (dataType === 'text') {
            countQuery = `COUNT(CASE WHEN ${columnName} IS NOT NULL AND ${columnName} != '' THEN 1 END)`;
          } else {
            countQuery = `COUNT(CASE WHEN ${columnName} IS NOT NULL THEN 1 END)`;
          }

          const countResult = await tenantPool.query(`SELECT ${countQuery} as populated_count FROM public.loans`);
          populatedCount = parseInt(countResult.rows[0]?.populated_count || '0');
          populationRate = totalLoans > 0 ? (populatedCount / totalLoans) * 100 : 0;
        }
      } catch (error: any) {
        // Skip if query fails
      }

      fieldMappings.push({
        alias,
        fieldId,
        columnName,
        source,
        inDatabase: true,
        populationRate: Math.round(populationRate * 100) / 100,
        populatedCount,
      });
    }

    // Get a sample loan to check what fields are actually in the API response
    let sampleLoanFields: string[] = [];
    try {
      const sampleLoanResult = await tenantPool.query(`
        SELECT raw_data
        FROM public.loans
        WHERE raw_data IS NOT NULL
        LIMIT 1
      `);

      if (sampleLoanResult.rows.length > 0 && sampleLoanResult.rows[0].raw_data) {
        sampleLoanFields = Object.keys(sampleLoanResult.rows[0].raw_data);
      }
    } catch (error: any) {
      // Ignore if raw_data doesn't exist or is null
    }

    // Analyze which mapped fields are missing from sample loan
    const emptyFields = fieldMappings.filter(f => f.populationRate === 0);
    const missingFromSample: Array<{ alias: string; fieldId: string; columnName: string; foundVariations: string[]; exactMatch?: string }> = [];
    const foundInSample: Array<{ alias: string; fieldId: string; columnName: string; foundAs: string }> = [];

    for (const field of emptyFields) {
      const variations = [
        field.fieldId,
        field.fieldId.replace('Fields.', ''),
        `Fields.${field.fieldId.replace('Fields.', '')}`,
        field.columnName,
      ];
      
      const foundVariations = variations.filter(v => sampleLoanFields.includes(v));
      
      if (foundVariations.length > 0) {
        // Field exists in sample but isn't being mapped - this is the problem!
        foundInSample.push({
          alias: field.alias,
          fieldId: field.fieldId,
          columnName: field.columnName,
          foundAs: foundVariations[0], // The exact key that exists in the sample
        });
      } else {
        // Check if any similar field names exist
        const similarFields = sampleLoanFields.filter(sf => 
          sf.toLowerCase().includes(field.columnName.toLowerCase()) ||
          field.columnName.toLowerCase().includes(sf.toLowerCase())
        );
        
        missingFromSample.push({
          alias: field.alias,
          fieldId: field.fieldId,
          columnName: field.columnName,
          foundVariations: similarFields.length > 0 ? similarFields : [],
        });
      }
    }
    
    // Also find fields in sample that don't have mappings (potential new fields)
    const unmappedSampleFields = sampleLoanFields.filter(sf => {
      // Check if this field matches any column name
      const matchingMapping = fieldMappings.find(f => {
        const variations = [
          f.fieldId,
          f.fieldId.replace('Fields.', ''),
          `Fields.${f.fieldId.replace('Fields.', '')}`,
          f.columnName,
        ];
        return variations.includes(sf);
      });
      return !matchingMapping;
    });

    // Summary statistics
    const totalMappedFields = fieldMappings.length;
    const populatedFields = fieldMappings.filter(f => f.populationRate > 0).length;
    const emptyMappedFields = emptyFields.length;
    const fieldsInSample = fieldMappings.filter(f => {
      const variations = [
        f.fieldId,
        f.fieldId.replace('Fields.', ''),
        `Fields.${f.fieldId.replace('Fields.', '')}`,
        f.columnName,
      ];
      return variations.some(v => sampleLoanFields.includes(v));
    }).length;

    res.json({
      summary: {
        totalMappedFields,
        populatedFields,
        emptyMappedFields,
        fieldsInSample,
        totalLoans,
        sampleLoanFieldCount: sampleLoanFields.length,
        foundInSampleButNotMapped: foundInSample.length, // Critical: fields that exist but aren't being mapped
      },
      emptyFields: emptyFields.map(f => ({
        alias: f.alias,
        fieldId: f.fieldId,
        columnName: f.columnName,
        source: f.source,
      })),
      missingFromSample, // Fields not in sample at all
      foundInSample, // Fields that exist in sample but aren't being mapped (THE PROBLEM!)
      unmappedSampleFields: unmappedSampleFields.slice(0, 50), // Sample fields with no mapping
      allMappings: fieldMappings.sort((a, b) => a.populationRate - b.populationRate),
    });
  } catch (error: any) {
    logError('Error in field mapping debug', error, { userId: req.userId });
    res.status(500).json({ 
      error: 'Failed to analyze field mappings',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/los/transformation-comparison
 * Compare transformed loan object with database schema to see what's being written
 */
router.get('/transformation-comparison', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Import field mapper to analyze what should be mapped
    const { getAllCoheusAliases, coheusAliasToColumnName, getDefaultFieldId } = await import('../services/encompassFieldMapper.js');
    
    // Get a sample loan with raw_data
    const sampleLoanResult = await tenantPool.query(`
      SELECT *
      FROM public.loans
      WHERE raw_data IS NOT NULL
      LIMIT 1
    `);
    
    if (sampleLoanResult.rows.length === 0) {
      return res.json({
        error: 'no_loans',
        message: 'No loans found in database. Sync some loans to see transformation comparison.',
        summary: { totalRawDataKeys: 0, populatedColumns: 0, emptyColumns: 0, databaseColumns: 0, problemMappings: 0 }
      });
    }
    
    const sampleLoan = sampleLoanResult.rows[0];
    const rawData = sampleLoan.raw_data || {};
    
    // Get all database columns
    const columnsResult = await tenantPool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'loans'
        AND column_name NOT IN ('id', 'created_at', 'updated_at', 'tenant_id', 'created_by')
      ORDER BY column_name
    `);
    const databaseColumns = columnsResult.rows.map((r: any) => r.column_name);
    
    // Analyze raw_data keys
    const rawDataKeys = Object.keys(rawData);
    const fieldsKeys = rawDataKeys.filter(k => k.startsWith('Fields.') || k.startsWith('Loan.'));
    const otherKeys = rawDataKeys.filter(k => !k.startsWith('Fields.') && !k.startsWith('Loan.'));
    
    // Find populated columns (non-null values in sample loan)
    const populatedColumns = databaseColumns.filter(col => 
      sampleLoan[col] !== null && sampleLoan[col] !== undefined
    );
    const emptyColumns = databaseColumns.filter(col => 
      sampleLoan[col] === null || sampleLoan[col] === undefined
    );
    
    // Build expected mapping: which field IDs should map to which columns
    const allAliases = getAllCoheusAliases();
    const expectedMappings: Array<{ alias: string; fieldId: string | null; column: string; hasRawData: boolean; hasDbValue: boolean; rawValue?: any; foundAsKey?: string }> = [];
    
    // Helper to check if a value is meaningful (non-null, non-empty)
    const isValueMeaningful = (value: any): boolean => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string' && value.trim() === '') return false;
      return true;
    };
    
    // Helper to find a field in rawData with various key formats
    // Only reports "found" if the value is actually meaningful
    const findFieldInRawData = (fieldId: string): { found: boolean; value: any; key: string } => {
      // Try exact match
      if (rawData[fieldId] !== undefined && isValueMeaningful(rawData[fieldId])) {
        return { found: true, value: rawData[fieldId], key: fieldId };
      }
      
      // Try without Fields. prefix
      if (fieldId.startsWith('Fields.')) {
        const withoutPrefix = fieldId.substring(7);
        if (rawData[withoutPrefix] !== undefined && isValueMeaningful(rawData[withoutPrefix])) {
          return { found: true, value: rawData[withoutPrefix], key: withoutPrefix };
        }
      }
      
      // Try with Fields. prefix if missing
      if (!fieldId.startsWith('Fields.')) {
        const withPrefix = `Fields.${fieldId}`;
        if (rawData[withPrefix] !== undefined && isValueMeaningful(rawData[withPrefix])) {
          return { found: true, value: rawData[withPrefix], key: withPrefix };
        }
      }
      
      // Handle special characters: # and spaces
      const variations = [
        fieldId,
        fieldId.replace(/#/g, '%23'),
        fieldId.replace(/#/g, '_'),
        fieldId.replace(/ /g, '%20'),
        fieldId.replace(/ /g, '+'),
        fieldId.replace(/ /g, '_'),
      ];
      
      // Also try without Fields. prefix for all variations
      if (fieldId.startsWith('Fields.')) {
        const base = fieldId.substring(7);
        variations.push(
          base,
          base.replace(/#/g, '%23'),
          base.replace(/#/g, '_'),
          base.replace(/ /g, '%20'),
          base.replace(/ /g, '+'),
          base.replace(/ /g, '_'),
        );
      }
      
      for (const v of variations) {
        if (rawData[v] !== undefined && isValueMeaningful(rawData[v])) {
          return { found: true, value: rawData[v], key: v };
        }
      }
      
      // Case-insensitive search as last resort - but be strict about matching
      // Don't strip # because it denotes borrower index (e.g., FE0110#2 = second borrower)
      // For numeric field IDs (e.g., Fields.1200), require EXACT match to prevent 1200 matching 12
      // For alphanumeric field IDs like FE0210, also require exact match
      const lowerFieldId = fieldId.toLowerCase();
      const lowerFieldIdNoPrefix = lowerFieldId.replace('fields.', '');
      
      // Check if this is a purely numeric field ID
      const isNumericFieldId = /^\d+$/.test(lowerFieldIdNoPrefix);
      
      // Check if this is a structured field ID (letters + numbers, like FE0210, ULDD.X26, etc.)
      // These should also require exact matches to prevent FE0210 matching FE0102
      const isStructuredFieldId = /^[a-z]+\d+$/i.test(lowerFieldIdNoPrefix) || 
                                   /^[a-z]+\.[a-z]+\d*$/i.test(lowerFieldIdNoPrefix);
      
      for (const key of Object.keys(rawData)) {
        const lowerKey = key.toLowerCase();
        const lowerKeyNoPrefix = lowerKey.replace('fields.', '');
        
        // Try exact case-insensitive match (with or without Fields. prefix)
        if (lowerKey === lowerFieldId || 
            lowerKeyNoPrefix === lowerFieldIdNoPrefix ||
            lowerKey === `fields.${lowerFieldIdNoPrefix}`) {
          if (isValueMeaningful(rawData[key])) {
            return { found: true, value: rawData[key], key: key };
          }
        }
        
        // For numeric or structured field IDs, ONLY allow exact match - no fuzzy matching
        // This prevents Fields.1200 from matching Fields.12
        // And prevents Fields.FE0210 from matching Fields.FE0102
        if (isNumericFieldId || isStructuredFieldId) {
          continue;
        }
        
        // Only normalize spaces (not # which is significant)
        const normalizedKey = lowerKeyNoPrefix.replace(/[%20+ ]/g, '');
        const normalizedFieldId = lowerFieldIdNoPrefix.replace(/[%20+ ]/g, '');
        if (normalizedKey === normalizedFieldId && isValueMeaningful(rawData[key])) {
          return { found: true, value: rawData[key], key: key };
        }
      }
      
      return { found: false, value: undefined, key: '' };
    };
    
    for (const alias of allAliases.slice(0, 50)) { // Limit to first 50 for response size
      const fieldId = getDefaultFieldId(alias);
      const column = coheusAliasToColumnName(alias);
      const rawDataResult = fieldId ? findFieldInRawData(fieldId) : { found: false, value: undefined, key: '' };
      const hasDbValue = sampleLoan[column] !== null && sampleLoan[column] !== undefined;
      
      expectedMappings.push({
        alias,
        fieldId,
        column,
        hasRawData: rawDataResult.found,
        hasDbValue,
        rawValue: rawDataResult.found ? rawDataResult.value : undefined,
        foundAsKey: rawDataResult.found ? rawDataResult.key : undefined
      });
    }
    
    // Find mappings that have raw data but no DB value (these are problems!)
    const problemMappings = expectedMappings.filter(m => m.hasRawData && !m.hasDbValue);
    
    // Sample of raw_data (first 20 fields)
    const sampleRawData: Record<string, any> = {};
    for (const key of fieldsKeys.slice(0, 20)) {
      sampleRawData[key] = rawData[key];
    }
    
    res.json({
      summary: {
        totalRawDataKeys: rawDataKeys.length,
        fieldsKeys: fieldsKeys.length,
        otherKeys: otherKeys.length,
        databaseColumns: databaseColumns.length,
        populatedColumns: populatedColumns.length,
        emptyColumns: emptyColumns.length,
        problemMappings: problemMappings.length
      },
      problemMappings: problemMappings.slice(0, 20), // Fields with raw data but no DB value
      populatedColumns: populatedColumns.sort(),
      emptyColumns: emptyColumns.sort(),
      sampleRawData,
      sampleExpectedMappings: expectedMappings.slice(0, 20),
      // Show what Loan.* keys exist
      loanKeys: otherKeys.filter(k => k.startsWith('Loan.')),
    });
  } catch (error: any) {
    logError('Error in transformation comparison', error, { userId: req.userId });
    res.status(500).json({ 
      error: 'Failed to compare transformation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/los/schema-dictionary-comparison
 * Compare database columns with data dictionary aliases to find mismatches
 * This shows which columns will NEVER populate because they have no data dictionary mapping
 */
router.get('/schema-dictionary-comparison', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Import the field mapper to get all aliases and their column names
    const { getAllCoheusAliases, coheusAliasToColumnName } = await import('../services/encompassFieldMapper.js');
    
    const allAliases = getAllCoheusAliases();
    
    // Build a set of valid column names from the data dictionary
    const validColumnsFromDictionary = new Map<string, string>(); // columnName -> alias
    for (const alias of allAliases) {
      const columnName = coheusAliasToColumnName(alias);
      if (!validColumnsFromDictionary.has(columnName)) {
        validColumnsFromDictionary.set(columnName, alias);
      }
    }
    
    // Get all database columns
    const columnsResult = await tenantPool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'loans'
        AND column_name NOT IN ('id', 'created_at', 'updated_at', 'tenant_id')
      ORDER BY column_name
    `);
    
    const databaseColumns = columnsResult.rows.map((r: any) => ({
      name: r.column_name,
      type: r.data_type
    }));
    
    // Find columns in DB that have NO mapping in data dictionary
    const orphanedColumns: Array<{column: string, type: string}> = [];
    const validColumns: Array<{column: string, type: string, alias: string}> = [];
    
    for (const col of databaseColumns) {
      // Skip special columns
      if (['loan_id', 'raw_data', 'embedding'].includes(col.name)) {
        continue;
      }
      
      if (validColumnsFromDictionary.has(col.name)) {
        validColumns.push({
          column: col.name,
          type: col.type,
          alias: validColumnsFromDictionary.get(col.name)!
        });
      } else {
        orphanedColumns.push({
          column: col.name,
          type: col.type
        });
      }
    }
    
    // Find aliases in dictionary that have NO column in DB
    const dbColumnSet = new Set(databaseColumns.map((c: any) => c.name));
    const missingColumns: Array<{alias: string, expectedColumn: string}> = [];
    
    for (const alias of allAliases) {
      const columnName = coheusAliasToColumnName(alias);
      if (!dbColumnSet.has(columnName)) {
        missingColumns.push({
          alias,
          expectedColumn: columnName
        });
      }
    }
    
    res.json({
      summary: {
        totalDatabaseColumns: databaseColumns.length,
        validColumns: validColumns.length,
        orphanedColumns: orphanedColumns.length,
        aliasesInDictionary: allAliases.length,
        missingColumnsInDb: missingColumns.length
      },
      orphanedColumns: orphanedColumns.sort((a, b) => a.column.localeCompare(b.column)),
      missingColumns: missingColumns.sort((a, b) => a.expectedColumn.localeCompare(b.expectedColumn)),
      validColumns: validColumns.sort((a, b) => a.column.localeCompare(b.column))
    });
  } catch (error: any) {
    logError('Error in schema-dictionary comparison', error, { userId: req.userId });
    res.status(500).json({ 
      error: 'Failed to compare schema with dictionary',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
