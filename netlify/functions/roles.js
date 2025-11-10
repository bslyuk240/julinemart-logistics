// Netlify Function: /api/roles
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Roles function misconfigured: missing Supabase env');
      // Fallback default roles so UI can operate minimally
      const fallback = [
        { name: 'admin', display_name: 'Administrator', description: 'Full access' },
        { name: 'manager', display_name: 'Manager', description: 'Manage operations' },
        { name: 'viewer', display_name: 'Viewer', description: 'Read-only access' }
      ];
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: fallback }) };
    }
    const { data, error } = await supabase
      .from('roles')
      .select('name, display_name, description')
      .order('display_name');
    if (error) {
      console.warn('Roles query failed, returning fallback roles:', error);
      const fallback = [
        { name: 'admin', display_name: 'Administrator', description: 'Full access' },
        { name: 'manager', display_name: 'Manager', description: 'Manage operations' },
        { name: 'viewer', display_name: 'Viewer', description: 'Read-only access' }
      ];
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: fallback }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
  } catch (e) {
    console.error('Roles function error:', e);
    const fallback = [
      { name: 'admin', display_name: 'Administrator', description: 'Full access' },
      { name: 'manager', display_name: 'Manager', description: 'Manage operations' },
      { name: 'viewer', display_name: 'Viewer', description: 'Read-only access' }
    ];
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: fallback }) };
  }
}
