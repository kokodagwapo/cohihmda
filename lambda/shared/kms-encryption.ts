/**
 * AWS KMS Encryption Helper
 * Provides encryption/decryption for sensitive data using AWS KMS
 */

import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

const kmsClient = new KMSClient({ 
  region: process.env.AWS_REGION || 'us-east-1' 
});

const KMS_KEY_ID = process.env.KMS_KEY_ID || 'alias/coheus-encryption';

/**
 * Encrypt a field value using KMS
 * @param plaintext - The plaintext string to encrypt
 * @returns Base64-encoded ciphertext
 */
export async function encryptField(plaintext: string): Promise<string> {
  try {
    const command = new EncryptCommand({
      KeyId: KMS_KEY_ID,
      Plaintext: Buffer.from(plaintext, 'utf-8'),
    });
    
    const response = await kmsClient.send(command);
    
    if (!response.CiphertextBlob) {
      throw new Error('Encryption failed - no ciphertext returned');
    }
    
    return Buffer.from(response.CiphertextBlob).toString('base64');
  } catch (error: any) {
    console.error('KMS encryption error:', error.message);
    throw new Error(`Failed to encrypt data: ${error.message}`);
  }
}

/**
 * Decrypt a field value using KMS
 * @param ciphertext - Base64-encoded ciphertext
 * @returns Decrypted plaintext string
 */
export async function decryptField(ciphertext: string): Promise<string> {
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
    console.error('KMS decryption error:', error.message);
    throw new Error(`Failed to decrypt data: ${error.message}`);
  }
}
