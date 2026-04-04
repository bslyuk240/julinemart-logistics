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

const FALLBACK_ROLES = [
  { name: 'admin', display_name: 'Administrator', description: 'Full access to everything' },
  { name: 'shop_manager', display_name: 'Shop Manager', description: 'Products, vendors & categories' },
  { name: 'agent', display_name: 'Agent', description: 'Orders, dispatch & support' },
];

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  // Always return the hardcoded role list — roles are defined in code, not a DB table
  return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: FALLBACK_ROLES }) };
}
