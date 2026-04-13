/**
 * vendor-sync-profiles.js
 * One-time admin function: fetch WCFM profile settings for all vendors
 * from WordPress REST API, parse the PHP-serialized blob, and update
 * Supabase vendors with real phone, address, city, state, description,
 * logo_url, and banner_url.
 *
 * POST /api/vendor-sync-profiles  (no body needed)
 * Requires admin Bearer token.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = process.env.VITE_SUPABASE_URL  || process.env.SUPABASE_URL  || '';
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
// Strip any /wp-json/... path suffix — env var may include it already
const wpBase       = (process.env.WOO_BASE_URL || process.env.WOOCOMMERCE_URL || '')
  .replace(/\/wp-json.*$/, '').replace(/\/+$/, '');
const wpUser       = process.env.WP_MEDIA_USERNAME  || '';
const wpAppPass    = process.env.WORDPRESS_APP_PASSWORD || '';
const wcKey        = process.env.WOO_CONSUMER_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY || '';
const wcSecret     = process.env.WOO_CONSUMER_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Minimal PHP unserialiser (handles string/int/bool/array) ─────────────────

function phpUnserialize(str) {
  let i = 0;

  function read() {
    const type = str[i];
    i += 2; // skip type and ':'

    if (type === 'N') { i++; return null; }                     // N;
    if (type === 'b') { const v = str[i] === '1'; i += 2; return v; } // b:0; or b:1;

    if (type === 'i') {
      const end = str.indexOf(';', i);
      const v = parseInt(str.slice(i, end), 10);
      i = end + 1;
      return v;
    }

    if (type === 'd') {
      const end = str.indexOf(';', i);
      const v = parseFloat(str.slice(i, end));
      i = end + 1;
      return v;
    }

    if (type === 's') {
      const lenEnd = str.indexOf(':', i);
      const len = parseInt(str.slice(i, lenEnd), 10);
      i = lenEnd + 2; // skip :"
      const v = str.slice(i, i + len);
      i += len + 2; // skip ";
      return v;
    }

    if (type === 'a') {
      const countEnd = str.indexOf(':', i);
      const count = parseInt(str.slice(i, countEnd), 10);
      i = countEnd + 2; // skip :{
      const obj = {};
      for (let n = 0; n < count; n++) {
        const key = read();
        obj[key] = read();
      }
      i++; // skip }
      return obj;
    }

    if (type === 'O') {
      // skip class name
      const lenEnd = str.indexOf(':', i);
      const len = parseInt(str.slice(i, lenEnd), 10);
      i = lenEnd + 2 + len + 2;
      const countEnd = str.indexOf(':', i);
      const count = parseInt(str.slice(i, countEnd), 10);
      i = countEnd + 2;
      const obj = {};
      for (let n = 0; n < count; n++) {
        const key = read();
        obj[key] = read();
      }
      i++;
      return obj;
    }

    return null;
  }

  try { return read(); } catch { return {}; }
}

// ── Resolve WP attachment ID → URL via REST API ───────────────────────────────

async function resolveAttachmentUrl(attachmentId) {
  if (!attachmentId || !wpBase) return null;
  const auth = `Basic ${Buffer.from(`${wpUser}:${wpAppPass}`).toString('base64')}`;
  try {
    const res = await fetch(`${wpBase}/wp-json/wp/v2/media/${attachmentId}`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.source_url || data.guid?.rendered || null;
  } catch {
    return null;
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  // Require admin auth
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const adminClient = createClient(supabaseUrl, serviceKey);

  const anonClient = createClient(supabaseUrl,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid token' }) };

  const { data: profile } = await adminClient.from('users').select('role').eq('id', user.id).single();
  if (!profile || !['admin', 'shop_manager', 'manager'].includes(profile.role)) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Config check — logged server-side, helps diagnose missing env vars
  console.log('[sync] config check:', {
    wpBase: wpBase || '(MISSING)',
    wcKeySet: !!wcKey,
    wcSecretSet: !!wcSecret,
    wpUserSet: !!wpUser,
    wpAppPassSet: !!wpAppPass,
  });

  if (!wpBase || !wcKey || !wcSecret) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Missing WooCommerce config',
        debug: { wpBase: wpBase || '(MISSING)', wcKeySet: !!wcKey, wcSecretSet: !!wcSecret },
      }),
    };
  }

  // Fetch all vendors from Supabase
  const { data: vendors, error: vErr } = await adminClient
    .from('vendors')
    .select('id, woocommerce_vendor_id, store_name');
  if (vErr || !vendors?.length) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Could not load vendors' }) };
  }

  // WC REST API (/wc/v3/*) requires consumer key:secret, NOT WP App Password
  const wcAuth   = `Basic ${Buffer.from(`${wcKey}:${wcSecret}`).toString('base64')}`;
  // WP REST API (/wp/v2/*) uses WP Application Password (for media attachment lookups)
  const wpAuth   = `Basic ${Buffer.from(`${wpUser}:${wpAppPass}`).toString('base64')}`;

  // Process all vendors in parallel to avoid timeout
  const results = await Promise.all(
    vendors.map(async (vendor) => {
      const wpId = vendor.woocommerce_vendor_id;
      if (!wpId) return null;

      try {
        const wcUrl = `${wpBase}/wp-json/wc/v3/customers/${wpId}`;
        const res = await fetch(wcUrl, { headers: { Authorization: wcAuth } });

        if (!res.ok) {
          let body = '';
          try { body = await res.text(); } catch {}
          return {
            wpId, store: vendor.store_name, status: 'skip',
            reason: `HTTP ${res.status}`,
            debug: { url: wcUrl, status: res.status, body: body.slice(0, 300) },
          };
        }

        const customer = await res.json();
        const meta = {};
        for (const m of (customer.meta_data || [])) {
          meta[m.key] = m.value;
        }

        const profileRaw = meta['wcfmmp_profile_settings'] || '';
        const profile = typeof profileRaw === 'string' && profileRaw.startsWith('a:')
          ? phpUnserialize(profileRaw)
          : (typeof profileRaw === 'object' ? profileRaw : {});

        const phone       = profile['mobile']  || profile['phone']  || meta['store_phone']  || customer.billing?.phone  || null;
        const address     = profile['address'] || meta['store_address1'] || customer.billing?.address_1 || null;
        const city        = profile['city']    || meta['store_city']    || customer.billing?.city  || null;
        const state       = profile['state']   || meta['store_state']   || customer.billing?.state || null;
        const description = meta['_store_description'] || profile['shop_description'] || null;

        const logoId   = profile['logo']   || meta['_wcfmmp_profile_logo']   || null;
        const bannerId = profile['banner'] || meta['_wcfmmp_profile_banner'] || null;
        const [logo_url, banner_url] = await Promise.all([
          logoId   ? resolveAttachmentUrl(logoId)   : Promise.resolve(null),
          bannerId ? resolveAttachmentUrl(bannerId)  : Promise.resolve(null),
        ]);

        const update = {};
        if (phone)       update.phone       = phone;
        if (address)     update.address     = address;
        if (city)        update.city        = city;
        if (state)       update.state       = state;
        if (description) update.description = description.replace(/<[^>]*>/g, '').trim() || null;
        if (logo_url)    update.logo_url    = logo_url;
        if (banner_url)  update.banner_url  = banner_url;

        if (Object.keys(update).length === 0) {
          return { wpId, store: vendor.store_name, status: 'no_data' };
        }

        const { error: upErr } = await adminClient
          .from('vendors')
          .update(update)
          .eq('id', vendor.id);

        return {
          wpId,
          store: vendor.store_name,
          status: upErr ? 'error' : 'updated',
          fields: Object.keys(update),
          error: upErr?.message,
        };
      } catch (e) {
        return { wpId, store: vendor.store_name, status: 'error', error: e.message };
      }
    })
  ).then(r => r.filter(Boolean));

  const updated  = results.filter(r => r.status === 'updated').length;
  const skipped  = results.filter(r => r.status === 'skip' || r.status === 'no_data').length;
  const errored  = results.filter(r => r.status === 'error').length;

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, updated, skipped, errored, results }),
  };
};
