/**
 * GET /api/admin/settings-health
 * Live server-side integration health — env presence only, never secret values.
 */
import { createClient } from '@supabase/supabase-js';
import { headers, jsonResponse, requireAdmin } from './services/global-sourcing-utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const envSet = (key) => Boolean(String(process.env[key] || '').trim());

function integrationCheck(id, label, ok, detail = null) {
  return { id, label, ok, detail };
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

/** Branch/preview PWA URLs (dev-lab--*, deploy previews, localhost). */
function isPreviewPwaUrl(url) {
  const raw = normalizeUrl(url).toLowerCase();
  if (!raw) return false;
  if (raw.includes('localhost') || raw.includes('127.0.0.1')) return true;
  if (raw.includes('dev-lab')) return true;
  try {
    const host = new URL(raw).hostname;
    if (host.endsWith('.netlify.app') && host.includes('--')) return true;
  } catch {
    return false;
  }
  return false;
}

function isProductionDeploy() {
  if (process.env.CONTEXT === 'production') return true;
  const siteUrl = normalizeUrl(process.env.URL || process.env.DEPLOY_URL || '').toLowerCase();
  return siteUrl.includes('jlo.julinemart.com') || siteUrl.includes('julinemart-logistics');
}

async function loadEmailHealth(adminClient) {
  const out = {
    provider: null,
    enabled: false,
    secrets_configured: false,
    encryption_active: envSet('EMAIL_SECRETS_ENCRYPTION_KEY'),
  };

  if (!adminClient) return out;

  try {
    const { data } = await adminClient.from('email_config').select('provider, email_enabled').limit(1).maybeSingle();
    if (data) {
      out.provider = data.provider || null;
      out.enabled = data.email_enabled === true;
    }
  } catch {
    /* table may be empty */
  }

  out.secrets_configured =
    envSet('EMAIL_PASSWORD') ||
    envSet('GMAIL_PASSWORD') ||
    envSet('SENDGRID_API_KEY') ||
    envSet('SMTP_PASSWORD') ||
    out.provider != null;

  return out;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  const adminClient =
    SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : auth.adminClient;

  const email = await loadEmailHealth(adminClient);

  const pwaUrl = normalizeUrl(process.env.PWA_BASE_URL);
  const pwaPreviewOnProd = isProductionDeploy() && isPreviewPwaUrl(pwaUrl);

  const pwaDetail = (() => {
    if (!envSet('PWA_BASE_URL')) return 'Set PWA_BASE_URL in Netlify env';
    if (pwaPreviewOnProd) {
      return `Production JLO is pointing at a preview/dev PWA — set PWA_BASE_URL=https://julinemart.com (current: ${pwaUrl})`;
    }
    return `PWA: ${pwaUrl}`;
  })();

  const checks = [
    integrationCheck('supabase', 'Supabase', envSet('SUPABASE_URL') && envSet('SUPABASE_SERVICE_ROLE_KEY')),
    integrationCheck(
      'paystack',
      'Paystack',
      envSet('PAYSTACK_SECRET_KEY'),
      envSet('PAYSTACK_PUBLIC_KEY') ? 'Public key set' : 'Missing PAYSTACK_PUBLIC_KEY',
    ),
    integrationCheck(
      'fez',
      'Fez courier',
      envSet('FEZ_API_KEY') && envSet('FEZ_USER_ID'),
      envSet('FEZ_API_BASE_URL') ? null : 'Using default Fez base URL',
    ),
    integrationCheck(
      'pwa_push',
      'Push notifications (PWA proxy)',
      envSet('PWA_BASE_URL') && envSet('NOTIFICATIONS_ADMIN_SECRET') && !pwaPreviewOnProd,
      pwaDetail,
    ),
    integrationCheck(
      'email',
      'Email delivery',
      email.enabled && (email.secrets_configured || email.encryption_active),
      email.provider ? `Provider: ${email.provider}` : 'Configure under Settings → Email',
    ),
    integrationCheck(
      'order_webhook',
      'Order confirmation webhook',
      envSet('ORDER_EMAIL_WEBHOOK_SECRET'),
      'For Supabase orders INSERT hook',
    ),
    integrationCheck(
      'webhook_secret',
      'Shared webhook secret',
      envSet('WEBHOOK_SECRET'),
      'Used where signature validation applies',
    ),
    integrationCheck(
      'cj',
      'CJ global sourcing',
      envSet('CJ_API_KEY') && envSet('CJ_API_BASE_URL'),
    ),
    integrationCheck(
      'fx',
      'FX rate provider',
      envSet('EXCHANGERATE_API_KEY'),
    ),
    integrationCheck(
      'cors',
      'Production CORS',
      envSet('ALLOWED_ORIGINS'),
      'Comma-separated ALLOWED_ORIGINS',
    ),
  ];

  const okCount = checks.filter((c) => c.ok).length;

  return jsonResponse(200, {
    success: true,
    data: {
      deployment: {
        node_env: process.env.NODE_ENV || 'unknown',
        site_url: process.env.URL || process.env.DEPLOY_URL || null,
      },
      summary: {
        total: checks.length,
        ok: okCount,
        needs_attention: checks.length - okCount,
      },
      checks,
      email,
    },
  });
}
