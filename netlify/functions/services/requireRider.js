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

/**
 * Verifies the Bearer token resolves to a real Supabase Auth user — no
 * `riders` row required. Used by rider-register.js, where that row may not
 * exist yet (a rider self-registers an auth account first, then submits
 * their KYC application to create/update it).
 */
export async function verifySession(event) {
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

  return { authUser: authData.user, adminClient };
}

export async function requireRider(event) {
  const session = await verifySession(event);
  if (session.errorResponse) return session;
  const { authUser } = session;

  const { data: rider, error: riderError } = await adminClient
    .from('riders')
    .select(
      'id, user_id, email, full_name, phone, status, reject_reason, created_at, approved_location_id, is_online, selfie_captured_at, known_device_ids, vehicle_type, vehicle_plate, bank_name, bank_account_number, bank_account_name, approved_vendor_locations ( city, state )'
    )
    .eq('user_id', authUser.id)
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

  return { authUser, rider, adminClient };
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
