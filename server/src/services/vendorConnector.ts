/**
 * Vendor Connector Service
 * Handles vendor API integrations, reading from loans table and transforming data
 */

import { pool } from '../config/database.js';
import axios, { AxiosInstance } from 'axios';
import {
  transformForAccounting,
  transformForCapitalMarkets,
  transformForServicing,
  validateTransformedData,
  LoanData,
  FieldMapping,
} from './dataTransformer.js';

export interface VendorConnection {
  id: string;
  tenant_id: string;
  vendor_name: string;
  vendor_category: 'accounting' | 'capital_markets' | 'servicing';
  connection_type: 'vendor_initiated' | 'lender_initiated';
  vendor_api_key?: string;
  vendor_api_endpoint?: string;
  vendor_credentials?: string;
  vendor_webhook_url?: string;
  vendor_webhook_secret?: string;
  data_mapping?: FieldMapping;
  connection_status: 'pending' | 'active' | 'inactive' | 'error';
  sync_enabled: boolean;
  sync_frequency: 'realtime' | 'hourly' | 'daily' | 'weekly';
  last_synced_at?: Date;
  last_sync_status?: string;
  last_sync_error?: string;
  metadata?: any;
}

export interface SyncResult {
  success: boolean;
  records_synced: number;
  records_failed: number;
  error?: string;
  duration: number;
}

/**
 * Base Vendor Connector
 */
abstract class BaseVendorConnector {
  protected connection: VendorConnection;
  protected axiosInstance: AxiosInstance;

  constructor(connection: VendorConnection) {
    this.connection = connection;
    this.axiosInstance = axios.create({
      baseURL: connection.vendor_api_endpoint,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  abstract authenticate(): Promise<void>;
  abstract testConnection(): Promise<boolean>;
  abstract syncData(loans: LoanData[]): Promise<SyncResult>;
  abstract handleWebhook(payload: any): Promise<void>;
}

/**
 * Accounting System Connector
 */
class AccountingConnector extends BaseVendorConnector {
  async authenticate(): Promise<void> {
    if (!this.connection.vendor_api_key) {
      throw new Error('Missing API key for accounting system');
    }

    this.axiosInstance.defaults.headers.common['Authorization'] = 
      `Bearer ${this.connection.vendor_api_key}`;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      const response = await this.axiosInstance.get('/health', { validateStatus: () => true });
      return response.status < 500;
    } catch (error: any) {
      console.error('Accounting connection test failed:', error.message);
      return false;
    }
  }

  async syncData(loans: LoanData[]): Promise<SyncResult> {
    await this.authenticate();

    const startTime = Date.now();
    let recordsSynced = 0;
    let recordsFailed = 0;

    for (const loan of loans) {
      try {
        const transformed = transformForAccounting(loan, this.connection.data_mapping);
        const validation = validateTransformedData(transformed, 'accounting');

        if (!validation.valid) {
          throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Push to accounting API
        await this.axiosInstance.post('/transactions', transformed);
        recordsSynced++;
      } catch (error: any) {
        console.error(`Failed to sync loan ${loan.loan_id} to accounting:`, error.message);
        recordsFailed++;
      }
    }

    return {
      success: recordsFailed === 0,
      records_synced: recordsSynced,
      records_failed: recordsFailed,
      duration: Date.now() - startTime,
    };
  }

  async handleWebhook(payload: any): Promise<void> {
    // Handle incoming webhooks from accounting system
    console.log('Accounting webhook received:', payload);
    // Update loans table if needed
  }
}

/**
 * Capital Markets Connector
 */
class CapitalMarketsConnector extends BaseVendorConnector {
  async authenticate(): Promise<void> {
    if (!this.connection.vendor_api_key) {
      throw new Error('Missing API key for capital markets platform');
    }

    this.axiosInstance.defaults.headers.common['X-API-Key'] = this.connection.vendor_api_key;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      const response = await this.axiosInstance.get('/api/v1/health', { validateStatus: () => true });
      return response.status < 500;
    } catch (error: any) {
      console.error('Capital markets connection test failed:', error.message);
      return false;
    }
  }

  async syncData(loans: LoanData[]): Promise<SyncResult> {
    await this.authenticate();

    const startTime = Date.now();
    let recordsSynced = 0;
    let recordsFailed = 0;

    for (const loan of loans) {
      try {
        const transformed = transformForCapitalMarkets(loan, this.connection.data_mapping);
        const validation = validateTransformedData(transformed, 'capital_markets');

        if (!validation.valid) {
          throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Push to capital markets API
        await this.axiosInstance.post('/api/v1/loans', transformed);
        recordsSynced++;
      } catch (error: any) {
        console.error(`Failed to sync loan ${loan.loan_id} to capital markets:`, error.message);
        recordsFailed++;
      }
    }

    return {
      success: recordsFailed === 0,
      records_synced: recordsSynced,
      records_failed: recordsFailed,
      duration: Date.now() - startTime,
    };
  }

  async handleWebhook(payload: any): Promise<void> {
    // Handle incoming webhooks from capital markets platform
    console.log('Capital markets webhook received:', payload);
  }
}

/**
 * Servicing Connector
 */
class ServicingConnector extends BaseVendorConnector {
  async authenticate(): Promise<void> {
    if (!this.connection.vendor_api_key && !this.connection.vendor_credentials) {
      throw new Error('Missing credentials for servicing application');
    }

    if (this.connection.vendor_api_key) {
      this.axiosInstance.defaults.headers.common['Authorization'] = 
        `Bearer ${this.connection.vendor_api_key}`;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      const response = await this.axiosInstance.get('/api/health', { validateStatus: () => true });
      return response.status < 500;
    } catch (error: any) {
      console.error('Servicing connection test failed:', error.message);
      return false;
    }
  }

  async syncData(loans: LoanData[]): Promise<SyncResult> {
    await this.authenticate();

    const startTime = Date.now();
    let recordsSynced = 0;
    let recordsFailed = 0;

    for (const loan of loans) {
      try {
        const transformed = transformForServicing(loan, this.connection.data_mapping);
        const validation = validateTransformedData(transformed, 'servicing');

        if (!validation.valid) {
          throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Push to servicing API
        await this.axiosInstance.post('/api/loans', transformed);
        recordsSynced++;
      } catch (error: any) {
        console.error(`Failed to sync loan ${loan.loan_id} to servicing:`, error.message);
        recordsFailed++;
      }
    }

    return {
      success: recordsFailed === 0,
      records_synced: recordsSynced,
      records_failed: recordsFailed,
      duration: Date.now() - startTime,
    };
  }

  async handleWebhook(payload: any): Promise<void> {
    // Handle incoming webhooks from servicing application
    console.log('Servicing webhook received:', payload);
  }
}

/**
 * Factory function to create appropriate vendor connector
 */
export function createVendorConnector(connection: VendorConnection): BaseVendorConnector {
  switch (connection.vendor_category) {
    case 'accounting':
      return new AccountingConnector(connection);
    case 'capital_markets':
      return new CapitalMarketsConnector(connection);
    case 'servicing':
      return new ServicingConnector(connection);
    default:
      throw new Error(`Unknown vendor category: ${connection.vendor_category}`);
  }
}

/**
 * Sync loans to vendor (reads from loans table)
 */
export async function syncLoansToVendor(connectionId: string): Promise<SyncResult> {
  const startTime = Date.now();
  let recordsSynced = 0;
  let recordsFailed = 0;
  let error: string | undefined;

  try {
    // Get connection from database
    const connectionResult = await pool.query(
      'SELECT * FROM public.vendor_connections WHERE id = $1',
      [connectionId]
    );

    if (connectionResult.rows.length === 0) {
      throw new Error('Vendor connection not found');
    }

    const connection = connectionResult.rows[0] as VendorConnection;

    if (!connection.sync_enabled) {
      throw new Error('Sync is disabled for this connection');
    }

    // Read loans from loans table (single source of truth)
    const lastSync = connection.last_synced_at ? new Date(connection.last_synced_at) : undefined;
    
    let loansQuery = 'SELECT * FROM public.loans WHERE tenant_id = $1';
    const queryParams: any[] = [connection.tenant_id];

    if (lastSync) {
      loansQuery += ' AND (updated_at > $2 OR created_at > $2)';
      queryParams.push(lastSync);
    }

    loansQuery += ' ORDER BY created_at DESC LIMIT 1000';

    const loansResult = await pool.query(loansQuery, queryParams);
    const loans: LoanData[] = loansResult.rows.map(row => ({
      loan_id: row.loan_id,
      borrower_name: row.borrower_name,
      loan_amount: parseFloat(row.loan_amount || 0),
      loan_type: row.loan_type,
      status: row.status,
      application_date: row.application_date ? new Date(row.application_date) : undefined,
      closing_date: row.closing_date ? new Date(row.closing_date) : undefined,
      interest_rate: row.interest_rate ? parseFloat(row.interest_rate) : undefined,
      loan_officer_id: row.loan_officer_id,
      branch: row.branch,
      loan_purpose: row.loan_purpose,
      cycle_time_days: row.cycle_time_days,
      credit_pull_date: row.credit_pull_date ? new Date(row.credit_pull_date) : undefined,
      lock_date: row.lock_date ? new Date(row.lock_date) : undefined,
      fund_date: row.fund_date ? new Date(row.fund_date) : undefined,
      raw_data: row.raw_data,
    }));

    if (loans.length === 0) {
      return {
        success: true,
        records_synced: 0,
        records_failed: 0,
        duration: Date.now() - startTime,
      };
    }

    // Create connector and sync
    const connector = createVendorConnector(connection);
    const result = await connector.syncData(loans);

    recordsSynced = result.records_synced;
    recordsFailed = result.records_failed;

    // Update sync status
    await pool.query(
      `UPDATE public.vendor_connections 
       SET last_synced_at = NOW(), last_sync_status = $1, last_sync_error = NULL, updated_at = NOW()
       WHERE id = $2`,
      [result.success ? 'success' : recordsFailed > 0 ? 'partial' : 'success', connectionId]
    );

    // Log sync
    await pool.query(
      `INSERT INTO public.vendor_sync_logs (vendor_connection_id, tenant_id, sync_type, status, records_synced, records_failed, started_at, completed_at)
       VALUES ($1, $2, 'manual', $3, $4, $5, $6, NOW())`,
      [
        connectionId,
        connection.tenant_id,
        result.success ? 'success' : 'partial',
        recordsSynced,
        recordsFailed,
        new Date(startTime),
      ]
    );

    return {
      success: result.success,
      records_synced: recordsSynced,
      records_failed: recordsFailed,
      duration: Date.now() - startTime,
    };
  } catch (e: any) {
    error = e.message;
    recordsFailed++;

    // Update sync status with error
    await pool.query(
      `UPDATE public.vendor_connections 
       SET last_synced_at = NOW(), last_sync_status = 'failed', last_sync_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [error, connectionId]
    );

    // Log failed sync
    const connectionResult = await pool.query(
      'SELECT tenant_id FROM public.vendor_connections WHERE id = $1',
      [connectionId]
    );
    const tenantId = connectionResult.rows[0]?.tenant_id;

    await pool.query(
      `INSERT INTO public.vendor_sync_logs (vendor_connection_id, tenant_id, sync_type, status, records_synced, records_failed, started_at, completed_at, error_message)
       VALUES ($1, $2, 'manual', 'failed', $3, $4, $5, NOW(), $6)`,
      [connectionId, tenantId, recordsSynced, recordsFailed, new Date(startTime), error]
    );

    return {
      success: false,
      records_synced: recordsSynced,
      records_failed: recordsFailed,
      error,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Test vendor connection
 */
export async function testVendorConnection(connectionId: string): Promise<{ success: boolean; message: string }> {
  try {
    const connectionResult = await pool.query(
      'SELECT * FROM public.vendor_connections WHERE id = $1',
      [connectionId]
    );

    if (connectionResult.rows.length === 0) {
      return { success: false, message: 'Connection not found' };
    }

    const connection = connectionResult.rows[0] as VendorConnection;

    const connector = createVendorConnector(connection);
    const isConnected = await connector.testConnection();

    return {
      success: isConnected,
      message: isConnected ? 'Connection successful' : 'Connection failed - check credentials and API endpoint',
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Connection test failed',
    };
  }
}
