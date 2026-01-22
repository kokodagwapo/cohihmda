/**
 * AWS Secrets Manager Integration
 * Handles fetching Encompass credentials from AWS Secrets Manager for production
 * Falls back to local configuration for development
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface EncompassCredentials {
  instanceId: string;
  apiClientId: string;
  clientSecret: string;
  saUsername?: string;
  saPassword?: string;
  extractionMethod: 'partner' | 'ropc' | 'api';
}

let secretsClient: SecretsManagerClient | null = null;

function getSecretsClient(): SecretsManagerClient | null {
  if (!secretsClient && process.env.AWS_REGION) {
    try {
      secretsClient = new SecretsManagerClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });
      return secretsClient;
    } catch (error) {
      console.warn('[SecretsManager] Failed to initialize AWS Secrets Manager client:', error);
      return null;
    }
  }
  return secretsClient;
}

/**
 * Fetch credentials from AWS Secrets Manager
 */
export async function getCredentialsFromSecretsManager(secretArn: string): Promise<EncompassCredentials> {
  const client = getSecretsClient();
  if (!client) {
    throw new Error('AWS Secrets Manager client not available. Set AWS_REGION environment variable.');
  }

  try {
    const command = new GetSecretValueCommand({ SecretId: secretArn });
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new Error(`Secret ${secretArn} has no SecretString value`);
    }

    const secret = JSON.parse(response.SecretString);
    
    return {
      instanceId: secret.instanceId || secret.instance_id,
      apiClientId: secret.apiClientId || secret.api_client_id || secret.clientId,
      clientSecret: secret.clientSecret || secret.client_secret || secret.secret,
      saUsername: secret.saUsername || secret.sa_username,
      saPassword: secret.saPassword || secret.sa_password,
      extractionMethod: (secret.extractionMethod || secret.extraction_method || 'partner') as 'partner' | 'ropc' | 'api',
    };
  } catch (error: any) {
    console.error(`[SecretsManager] Error fetching secret ${secretArn}:`, error.message);
    throw new Error(`Failed to fetch credentials from Secrets Manager: ${error.message}`);
  }
}

/**
 * Get credentials from local config file (for development)
 */
export function getCredentialsFromLocal(connectionId: string): EncompassCredentials | null {
  try {
    // Try config file first
    const configPath = join(__dirname, '../../../config/encompass-credentials.local.json');
    try {
      const configContent = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      
      const connection = config.connections?.find((c: any) => c.id === connectionId);
      if (connection) {
        return {
          instanceId: connection.instanceId,
          apiClientId: connection.apiClientId,
          clientSecret: connection.clientSecret,
          saUsername: connection.saUsername,
          saPassword: connection.saPassword,
          extractionMethod: connection.extractionMethod || 'partner',
        };
      }
    } catch (fileError: any) {
      if (fileError.code !== 'ENOENT') {
        console.warn('[SecretsManager] Error reading local config file:', fileError.message);
      }
    }

    // Fallback to environment variables (for single connection setup)
    const instanceId = process.env.ENCOMPASS_INSTANCE_ID || process.env.ENCOMPASS_CLIENT_1_INSTANCE_ID;
    const apiClientId = process.env.ENCOMPASS_API_CLIENT_ID || process.env.ENCOMPASS_CLIENT_1_API_CLIENT_ID;
    const clientSecret = process.env.ENCOMPASS_CLIENT_SECRET || process.env.ENCOMPASS_CLIENT_1_CLIENT_SECRET;
    const saUsername = process.env.ENCOMPASS_SA_USERNAME || process.env.ENCOMPASS_CLIENT_1_SA_USERNAME;
    const saPassword = process.env.ENCOMPASS_SA_PASSWORD || process.env.ENCOMPASS_CLIENT_1_SA_PASSWORD;
    const extractionMethod = (process.env.ENCOMPASS_EXTRACTION_METHOD || process.env.ENCOMPASS_CLIENT_1_EXTRACTION_METHOD || 'partner') as 'partner' | 'ropc' | 'api';

    if (instanceId && apiClientId && clientSecret) {
      return {
        instanceId,
        apiClientId,
        clientSecret,
        saUsername,
        saPassword,
        extractionMethod,
      };
    }

    return null;
  } catch (error: any) {
    console.error('[SecretsManager] Error getting local credentials:', error.message);
    return null;
  }
}
