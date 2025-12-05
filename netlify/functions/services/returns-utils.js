// Shared helpers for Returns module (Supabase + Woo + Fez)
import fetch from 'node-fetch';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const WOO_BASE = (process.env.WOOCOMMERCE_URL || '').replace(/\/$/, '');
const WOO_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY || '';
const WOO_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET || '';

const FEZ_BASE = (process.env.FEZ_API_BASE_URL || process.env.FEZ_API_URL || '').replace(/\/$/, '');
const FEZ_KEY = process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY || '';
const FEZ_USER_ID = process.env.FEZ_USER_ID || '';

export const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false } });

export function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export async function fetchWooOrder(orderId) {
  if (!WOO_BASE || !WOO_KEY || !WOO_SECRET) throw new Error('WooCommerce not configured');
  const url = `${WOO_BASE}/orders/${orderId}`;
  const res = await fetch(url, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64'),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Woo order fetch failed (${res.status})`);
  }
  return data;
}

export function validateReturnWindow(order, maxDays = 14) {
  const completed = order?.date_completed ? new Date(order.date_completed) : null;
  if (!completed) return false;
  return daysBetween(new Date(), completed) <= maxDays;
}

export function generateReturnCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let code = 'RTN-';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

export function generateShortUniqueId(source) {
  const shortId = (source || crypto.randomUUID()).replace(/-/g, '').slice(-8);
  const ts = Date.now().toString(36);
  return `JLO-${shortId}-${ts}`.toUpperCase();
}

async function authenticateFez() {
  if (!FEZ_BASE || !FEZ_KEY || !FEZ_USER_ID) throw new Error('Fez API not configured');
  const res = await fetch(`${FEZ_BASE}/user/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: FEZ_USER_ID, password: FEZ_KEY }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.status !== 'Success') throw new Error(data?.description || 'Fez auth failed');
  return { authToken: data.authDetails?.authToken, secretKey: data.orgDetails?.['secret-key'] };
}

export async function createFezReturnPickup({ returnCode, returnRequestId, customer, hub }) {
  const auth = await authenticateFez();
  if (!auth.authToken || !auth.secretKey) throw new Error('Fez auth missing token/secret');

  const uniqueId = generateShortUniqueId(returnRequestId || returnCode).replace(/-/g, '');
  const payload = {
    recipientAddress: hub?.address || '',
    recipientState: hub?.state || 'Lagos',
    recipientName: hub?.name || 'JulineMart Hub',
    recipientPhone: hub?.phone || '+2340000000000',
    recipientEmail: 'returns@julinemart.com',
    uniqueID: uniqueId,
    BatchID: returnCode.replace(/-/g, ''),
    itemDescription: `Return package ${returnCode}`,
    valueOfItem: '6000',
    weight: 1,
    pickUpAddress: customer?.address || '',
    pickUpState: customer?.state || 'Lagos',
    additionalDetails: `Return from: ${customer?.name || ''}, Phone: ${customer?.phone || ''}`,
  };

  const res = await fetch(`${FEZ_BASE}/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.authToken}`,
      'secret-key': auth.secretKey,
    },
    body: JSON.stringify([payload]),
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (data?.status === 'Success' && data?.orderNos) {
    const values = Object.values(data.orderNos);
    if (values.length > 0) return { tracking: String(values[0]) };
  }
  throw new Error(data?.description || data?.message || text || 'Fez order creation failed');
}

export function mapFezStatusToReturn(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('pickup')) return 'pickup_scheduled';
  if (s.includes('in_transit') || s.includes('transit') || s.includes('on_the_way')) return 'in_transit';
  if (s.includes('delivered')) return 'delivered_to_hub';
  if (s.includes('cancel')) return 'cancelled';
  return 'pending';
}

export async function createWooRefund(orderId, amount, reason) {
  if (!WOO_BASE || !WOO_KEY || !WOO_SECRET) throw new Error('WooCommerce not configured');
  const url = `${WOO_BASE}/orders/${orderId}/refunds`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: String(amount ?? 0),
      reason,
      api_refund: true,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Woo refund failed (${res.status})`);
  }
  return data;
}
