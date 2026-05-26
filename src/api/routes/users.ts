import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';
import { AuthRequest, logActivity } from '../middleware/auth.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const allowedRoles = ['admin', 'agent', 'shop_manager', 'vendor', 'manager', 'viewer'];

// Get all users
export async function getUsersHandler(req: AuthRequest, res: Response) {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select(`
        id,
        email,
        full_name,
        role,
        is_active,
        last_login,
        created_at
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: users || [],
    });
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json({
      error: 'Failed to fetch users',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get single user
export async function getUserByIdHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        id,
        email,
        full_name,
        role,
        is_active,
        last_login,
        created_at,
        updated_at
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({
      error: 'Failed to fetch user',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Create user
export async function createUserHandler(req: AuthRequest, res: Response) {
  try {
    const { email, password, full_name, role } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
      });
    }

    const finalRole = role && allowedRoles.includes(role) ? role : 'agent';

    // Create user in Supabase Auth (app_metadata: JLO-only; see is_jlo_staff_auth_creation migration)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
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

    // Create user in users table
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        full_name: full_name || null,
        role: finalRole,
        is_active: true
      })
      .select()
      .single();

    if (userError) throw userError;

    // Log activity
    await logActivity(
      req.user!.id,
      'CREATE',
      'users',
      user.id,
      { email, role },
      req
    );

    return res.status(201).json({
      success: true,
      data: user,
      message: 'User created successfully'
    });
  } catch (error) {
    console.error('Create user error:', error);
    return res.status(500).json({
      error: 'Failed to create user',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Update user
export async function updateUserHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { full_name, role, is_active } = req.body;

    const updateData: any = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (role !== undefined) {
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          error: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
        });
      }
      updateData.role = role;
    }
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: user, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Log activity
    await logActivity(
      req.user!.id,
      'UPDATE',
      'users',
      id,
      updateData,
      req
    );

    return res.status(200).json({
      success: true,
      data: user,
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({
      error: 'Failed to update user',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Delete user
export async function deleteUserHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    // Don't allow users to delete themselves
    if (id === req.user!.id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    const { data: profile, error: profileErr } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (profileErr) throw profileErr;
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Staff profile not found',
        hint: 'There is no row in public.users for this id.',
      });
    }

    const fkHint =
      'Other tables still reference this user (for example courier_settlements.approved_by or paid_by). Clear or reassign those rows, then retry.';

    const respondProfileDeleteError = (pubDelErr: { message?: string } | null) => {
      const pmsg = String(pubDelErr?.message || '');
      const pubFk = /foreign key|violates|23503|referenced/i.test(pmsg);
      return res.status(409).json({
        success: false,
        error: pubFk
          ? 'Cannot remove this staff profile while other records reference it.'
          : pmsg || 'Could not remove staff profile',
        hint: pubFk ? fkHint : undefined,
      });
    };

    const { error: delErr } = await supabase.auth.admin.deleteUser(id);
    if (!delErr) {
      await logActivity(req.user!.id, 'DELETE', 'users', id, { hard_delete: true }, req);
      return res.status(204).send();
    }

    const msg = String(delErr.message || '');
    const looksLikeAuthMissing =
      /user not found|no user found|does not exist|not_found/i.test(msg) ||
      (delErr as { status?: number }).status === 404;

    const { data: authLookup, error: getAuthErr } = await supabase.auth.admin.getUserById(id);
    const gmsg = String(getAuthErr?.message || '');
    const authUserPresent = !getAuthErr && !!authLookup?.user;
    const authVerifyFailed =
      getAuthErr &&
      !/user not found|not found|no user/i.test(gmsg) &&
      (getAuthErr as { status?: number }).status !== 404;

    if (authVerifyFailed) {
      return res.status(502).json({
        success: false,
        error: 'Could not verify login account status',
        hint: gmsg || 'Try again in a moment.',
      });
    }

    if (looksLikeAuthMissing && !authUserPresent) {
      const { error: pubDelErr } = await supabase.from('users').delete().eq('id', id);
      if (pubDelErr) return respondProfileDeleteError(pubDelErr);
      await logActivity(
        req.user!.id,
        'DELETE',
        'users',
        id,
        { hard_delete: true, orphan_profile: true },
        req
      );
      return res.status(204).send();
    }

    if (looksLikeAuthMissing && authUserPresent) {
      return res.status(409).json({
        success: false,
        error: 'Could not delete login account',
        hint: `${fkHint} If the problem persists, try again or check the Supabase Auth dashboard for this user.`,
      });
    }

    const isFkBlock = /foreign key|violates|23503|referenced/i.test(msg);
    return res.status(409).json({
      success: false,
      error: isFkBlock
        ? 'Cannot delete account while other records still reference this staff profile.'
        : msg || 'Could not delete user',
      hint: isFkBlock ? fkHint : undefined,
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({
      error: 'Failed to delete user',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get all roles
export async function getRolesHandler(req: AuthRequest, res: Response) {
  try {
    const { data: roles, error } = await supabase
      .from('roles')
      .select('*')
      .order('name');

    if (error) throw error;

    const filtered = (roles || []).filter((r) => allowedRoles.includes(r.name));

    return res.status(200).json({
      success: true,
      data: filtered.length > 0 ? filtered : allowedRoles.map((name) => ({ name })),
    });
  } catch (error) {
    console.error('Get roles error:', error);
    return res.status(500).json({
      error: 'Failed to fetch roles',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get activity logs
export async function getActivityLogsHandler(req: AuthRequest, res: Response) {
  try {
    const { limit = 50, offset = 0, userId, action } = req.query;

    const excludeWhatsapp = req.query.exclude_whatsapp !== 'false';

    let query = supabase
      .from('activity_logs')
      .select(`
        id,
        user_id,
        actor_email,
        action,
        resource_type,
        resource_id,
        details,
        ip_address,
        source,
        created_at,
        users (email, full_name, role)
      `)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (excludeWhatsapp) {
      query = query
        .not('action', 'ilike', 'whatsapp%')
        .not('resource_type', 'ilike', 'whatsapp%');
    }

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (action) {
      query = query.eq('action', action);
    }

    const source = req.query.source;
    if (source && source !== 'all') {
      query = query.eq('source', source);
    }

    const { data: logs, error, count } = await query;

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: logs || [],
      pagination: {
        total: count,
        limit: Number(limit),
        offset: Number(offset)
      }
    });
  } catch (error) {
    console.error('Get activity logs error:', error);
    return res.status(500).json({
      error: 'Failed to fetch activity logs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get current user profile
export async function getCurrentUserHandler(req: AuthRequest, res: Response) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select(`
        id,
        email,
        full_name,
        role,
        is_active,
        last_login,
        created_at
      `)
      .eq('id', req.user!.id)
      .single();

    if (error) throw error;

    // Get role details
    const { data: roleData } = await supabase
      .from('roles')
      .select('*')
      .eq('name', user.role)
      .single();

    return res.status(200).json({
      success: true,
      data: {
        ...user,
        role_details: roleData
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    return res.status(500).json({
      error: 'Failed to fetch user profile',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
