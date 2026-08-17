/**
 * Smoke test for JulineMart Gifts admin + public APIs (local Netlify dev).
 * Run: node scripts/smoke-test-gifts.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.JLO_TEST_BASE || 'http://localhost:8888/.netlify/functions';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { res, json, text };
}

async function getAdminToken() {
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return null;
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: users, error: userErr } = await admin
    .from('users')
    .select('id, email, role')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1);
  if (userErr || !users?.length) return null;

  const userId = users[0].id;
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: users[0].email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) return null;

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({
      type: 'magiclink',
      token_hash: linkData.properties.hashed_token,
    }),
  });
  const verifyJson = await verifyRes.json();
  if (!verifyRes.ok || !verifyJson.access_token) {
    fail('admin token', `Could not verify magic link for ${users[0].email}`);
    return null;
  }
  pass('admin token', `Authenticated as ${users[0].email} (${userId.slice(0, 8)}…)`);
  return verifyJson.access_token;
}

async function main() {
  console.log(`\nGifts smoke test → ${BASE}\n`);

  // --- Public endpoints ---
  {
    const { res, json } = await fetchJson('/gift-pool-products?gfc=warri');
    if (res.status === 200 && json.success && json.data?.fulfilment_centre?.code === 'warri') {
      pass('GET gift-pool-products', `hub=${json.data.fulfilment_centre.name}, count=${json.data.count}`);
    } else {
      fail('GET gift-pool-products', `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
    }
  }

  {
    const { res, json } = await fetchJson('/gift-boxes?gfc=warri');
    if (res.status === 200 && json.success && Array.isArray(json.data)) {
      pass('GET gift-boxes', `${json.data.length} box(es)`);
    } else {
      fail('GET gift-boxes', `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
    }
  }

  {
    const { res, json } = await fetchJson('/gift-builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', gfc_code: 'warri' }),
    });
    if ((res.status === 200 || res.status === 201) && json.success && (json.data?.session_token || json.data?.session?.session_token)) {
      const tok = json.data.session_token || json.data.session.session_token;
      pass('POST gift-builder create', `session=${String(tok).slice(0, 12)}…`);
    } else {
      fail('POST gift-builder create', `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
    }
  }

  // --- Admin auth gate ---
  {
    const { res, json } = await fetchJson('/admin-gift-fulfilment-centres');
    if (res.status === 401 && json.error === 'unauthorized') {
      pass('admin-gift-fulfilment-centres rejects unauthenticated');
    } else {
      fail('admin-gift-fulfilment-centres auth gate', `HTTP ${res.status}`);
    }
  }

  const token = await getAdminToken();

  if (!token) {
    fail('admin API suite', 'Skipped — could not obtain admin session (check Supabase env)');
  } else {
    const auth = { Authorization: `Bearer ${token}` };
    const warriId = '2245c066-7bb8-44d0-a167-5f8278d5103d';

    {
      const { res, json } = await fetchJson('/admin-gift-fulfilment-centres', { headers: auth });
      if (res.status === 200 && json.success && Array.isArray(json.data) && json.data.some((h) => h.code === 'warri')) {
        pass('GET admin-gift-fulfilment-centres', `${json.data.length} hub(s)`);
      } else {
        fail('GET admin-gift-fulfilment-centres', `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
      }
    }

    {
      const { res, json } = await fetchJson(`/admin-gift-pool?gfc_id=${warriId}`, { headers: auth });
      if (res.status === 200 && json.success && Array.isArray(json.data)) {
        pass('GET admin-gift-pool', `${json.data.length} pool row(s)`);
      } else {
        fail('GET admin-gift-pool', `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
      }
    }

    {
      const { res, json } = await fetchJson(`/admin-gift-boxes?gfc_id=${warriId}`, { headers: auth });
      if (res.status === 200 && json.success && Array.isArray(json.data)) {
        pass('GET admin-gift-boxes', `${json.data.length} box(es)`);
      } else {
        fail('GET admin-gift-boxes', `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
      }
    }

    for (const tab of ['new', 'packing', 'dispatch', 'done']) {
      const { res, json } = await fetchJson(
        `/admin-gift-ops?tab=${tab}&gfc_id=${warriId}`,
        { headers: auth },
      );
      if (res.status === 200 && json.success && Array.isArray(json.data)) {
        pass(`GET admin-gift-ops tab=${tab}`, `${json.data.length} order(s)`);
      } else {
        fail(`GET admin-gift-ops tab=${tab}`, `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
      }
    }

    // Round-trip: create + deactivate test hub (validates POST/PUT/PATCH used by mobile UI)
    const testCode = `test-${Date.now().toString(36)}`;
    let testHubId = null;
    {
      const { res, json } = await fetchJson('/admin-gift-fulfilment-centres', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Smoke Test Hub',
          code: testCode,
          state: 'Delta',
          city: 'Warri',
          address: 'Test address',
          is_default: false,
          active: true,
        }),
      });
      if ((res.status === 200 || res.status === 201) && json.success && json.data?.id) {
        testHubId = json.data.id;
        pass('POST admin-gift-fulfilment-centres', `id=${testHubId.slice(0, 8)}…`);
      } else {
        fail('POST admin-gift-fulfilment-centres', `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
      }
    }

    if (testHubId) {
      {
        const slug = `smoke-box-${Date.now().toString(36)}`;
        const { res, json } = await fetchJson('/admin-gift-boxes', {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Smoke Test Box',
            slug,
            description: 'Automated smoke test',
            list_price: 15000,
            sort_order: 0,
            active: true,
            gift_fulfilment_centre_id: warriId,
          }),
        });
        if ((res.status === 200 || res.status === 201) && json.success && json.data?.id) {
          pass('POST admin-gift-boxes', `id=${json.data.id.slice(0, 8)}…`);
          const boxId = json.data.id;
          const detail = await fetchJson(`/admin-gift-boxes?id=${boxId}`, { headers: auth });
          if (detail.res.status === 200 && detail.json.success) {
            pass('GET admin-gift-boxes?id=');
          } else {
            fail('GET admin-gift-boxes?id=', `HTTP ${detail.res.status}`);
          }
        } else {
          fail('POST admin-gift-boxes', `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
        }
      }

      {
        const { res, json } = await fetchJson(`/admin-gift-fulfilment-centres?id=${testHubId}`, {
          method: 'PUT',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Smoke Test Hub Updated',
            code: testCode,
            state: 'Delta',
            city: 'Warri',
            address: 'Updated',
            is_default: false,
            active: true,
          }),
        });
        if (res.status === 200 && json.success) {
          pass('PUT admin-gift-fulfilment-centres');
        } else {
          fail('PUT admin-gift-fulfilment-centres', `HTTP ${res.status}`);
        }
      }

      {
        const { res, json } = await fetchJson(`/admin-gift-fulfilment-centres?id=${testHubId}`, {
          method: 'PATCH',
          headers: auth,
        });
        if (res.status === 200 && json.success) {
          pass('PATCH admin-gift-fulfilment-centres deactivate');
        } else {
          fail('PATCH admin-gift-fulfilment-centres', `HTTP ${res.status}`);
        }
      }
    }
  }

  // --- DB sanity via service role ---
  if (SUPABASE_URL && SERVICE_KEY) {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const checks = [
      ['gift_fulfilment_centres', 'Warri hub seeded'],
      ['gift_pool_inventory', 'pool table readable'],
      ['gift_boxes', 'boxes table readable'],
      ['gift_orders', 'gift orders table readable'],
      ['gift_packaging_types', 'packaging types seeded'],
    ];
    for (const [table, label] of checks) {
      const { error, count } = await db.from(table).select('*', { count: 'exact', head: true });
      if (!error) pass(`DB ${label}`, `${count ?? 0} row(s) in ${table}`);
      else fail(`DB ${label}`, error.message);
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
