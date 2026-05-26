/**
 * Central audit logging for JLO admin, vendor portal, and system events.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  '';

const BLOCKED_ACTION_PREFIXES = ['whatsapp'];

let adminClient = null;

function getAdmin() {
  if (!adminClient && supabaseUrl && serviceKey) {
    adminClient = createClient(supabaseUrl, serviceKey);
  }
  return adminClient;
}

/**
 * @param {object} opts
 * @param {string} opts.action - e.g. USER_CREATED, VENDOR_APPROVED
 * @param {string} [opts.resource_type]
 * @param {string} [opts.resource_id]
 * @param {object} [opts.details]
 * @param {'jlo'|'vendor_portal'|'storefront'|'system'} [opts.source]
 * @param {string} [opts.user_id]
 * @param {string} [opts.actor_email]
 * @param {string} [opts.ip_address]
 * @param {string} [opts.user_agent]
 */
export async function recordAudit(opts) {
  const action = String(opts.action || '').trim().toUpperCase();
  if (!action) return;

  if (BLOCKED_ACTION_PREFIXES.some((p) => action.startsWith(p.toUpperCase()))) return;
  if (opts.resource_type && String(opts.resource_type).toLowerCase().startsWith('whatsapp')) return;

  const client = getAdmin();
  if (!client) {
    console.warn('[auditLog] missing Supabase config');
    return;
  }

  const { error } = await client.from('activity_logs').insert({
    user_id: opts.user_id || null,
    actor_email: opts.actor_email || null,
    action,
    resource_type: opts.resource_type || null,
    resource_id: opts.resource_id || null,
    details: opts.details || null,
    source: opts.source || 'jlo',
    ip_address: opts.ip_address || null,
    user_agent: opts.user_agent || null,
  });

  if (error) console.error('[auditLog] insert failed:', error.message);
}

export function requestMeta(event) {
  const ip =
    event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    event?.headers?.['client-ip'] ||
    null;
  const userAgent = event?.headers?.['user-agent'] || null;
  return { ip_address: ip, user_agent: userAgent };
}

/**
 * Log from a Netlify function after staff auth.
 */
export async function recordStaffAudit(event, authUser, params) {
  const meta = requestMeta(event);
  await recordAudit({
    ...params,
    ...meta,
    user_id: authUser?.id,
    actor_email: authUser?.email,
    source: params.source || 'jlo',
  });
}
