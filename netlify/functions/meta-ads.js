// Netlify Function: /api/meta/*
// Handles all Meta Ads module routes
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const META_API_BASE = 'https://graph.facebook.com/v19.0';
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '';
const ACCESS_TOKEN  = process.env.META_ADS_ACCESS_TOKEN || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

const ok  = (data)        => ({ statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, data }) });
const created = (data)    => ({ statusCode: 201, headers: CORS, body: JSON.stringify({ success: true, data }) });
const err = (msg, code=500) => ({ statusCode: code, headers: CORS, body: JSON.stringify({ success: false, error: msg }) });

// ── Meta API helper ──────────────────────────────────────────────────────────

async function metaGet(path, params = {}) {
  const url = new URL(`${META_API_BASE}/${path}`);
  url.searchParams.set('access_token', ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res  = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message || `Meta API error on ${path}`);
  return json;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function getCampaigns() {
  const { data, error } = await supabase
    .from('meta_campaigns_cache')
    .select('*')
    .order('synced_at', { ascending: false });
  if (error) throw error;
  return ok(data || []);
}

async function syncCampaigns(userId) {
  const fields = 'id,name,status,objective,daily_budget,lifetime_budget,spend_cap,start_time,stop_time';
  const data   = await metaGet(`${AD_ACCOUNT_ID}/campaigns`, { fields, limit: '100' });
  const campaigns = data.data || [];

  const insightMap = {};
  if (campaigns.length > 0) {
    try {
      const insights = await metaGet(`${AD_ACCOUNT_ID}/insights`, {
        fields: 'campaign_id,impressions,reach,clicks,spend,ctr,cpc,cpm',
        level: 'campaign', date_preset: 'last_30d', limit: '100',
      });
      for (const row of insights.data || []) insightMap[row.campaign_id] = row;
    } catch { /* insights optional */ }
  }

  const rows = campaigns.map((c) => {
    const ins = insightMap[c.id] || {};
    return {
      meta_campaign_id: c.id,
      name: c.name, status: c.status, objective: c.objective || null,
      daily_budget:    c.daily_budget    ? Number(c.daily_budget)    / 100 : null,
      lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
      spend_cap:       c.spend_cap       ? Number(c.spend_cap)       / 100 : null,
      start_time: c.start_time || null, stop_time: c.stop_time || null,
      impressions: Number(ins.impressions || 0), reach: Number(ins.reach || 0),
      clicks: Number(ins.clicks || 0),  spend: Number(ins.spend  || 0),
      ctr: Number(ins.ctr || 0), cpc: Number(ins.cpc || 0), cpm: Number(ins.cpm || 0),
      ad_account_id: AD_ACCOUNT_ID,
      synced_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from('meta_campaigns_cache')
      .upsert(rows, { onConflict: 'meta_campaign_id' });
    if (error) throw error;
  }

  await logAction(userId, 'sync_campaigns', 'campaign', null, { count: rows.length });
  return ok({ synced: rows.length });
}

async function getDrafts(status) {
  let q = supabase
    .from('meta_ad_drafts')
    .select('*, users!meta_ad_drafts_created_by_fkey(full_name, email)')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return ok(data || []);
}

async function createDraft(body, userId) {
  const { title, headline, body_text, call_to_action, image_url, destination_url,
          source_products, source_context, target_audience, suggested_budget, ai_generated } = body;
  if (!title || !body_text) return err('title and body_text are required', 400);

  const { data, error } = await supabase
    .from('meta_ad_drafts')
    .insert({
      title, headline, body_text,
      call_to_action: call_to_action || 'SHOP_NOW',
      image_url, destination_url, source_products, source_context,
      target_audience, suggested_budget,
      ai_generated: ai_generated || false,
      created_by: userId || null,
      status: 'draft',
    })
    .select()
    .single();
  if (error) throw error;
  await logAction(userId, 'create_draft', 'draft', data.id, { title });
  return created(data);
}

async function approveDraft(id, userId) {
  const { data, error } = await supabase
    .from('meta_ad_drafts')
    .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw error;
  await logAction(userId, 'approve_draft', 'draft', id, { title: data.title });
  return ok(data);
}

async function rejectDraft(id, userId, note) {
  const { data, error } = await supabase
    .from('meta_ad_drafts')
    .update({ status: 'rejected', approved_by: userId, rejection_note: note || '' })
    .eq('id', id).select().single();
  if (error) throw error;
  await logAction(userId, 'reject_draft', 'draft', id, { note });
  return ok(data);
}

async function generateContent(body, userId) {
  if (!ANTHROPIC_KEY) return err('ANTHROPIC_API_KEY not configured', 500);

  const { products = [], promo_code, top_region, objective = 'sales', tone = 'engaging', count = 3 } = body;
  const productList = products.length
    ? products.map((p) => `- ${p.name} (₦${Number(p.price).toLocaleString()}, ${p.category})`).join('\n')
    : 'JulineMart products';

  const prompt = `You are a creative Nigerian e-commerce ad copywriter for JulineMart, an online marketplace.

Generate ${count} Facebook/Instagram ad variations for the following:

Products:
${productList}
${top_region  ? `\nTop buying region: ${top_region}` : ''}
${promo_code  ? `\nPromo code: ${promo_code}` : ''}
Objective: ${objective}
Tone: ${tone}

For each variation, return JSON with:
- headline (max 40 chars)
- body_text (max 125 chars, compelling, includes product/price/CTA)
- call_to_action (one of: SHOP_NOW, LEARN_MORE, ORDER_NOW, GET_OFFER)

Return a JSON array only, no extra text.`;

  const res  = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) return err(`Anthropic API error: ${res.status}`, 500);
  const json  = await res.json();
  const text  = json.content?.[0]?.text || '[]';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return err('AI returned unexpected format', 500);

  const variations = JSON.parse(match[0]);
  await logAction(userId, 'generate_content', null, null, { count: variations.length });
  return ok(variations);
}

async function getRecommendations() {
  const { data, error } = await supabase
    .from('meta_ai_recommendations')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ok(data || []);
}

async function getAdsContext() {
  const [productsRes, regionRes, promosRes] = await Promise.all([
    supabase.from('order_items').select('product_name, unit_price').limit(200),
    supabase.from('orders').select('delivery_state').not('delivery_state', 'is', null).limit(500),
    supabase.from('campaign_vouchers').select('code, discount_value, discount_type').eq('is_active', true).limit(5),
  ]);

  const productCount = {};
  for (const item of productsRes.data || []) {
    const key = item.product_name || 'Unknown';
    if (!productCount[key]) productCount[key] = { name: key, price: Number(item.unit_price || 0), count: 0 };
    productCount[key].count++;
  }
  const top_products = Object.values(productCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(({ name, price }) => ({ name, price, category: 'general' }));

  const regionCount = {};
  for (const o of regionRes.data || []) {
    const s = o.delivery_state || 'Unknown';
    regionCount[s] = (regionCount[s] || 0) + 1;
  }
  const top_region = Object.entries(regionCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const active_promos = (promosRes.data || []).map((v) => ({
    code: v.code, value: v.discount_value, type: v.discount_type,
  }));

  return ok({ top_products, top_region, active_promos });
}

async function logAction(userId, action, resource, resourceId, details, status = 'success', errorMsg) {
  await supabase.from('meta_action_logs').insert({
    user_id: userId || null, action,
    resource: resource || null, resource_id: resourceId || null,
    details: details || null, status, error_msg: errorMsg || null,
  });
}

// ── Auth helper ──────────────────────────────────────────────────────────────

async function getUserId(event) {
  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  return data?.user?.id || null;
}

// ── Router ───────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const path   = (event.path || '').replace(/^\/api\/meta\/?/, '').replace(/\/$/, '');
  const method = event.httpMethod;
  const body   = event.body ? JSON.parse(event.body) : {};
  const qs     = event.queryStringParameters || {};
  const userId = await getUserId(event);

  try {
    // GET /api/meta/campaigns
    if (path === 'campaigns' && method === 'GET') return await getCampaigns();

    // POST /api/meta/campaigns/sync
    if (path === 'campaigns/sync' && method === 'POST') return await syncCampaigns(userId);

    // GET /api/meta/drafts
    if (path === 'drafts' && method === 'GET') return await getDrafts(qs.status);

    // POST /api/meta/drafts
    if (path === 'drafts' && method === 'POST') return await createDraft(body, userId);

    // PUT /api/meta/drafts/:id/approve
    const approveMatch = path.match(/^drafts\/([^/]+)\/approve$/);
    if (approveMatch && method === 'PUT') return await approveDraft(approveMatch[1], userId);

    // PUT /api/meta/drafts/:id/reject
    const rejectMatch = path.match(/^drafts\/([^/]+)\/reject$/);
    if (rejectMatch && method === 'PUT') return await rejectDraft(rejectMatch[1], userId, body.note);

    // POST /api/meta/ai/generate
    if (path === 'ai/generate' && method === 'POST') return await generateContent(body, userId);

    // GET /api/meta/recommendations
    if (path === 'recommendations' && method === 'GET') return await getRecommendations();

    // GET /api/meta/context
    if (path === 'context' && method === 'GET') return await getAdsContext();

    return err(`Unknown route: ${method} /api/meta/${path}`, 404);
  } catch (e) {
    console.error('meta-ads function error:', e);
    return err(e.message || 'Internal error', 500);
  }
}
