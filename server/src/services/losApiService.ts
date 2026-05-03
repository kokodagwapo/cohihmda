/**
 * LOS API Service
 * Handles API integration with various Loan Origination Systems
 */

import { pool } from '../config/database.js';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { getApiBaseUrl, getCredentials } from './mockLosHelper.js';
import { runPostSyncHooks } from './hooks/postSyncHookService.js';
import type { SyncTrigger } from '../utils/schedulerPolicy.js';
import { attachPersistedComplexityScores } from './scoring/persistedLoanComplexity.js';

export interface LOSConnection {
  id: string;
  los_type: string;
  name: string;
  connection_method: string;
  api_base_url?: string;
  api_client_id?: string;
  api_client_secret?: string;
  api_key?: string;
  api_access_token?: string;
  api_refresh_token?: string;
  api_token_expires_at?: Date;
  api_environment?: string;
  oauth_authorization_url?: string;
  oauth_token_url?: string;
  oauth_scopes?: string;
  csv_upload_path?: string;
  csv_field_mapping?: any;
  db_host?: string;
  db_port?: number;
  db_name?: string;
  db_user?: string;
  db_password?: string;
  sync_enabled: boolean;
  sync_frequency: string;
  webhook_enabled: boolean;
  webhook_url?: string;
}

export interface LoanData {
  loan_id: string;
  borrower_name?: string;
  loan_amount?: number;
  loan_type?: string;
  status?: string;
  application_date?: Date;
  closing_date?: Date;
  interest_rate?: number;
  [key: string]: any; // Allow additional fields
}

export interface SyncResult {
  success: boolean;
  records_synced: number;
  records_failed: number;
  error?: string;
  duration: number;
}

/**
 * Base LOS API Client
 */
abstract class BaseLOSClient {
  protected connection: LOSConnection;
  protected axiosInstance: AxiosInstance;

  constructor(connection: LOSConnection) {
    this.connection = connection;
    // Use mock API if configured, otherwise use provided URL
    const baseURL = getApiBaseUrl(connection.los_type, connection.api_base_url) || connection.api_base_url;
    this.axiosInstance = axios.create({
      baseURL: baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  abstract authenticate(): Promise<void>;
  abstract fetchLoans(since?: Date): Promise<LoanData[]>;
  abstract testConnection(): Promise<boolean>;
}

/**
 * ICE Encompass OAuth2 Client
 * Documentation: https://mortgagetech.ice.com/resources/encompass-developer-connect
 * 
 * Encompass Developer Connect provides:
 * - OAuth2 authentication
 * - Loan API endpoints
 * - eFolder document management
 * - Contacts API
 * - Custom data objects
 * - Webhooks for real-time notifications
 */
class EncompassClient extends BaseLOSClient {
  async authenticate(): Promise<void> {
    // Check if we have a valid token
    if (
      this.connection.api_access_token &&
      this.connection.api_token_expires_at &&
      new Date(this.connection.api_token_expires_at) > new Date()
    ) {
      this.axiosInstance.defaults.headers.common['Authorization'] = 
        `Bearer ${this.connection.api_access_token}`;
      return;
    }

    // Get credentials (mock or real)
    const creds = getCredentials('encompass', this.connection);
    
    if (!creds.oauth_token_url || !creds.api_client_id || !creds.api_client_secret) {
      throw new Error('Missing OAuth2 credentials for Encompass');
    }

    try {
      const response = await axios.post(
        creds.oauth_token_url!,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: creds.api_client_id!,
          client_secret: creds.api_client_secret!,
          scope: this.connection.oauth_scopes || 'lp lp_master_readonly',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;

      // Save tokens to database
      const expiresAt = new Date(Date.now() + (expires_in * 1000));
      await pool.query(
        `UPDATE public.los_connections 
         SET api_access_token = $1, api_refresh_token = $2, api_token_expires_at = $3, updated_at = NOW()
         WHERE id = $4`,
        [access_token, refresh_token || null, expiresAt, this.connection.id]
      );

      this.connection.api_access_token = access_token;
      this.connection.api_refresh_token = refresh_token;
      this.connection.api_token_expires_at = expiresAt;

      this.axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    } catch (error: any) {
      console.error('Encompass OAuth2 authentication failed:', error.response?.data || error.message);
      throw new Error(`Encompass authentication failed: ${error.response?.data?.error_description || error.message}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      // Test with a simple API call (adjust endpoint based on Encompass API)
      const response = await this.axiosInstance.get('/encompass/v1/loans?limit=1');
      return response.status === 200;
    } catch (error: any) {
      console.error('Encompass connection test failed:', error.response?.data || error.message);
      return false;
    }
  }

  async fetchLoans(since?: Date): Promise<LoanData[]> {
    await this.authenticate();

    try {
      // Build query parameters according to Encompass Developer Connect API
      // Reference: https://mortgagetech.ice.com/resources/encompass-developer-connect
      const params: any = {
        limit: 100,
        fields: 'fields=loanNumber,borrower.firstName,borrower.lastName,loanAmount,loanPurpose,loanStatus,applicationDate,closingDate,interestRate',
      };

      if (since) {
        params.modifiedFrom = since.toISOString();
      }

      // Use Encompass API v1 endpoint for loans
      // API documentation: https://mortgagetech.ice.com/resources/encompass-developer-connect
      const response = await this.axiosInstance.get('/encompass/v1/loans', { params });

      // Transform Encompass loan data to our format
      // Based on Encompass Developer Connect API structure
      return (response.data.loans || []).map((loan: any) => ({
        loan_id: loan.loanNumber || loan.guid,
        borrower_name: loan.borrower ? `${loan.borrower.firstName || ''} ${loan.borrower.lastName || ''}`.trim() : undefined,
        loan_amount: loan.loanAmount,
        loan_type: loan.loanPurpose,
        status: loan.loanStatus,
        application_date: loan.applicationDate ? new Date(loan.applicationDate) : undefined,
        closing_date: loan.closingDate ? new Date(loan.closingDate) : undefined,
        interest_rate: loan.interestRate,
        raw_data: loan, // Store raw data for reference
      }));
    } catch (error: any) {
      console.error('Error fetching Encompass loans:', error.response?.data || error.message);
      throw new Error(`Failed to fetch loans from Encompass: ${error.response?.data?.message || error.message}`);
    }
  }
}

/**
 * MeridianLink API Key Client
 */
class MeridianLinkClient extends BaseLOSClient {
  async authenticate(): Promise<void> {
    // Get credentials (mock or real)
    const creds = getCredentials('meridianlink', this.connection);
    
    if (!creds.api_key) {
      throw new Error('Missing API key for MeridianLink');
    }

    this.axiosInstance.defaults.headers.common['X-API-Key'] = creds.api_key;
    this.axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${creds.api_key}`;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      // Test with a simple API call (adjust endpoint based on MeridianLink API)
      const response = await this.axiosInstance.get('/api/v1/loans?limit=1');
      return response.status === 200;
    } catch (error: any) {
      console.error('MeridianLink connection test failed:', error.response?.data || error.message);
      return false;
    }
  }

  async fetchLoans(since?: Date): Promise<LoanData[]> {
    await this.authenticate();

    try {
      const params: any = {
        limit: 100,
      };

      if (since) {
        params.updated_since = since.toISOString();
      }

      const response = await this.axiosInstance.get('/api/v1/loans', { params });

      // Transform MeridianLink loan data to our format
      return (response.data.data || response.data.loans || []).map((loan: any) => ({
        loan_id: loan.id || loan.loan_number,
        borrower_name: loan.borrower_name || loan.applicant_name,
        loan_amount: loan.loan_amount || loan.amount,
        loan_type: loan.loan_type || loan.product_type,
        status: loan.status || loan.loan_status,
        application_date: loan.application_date ? new Date(loan.application_date) : undefined,
        closing_date: loan.closing_date ? new Date(loan.closing_date) : undefined,
        interest_rate: loan.interest_rate || loan.rate,
        raw_data: loan,
      }));
    } catch (error: any) {
      console.error('Error fetching MeridianLink loans:', error.response?.data || error.message);
      throw new Error(`Failed to fetch loans from MeridianLink: ${error.response?.data?.message || error.message}`);
    }
  }
}

/**
 * Generic API Key Client (for other LOS systems)
 */
class GenericAPIKeyClient extends BaseLOSClient {
  async authenticate(): Promise<void> {
    // Get credentials (mock or real) - try to infer LOS type from base URL or use generic
    const losType = this.connection.los_type || 'generic';
    const creds = getCredentials(losType, this.connection);
    
    if (!creds.api_key) {
      throw new Error('Missing API key');
    }

    this.axiosInstance.defaults.headers.common['X-API-Key'] = creds.api_key;
    this.axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${creds.api_key}`;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      // Generic health check endpoint
      const response = await this.axiosInstance.get('/health', { validateStatus: () => true });
      return response.status < 500;
    } catch (error: any) {
      console.error('Generic API connection test failed:', error.message);
      return false;
    }
  }

  async fetchLoans(since?: Date): Promise<LoanData[]> {
    await this.authenticate();

    try {
      const params: any = {};
      if (since) {
        params.updated_since = since.toISOString();
      }

      // Try common endpoints
      const endpoints = ['/api/v1/loans', '/api/loans', '/loans', '/api/v1/applications'];
      
      for (const endpoint of endpoints) {
        try {
          const response = await this.axiosInstance.get(endpoint, { params });
          const loans = response.data.data || response.data.loans || response.data || [];
          
          if (Array.isArray(loans) && loans.length > 0) {
            return loans.map((loan: any) => ({
              loan_id: loan.id || loan.loan_id || loan.loan_number || loan.application_id,
              borrower_name: loan.borrower_name || loan.applicant_name || loan.name,
              loan_amount: loan.loan_amount || loan.amount || loan.requested_amount,
              loan_type: loan.loan_type || loan.product_type || loan.product,
              status: loan.status || loan.loan_status || loan.application_status,
              application_date: loan.application_date ? new Date(loan.application_date) : undefined,
              closing_date: loan.closing_date ? new Date(loan.closing_date) : undefined,
              interest_rate: loan.interest_rate || loan.rate,
              raw_data: loan,
            }));
          }
        } catch (e) {
          // Try next endpoint
          continue;
        }
      }

      return [];
    } catch (error: any) {
      console.error('Error fetching loans from generic API:', error.response?.data || error.message);
      throw new Error(`Failed to fetch loans: ${error.response?.data?.message || error.message}`);
    }
  }
}

/**
 * Factory function to create appropriate LOS client
 */
export function createLOSClient(connection: LOSConnection): BaseLOSClient {
  switch (connection.los_type) {
    case 'encompass':
      return new EncompassClient(connection);
    case 'meridianlink':
      return new MeridianLinkClient(connection);
    default:
      return new GenericAPIKeyClient(connection);
  }
}

export interface SyncLoansFromApiOptions {
  syncTrigger?: SyncTrigger;
  scheduledInsightsEnabled?: boolean;
}

/**
 * Sync loans from LOS API
 */
export async function syncLoansFromAPI(
  connectionId: string,
  options: SyncLoansFromApiOptions = {},
): Promise<SyncResult> {
  const startTime = Date.now();
  let recordsSynced = 0;
  let recordsFailed = 0;
  let error: string | undefined;

  try {
    // Get connection from database
    const connectionResult = await pool.query(
      'SELECT * FROM public.los_connections WHERE id = $1',
      [connectionId]
    );

    if (connectionResult.rows.length === 0) {
      throw new Error('Connection not found');
    }

    const connection = connectionResult.rows[0] as LOSConnection;

    if (connection.connection_method !== 'api') {
      throw new Error('Sync only available for API connections');
    }

    // Get last sync time
    const lastSync = (connection as any).last_synced_at ? new Date((connection as any).last_synced_at) : undefined;

    // Create client and fetch loans
    const client = createLOSClient(connection);
    const loans = await client.fetchLoans(lastSync);

    // Process and store loans in the database
    for (const loan of loans) {
      try {
        const raw = loan.raw_data && typeof loan.raw_data === "object" ? loan.raw_data : {};
        const merged: Record<string, any> = { ...raw, ...loan };
        await attachPersistedComplexityScores(pool, [merged]);
        const complexityScore = merged.complexity_score ?? null;

        // Upsert loan data into the loans table
        await pool.query(
          `INSERT INTO public.loans (
            tenant_id, loan_id, borrower_name, loan_amount, loan_type, 
            status, application_date, closing_date, interest_rate, 
            complexity_score, raw_data, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
          ON CONFLICT (tenant_id, loan_id) 
          DO UPDATE SET
            borrower_name = EXCLUDED.borrower_name,
            loan_amount = EXCLUDED.loan_amount,
            loan_type = EXCLUDED.loan_type,
            status = EXCLUDED.status,
            application_date = EXCLUDED.application_date,
            closing_date = EXCLUDED.closing_date,
            interest_rate = EXCLUDED.interest_rate,
            complexity_score = EXCLUDED.complexity_score,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()`,
          [
            (connection as any).tenant_id,
            loan.loan_id,
            loan.borrower_name,
            loan.loan_amount,
            loan.loan_type,
            loan.status,
            loan.application_date,
            loan.closing_date,
            loan.interest_rate,
            complexityScore,
            JSON.stringify(loan.raw_data || loan),
          ]
        );
        console.log(`Synced loan: ${loan.loan_id}`);
        recordsSynced++;
      } catch (e: any) {
        console.error(`Failed to store loan ${loan.loan_id}:`, e.message);
        recordsFailed++;
      }
    }

    // Update sync status
    await pool.query(
      `UPDATE public.los_connections 
       SET last_synced_at = NOW(), last_sync_status = 'success', last_sync_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [connectionId]
    );

    // Log sync
    await pool.query(
      `INSERT INTO public.los_sync_logs (los_connection_id, tenant_id, sync_type, status, records_synced, records_failed, started_at, completed_at)
       VALUES ($1, $2, 'api', 'success', $3, $4, $5, NOW())`,
      [connectionId, (connection as any).tenant_id, recordsSynced, recordsFailed, new Date(startTime)]
    );

    // Fire post-sync hooks asynchronously
    if (recordsSynced > 0) {
      runPostSyncHooks({
        tenantId: (connection as any).tenant_id,
        tenantPool: pool,
        connectionId,
        syncType: "api",
        recordsSynced,
        trigger: options.syncTrigger ?? "unknown",
        scheduledInsightsEnabled: options.scheduledInsightsEnabled,
      }).catch((err) =>
        console.error("[LOS API Sync] Post-sync hooks error:", err.message)
      );
    }

    return {
      success: true,
      records_synced: recordsSynced,
      records_failed: recordsFailed,
      duration: Date.now() - startTime,
    };
  } catch (e: any) {
    error = e.message;
    recordsFailed++;

    // Update sync status with error
    await pool.query(
      `UPDATE public.los_connections 
       SET last_synced_at = NOW(), last_sync_status = 'failed', last_sync_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [error, connectionId]
    );

    // Log failed sync
    const connectionResult = await pool.query(
      'SELECT tenant_id FROM public.los_connections WHERE id = $1',
      [connectionId]
    );
    const tenantId = connectionResult.rows[0]?.tenant_id;

    await pool.query(
      `INSERT INTO public.los_sync_logs (los_connection_id, tenant_id, sync_type, status, records_synced, records_failed, started_at, completed_at, error_message)
       VALUES ($1, $2, 'api', 'failed', $3, $4, $5, NOW(), $6)`,
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
 * Test LOS connection
 */
export async function testLOSConnection(connectionId: string): Promise<{ success: boolean; message: string }> {
  try {
    const connectionResult = await pool.query(
      'SELECT * FROM public.los_connections WHERE id = $1',
      [connectionId]
    );

    if (connectionResult.rows.length === 0) {
      return { success: false, message: 'Connection not found' };
    }

    const connection = connectionResult.rows[0] as LOSConnection;

    if (connection.connection_method !== 'api') {
      return { success: false, message: 'Test connection only available for API connections' };
    }

    const client = createLOSClient(connection);
    const isConnected = await client.testConnection();

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
