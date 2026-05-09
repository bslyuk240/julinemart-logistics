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
const allowedRoles = ['admin', 'agent', 'shop_manager', 'vendor', 'manager', 'viewer', 'social_media_manager'];

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

      // Use * so missing optional columns (e.g. catalog_access) on older DBs do not 500 the whole list
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []).map((r) => ({
        ...r,
        catalog_access: Boolean(r.catalog_access),
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
    }

    if (event.httpMethod === 'POST' && !id) {
      const auth = await requireRole(event, ['admin']);
      if (auth.errorResponse) return auth.errorResponse;

      const payload = JSON.parse(event.body || '{}');
      const { email, full_name, role } = payload;

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

      if (!email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Email is required'
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

      // Invite the user via email — Supabase sends a "Set up your account" link.
      // The user clicks it, sets their own password, and lands on the JLO dashboard.
      const JLO_URL = process.env.JLO_URL || process.env.VITE_APP_URL || 'https://jlo.julinemart.com';
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${JLO_URL}/auth/callback`,
        data: {
          full_name: full_name || '',
          role: finalRole,
        },
      });

      if (authError) throw authError;

      // Set app_metadata so DB triggers know this is a JLO staff account
      if (authData?.user?.id) {
        await supabaseAdmin.auth.admin.updateUserById(authData.user.id, {
          app_metadata: { jlo_staff: true, signup_source: 'jlo' },
        });
      }

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

      if (auth.authUser.id === id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'You cannot delete your own account'
          })
        };
      }

      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', id)
        .maybeSingle();

      if (profileErr) {
        console.error('users delete profile lookup:', profileErr);
        throw profileErr;
      }

      if (!profile) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Staff profile not found',
            hint: 'There is no row in public.users for this id.'
          })
        };
      }

      const fkHint =
        'Other tables still reference this user (for example courier_settlements.approved_by or paid_by). Clear or reassign those rows, then retry.';

      const respondProfileDeleteError = (pubDelErr) => {
        const pmsg = String(pubDelErr?.message || '');
        const pubFk = /foreign key|violates|23503|referenced/i.test(pmsg);
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({
            success: false,
            error: pubFk
              ? 'Cannot remove this staff profile while other records reference it.'
              : pmsg || 'Could not remove staff profile',
            hint: pubFk ? fkHint : undefined
          })
        };
      };

      // Hard delete: removes auth.users; public.users cascades when FK allows it.
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (!delErr) {
        return { statusCode: 204, headers, body: '' };
      }

      console.error('auth.admin.deleteUser failed:', delErr);

      const msg = String(delErr.message || '');
      const looksLikeAuthMissing =
        /user not found|no user found|does not exist|not_found/i.test(msg) ||
        delErr.status === 404;

      const { data: authLookup, error: getAuthErr } = await supabaseAdmin.auth.admin.getUserById(id);
      const gmsg = String(getAuthErr?.message || '');
      const authUserPresent = !getAuthErr && !!authLookup?.user;
      const authVerifyFailed =
        getAuthErr &&
        !/user not found|not found|no user/i.test(gmsg) &&
        getAuthErr.status !== 404;

      if (authVerifyFailed) {
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Could not verify login account status',
            hint: gmsg || 'Try again in a moment.'
          })
        };
      }

      if (looksLikeAuthMissing && !authUserPresent) {
        const { error: pubDelErr } = await supabaseAdmin.from('users').delete().eq('id', id);
        if (pubDelErr) return respondProfileDeleteError(pubDelErr);
        return { statusCode: 204, headers, body: '' };
      }

      if (looksLikeAuthMissing && authUserPresent) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Could not delete login account',
            hint: `${fkHint} If the problem persists, try again or check the Supabase Auth dashboard for this user.`
          })
        };
      }

      const isFkBlock = /foreign key|violates|23503|referenced/i.test(msg);
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          success: false,
          error: isFkBlock
            ? 'Cannot delete account while other records still reference this staff profile.'
            : msg || 'Could not delete user',
          hint: isFkBlock ? fkHint : undefined
        })
      };
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