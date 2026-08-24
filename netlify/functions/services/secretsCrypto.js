/**
 * AES-256-GCM encrypt/decrypt for secrets stored at rest (webhook signing
 * secrets, etc). Same scheme and wire format as save-courier-credentials.js /
 * fezAuth.js: "gcm:<iv hex>:<authTag hex>:<ciphertext hex>". No hardcoded
 * fallback key — fails loudly if ENCRYPTION_KEY is missing (see the 2026-08
 * security hardening pass that removed exactly that fallback elsewhere).
 */
import crypto from 'crypto';

const encryptionKey = process.env.ENCRYPTION_KEY;

function deriveKey() {
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY is not configured — refusing to store/read secrets');
  }
  return Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32));
}

export function encryptSecret(text) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptSecret(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('gcm:')) return value;
  const key = deriveKey();
  const [, ivHex, authTagHex, encryptedHex] = value.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
