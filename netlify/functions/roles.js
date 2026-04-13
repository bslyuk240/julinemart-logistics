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
  {
    name: 'shop_manager',
    display_name: 'Shop Manager',
    description: 'Catalog, vendors, categories (modern ops + merchandising)'
  },
  {
    name: 'manager',
    display_name: 'Manager',
    description:
      'Dashboard, orders, WhatsApp, refunds, rates, catalog, global sourcing, vendors & payouts (no hub dispatch, users, or admin settings)'
  },
  { name: 'agent', display_name: 'Agent', description: 'Orders, dispatch, support; optional catalog_access' },
  {
    name: 'viewer',
    display_name: 'Viewer (legacy)',
    description: 'Read-oriented legacy role: dashboard/orders/dispatch-style pages only (no catalog write screens)'
  },
  {
    name: 'vendor',
    display_name: 'Vendor',
    description: 'Vendor portal account (not JLO); create only if they should log into the vendor app'
  },
];

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  // Always return the hardcoded role list — roles are defined in code, not a DB table
  return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: FALLBACK_ROLES }) };
}
