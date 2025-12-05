// Shared helpers for Returns module (Supabase + Woo + Fez)
// FIXED: Always fetch hub address from database to prevent customer address being used as hub address
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

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

function parseDataUrl(str) {
  const match = /^data:(.+);base64,(.+)$/i.exec(str);
  if (!match) return null;
  const [, mime, b64] = match;
  return { mime: mime.trim().toLowerCase(), b64 };
}

function extensionForMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return '+2340000000000';
  const digits = phone.replace(/\D+/g, '');
  // If it already starts with country code (234...) keep it; else prepend.
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+234${digits}`;
}

export async function uploadReturnImages(images = [], returnRequestId) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const bucket = supabase.storage.from('return-images');
  const results = [];

  for (const img of images) {
    if (typeof img !== 'string' || img.trim() === '') continue;
    const trimmed = img.trim();

    // If already a URL, keep as-is.
    if (/^https?:\/\//i.test(trimmed)) {
      results.push(trimmed);
      continue;
    }

    const parsed = parseDataUrl(trimmed);
    if (!parsed) {
      throw new Error('Invalid image format');
    }

    const { mime, b64 } = parsed;
    if (!ALLOWED_IMAGE_TYPES.has(mime)) {
      throw new Error(`Unsupported image type: ${mime}`);
    }

    const buffer = Buffer.from(b64, 'base64');
    if (!buffer || buffer.length === 0) {
      throw new Error('Empty image data');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds 8MB limit');
    }

    const ext = extensionForMime(mime);
    const filename = `${crypto.randomUUID()}.${ext}`;
    const path = `return-images/${returnRequestId}/${filename}`;

    const { error: uploadError } = await bucket.upload(path, buffer, {
      contentType: mime,
      upsert: true,
    });
    if (uploadError) {
      throw uploadError;
    }

    const { data: publicUrlData } = bucket.getPublicUrl(path);
    if (!publicUrlData?.publicUrl) {
      throw new Error('Failed to get public URL');
    }

    results.push(publicUrlData.publicUrl);
  }

  return results;
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

/**
 * CRITICAL FIX: Always fetch hub from database to get the REAL warehouse address.
 * This prevents the bug where customer address is mistakenly used as hub address.
 */
async function fetchHubFromDatabase(hubHint) {
  console.log('=== FETCHING HUB FROM DATABASE ===');
  console.log('Hub hint from frontend:', JSON.stringify(hubHint));
  
  try {
    // Get all active hubs from database
    const { data: hubs, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('is_active', true)
      .order('name');
    
    if (error) {
      console.error('Database error fetching hubs:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    
    if (!hubs || hubs.length === 0) {
      throw new Error('No active hubs found in database. Please activate at least one hub.');
    }
    
    console.log('Found', hubs.length, 'active hub(s):');
    hubs.forEach(h => console.log(`  - ${h.name}: "${h.address || 'NO ADDRESS!'}" (${h.city}, ${h.state})`));
    
    // Try to find a matching hub
    let matchedHub = null;
    const hintName = (hubHint?.name || '').toLowerCase();
    const hintState = (hubHint?.state || '').toLowerCase();
    
    // Priority 1: Match by name if provided
    if (hintName) {
      matchedHub = hubs.find(h => 
        h.name?.toLowerCase().includes(hintName) || 
        hintName.includes(h.name?.toLowerCase())
      );
      if (matchedHub) console.log('Matched by name:', matchedHub.name);
    }
    
    // Priority 2: Match by state if provided
    if (!matchedHub && hintState) {
      matchedHub = hubs.find(h => h.state?.toLowerCase() === hintState);
      if (matchedHub) console.log('Matched by state:', matchedHub.name);
    }
    
    // Priority 3: Default to Warri Hub (primary hub)
    if (!matchedHub) {
      matchedHub = hubs.find(h => h.name?.toLowerCase().includes('warri'));
      if (matchedHub) console.log('Using default Warri Hub:', matchedHub.name);
    }
    
    // Priority 4: Just use first active hub
    if (!matchedHub) {
      matchedHub = hubs[0];
      console.log('Using first available hub:', matchedHub.name);
    }
    
    // CRITICAL: Validate that hub has an address
    if (!matchedHub.address || matchedHub.address.trim() === '') {
      throw new Error(
        `Hub "${matchedHub.name}" has no address configured! ` +
        `Please go to Hubs settings and add an address for this hub.`
      );
    }
    
    console.log('âœ… Selected hub:', matchedHub.name);
    console.log('   Address:', matchedHub.address);
    
    return {
      name: matchedHub.name,
      address: matchedHub.address,
      city: matchedHub.city || matchedHub.state,
      state: matchedHub.state,
      phone: normalizePhone(matchedHub.phone),
    };
    
  } catch (err) {
    console.error('fetchHubFromDatabase failed:', err.message);
    throw err;
  }
}

export async function createFezReturnPickup({ returnCode, customer, hub }) {
  const fezToken = process.env.FEZ_API_KEY || FEZ_KEY;
  const fezUser = process.env.FEZ_USER_ID;
  const fezPassword = process.env.FEZ_PASSWORD || FEZ_KEY;

  const missing = [];
  if (!fezToken) missing.push('FEZ_API_KEY');
  if (!fezUser) missing.push('FEZ_USER_ID');
  if (!fezPassword) missing.push('FEZ_PASSWORD');
  if (missing.length) {
    throw new Error(`Fez auth missing: ${missing.join(', ')}`);
  }

  const payload = {
    uniqueId: `JLO-RETURN-${returnCode}`,
    sender: {
      name: customer?.name || 'Return Customer',
      phone: normalizePhone(customer?.phone),
      address: customer?.address || '',
      city: customer?.city || '',
      state: customer?.state || '',
    },
    receiver: {
      name: hub?.name || 'JulineMart Hub',
      phone: normalizePhone(hub?.phone),
      address: hub?.address || '',
      city: hub?.city || '',
      state: hub?.state || '',
    },
    items: [
      {
        itemName: 'Return Item',
        weight: 1,
        quantity: 1,
      },
    ],
    paymentMethod: 1,
    deliveryMethod: 1,
    requestPickup: true,
  };

  const headers = {
    'Content-Type': 'application/json',
    'fez-token': fezToken,
    'fez-username': fezUser,
    'fez-password': fezPassword,
  };

  console.error('Fez Headers:', headers);
  console.error('Fez Payload:', payload);

  const res = await fetch(`${FEZ_BASE}/order`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  console.error('Fez Response:', text);

  if (!res.ok) {
    throw new Error(data?.description || data?.message || text || 'Fez order creation failed');
  }

  let tracking =
    data?.trackingNumber ||
    data?.tracking_number ||
    data?.orderNo ||
    data?.order_no ||
    data?.data?.trackingNumber ||
    null;
  if (!tracking && data?.orderNos && typeof data.orderNos === 'object') {
    const values = Object.values(data.orderNos);
    if (values.length > 0) tracking = String(values[0]);
  }

  const shipmentId = data?.orderId || data?.order_id || data?.data?.orderId || null;
  return { tracking, shipmentId };
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
