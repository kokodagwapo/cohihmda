/**
 * Data Encryption Service
 * SOC 2 Compliance: Field-level encryption using AWS KMS
 * 
 * This service provides encryption/decryption for sensitive data:
 * - API keys (OpenAI, Gemini, etc.)
 * - PII fields (SSN, DOB, account numbers)
 * - Credentials and secrets
 */

import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

// Initialize KMS client
const kmsClient = new KMSClient({ 
  region: process.env.AWS_REGION || 'us-east-1' 
});

// KMS Key ID from environment (will be set in EB environment)
const KMS_KEY_ID = process.env.KMS_KEY_ID;

// Flag to enable/disable encryption (for development)
const ENCRYPTION_ENABLED = process.env.ENABLE_ENCRYPTION === 'true' || process.env.NODE_ENV === 'production';

/**
 * Encrypt a single field value
 */
export async function encryptField(plaintext: string | null | undefined): Promise<string | null> {
  // Return null/undefined as-is
  if (!plaintext) return null;

  // If encryption is disabled (dev mode), return plaintext
  if (!ENCRYPTION_ENABLED) {
    console.warn('⚠️  Encryption disabled - storing plaintext (development mode only)');
    return plaintext;
  }

  // Check if KMS key is configured
  if (!KMS_KEY_ID) {
    console.error('❌ KMS_KEY_ID not configured - cannot encrypt data');
    throw new Error('Encryption not configured. Please set KMS_KEY_ID environment variable.');
  }

  try {
    const command = new EncryptCommand({
      KeyId: KMS_KEY_ID,
      Plaintext: Buffer.from(plaintext, 'utf-8'),
    });

    const response = await kmsClient.send(command);
    
    // Return base64-encoded ciphertext
    if (!response.CiphertextBlob) {
      throw new Error('Encryption failed - no ciphertext returned');
    }

    return Buffer.from(response.CiphertextBlob).toString('base64');
  } catch (error: any) {
    console.error('Encryption error:', error.message);
    throw new Error(`Failed to encrypt data: ${error.message}`);
  }
}

/**
 * Decrypt a single field value
 */
export async function decryptField(ciphertext: string | null | undefined): Promise<string | null> {
  // Return null/undefined as-is
  if (!ciphertext) return null;

  // If encryption is disabled (dev mode), return ciphertext as-is
  if (!ENCRYPTION_ENABLED) {
    return ciphertext;
  }

  // Check if KMS key is configured
  if (!KMS_KEY_ID) {
    console.error('❌ KMS_KEY_ID not configured - cannot decrypt data');
    throw new Error('Encryption not configured. Please set KMS_KEY_ID environment variable.');
  }

  try {
    const command = new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    });

    const response = await kmsClient.send(command);
    
    if (!response.Plaintext) {
      throw new Error('Decryption failed - no plaintext returned');
    }

    return Buffer.from(response.Plaintext).toString('utf-8');
  } catch (error: any) {
    console.error('Decryption error:', error.message);
    throw new Error(`Failed to decrypt data: ${error.message}`);
  }
}

/**
 * Encrypt PII fields in an object
 * Commonly encrypted fields: ssn, dob, account_number, routing_number
 */
export async function encryptPII(data: Record<string, any>): Promise<Record<string, any>> {
  const encrypted = { ...data };

  // List of PII fields to encrypt
  const piiFields = ['ssn', 'dob', 'account_number', 'routing_number', 'tax_id', 'drivers_license'];

  for (const field of piiFields) {
    if (data[field]) {
      try {
        encrypted[field] = await encryptField(data[field]);
      } catch (error) {
        console.error(`Failed to encrypt field ${field}:`, error);
        throw error;
      }
    }
  }

  return encrypted;
}

/**
 * Decrypt PII fields in an object
 */
export async function decryptPII(data: Record<string, any>): Promise<Record<string, any>> {
  const decrypted = { ...data };

  // List of PII fields to decrypt
  const piiFields = ['ssn', 'dob', 'account_number', 'routing_number', 'tax_id', 'drivers_license'];

  for (const field of piiFields) {
    if (data[field]) {
      try {
        decrypted[field] = await decryptField(data[field]);
      } catch (error) {
        console.error(`Failed to decrypt field ${field}:`, error);
        // Don't throw - return encrypted value if decryption fails
        // This allows the system to continue functioning
      }
    }
  }

  return decrypted;
}

/**
 * Encrypt API keys in RAG settings
 */
export async function encryptAPIKeys(settings: Record<string, any>): Promise<Record<string, any>> {
  const encrypted = { ...settings };

  // API key fields to encrypt
  const apiKeyFields = ['openai_api_key', 'gemini_api_key', 'anthropic_api_key'];

  for (const field of apiKeyFields) {
    if (settings[field]) {
      try {
        encrypted[field] = await encryptField(settings[field]);
      } catch (error) {
        console.error(`Failed to encrypt ${field}:`, error);
        throw error;
      }
    }
  }

  return encrypted;
}

/**
 * Decrypt API keys in RAG settings
 */
export async function decryptAPIKeys(settings: Record<string, any>): Promise<Record<string, any>> {
  const decrypted = { ...settings };

  // API key fields to decrypt
  const apiKeyFields = ['openai_api_key', 'gemini_api_key', 'anthropic_api_key'];

  for (const field of apiKeyFields) {
    if (settings[field]) {
      try {
        decrypted[field] = await decryptField(settings[field]);
      } catch (error) {
        console.error(`Failed to decrypt ${field}:`, error);
        // Return null if decryption fails
        decrypted[field] = null;
      }
    }
  }

  return decrypted;
}

/**
 * Check if encryption is properly configured
 */
export function isEncryptionConfigured(): boolean {
  return ENCRYPTION_ENABLED && !!KMS_KEY_ID;
}

/**
 * Get encryption status for monitoring
 */
export function getEncryptionStatus(): {
  enabled: boolean;
  configured: boolean;
  keyId: string | undefined;
  region: string;
} {
  return {
    enabled: ENCRYPTION_ENABLED,
    configured: isEncryptionConfigured(),
    keyId: KMS_KEY_ID ? `${KMS_KEY_ID.substring(0, 20)}...` : undefined,
    region: process.env.AWS_REGION || 'us-east-1',
  };
}

/**
 * Utility: Check if a value appears to be encrypted
 * (base64-encoded, longer than typical plaintext)
 */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  
  // Check if it's base64 and reasonably long
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(value) && value.length > 100;
}

/**
 * Migrate plaintext data to encrypted (for existing data)
 * This is a helper function for data migration scripts
 */
export async function migrateToEncrypted(
  tableName: string,
  fieldName: string,
  idField: string = 'id'
): Promise<{ migrated: number; errors: number }> {
  // This would be implemented in a migration script
  // Placeholder for documentation
  throw new Error('Migration function should be implemented in a separate migration script');
}
