// Shared helpers for Returns module (Supabase + Woo + Fez v1 Sandbox)
import fetch from 'node-fetch';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

/* --------------------------------------------------------
   ENVIRONMENT VARIABLES
--------------------------------------------------------- */
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const WOO_BASE = (process.env.WOOCOMMERCE_URL || '').replace(/\/$/, '');
const WOO_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY || '';
const WOO_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET || '';

/* 
  IMPORTANT — YOU USE FEZ API v1 (Sandbox)
  And forwarding shipments already work with these vars:
*/
const FEZ_BASE = (process.env.FEZ_API_BASE_URL || '').replace(/\/$/, ''); // should be https://apisandbox.fezdelivery.co/v1
const FEZ_USER_ID = process.env.FEZ_USER_ID || '';        // sandbox email
const FEZ_PASSWORD = process.env.FEZ_PASSWORD || '';      // sandbox password

export const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false }
});

/* --------------------------------------------------------
   BASIC HELPERS
--------------------------------------------------------- */
export function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
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
  const completedString =
    order?.date_completed ||
    order?.date_completed_gmt ||
    order?.date_paid ||
    order?.date_created ||
    order?.date_created_gmt;

  const completed = completedString ? new Date(completedString) : null;
  if (!completed || Number.isNaN(completed.getTime())) return false;

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

/* --------------------------------------------------------
   IMAGE UPLOAD
--------------------------------------------------------- */

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function parseDataUrl(str) {
  const match = /^data:(.+);base64,(.+)$/i.exec(str);
  if (!match) return null;
  return { mime: match[1].trim().toLowerCase(), b64: match[2] };
}

function extensionForMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

export async function uploadReturnImages(images = [], returnRequestId) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const bucket = supabase.storage.from('return-images');
  const results = [];

  for (const img of images) {
    if (typeof img !== 'string' || !img.trim()) continue;
    if (/^https?:\/\//i.test(img)) {
      results.push(img);
      continue;
    }

    const parsed = parseDataUrl(img);
    if (!parsed) throw new Error('Invalid image format');

    const { mime, b64 } = parsed;
    if (!ALLOWED_IMAGE_TYPES.has(mime)) throw new Error(`Unsupported image type: ${mime}`);

    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) throw new Error('Empty image data');
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds 8MB limit');

    const filename = `${crypto.randomUUID()}.${extensionForMime(mime)}`;
    const path = `return-images/${returnRequestId}/${filename}`;

    const { error } = await bucket.upload(path, buffer, {
      contentType: mime,
      upsert: true,
    });
    if (error) throw error;

    const { data: urlData } = bucket.getPublicUrl(path);
    results.push(urlData.publicUrl);
  }

  return results;
}

/* --------------------------------------------------------
   PHONE NORMALIZATION
--------------------------------------------------------- */
export function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return '+2340000000000';
  const digits = phone.replace(/\D+/g, '');
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+${digits}`;
}

/* --------------------------------------------------------
   HUB SELECTION
--------------------------------------------------------- */
export async function fetchHubFromDatabase(hubHint) {
  const { data: hubs, error } = await supabase
    .from('hubs')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (error) throw new Error('Failed to fetch hubs');

  if (!hubs?.length) throw new Error('No active hubs configured');

  // match by name first
  const hintName = hubHint?.name?.toLowerCase() || '';
  let matched = hubs.find(h => h.name.toLowerCase().includes(hintName));

  // fallback: first hub
  if (!matched) matched = hubs[0];

  if (!matched.address) throw new Error(`Hub "${matched.name}" has no address`);

  return {
    name: matched.name,
    address: matched.address,
    city: matched.city,
    state: matched.state,
    phone: normalizePhone(matched.phone),
  };
}

/* --------------------------------------------------------
   FEZ API v1 SANDBOX AUTH
--------------------------------------------------------- */
async function authenticateFezSandbox() {
  if (!FEZ_BASE || !FEZ_USER_ID || !FEZ_PASSWORD) {
    throw new Error('Fez sandbox env vars missing');
  }

  const res = await fetch(`${FEZ_BASE}/user/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: FEZ_USER_ID, password: FEZ_PASSWORD }),
  });

  const data = await res.json().catch(() => ({}));

  if (data?.status !== 'Success') {
    throw new Error(data?.description || 'Fez authentication failed');
  }

  return {
    token: data.authDetails?.authToken,
    secretKey: data.orgDetails?.['secret-key'],
  };
}

/* --------------------------------------------------------
   CREATE RETURN PICKUP — FEZ API v1 SANDBOX
--------------------------------------------------------- */
export async function createFezReturnPickup({ returnCode, customer, hub }) {
  const { token, secretKey } = await authenticateFezSandbox();

  const uniqueId = `JLO-RETURN-${returnCode}`;

  const payload = {
    uniqueID: uniqueId,
    recipientAddress: hub.address,
    recipientState: hub.state,
    recipientName: hub.name,
    recipientPhone: normalizePhone(hub.phone),
    recipientEmail: '',
    BatchID: uniqueId,
    itemDescription: 'Return Item',
    valueOfItem: '1000',
    weight: 1,

    pickUpAddress: customer.address,
    pickUpState: customer.state,
    senderName: customer.name,
    senderPhone: normalizePhone(customer.phone),
    senderEmail: '',

    additionalDetails: `Return shipment from ${customer.city}`,
  };

  const res = await fetch(`${FEZ_BASE}/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'secret-key': secretKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}

  if (!res.ok || data.status === 'Error') {
    throw new Error(data.description || raw || 'Fez sandbox return failed');
  }

  let tracking = null;
  if (data.orderNos && typeof data.orderNos === 'object') {
    tracking = Object.values(data.orderNos)[0];
  }

  return { tracking, shipmentId: tracking };
}

/* --------------------------------------------------------
   RETURN STATUS MAPPING
--------------------------------------------------------- */
export function mapFezStatusToReturn(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('pickup')) return 'pickup_scheduled';
  if (s.includes('transit')) return 'in_transit';
  if (s.includes('delivered')) return 'delivered_to_hub';
  if (s.includes('cancel')) return 'cancelled';
  return 'pending';
}
