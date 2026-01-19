/**
 * Mock LOS Helper
 * Utilities to easily configure LOS connections to use mock APIs
 */

import { getMockApiBaseUrl, getMockCredentials } from './mockLosApi.js';

/**
 * Check if mock LOS API should be used
 */
export function shouldUseMockApi(): boolean {
  return process.env.MOCK_LOS_API === 'true' || process.env.NODE_ENV !== 'production';
}

/**
 * Get the appropriate API base URL (mock or real)
 */
export function getApiBaseUrl(losType: string, configuredUrl?: string, serverPort: number = 3001): string {
  if (shouldUseMockApi() && (!configuredUrl || configuredUrl.includes('localhost') || configuredUrl.includes('mock'))) {
    return getMockApiBaseUrl(losType, serverPort);
  }
  return configuredUrl || '';
}

/**
 * Get credentials for a LOS connection (mock or configured)
 */
export function getCredentials(losType: string, connection: any): {
  api_client_id?: string;
  api_client_secret?: string;
  api_key?: string;
  oauth_token_url?: string;
} {
  if (shouldUseMockApi()) {
    const mockCreds = getMockCredentials(losType);
    // Merge with configured credentials if they exist
    return {
      ...mockCreds,
      api_client_id: connection.api_client_id || mockCreds.api_client_id,
      api_client_secret: connection.api_client_secret || mockCreds.api_client_secret,
      api_key: connection.api_key || mockCreds.api_key,
      oauth_token_url: connection.oauth_token_url || mockCreds.oauth_token_url,
    };
  }
  
  return {
    api_client_id: connection.api_client_id,
    api_client_secret: connection.api_client_secret,
    api_key: connection.api_key,
    oauth_token_url: connection.oauth_token_url,
  };
}

/**
 * Create a test connection configuration for a LOS type
 */
export function createTestConnection(losType: string, tenantId: string, name?: string): any {
  const mockCreds = getMockCredentials(losType);
  const baseUrl = getMockApiBaseUrl(losType);
  
  return {
    los_type: losType,
    name: name || `${losType} Mock Connection`,
    connection_method: 'api',
    api_base_url: baseUrl,
    api_environment: 'sandbox',
    ...mockCreds,
    sync_enabled: true,
    sync_frequency: 'hourly',
    webhook_enabled: false,
  };
}
