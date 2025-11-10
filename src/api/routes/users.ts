import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';
import { AuthRequest, logActivity } from '../middleware/auth.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

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

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) throw authError;

    // Create user in users table
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        full_name: full_name || null,
        role: role || 'viewer',
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
    if (role !== undefined) updateData.role = role;
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

    // Deactivate user instead of deleting
    const { error } = await supabase
      .from('users')
      .update({ is_active: false })
      .eq('id', id);

    if (error) throw error;

    // Log activity
    await logActivity(
      req.user!.id,
      'DELETE',
      'users',
      id,
      {},
      req
    );

    return res.status(200).json({
      success: true,
      message: 'User deactivated successfully'
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

    return res.status(200).json({
      success: true,
      data: roles || [],
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

    let query = supabase
      .from('activity_logs')
      .select(`
        id,
        user_id,
        action,
        resource_type,
        resource_id,
        details,
        ip_address,
        created_at,
        users (email, full_name)
      `)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (action) {
      query = query.eq('action', action);
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
