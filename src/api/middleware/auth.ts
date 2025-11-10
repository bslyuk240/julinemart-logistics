import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    permissions: string[];
  };
}

// Authenticate user from JWT token
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'No valid authorization token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or expired token'
      });
    }

    // Get user details including role
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !userData.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User account is inactive or not found'
      });
    }

    // Get role permissions
    const { data: roleData } = await supabase
      .from('roles')
      .select('permissions')
      .eq('name', userData.role)
      .single();

    req.user = {
      id: userData.id,
      email: userData.email,
      role: userData.role,
      permissions: roleData?.permissions || []
    };

    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Authentication failed'
    });
  }
}

// Check if user has required permission
export function authorize(...requiredPermissions: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User not authenticated'
      });
    }

    // Admins have all permissions
    if (req.user.role === 'admin') {
      return next();
    }

    // Check if user has any of the required permissions
    const hasPermission = requiredPermissions.some(permission =>
      req.user!.permissions.includes(permission)
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Insufficient permissions for this action'
      });
    }

    next();
  };
}

// Check if user has specific role
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User not authenticated'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: `This action requires one of these roles: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

// Log activity
export async function logActivity(
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  details: any,
  req: Request
) {
  try {
    await supabase.from('activity_logs').insert({
      user_id: userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
      ip_address: req.ip || req.socket.remoteAddress,
      user_agent: req.headers['user-agent']
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

export { AuthRequest };
