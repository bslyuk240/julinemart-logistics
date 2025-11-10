// Netlify Function: /api/settlements and /api/settlements/pending
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'settlements');
  const sub = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;

  try {
    if (event.httpMethod === 'GET' && sub === 'pending') {
      // Prefer view when available
      const view = await supabase.from('pending_courier_payments').select('*');
      if (!view.error && view.data) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: view.data }) };
      }

      // Fallback: compute from base tables
      const { data: couriers } = await supabase.from('couriers').select('id, name, code');
      const { data: shipments } = await supabase
        .from('sub_orders')
        .select('id, courier_id, settlement_status, status, shipping_cost, created_at');

      const grouped = [];
      const map = new Map();
      (shipments || [])
        .filter((s) => ['pending', 'approved'].includes(s.settlement_status) && ['delivered', 'in_transit'].includes(s.status))
        .forEach((s) => {
          const key = s.courier_id;
          if (!key) return;
          if (!map.has(key)) {
            const c = (couriers || []).find((c) => c.id === key);
            map.set(key, {
              courier_id: key,
              courier_name: c?.name || 'Unknown',
              courier_code: c?.code || '',
              pending_shipments: 0,
              total_amount_due: 0,
              approved_amount: 0,
              oldest_shipment: null,
              newest_shipment: null
            });
          }
          const g = map.get(key);
          g.pending_shipments += 1;
          g.total_amount_due += Number(s.shipping_cost || 0);
          if (s.settlement_status === 'approved') {
            g.approved_amount += Number(s.shipping_cost || 0);
          }
          const ts = new Date(s.created_at).getTime();
          g.oldest_shipment = g.oldest_shipment ? (ts < new Date(g.oldest_shipment).getTime() ? s.created_at : g.oldest_shipment) : s.created_at;
          g.newest_shipment = g.newest_shipment ? (ts > new Date(g.newest_shipment).getTime() ? s.created_at : g.newest_shipment) : s.created_at;
        });
      map.forEach((v) => grouped.push(v));
      grouped.sort((a, b) => b.total_amount_due - a.total_amount_due);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: grouped }) };
    }

    if (event.httpMethod === 'GET') {
      // Settlements history (summary view preferred)
      const limit = 100;
      let q = supabase.from('courier_settlement_summary').select('*').order('created_at', { ascending: false }).limit(limit);
      let { data, error } = await q;
      if (error) {
        const alt = await supabase.from('courier_settlements').select('*').order('created_at', { ascending: false }).limit(limit);
        data = alt.data;
        error = alt.error;
      }
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to handle settlements' }) };
  }
}

