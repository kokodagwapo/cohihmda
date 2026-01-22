/**
 * Encompass Credentials Service
 * Manages Encompass API credentials with AWS Secrets Manager (production) and local fallback (development)
 */

import { getCredentialsFromSecretsManager, getCredentialsFromLocal, EncompassCredentials } from '../config/secrets.js';
import { decryptField } from './encryption.js';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';

export interface EncompassClientDetails {
  InstanceId: string;
  ApiClientId?: string;
  ClientSecret?: string;
  SAUsername?: string;
  SAPassword?: string;
  ExtractionMethod?: string;
  ApiServer?: string; // Encompass API server URL (e.g., https://api.elliemae.com or https://concept.api.elliemae.com)
}

// In-memory cache for credentials (with TTL)
interface CachedCredentials {
  credentials: EncompassCredentials;
  expiresAt: number;
}

const credentialsCache = new Map<string, CachedCredentials>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get Encompass credentials for a connection
 */
export async function getEncompassCredentials(
  tenantId: string,
  losConnectionId: string
): Promise<EncompassClientDetails> {
  const cacheKey = `${tenantId}:${losConnectionId}`;
  
  // Check cache first
  const cached = credentialsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    // Still need to get API server from DB (it's not in the cache)
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    const result = await tenantPool.query(
      `SELECT encompass_api_server FROM public.los_connections WHERE id = $1 AND is_active = true`,
      [losConnectionId]
    );
    const apiServer = result.rows[0]?.encompass_api_server || 'https://api.elliemae.com';
    return convertToClientDetails(cached.credentials, apiServer);
  }

  // Get tenant database pool
  const tenantPool = await tenantDbManager.getTenantPool(tenantId);

  // Get connection from tenant database (los_connections table)
  const result = await tenantPool.query(
    `SELECT 
      encompass_secret_arn,
      encompass_instance_id,
      encompass_api_server,
      encompass_sa_username_encrypted,
      encompass_sa_password_encrypted,
      encompass_extraction_method,
      api_client_id_encrypted,
      api_client_secret_encrypted
    FROM public.los_connections 
    WHERE id = $1 AND is_active = true`,
    [losConnectionId]
  );

  if (result.rows.length === 0) {
    throw new Error(`LOS connection ${losConnectionId} not found for tenant ${tenantId}`);
  }

  const connection = result.rows[0];
  
  // Get API server URL (default to production if not set)
  const apiServer = connection.encompass_api_server || 'https://api.elliemae.com';
  
  // Decrypt encrypted fields
  const saUsername = connection.encompass_sa_username_encrypted 
    ? await decryptField(connection.encompass_sa_username_encrypted) 
    : null;
  const saPassword = connection.encompass_sa_password_encrypted 
    ? await decryptField(connection.encompass_sa_password_encrypted) 
    : null;
  const apiClientId = connection.api_client_id_encrypted 
    ? await decryptField(connection.api_client_id_encrypted) 
    : null;
  const apiClientSecret = connection.api_client_secret_encrypted 
    ? await decryptField(connection.api_client_secret_encrypted) 
    : null;
  let credentials: EncompassCredentials;

  // Try AWS Secrets Manager first (production)
  if (connection.encompass_secret_arn) {
    try {
      credentials = await getCredentialsFromSecretsManager(connection.encompass_secret_arn);
    } catch (error: any) {
      console.warn(`[EncompassCredentials] Failed to fetch from Secrets Manager, trying local: ${error.message}`);
      // Fallback to local
      const localCreds = getCredentialsFromLocal(losConnectionId);
      if (!localCreds) {
        throw new Error(`Failed to get credentials: ${error.message}`);
      }
      credentials = localCreds;
    }
  } else {
    // Check if database has credentials first (for new connections saved via UI)
    if (apiClientId && apiClientSecret) {
      console.log('[EncompassCredentials] Using database credentials for connection:', losConnectionId);
      credentials = {
        instanceId: connection.encompass_instance_id || '',
        apiClientId: apiClientId,
        clientSecret: apiClientSecret,
        saUsername: saUsername || undefined,
        saPassword: saPassword || undefined,
        extractionMethod: (connection.encompass_extraction_method || 'partner') as 'partner' | 'ropc' | 'api',
      };
    } else {
      // Fallback to local credentials (development)
      const localCreds = getCredentialsFromLocal(losConnectionId);
      if (!localCreds) {
        throw new Error(`No credentials found for connection ${losConnectionId}. Configure AWS Secrets Manager ARN, database credentials, or local credentials.`);
      }
      console.log('[EncompassCredentials] Using local credentials for connection:', losConnectionId);
      credentials = localCreds;
    }
  }

  // Cache credentials
  credentialsCache.set(cacheKey, {
    credentials,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  const clientDetails = convertToClientDetails(credentials);
  // Add API server URL to client details
  clientDetails.ApiServer = apiServer;
  return clientDetails;
}

/**
 * Convert EncompassCredentials to EncompassClientDetails format
 */
function convertToClientDetails(creds: EncompassCredentials, apiServer?: string): EncompassClientDetails {
  return {
    InstanceId: creds.instanceId,
    ApiClientId: creds.apiClientId,
    ClientSecret: creds.clientSecret,
    SAUsername: creds.saUsername,
    SAPassword: creds.saPassword,
    ExtractionMethod: creds.extractionMethod,
    ApiServer: apiServer,
  };
}

/**
 * Clear credentials cache for a connection
 */
export function clearCredentialsCache(tenantId: string, losConnectionId: string): void {
  const cacheKey = `${tenantId}:${losConnectionId}`;
  credentialsCache.delete(cacheKey);
}

/**
 * Clear all credentials cache
 */
export function clearAllCredentialsCache(): void {
  credentialsCache.clear();
}
