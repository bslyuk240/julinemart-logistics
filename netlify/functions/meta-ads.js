// Netlify Function: /api/meta/*
// Handles all Meta Ads module routes
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL   = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const META_API_BASE  = 'https://graph.facebook.com/v19.0';
const AD_ACCOUNT_ID  = process.env.META_AD_ACCOUNT_ID || '';
const ACCESS_TOKEN   = process.env.META_ADS_ACCESS_TOKEN || '';
const META_PAGE_ID   = process.env.META_PAGE_ID || '';
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || '';
const STORE_URL      = process.env.STORE_URL || 'https://julinemart.com';

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

// ── Meta API helpers ─────────────────────────────────────────────────────────

async function metaGet(path, params = {}) {
  const url = new URL(`${META_API_BASE}/${path}`);
  url.searchParams.set('access_token', ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res  = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message || `Meta API error on ${path}`);
  return json;
}

async function metaPost(path, payload) {
  const url = new URL(`${META_API_BASE}/${path}`);
  url.searchParams.set('access_token', ACCESS_TOKEN);
  const res  = await fetch(url.toString(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
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
    ? products.map((p) => {
        const price = p.price ? `₦${Number(p.price).toLocaleString()}` : '';
        const desc  = p.description ? ` — ${p.description.slice(0, 120)}` : '';
        return `- ${p.name}${price ? ` (${price})` : ''}${desc}`;
      }).join('\n')
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
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody?.error?.message || `Anthropic API error: ${res.status}`;
    console.error('Anthropic error:', JSON.stringify(errBody));
    return err(msg, 500);
  }
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
    // Pull from catalog with descriptions and thumbnail images
    supabase
      .from('products')
      .select('id, name, short_description, description, regular_price, sale_price, product_images!inner(src, is_thumbnail)')
      .eq('status', 'published')
      .eq('product_images.is_thumbnail', true)
      .limit(50),
    supabase.from('orders').select('delivery_state').not('delivery_state', 'is', null).limit(500),
    supabase.from('campaign_vouchers').select('code, discount_value, discount_type').eq('is_active', true).limit(5),
  ]);

  const top_products = (productsRes.data || []).map((p) => ({
    id:          p.id,
    name:        p.name,
    price:       Number(p.sale_price || p.regular_price || 0),
    description: p.short_description || p.description || '',
    image_url:   p.product_images?.[0]?.src || null,
    category:    'general',
  }));

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

// ── Products with thumbnail images (used by image picker) ────────────────────

async function getProductsWithImages() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, product_images!inner(src, alt, is_thumbnail)')
    .eq('status', 'published')
    .eq('product_images.is_thumbnail', true)
    .limit(50);
  if (error) throw error;
  const flat = (data || []).map((p) => ({
    product_id: p.id,
    name:       p.name,
    src:        p.product_images?.[0]?.src || '',
    alt:        p.product_images?.[0]?.alt || p.name,
  })).filter((p) => p.src);
  return ok(flat);
}

// ── Catalog product search (for product selector combobox) ───────────────────

async function searchCatalogProducts(search) {
  let q = supabase
    .from('products')
    .select('id, name, short_description, regular_price, sale_price, product_images(src, is_thumbnail)')
    .eq('status', 'published')
    .order('name', { ascending: true })
    .limit(200);

  if (search && search.trim().length > 0) {
    q = q.ilike('name', `%${search.trim()}%`);
  }

  const { data, error } = await q;
  if (error) throw error;

  const products = (data || []).map((p) => {
    const thumb = (p.product_images || []).find((img) => img.is_thumbnail) || p.product_images?.[0];
    return {
      id:          p.id,
      name:        p.name,
      description: p.short_description || '',
      price:       Number(p.sale_price || p.regular_price || 0),
      image_url:   thumb?.src || null,
      category:    'general',
    };
  });

  return ok(products);
}

// ── Image upload to Supabase Storage ─────────────────────────────────────────

const ALLOWED_IMG_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function extFromType(ct) {
  if (ct === 'image/png') return 'png';
  if (ct === 'image/webp') return 'webp';
  return 'jpg';
}

function ensurePublicUrl(url) {
  if (!url) return '';
  if (url.includes('/storage/v1/object/public/')) return url;
  return url.replace(/(\/storage\/v1\/object\/)(?!public\/)([^/]+)\//, '$1public/$2/');
}

async function uploadAdImage(body) {
  const { file_base64, content_type } = body;
  if (!file_base64) return err('file_base64 is required', 400);

  const ct = ALLOWED_IMG_TYPES.has(content_type) ? content_type : 'image/jpeg';
  let buffer;
  try { buffer = Buffer.from(String(file_base64), 'base64'); }
  catch { return err('Invalid base64 payload', 400); }

  if (buffer.length > 4 * 1024 * 1024) return err('Image must be 4 MB or smaller', 400);
  if (buffer.length < 16) return err('File too small', 400);

  const path = `meta-ads/${Date.now()}_${Math.random().toString(36).slice(2)}.${extFromType(ct)}`;
  const { data, error } = await supabase.storage.from('vendor-documents').upload(path, buffer, {
    contentType: ct, upsert: false,
  });
  if (error) throw error;

  const { data: pub } = supabase.storage.from('vendor-documents').getPublicUrl(data.path);
  return ok({ url: ensurePublicUrl(pub.publicUrl) });
}

// ── Campaign status toggle (pause / resume via Meta API) ─────────────────────

async function updateCampaignStatus(campaignId, status, userId) {
  if (!['ACTIVE', 'PAUSED'].includes(status)) return err('status must be ACTIVE or PAUSED', 400);

  const url = new URL(`${META_API_BASE}/${campaignId}`);
  url.searchParams.set('access_token', ACCESS_TOKEN);

  const res  = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message || 'Meta API error');

  // Update cache
  await supabase
    .from('meta_campaigns_cache')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('meta_campaign_id', campaignId);

  await logAction(userId, status === 'PAUSED' ? 'pause_campaign' : 'resume_campaign', 'campaign', campaignId);
  return ok({ campaign_id: campaignId, status });
}

// ── Publish approved draft → Meta Ad ─────────────────────────────────────────
// Flow: Ad Creative → Ad Set (under chosen campaign) → Ad

async function publishDraft(draftId, body, userId) {
  if (!META_PAGE_ID) return err('META_PAGE_ID env var is not configured', 500);
  if (!AD_ACCOUNT_ID) return err('META_AD_ACCOUNT_ID env var is not configured', 500);

  const { campaign_id, new_campaign_name, daily_budget } = body;
  if (!campaign_id && !new_campaign_name) return err('campaign_id or new_campaign_name is required', 400);
  if (!daily_budget || Number(daily_budget) < 1) return err('daily_budget (₦) is required', 400);

  // Load draft
  const { data: draft, error: draftErr } = await supabase
    .from('meta_ad_drafts')
    .select('*')
    .eq('id', draftId)
    .single();
  if (draftErr || !draft) return err('Draft not found', 404);
  if (draft.status !== 'approved') return err('Only approved drafts can be published', 400);

  const destinationUrl = draft.destination_url || STORE_URL;
  const budgetCents    = Math.round(Number(daily_budget) * 100); // Meta expects cents

  // 0. Create campaign if not provided
  let resolvedCampaignId = campaign_id;
  if (!resolvedCampaignId) {
    const newCampaign = await metaPost(`${AD_ACCOUNT_ID}/campaigns`, {
      name:      new_campaign_name,
      objective: 'OUTCOME_TRAFFIC',
      status:    'PAUSED',
      special_ad_categories: [],
    });
    resolvedCampaignId = newCampaign.id;
  }

  // 1. Create Ad Creative
  const creativePayload = {
    name: draft.title,
    object_story_spec: {
      page_id: META_PAGE_ID,
      link_data: {
        message:     draft.body_text,
        link:        destinationUrl,
        name:        draft.headline || draft.title,
        call_to_action: { type: draft.call_to_action || 'SHOP_NOW', value: { link: destinationUrl } },
        ...(draft.image_url ? { picture: draft.image_url } : {}),
      },
    },
  };
  const creative = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, creativePayload);

  // 2. Create Ad Set under the campaign
  const adSetPayload = {
    name:              `${draft.title} — Ad Set`,
    campaign_id:       resolvedCampaignId,
    daily_budget:      budgetCents,
    billing_event:     'IMPRESSIONS',
    optimization_goal: 'REACH',
    bid_strategy:      'LOWEST_COST_WITHOUT_CAP',
    targeting:         { geo_locations: { countries: ['NG'] } },
    status:            'PAUSED',
    start_time:        new Date().toISOString(),
  };
  const adSet = await metaPost(`${AD_ACCOUNT_ID}/adsets`, adSetPayload);

  // 3. Create Ad
  const adPayload = {
    name:       draft.title,
    adset_id:   adSet.id,
    creative:   { creative_id: creative.id },
    status:     'PAUSED',
  };
  const ad = await metaPost(`${AD_ACCOUNT_ID}/ads`, adPayload);

  // 4. Mark draft published
  await supabase
    .from('meta_ad_drafts')
    .update({
      status:            'published',
      meta_creative_id:  creative.id,
      meta_ad_id:        ad.id,
      meta_adset_id:     adSet.id,
      published_at:      new Date().toISOString(),
    })
    .eq('id', draftId);

  await logAction(userId, 'publish_draft', 'draft', draftId, {
    campaign_id: resolvedCampaignId, creative_id: creative.id, ad_id: ad.id, adset_id: adSet.id,
  });

  return ok({ creative_id: creative.id, adset_id: adSet.id, ad_id: ad.id });
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

    // POST /api/meta/drafts/:id/publish
    const publishMatch = path.match(/^drafts\/([^/]+)\/publish$/);
    if (publishMatch && method === 'POST') return await publishDraft(publishMatch[1], body, userId);

    // POST /api/meta/ai/generate
    if (path === 'ai/generate' && method === 'POST') return await generateContent(body, userId);

    // GET /api/meta/recommendations
    if (path === 'recommendations' && method === 'GET') return await getRecommendations();

    // GET /api/meta/context
    if (path === 'context' && method === 'GET') return await getAdsContext();

    // GET /api/meta/products-images
    if (path === 'products-images' && method === 'GET') return await getProductsWithImages();

    // GET /api/meta/catalog-products?search=xxx
    if (path === 'catalog-products' && method === 'GET') return await searchCatalogProducts(qs.search);

    // POST /api/meta/upload-image
    if (path === 'upload-image' && method === 'POST') return await uploadAdImage(body);

    // PUT /api/meta/campaigns/:id/status
    const campaignStatusMatch = path.match(/^campaigns\/([^/]+)\/status$/);
    if (campaignStatusMatch && method === 'PUT') return await updateCampaignStatus(campaignStatusMatch[1], body.status, userId);

    return err(`Unknown route: ${method} /api/meta/${path}`, 404);
  } catch (e) {
    console.error('meta-ads function error:', e);
    return err(e.message || 'Internal error', 500);
  }
}
