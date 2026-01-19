/**
 * AWS Secrets Manager Helper
 * Fetches secrets from AWS Secrets Manager with KMS encryption
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({ 
  region: process.env.AWS_REGION || 'us-east-1' 
});

/**
 * Get a secret value from AWS Secrets Manager
 * @param secretName - The name of the secret (e.g., 'coheus/gemini-api-key')
 * @returns The secret value as a string
 */
export async function getSecret(secretName: string): Promise<string> {
  try {
    const command = new GetSecretValueCommand({
      SecretId: secretName,
    });
    
    const response = await secretsClient.send(command);
    
    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} not found or empty`);
    }
    
    return response.SecretString;
  } catch (error: any) {
    console.error(`Error fetching secret ${secretName}:`, error.message);
    throw new Error(`Failed to get secret ${secretName}: ${error.message}`);
  }
}

/**
 * Get multiple secrets at once
 * @param secretNames - Array of secret names
 * @returns Object with secret names as keys and values as values
 */
export async function getSecrets(secretNames: string[]): Promise<Record<string, string>> {
  const secrets: Record<string, string> = {};
  
  await Promise.all(
    secretNames.map(async (name) => {
      secrets[name] = await getSecret(name);
    })
  );
  
  return secrets;
}
