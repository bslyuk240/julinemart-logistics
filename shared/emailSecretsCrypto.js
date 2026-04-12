/**
 * Reversible encryption for email_config secret fields (gmail_password, sendgrid_api_key, smtp_password).
 * Hashing (bcrypt) cannot be used — SMTP requires the plaintext password at send time.
 *
 * Set EMAIL_SECRETS_ENCRYPTION_KEY to a 32-byte key: base64 (preferred) or 64 hex chars.
 * When unset, values are stored as-is (legacy / local dev).
 */
import crypto from 'crypto';

export const ENC_PREFIX = 'enc:v1:';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export function getEncryptionKeyBuffer() {
  const raw = (process.env.EMAIL_SECRETS_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) return b;
  } catch {
    /* ignore */
  }
  console.warn(
    '[emailSecrets] EMAIL_SECRETS_ENCRYPTION_KEY must be 32 bytes as base64 or 64 hex characters'
  );
  return null;
}

/** @param {string | null | undefined} plaintext */
export function encryptSecretForStorage(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const key = getEncryptionKeyBuffer();
  if (!key) return plaintext;
  if (typeof plaintext === 'string' && plaintext.startsWith(ENC_PREFIX)) return plaintext;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, enc]);
  return ENC_PREFIX + combined.toString('base64');
}

/** @param {string | null | undefined} stored */
export function decryptSecretFromStorage(stored) {
  if (stored == null || stored === '') return stored;
  if (typeof stored !== 'string' || !stored.startsWith(ENC_PREFIX)) return stored;
  const key = getEncryptionKeyBuffer();
  if (!key) {
    console.error('[emailSecrets] Encrypted value in DB but EMAIL_SECRETS_ENCRYPTION_KEY is missing');
    return '';
  }
  try {
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[emailSecrets] Decryption failed:', e?.message || e);
    return '';
  }
}

/** @param {Record<string, unknown> | null} config */
export function decryptEmailConfigSecrets(config) {
  if (!config) return config;
  return {
    ...config,
    gmail_password: decryptSecretFromStorage(config.gmail_password),
    sendgrid_api_key: decryptSecretFromStorage(config.sendgrid_api_key),
    smtp_password: decryptSecretFromStorage(config.smtp_password),
  };
}

/** @param {Record<string, unknown>} config */
export function encryptEmailConfigSecretsForStorage(config) {
  if (!config) return config;
  if (!getEncryptionKeyBuffer()) return { ...config };
  return {
    ...config,
    gmail_password: encryptSecretForStorage(config.gmail_password),
    sendgrid_api_key: encryptSecretForStorage(config.sendgrid_api_key),
    smtp_password: encryptSecretForStorage(config.smtp_password),
  };
}

/**
 * API GET: never send decrypted secrets to the browser.
 * @param {Record<string, unknown>} config — row as stored in DB (may be encrypted)
 */
export function sanitizeEmailConfigForClient(config) {
  if (!config) return config;
  const has = (k) => {
    const v = config[k];
    return typeof v === 'string' && v.length > 0;
  };
  return {
    ...config,
    gmail_password: '',
    sendgrid_api_key: '',
    smtp_password: '',
    secrets_configured: {
      gmail_password: has('gmail_password'),
      sendgrid_api_key: has('sendgrid_api_key'),
      smtp_password: has('smtp_password'),
    },
    /** True when EMAIL_SECRETS_ENCRYPTION_KEY is valid in this process (check Network response if DB stays plaintext). */
    email_secrets_encryption_active: getEncryptionKeyBuffer() !== null,
  };
}
