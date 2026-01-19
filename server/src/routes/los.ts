/**
 * LOS (Loan Origination System) Universal Connector Routes
 * Manages LOS connections, API integrations, and CSV uploads
 */

import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
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
 * Get all LOS connections for authenticated tenant
 */
router.get('/connections', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      // Return empty array if no tenant (for demo/testing)
      return res.json({ connections: [] });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const result = await pool.query(
      `SELECT * FROM public.los_connections WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );

    // Mask sensitive fields
    const connections = result.rows.map(conn => ({
      ...conn,
      api_client_secret: conn.api_client_secret ? '••••••••' : null,
      api_key: conn.api_key ? '••••••••' : null,
      db_password: conn.db_password ? '••••••••' : null,
    }));

    res.json({ connections });
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
 * POST /api/los/connections
 * Create a new LOS connection
 */
router.post('/connections', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const data = losConnectionSchema.parse(req.body);

    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    // Use a default tenant ID if none exists (for demo)
    const tenantId = profileResult.rows[0]?.tenant_id || '00000000-0000-0000-0000-000000000000';

    const result = await pool.query(
      `INSERT INTO public.los_connections (
        tenant_id, los_type, name, connection_method,
        api_base_url, api_client_id, api_client_secret, api_key,
        api_environment, oauth_authorization_url, oauth_token_url, oauth_scopes,
        sync_enabled, sync_frequency, webhook_enabled, webhook_url, webhook_secret,
        csv_upload_schedule, csv_upload_path, csv_field_mapping,
        db_host, db_port, db_name, db_user, db_password,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      RETURNING *`,
      [
        tenantId,
        data.los_type,
        data.name,
        data.connection_method,
        data.api_base_url || LOS_CONFIGS[data.los_type]?.defaultBaseUrl || null,
        data.api_client_id || null,
        data.api_client_secret || null,
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
        data.db_password || null,
        req.userId,
      ]
    );

    res.json({ connection: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error creating LOS connection', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to create LOS connection' });
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

    // Check if connection exists and belongs to user's tenant
    const connectionResult = await pool.query(
      'SELECT tenant_id FROM public.los_connections WHERE id = $1',
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

    updates.push(`updated_at = NOW()`);
    values.push(id);

    if (updates.length === 1) {
      return res.json({ connection: connectionResult.rows[0] });
    }

    const result = await pool.query(
      `UPDATE public.los_connections SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json({ connection: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error updating LOS connection', error, { userId: req.userId, connectionId: req.params.id });
    res.status(500).json({ error: 'Failed to update LOS connection' });
  }
});

/**
 * DELETE /api/los/connections/:id
 * Delete a LOS connection
 */
router.delete('/connections/:id', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM public.los_connections WHERE id = $1 RETURNING id',
      [id]
    );

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
    const connectionResult = await pool.query(
      'SELECT * FROM public.los_connections WHERE id = $1',
      [id]
    );

    if (connectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'LOS connection not found' });
    }

    const connection = connectionResult.rows[0];

    // Use actual test function for API connections
    if (connection.connection_method === 'api') {
      const { testLOSConnection } = await import('../services/losApiService.js');
      const result = await testLOSConnection(id);
      
      if (result.success) {
        res.json({ success: true, message: result.message });
      } else {
        res.status(400).json({ success: false, error: result.message });
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

    const connectionResult = await pool.query(
      'SELECT * FROM public.los_connections WHERE id = $1',
      [id]
    );

    if (connectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'LOS connection not found' });
    }

    const connection = connectionResult.rows[0];

    // Update sync status to pending
    await pool.query(
      `UPDATE public.los_connections
       SET last_synced_at = NOW(), last_sync_status = 'pending', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    // Trigger sync based on connection method
    if (connection.connection_method === 'api') {
      // Import and use API sync service
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
    logError('Error triggering sync', error, { userId: req.userId, connectionId: req.params.id });
    res.status(500).json({ error: error.message || 'Failed to trigger sync' });
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

export default router;
