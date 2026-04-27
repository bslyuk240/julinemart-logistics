/**
 * Reversible encryption for email_config secret fields (gmail_password, sendgrid_api_key, smtp_password).
 * Hashing (bcrypt) cannot be used — SMTP requires the plaintext password at send time.
 *
 * Set EMAIL_SECRETS_ENCRYPTION_KEY to a 32-byte key: base64 (preferred) or 64 hex chars.
 * When unset, values are stored as-is (legacy / local dev).
 */
import crypto from 'crypto';

export const ENC_PREFIX = 'enc:v1:';

/** Columns on public.email_config — strip API-only fields before insert/update (PostgREST 500 on unknown keys). */
export const EMAIL_CONFIG_DB_FIELDS = [
  'provider',
  'gmail_user',
  'gmail_password',
  'sendgrid_api_key',
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_password',
  'email_from',
  'email_enabled',
  'portal_url',
  'order_alert_emails',
];

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Normalize env value: trim, strip wrapping quotes, remove accidental newlines/spaces in pasted keys.
 * @param {string} raw
 */
export function normalizeEncryptionKeyInput(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[\r\n]/g, '');
  return s.trim();
}

export function getEncryptionKeyBuffer() {
  const env =
    typeof process !== 'undefined' && process.env
      ? process.env.EMAIL_SECRETS_ENCRYPTION_KEY ||
        process.env['EMAIL_SECRETS_ENCRYPTION_KEY']
      : '';
  const raw = normalizeEncryptionKeyInput(env || '');
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const compact = raw.replace(/\s/g, '');
    const b = Buffer.from(compact, 'base64');
    if (b.length === 32) return b;
  } catch {
    /* ignore */
  }
  console.warn(
    '[emailSecrets] EMAIL_SECRETS_ENCRYPTION_KEY must be 32 bytes as base64 or 64 hex characters'
  );
  return null;
}

/** True if the env var is non-empty (may still be wrong length). */
export function isEncryptionKeyEnvPresent() {
  const env =
    typeof process !== 'undefined' && process.env
      ? process.env.EMAIL_SECRETS_ENCRYPTION_KEY ||
        process.env['EMAIL_SECRETS_ENCRYPTION_KEY']
      : '';
  return normalizeEncryptionKeyInput(env || '').length > 0;
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

/**
 * If DB holds enc:v1:… but decryption yields empty (wrong key, missing key at runtime, or corrupt blob),
 * SMTP would get no password → 535 "invalid credentials". Call this after decryptEmailConfigSecrets.
 *
 * @param {Record<string, unknown>} mergedBeforeDecrypt — row/merge with DB ciphertext still in smtp_password
 * @param {Record<string, unknown>} decrypted — output of decryptEmailConfigSecrets(merged)
 * @returns {string | null} user-facing error, or null if OK
 */
export function getSmtpDecryptFailureMessage(mergedBeforeDecrypt, decrypted) {
  const stored = mergedBeforeDecrypt?.smtp_password;
  const looksEncrypted =
    typeof stored === 'string' && stored.startsWith(ENC_PREFIX);
  if (!looksEncrypted) return null;
  const after = decrypted?.smtp_password;
  const ok = after != null && String(after).trim().length > 0;
  if (ok) return null;
  return (
    'Saved SMTP password could not be decrypted. Usually the Netlify EMAIL_SECRETS_ENCRYPTION_KEY does not match the key used when this password was saved, or the stored value is corrupted. ' +
    'Re-enter the SMTP password in this page, click Save Configuration, then Test connection again.'
  );
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
 * Keep only real DB columns (drops secrets_configured, email_secrets_encryption_active, id, etc.).
 * @param {Record<string, unknown>} row
 */
export function pickEmailConfigForDatabase(row) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  for (const k of EMAIL_CONFIG_DB_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, k) && row[k] !== undefined) {
      out[k] = row[k];
    }
  }
  if (out.smtp_port != null && typeof out.smtp_port === 'string') {
    const n = parseInt(String(out.smtp_port), 10);
    out.smtp_port = Number.isFinite(n) ? n : 587;
  }
  return out;
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
    /** True when the env var is set (even if length/format invalid — redeploy after fixing Netlify env). */
    email_secrets_key_env_present: isEncryptionKeyEnvPresent(),
  };
}
