/**
 * Shared Fez credential resolution + authentication.
 * DB courier rows (Settings → Couriers) take precedence over Netlify env vars.
 * Passwords saved via save-courier-credentials are encrypted — we decrypt here.
 */
import crypto from 'crypto';

const encryptionKey = process.env.ENCRYPTION_KEY || 'your-32-character-encryption-key-here-change-this!';

export function isProductionDeploy() {
  if (process.env.CONTEXT === 'production' || process.env.NETLIFY_CONTEXT === 'production') return true;
  const siteUrl = String(process.env.URL || process.env.DEPLOY_URL || '').toLowerCase();
  return siteUrl.includes('jlo.julinemart.com') || siteUrl.includes('julinemart-logistics');
}

export function fezTargetEnvironment() {
  return isProductionDeploy() ? 'production' : 'sandbox';
}

function decryptCourierSecret(value) {
  if (!value || typeof value !== 'string') return value;
  // Encrypted format: "<32-char iv hex>:<ciphertext hex>"
  if (!/^[0-9a-f]{32}:[0-9a-f]+$/i.test(value)) return value;

  try {
    const [ivHex, encryptedHex] = value.split(':');
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32));
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.warn('Fez password decrypt failed, using stored value as-is:', err?.message);
    return value;
  }
}

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function isSandboxUrl(url) {
  return normalizeBaseUrl(url).toLowerCase().includes('sandbox');
}

function packCredentials(row, source) {
  return {
    baseUrl: normalizeBaseUrl(row.api_base_url),
    userId: row.api_user_id,
    password: decryptCourierSecret(row.api_password),
    source,
    environment: row.environment || null,
  };
}

/** Resolve Fez API credentials for the current deploy environment. */
export async function resolveFezCredentials(supabase) {
  const targetEnv = fezTargetEnvironment();
  const envValues = targetEnv === 'production' ? ['production', 'live'] : ['sandbox', 'test', 'staging'];

  for (const env of envValues) {
    const { data } = await supabase
      .from('couriers')
      .select('api_user_id, api_password, api_base_url, environment')
      .eq('code', 'fez')
      .eq('api_enabled', true)
      .eq('environment', env)
      .maybeSingle();

    if (data?.api_user_id && data?.api_password && data?.api_base_url) {
      return packCredentials(data, 'database');
    }
  }

  // Enabled Fez rows without matching environment label — pick by URL.
  const { data: rows } = await supabase
    .from('couriers')
    .select('api_user_id, api_password, api_base_url, environment')
    .eq('code', 'fez')
    .eq('api_enabled', true);

  if (rows?.length) {
    const wantSandbox = targetEnv !== 'production';
    const match =
      rows.find((row) => isSandboxUrl(row.api_base_url) === wantSandbox) ||
      rows.find((row) => !isSandboxUrl(row.api_base_url)) ||
      rows[0];

    if (match?.api_user_id && match?.api_password && match?.api_base_url) {
      return packCredentials(match, 'database');
    }
  }

  const baseUrl = normalizeBaseUrl(process.env.FEZ_API_BASE_URL);
  const userId = process.env.FEZ_USER_ID;
  const password = process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY;

  if (baseUrl && userId && password) {
    return { baseUrl, userId, password, source: 'env', environment: targetEnv };
  }

  throw new Error(
    `Missing Fez API credentials for ${targetEnv}. Configure Settings → Couriers (production URL + credentials) or Netlify FEZ_* env vars.`,
  );
}

/** Authenticate with Fez and return token + secret-key + base URL. */
export async function authenticateFez(supabase) {
  const creds = await resolveFezCredentials(supabase);
  console.log(`Fez auth via ${creds.source} (${creds.environment || fezTargetEnvironment()}) → ${creds.baseUrl}`);

  const res = await fetch(`${creds.baseUrl}/user/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: creds.userId, password: creds.password }),
  });

  const data = await res.json();
  if (data.status !== 'Success') {
    throw new Error(data.description || 'Fez authentication failed');
  }

  return {
    authToken: data.authDetails.authToken,
    secretKey: data.orgDetails['secret-key'],
    baseUrl: creds.baseUrl,
  };
}
