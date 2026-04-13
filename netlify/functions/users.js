// Netlify Function: /api/users and /api/users/:id
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const READ_ONLY_KEY =
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  SERVICE_ROLE_KEY;

// Use READ_ONLY_KEY only for auth token verification; all DB access goes through the service key
const supabaseAuth = createClient(SUPABASE_URL || '', READ_ONLY_KEY || '');
const supabaseAdmin = SERVICE_ROLE_KEY ? createClient(SUPABASE_URL || '', SERVICE_ROLE_KEY) : null;
const allowedRoles = ['admin', 'agent', 'shop_manager', 'vendor'];

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const unauthorized = (message = 'Unauthorized') => ({
  statusCode: 401,
  headers,
  body: JSON.stringify({ success: false, error: 'unauthorized', message })
});

const forbidden = (message = 'Forbidden') => ({
  statusCode: 403,
  headers,
  body: JSON.stringify({ success: false, error: 'forbidden', message })
});

const misconfigured = () => ({
  statusCode: 500,
  headers,
  body: JSON.stringify({
    success: false,
    error: 'Server not configured',
    message: 'Supabase URL or service role key is missing for the users function'
  })
});

async function requireRole(event, roles = ['admin']) {
  if (!supabaseAdmin || !SUPABASE_URL) {
    return { errorResponse: misconfigured() };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { errorResponse: unauthorized('Missing bearer token') };
  }

  const token = authHeader.split(' ')[1];
  const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !authData?.user) {
    return { errorResponse: unauthorized('Invalid or expired token') };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, email, role, is_active')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) {
    return { errorResponse: forbidden('User profile not found or inactive') };
  }

  if (!profile.is_active) {
    return { errorResponse: forbidden('User account is inactive') };
  }

  if (!roles.includes(profile.role)) {
    return { errorResponse: forbidden('Insufficient permissions for this action') };
  }

  return { authUser: authData.user, profile };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'users');
  const id = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('Users function misconfigured: missing Supabase credentials');
      return misconfigured();
    }

    // Lists are admin-only
    if (event.httpMethod === 'GET' && !id) {
      const auth = await requireRole(event, ['admin']);
      if (auth.errorResponse) return auth.errorResponse;

      const { data, error } = await supabaseAdmin
        .from('users')
        .select('id, email, full_name, role, is_active, catalog_access, last_login, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
    }

    if (event.httpMethod === 'POST' && !id) {
      const auth = await requireRole(event, ['admin']);
      if (auth.errorResponse) return auth.errorResponse;

      const payload = JSON.parse(event.body || '{}');
      const { email, password, full_name, role } = payload;

      if (!supabaseAdmin) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Service role key is required to create users'
          })
        };
      }

      if (!email || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Email and password are required'
          })
        };
      }

      const finalRole = role && allowedRoles.includes(role) ? role : 'agent';

      if (role && !allowedRoles.includes(role)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
          })
        };
      }

      // Create user in auth.users with role in user_metadata.
      // app_metadata is server-only: triggers that sync auth → public.customers should skip when
      // public.is_jlo_staff_auth_creation(NEW.raw_app_meta_data) is true (see migration jlo_staff_skip_customers_helper).
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: full_name || '',
          role: finalRole
        },
        app_metadata: {
          jlo_staff: true,
          signup_source: 'jlo'
        }
      });

      if (authError) throw authError;

      if (!authData?.user) {
        throw new Error('Failed to resolve created user');
      }

      const userId = authData.user.id;
      const selectCreated = () =>
        supabaseAdmin
          .from('users')
          .select('id, email, full_name, role, is_active, created_at, updated_at')
          .eq('id', userId)
          .single();

      // Trigger handle_new_user may lag; retry briefly before upserting a profile row.
      let user = null;
      let fetchError = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
        const res = await selectCreated();
        user = res.data;
        fetchError = res.error;
        if (user && !fetchError) break;
      }

      if (!user || fetchError) {
        console.error('User profile missing after auth create; upserting via service role:', fetchError);
        const { error: upsertError } = await supabaseAdmin.from('users').upsert(
          {
            id: userId,
            email,
            full_name: full_name || null,
            role: finalRole,
            is_active: true
          },
          { onConflict: 'id' }
        );
        if (upsertError) {
          console.error('Upsert public.users after create failed:', upsertError);
          throw new Error(
            upsertError.message ||
              'Auth user was created but the staff profile row could not be written. Check DB role CHECK constraint and RLS.'
          );
        }
        const res = await selectCreated();
        user = res.data;
        if (!user || res.error) {
          throw new Error(res.error?.message || 'Profile row still missing after upsert');
        }
      }

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, data: user })
      };
    }

    if (event.httpMethod === 'DELETE' && id) {
      const auth = await requireRole(event, ['admin']);
      if (auth.errorResponse) return auth.errorResponse;

      if (!supabaseAdmin) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Service role key is required to delete users'
          })
        };
      }
      // Soft-delete: deactivate user
      const { error } = await supabaseAdmin
        .from('users')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
      return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod === 'PUT' && id) {
      const auth = await requireRole(event, ['admin']);
      if (auth.errorResponse) return auth.errorResponse;

      if (!supabaseAdmin) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Service role key is required to update users'
          })
        };
      }
      const payload = JSON.parse(event.body || '{}');
      const updateData = {};
      if (payload.full_name !== undefined) updateData.full_name = payload.full_name;
      if (payload.role !== undefined) {
        if (!allowedRoles.includes(payload.role)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              success: false,
              error: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
            })
          };
        }
        updateData.role = payload.role;
      }
      if (payload.is_active !== undefined) updateData.is_active = payload.is_active;
      if (payload.catalog_access !== undefined) updateData.catalog_access = !!payload.catalog_access;

      const { data, error } = await supabaseAdmin
        .from('users')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  } catch (e) {
    console.error('Users function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e?.message || 'Failed to handle users' }) };
  }
}