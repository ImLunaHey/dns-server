import * as crypto from 'crypto';
import { logger } from './logger.js';

// Encryption algorithm and key derivation
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM

/**
 * Get or derive encryption key from environment variable
 * Falls back to a warning in development, errors in production
 */
function getEncryptionKey(): Buffer {
  const keyEnv = process.env.SECRET_ENCRYPTION_KEY;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!keyEnv) {
    const errorMessage =
      'SECRET_ENCRYPTION_KEY environment variable is required for secret encryption. ' +
      'Generate one with: openssl rand -base64 32';

    if (isProduction) {
      logger.error(errorMessage);
      throw new Error(errorMessage);
    } else {
      logger.warn(
        `Security warning: ${errorMessage}. ` +
          'Secrets will be stored in plaintext. This is allowed in development but MUST be fixed before production deployment.',
      );
      // In development, use a default key (not secure, but allows testing)
      // This should never be used in production
      return crypto.scryptSync('development-key-not-secure', 'salt', KEY_LENGTH);
    }
  }

  // Validate key length
  if (keyEnv.length < 32) {
    const errorMessage = 'SECRET_ENCRYPTION_KEY must be at least 32 characters long.';
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  // Derive key from environment variable using scrypt
  return crypto.scryptSync(keyEnv, 'dns-server-secret-encryption', KEY_LENGTH);
}

/**
 * Encrypt a secret value
 */
export function encryptSecret(plaintext: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted (all base64 encoded)
    const ivBase64 = iv.toString('base64');
    const authTagBase64 = authTag.toString('base64');
    const encryptedBase64 = encrypted.toString('base64');

    return `${ivBase64}:${authTagBase64}:${encryptedBase64}`;
  } catch (error) {
    logger.error('Error encrypting secret', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

/**
 * Decrypt a secret value
 * All secrets should be encrypted by the migration code that runs on startup
 */
export function decryptSecret(encrypted: string): string {
  try {
    // Check if value is plaintext (should not happen after migration)
    if (!encrypted.includes(':')) {
      logger.error('Encountered plaintext secret. Migration should have encrypted all secrets on startup.');
      throw new Error('Plaintext secret found. All secrets should be encrypted.');
    }

    const key = getEncryptionKey();
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted secret format');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encryptedData = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch (error) {
    logger.error('Error decrypting secret', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}
