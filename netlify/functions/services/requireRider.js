/**
 * Auth guard for rider-facing endpoints — mirrors requireAdmin() in
 * global-sourcing-utils.js, but resolves against the `riders` table instead
 * of `users`. A valid Supabase session only proves someone holds that
 * login; this is what proves they're an approved, active rider.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';
const VERIFY_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_KEY ||
  SERVICE_ROLE_KEY ||
  '';

const authClient = SUPABASE_URL && VERIFY_KEY ? createClient(SUPABASE_URL, VERIFY_KEY) : null;
const adminClient =
  SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

export const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

export function jsonResponse(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

export async function requireRider(event) {
  if (!authClient || !adminClient) {
    return {
      errorResponse: jsonResponse(500, {
        success: false,
        error: 'Server not configured',
        message: 'Supabase credentials are missing',
      }),
    };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      errorResponse: jsonResponse(401, { success: false, error: 'unauthorized', message: 'Missing bearer token' }),
    };
  }

  const token = authHeader.slice('Bearer '.length);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      errorResponse: jsonResponse(401, { success: false, error: 'unauthorized', message: 'Invalid or expired token' }),
    };
  }

  const { data: rider, error: riderError } = await adminClient
    .from('riders')
    .select('id, user_id, email, full_name, phone, status, approved_location_id')
    .eq('user_id', authData.user.id)
    .maybeSingle();

  if (riderError) {
    return { errorResponse: jsonResponse(500, { success: false, error: riderError.message }) };
  }
  if (!rider) {
    return {
      errorResponse: jsonResponse(403, {
        success: false,
        error: 'forbidden',
        message: 'No rider account linked to this login',
      }),
    };
  }

  return { authUser: authData.user, rider, adminClient };
}

/** Same as requireRider, but also enforces status = 'active' — for anything job-related. */
export async function requireActiveRider(event) {
  const result = await requireRider(event);
  if (result.errorResponse) return result;
  if (result.rider.status !== 'active') {
    return {
      errorResponse: jsonResponse(403, {
        success: false,
        error: 'not_active',
        message: 'Your application is not approved yet',
      }),
    };
  }
  return result;
}
