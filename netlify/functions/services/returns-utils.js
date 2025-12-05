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
    
    console.log('✅ Selected hub:', matchedHub.name);
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

export async function createFezReturnPickup({ returnCode, returnRequestId, customer, hub }) {
  console.log('\n' + '='.repeat(60));
  console.log('=== CREATING FEZ RETURN PICKUP ===');
  console.log('='.repeat(60));
  
  const auth = await authenticateFez();
  if (!auth.authToken || !auth.secretKey) throw new Error('Fez auth missing token/secret');

  const uniqueId = generateShortUniqueId(returnRequestId || returnCode).replace(/-/g, '');
  
  // CUSTOMER INFO (where Fez picks up FROM)
  const customerName = customer?.name || customer?.full_name || 'Return Customer';
  const customerPhone = normalizePhone(customer?.phone);
  const customerAddress = customer?.address || '';
  const customerCity = customer?.city || customer?.state || 'Lagos';
  const customerState = customer?.state || 'Lagos';
  
  console.log('\n--- CUSTOMER (PICKUP LOCATION) ---');
  console.log('Name:', customerName);
  console.log('Phone:', customerPhone);
  console.log('Address:', customerAddress);
  console.log('City:', customerCity);
  console.log('State:', customerState);
  
  // CRITICAL FIX: ALWAYS fetch hub from database
  // Never trust the hub data from frontend - it might be incomplete or wrong
  console.log('\n--- FETCHING HUB FROM DATABASE ---');
  const dbHub = await fetchHubFromDatabase(hub);
  
  console.log('\n--- HUB (DELIVERY DESTINATION) ---');
  console.log('Name:', dbHub.name);
  console.log('Phone:', dbHub.phone);
  console.log('Address:', dbHub.address);
  console.log('City:', dbHub.city);
  console.log('State:', dbHub.state);
  
  // VALIDATION: Ensure pickup and delivery addresses are different
  const customerAddrNorm = customerAddress.toLowerCase().trim();
  const hubAddrNorm = dbHub.address.toLowerCase().trim();
  
  if (customerAddrNorm === hubAddrNorm) {
    console.error('\n❌ ERROR: Customer and Hub addresses are IDENTICAL!');
    console.error('   Customer:', customerAddress);
    console.error('   Hub:', dbHub.address);
    throw new Error(
      'Cannot create return shipment: Customer address and hub address are the same. ' +
      'Fez requires different pickup and delivery locations.'
    );
  }
  
  // Build Fez payload
  // THEORY: Fez API might only allow pickups from registered hub addresses
  // Forward shipments work because: Hub (pickup) → Customer (recipient)
  // Return shipments fail because: Customer (pickup) → Hub (recipient)
  //
  // WORKAROUND: Create the order in "forward" direction (Hub → Customer)
  // but use additionalDetails to explain it's actually a RETURN pickup
  // Fez's dispatch team will see the note and handle it as a return
  
  const payload = {
    // For return, we SWAP the direction to match working forward format:
    // "Pickup" = HUB (Fez picks up from hub... but we'll note it's actually customer pickup)
    // "Recipient" = CUSTOMER (this is actually where the item comes FROM)
    
    // RECIPIENT = CUSTOMER (label says deliver to customer, but it's actually pickup FROM them)
    recipientAddress: customerAddress,
    recipientState: customerState,
    recipientName: customerName,
    recipientPhone: customerPhone,
    recipientEmail: customer?.email || '',
    
    // Identifiers
    uniqueID: uniqueId,
    BatchID: returnCode.replace(/-/g, ''),
    
    // Package details - mark as RETURN in description
    itemDescription: `RETURN PICKUP ${returnCode} - Collect from customer, deliver to hub`,
    valueOfItem: '6000',
    weight: 1,
    
    // PICKUP = HUB (we register pickup from hub, like working forward shipments)
    pickUpAddress: dbHub.address,
    pickUpState: dbHub.state,
    
    // CRITICAL: Use additionalDetails to explain the ACTUAL flow
    additionalDetails: `⚠️ RETURN ORDER - REVERSED FLOW: Physically PICK UP from ${customerName} at ${customerAddress}, ${customerCity}. DELIVER TO ${dbHub.name} at ${dbHub.address}. Customer phone: ${customer?.phone || ''}`,
  };

  console.log('\n--- FEZ API PAYLOAD (SWAPPED FOR RETURN) ---');
  console.log('Registered Pickup (Hub):', payload.pickUpAddress, ',', payload.pickUpState);
  console.log('Registered Recipient (Customer):', payload.recipientAddress, ',', payload.recipientState);
  console.log('ACTUAL FLOW: Customer → Hub (see additionalDetails)');

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
  
  console.log('\n--- FEZ API RESPONSE ---');
  console.log('HTTP Status:', res.status);
  console.log('Response:', text);
  
  if (data?.status === 'Success' && data?.orderNos) {
    const values = Object.values(data.orderNos);
    if (values.length > 0) {
      const tracking = String(values[0]);
      console.log('\n✅ SUCCESS! Fez tracking:', tracking);
      return { tracking };
    }
  }
  
  // Log failure details
  console.error('\n❌ FEZ ORDER CREATION FAILED');
  console.error('Payload sent:', JSON.stringify({
    recipientAddress: payload.recipientAddress,
    recipientCity: payload.recipientCity,
    recipientState: payload.recipientState,
    pickUpAddress: payload.pickUpAddress,
    pickUpCity: payload.pickUpCity,
    pickUpState: payload.pickUpState,
  }, null, 2));
  
  const errDetail = data?.description || data?.message || text || 'Fez order creation failed';
  throw new Error(`Fez order create failed (${res.status}): ${errDetail}`);
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