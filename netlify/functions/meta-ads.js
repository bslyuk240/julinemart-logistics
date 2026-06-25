// Netlify Function: /api/meta/*
// Handles all Meta Ads module routes
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL   = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const META_API_BASE  = 'https://graph.facebook.com/v21.0';
const AD_ACCOUNT_ID  = process.env.META_AD_ACCOUNT_ID || '';
const ACCESS_TOKEN   = process.env.META_ADS_ACCESS_TOKEN || '';
const META_PAGE_ID   = process.env.META_PAGE_ID || '';
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || '';
const STORE_URL      = process.env.STORE_URL || 'https://julinemart.com';

/** Meta floors vary by optimisation (often ~₦1.4k–₦3.5k/day); publishing below this wastes API calls */
const META_MIN_DAILY_BUDGET_NGN = Number(process.env.META_MIN_DAILY_BUDGET_NGN) || 4000;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

function metaErrMsg(err, fallback) {
  if (!err) return fallback;
  const parts = [err.message, err.error_user_msg].filter(Boolean);

  const sc = Number(err.error_subcode);
  // No payment method on the ad account (final /ads step commonly fails here first)
  if (sc === 1359188) {
    const headline = parts.length ? parts.join(' — ') : fallback;
    return `${headline} Open Meta Ads Manager → Billing & payments → Payment settings and add a valid payment method for this ad account.`;
  }

  return parts.length ? parts.join(' — ') : fallback;
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
  if (!res.ok || json.error) {
    console.error('[metaPost]', path, 'payload_keys:', Object.keys(payload), 'meta_error:', JSON.stringify(json.error));
    throw new Error(metaErrMsg(json.error, `Meta API error on ${path}`));
  }
  return json;
}

/**
 * Download image from a URL and upload it to Meta's ad images endpoint.
 * Returns the image_hash Meta assigns to it, which can be used in ad creatives
 * without Meta having to crawl the original URL.
 */
async function uploadImageToMeta(imageUrl) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Could not fetch image: ${imgRes.status} ${imageUrl}`);

  const buffer     = await imgRes.arrayBuffer();
  const mimeType   = imgRes.headers.get('content-type') || 'image/jpeg';
  const ext        = mimeType.split('/')[1]?.split(';')[0] || 'jpg';
  const filename   = `ad_image.${ext}`;

  const form = new FormData();
  form.append('access_token', ACCESS_TOKEN);
  form.append('filename', new Blob([buffer], { type: mimeType }), filename);

  const url = new URL(`${META_API_BASE}/${AD_ACCOUNT_ID}/adimages`);
  const res  = await fetch(url.toString(), { method: 'POST', body: form });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message || 'Failed to upload image to Meta');

  // Response shape: { images: { <filename>: { hash, url, ... } } }
  const images = json.images || {};
  const entry  = Object.values(images)[0];
  if (!entry?.hash) throw new Error('Meta did not return an image hash after upload');
  return entry.hash;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function getCampaigns() {
  let q = supabase.from('meta_campaigns_cache').select('*');
  if (AD_ACCOUNT_ID) q = q.eq('ad_account_id', AD_ACCOUNT_ID);
  const { data, error } = await q.order('synced_at', { ascending: false });
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

  // Replace cache for this ad account so Meta-deleted campaigns disappear locally
  const { error: delErr } = await supabase
    .from('meta_campaigns_cache')
    .delete()
    .eq('ad_account_id', AD_ACCOUNT_ID);
  if (delErr) throw delErr;

  if (rows.length > 0) {
    const { error } = await supabase
      .from('meta_campaigns_cache')
      .insert(rows);
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
          source_products, source_context, target_audience, suggested_budget,
          ai_generated, ad_format, meta_video_id } = body;
  if (!title || !body_text) return err('title and body_text are required', 400);

  const { data, error } = await supabase
    .from('meta_ad_drafts')
    .insert({
      title, headline, body_text,
      call_to_action: call_to_action || 'SHOP_NOW',
      image_url, destination_url, source_products, source_context,
      target_audience, suggested_budget,
      ai_generated: ai_generated || false,
      ad_format: ad_format || 'image',
      meta_video_id: meta_video_id || null,
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

async function deleteDraft(id, userId) {
  const { data: row, error: fetchErr } = await supabase
    .from('meta_ad_drafts')
    .select('id, title')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) return err('Draft not found', 404);
  const { error } = await supabase.from('meta_ad_drafts').delete().eq('id', id);
  if (error) throw error;
  await logAction(userId, 'delete_draft', 'draft', id, { title: row.title });
  return ok({ id: row.id });
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
    .select('id, name, slug, short_description, regular_price, sale_price, product_images(src, is_thumbnail)')
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
      product_url: p.slug ? `${STORE_URL}/product/${p.slug}` : null,
    };
  });

  return ok(products);
}

async function updateDraft(draftId, body, userId) {
  const { destination_url, ad_format, meta_video_id } = body;
  if (!draftId) return err('Draft ID required', 400);

  const { data: draft } = await supabase.from('meta_ad_drafts').select('status').eq('id', draftId).single();
  if (!draft) return err('Draft not found', 404);
  if (draft.status === 'published') return err('Cannot edit a published draft', 400);

  const updates = {};
  if (destination_url !== undefined) updates.destination_url = destination_url || null;
  if (ad_format !== undefined) updates.ad_format = ad_format;
  if (meta_video_id !== undefined) updates.meta_video_id = meta_video_id || null;

  const { error } = await supabase.from('meta_ad_drafts').update(updates).eq('id', draftId);
  if (error) throw error;

  return ok({ updated: true });
}

// ── AI writing assistant (brief → headline + body suggestions) ────────────────

async function aiAssist(body) {
  if (!ANTHROPIC_KEY) return err('ANTHROPIC_API_KEY not configured', 500);

  const { brief, tone = 'engaging', cta = 'SHOP_NOW' } = body;
  if (!brief || !brief.trim()) return err('brief is required', 400);

  const ctaLabel = {
    SHOP_NOW: 'Shop Now', LEARN_MORE: 'Learn More', SIGN_UP: 'Sign Up',
    CONTACT_US: 'Contact Us', BOOK_NOW: 'Book Now', GET_OFFER: 'Get Offer',
    SUBSCRIBE: 'Subscribe', WATCH_MORE: 'Watch More',
  }[cta] || 'Shop Now';

  const prompt = `You are a creative Nigerian social media ad copywriter for JulineMart.

Brief from the marketing team: "${brief.trim()}"
Tone: ${tone}
Call to action button: ${ctaLabel}

Write 3 variations of ad copy. Each variation must have:
1. A punchy headline (max 40 characters)
2. Body text (max 120 characters, engaging, relevant to Nigerian audience)

Respond with ONLY a JSON array, no explanation:
[
  { "headline": "...", "body_text": "..." },
  { "headline": "...", "body_text": "..." },
  { "headline": "...", "body_text": "..." }
]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  try {
    const match = text.match(/\[[\s\S]*\]/);
    const suggestions = JSON.parse(match[0]);
    return ok(suggestions);
  } catch {
    return err('AI returned unexpected format — try again', 500);
  }
}

// ── Upload video to Meta (/advideos) ─────────────────────────────────────────

async function uploadVideoToMeta(body) {
  const { video_url, file_base64, content_type, title } = body;
  if (!video_url && !file_base64) return err('video_url or file_base64 is required', 400);
  if (!content_type) return err('content_type is required', 400);
  if (!AD_ACCOUNT_ID) return err('META_AD_ACCOUNT_ID not configured', 500);
  if (!ACCESS_TOKEN)  return err('META_ADS_ACCESS_TOKEN not configured', 500);

  let buffer;

  if (video_url) {
    // Preferred path: fetch video from Supabase Storage URL (avoids Netlify's 6 MB body limit)
    let storageRes;
    try {
      storageRes = await fetch(video_url);
    } catch (e) {
      throw new Error(`Failed to fetch video from storage: ${e.message}`);
    }
    if (!storageRes.ok) throw new Error(`Could not download video from storage (HTTP ${storageRes.status})`);
    buffer = Buffer.from(await storageRes.arrayBuffer());
  } else {
    // Legacy base64 path (kept for backwards compatibility)
    const approxBytes = Math.ceil((file_base64.length * 3) / 4);
    if (approxBytes > 50 * 1024 * 1024) {
      return err('Video file is too large — upload via storage URL instead', 413);
    }
    try {
      buffer = Buffer.from(file_base64, 'base64');
    } catch (e) {
      return err(`Invalid base64 payload: ${e.message}`, 400);
    }
  }

  const ext      = content_type.split('/')[1]?.split(';')[0] || 'mp4';
  const filename = `ad_video_${Date.now()}.${ext}`;

  const form = new FormData();
  form.append('access_token', ACCESS_TOKEN);
  form.append('title', title || filename);
  form.append('source', new Blob([buffer], { type: content_type }), filename);

  const apiVersion = META_API_BASE.split('/').pop();
  const url = `https://graph-video.facebook.com/${apiVersion}/${AD_ACCOUNT_ID}/advideos`;

  let res, rawText;
  try {
    res     = await fetch(url, { method: 'POST', body: form });
    rawText = await res.text();
  } catch (fetchErr) {
    throw new Error(`Network error reaching Meta video API: ${fetchErr.message}`);
  }

  let json = {};
  try { json = JSON.parse(rawText); } catch { /* rawText may not be JSON */ }

  if (!res.ok || json.error) {
    // HEVC/H.265 codec — common on iPhone (records HEVC by default)
    if (json.error?.code === 352 || json.error?.error_subcode === 1363024) {
      throw new Error(
        'Video format not supported by Meta. Your video is likely encoded in HEVC/H.265 (common on iPhone). ' +
        'Fix: on iPhone go to Settings → Camera → Formats → Most Compatible, then re-record. ' +
        'Or convert the video to MP4 (H.264) using a converter app before uploading.'
      );
    }
    const code    = json.error?.code    ? `(#${json.error.code}) ` : '';
    const subcode = json.error?.error_subcode ? ` [subcode ${json.error.error_subcode}]` : '';
    const detail  = json.error?.message || rawText || `HTTP ${res.status}`;
    throw new Error(`Meta video upload failed: ${code}${detail}${subcode}`);
  }

  if (!json.id) throw new Error(`Meta did not return a video ID. Response: ${rawText}`);
  return ok({ video_id: json.id });
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

// ── Campaign budget update ────────────────────────────────────────────────────

async function updateCampaignBudget(campaignId, dailyBudgetNgn, userId) {
  const ngn = Number(dailyBudgetNgn);
  if (!ngn || ngn < META_MIN_DAILY_BUDGET_NGN)
    return err(`Budget must be at least ₦${META_MIN_DAILY_BUDGET_NGN.toLocaleString()}`, 400);

  const budgetCents = Math.round(ngn * 100); // Meta stores in currency subunits (kobo for NGN)

  const url = new URL(`${META_API_BASE}/${campaignId}`);
  url.searchParams.set('access_token', ACCESS_TOKEN);
  const res  = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_budget: budgetCents }),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(metaErrMsg(json.error, 'Failed to update budget'));

  await supabase.from('meta_campaigns_cache')
    .update({ daily_budget: ngn, updated_at: new Date().toISOString() })
    .eq('meta_campaign_id', campaignId);

  await logAction(userId, 'update_budget', 'campaign', campaignId, { budget_ngn: ngn });
  return ok({ campaign_id: campaignId, daily_budget: ngn });
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
  // daily_budget validation deferred — CBO campaigns manage budget at campaign level (no ad set budget needed)
  // Validate upfront only when creating a new campaign (which is always ad-set-budget)
  if (!campaign_id && (!daily_budget || Number(daily_budget) < META_MIN_DAILY_BUDGET_NGN)) {
    return err(`daily_budget (₦) must be at least ${META_MIN_DAILY_BUDGET_NGN} — Meta rejects lower ad set budgets`, 400);
  }

  // Load draft
  const { data: draft, error: draftErr } = await supabase
    .from('meta_ad_drafts')
    .select('*')
    .eq('id', draftId)
    .single();
  if (draftErr || !draft) return err('Draft not found', 404);
  if (draft.status !== 'approved') return err('Only approved drafts can be published', 400);

  const destinationUrl = draft.destination_url || STORE_URL;
  const budgetCents    = daily_budget ? Math.round(Number(daily_budget) * 100) : 0; // Meta expects cents; 0 is safe — only used when !campaignHoldsBudget
  const isAppCta       = ['INSTALL_MOBILE_APP', 'USE_MOBILE_APP'].includes(draft.call_to_action);

  // 0. Create campaign if not provided
  let resolvedCampaignId = campaign_id;
  if (!resolvedCampaignId) {
    const newCampaign = await metaPost(`${AD_ACCOUNT_ID}/campaigns`, {
      name:      new_campaign_name,
      // App-install CTAs require OUTCOME_APP_PROMOTION; everything else uses traffic
      objective: isAppCta ? 'OUTCOME_APP_PROMOTION' : 'OUTCOME_TRAFFIC',
      status:    'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    });
    resolvedCampaignId = newCampaign.id;
  }

  // Whether this campaign holds budget at campaign level (CBO) — Meta rejects daily_budget on new ad sets in that case
  let campaignHoldsBudget = false;
  try {
    const cMeta = await metaGet(resolvedCampaignId, {
      fields: 'daily_budget,lifetime_budget',
    });
    campaignHoldsBudget =
      Number(cMeta?.daily_budget) > 0 || Number(cMeta?.lifetime_budget) > 0;
  } catch {
    campaignHoldsBudget = false;
  }

  // For existing non-CBO campaigns, budget is required at ad set level
  if (!campaignHoldsBudget && (!daily_budget || Number(daily_budget) < META_MIN_DAILY_BUDGET_NGN)) {
    return err(`daily_budget (₦) must be at least ${META_MIN_DAILY_BUDGET_NGN} — Meta rejects lower ad set budgets`, 400);
  }

  // 1. Create Ad Creative
  let creativePayload;

  if (draft.ad_format === 'video' && draft.meta_video_id) {
    // ── Video creative ──────────────────────────────────────────────────────
    // Meta requires image_url or image_hash in video_data for the thumbnail.
    // If the draft has no image, auto-fetch one from Meta's video thumbnails.
    let thumbImageUrl = draft.image_url || null;
    if (!thumbImageUrl) {
      try {
        const thumbData = await metaGet(`${draft.meta_video_id}/thumbnails`);
        const thumbs    = thumbData.data || [];
        const preferred = thumbs.find((t) => t.is_preferred) || thumbs[0];
        if (preferred?.uri) thumbImageUrl = preferred.uri;
      } catch (e) {
        console.warn('[publishDraft] Could not fetch video thumbnails from Meta:', e.message);
      }
    }
    if (!thumbImageUrl) {
      return err(
        'Video ad requires a thumbnail image. Please add a thumbnail image to the draft before publishing.',
        400
      );
    }

    creativePayload = {
      name: draft.title,
      object_story_spec: {
        page_id: META_PAGE_ID,
        video_data: {
          video_id:       draft.meta_video_id,
          message:        draft.body_text,
          title:          draft.headline || draft.title,
          call_to_action: { type: draft.call_to_action || 'SHOP_NOW', value: { link: destinationUrl } },
          image_url:      thumbImageUrl,
        },
      },
    };
  } else {
    // ── Image / text creative ───────────────────────────────────────────────
    const hasImage = draft.image_url &&
      !draft.image_url.includes('admin.julinemart.com') &&
      !draft.image_url.includes('wp-content');

    let imageHash = null;
    if (hasImage) {
      try {
        imageHash = await uploadImageToMeta(draft.image_url);
      } catch (imgErr) {
        console.warn('Image upload to Meta failed, continuing without image:', imgErr.message);
      }
    }

    creativePayload = {
      name: draft.title,
      object_story_spec: {
        page_id: META_PAGE_ID,
        link_data: {
          message:        draft.body_text,
          link:           destinationUrl,
          name:           draft.headline || draft.title,
          call_to_action: { type: draft.call_to_action || 'SHOP_NOW', value: { link: destinationUrl } },
          ...(imageHash ? { image_hash: imageHash } : {}),
        },
      },
    };
  }

  console.log('[publishDraft] step=adcreatives payload:', JSON.stringify(creativePayload));
  let creative;
  try {
    creative = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, creativePayload);
  } catch (e) {
    throw new Error(`[adcreatives] ${e.message}`);
  }
  console.log('[publishDraft] step=adcreatives ok id:', creative.id);

  // 2. Create Ad Set under the campaign
  // ODAX Traffic + Website: Meta maps this to LANDING_PAGE_VIEWS / LINK_CLICKS + IMPRESSIONS billing
  // (see ODAX mapping). Avoid promoted_object here — it is not used for plain website traffic and
  // often triggers "Invalid parameter". Ongoing daily_budget sets need end_time=0.
  const adSetBase = {
    name:             `${draft.title} — Ad Set`,
    campaign_id:      resolvedCampaignId,
    ...(!campaignHoldsBudget ? { daily_budget: budgetCents } : {}),
    // Some ad accounts default to a bid-cap strategy unless this is explicit (error_subcode 2490487).
    ...(!campaignHoldsBudget ? { bid_strategy: 'LOWEST_COST_WITHOUT_CAP' } : {}),
    targeting:        { geo_locations: { countries: ['NG'] } },
    destination_type: isAppCta ? 'APP' : 'WEBSITE',
    // App campaigns require a promoted_object with the store URL
    ...(isAppCta ? { promoted_object: { application_id: null, object_store_url: destinationUrl } } : {}),
    status:           'PAUSED',
    start_time:       new Date().toISOString(),
    ...(!campaignHoldsBudget ? { end_time: 0 } : {}),
  };

  const adSetAttempts = isAppCta ? [
    { ...adSetBase, billing_event: 'IMPRESSIONS', optimization_goal: 'APP_INSTALLS' },
    { ...adSetBase, billing_event: 'IMPRESSIONS', optimization_goal: 'LINK_CLICKS' },
  ] : [
    { ...adSetBase, billing_event: 'IMPRESSIONS', optimization_goal: 'LANDING_PAGE_VIEWS' },
    { ...adSetBase, billing_event: 'LINK_CLICKS', optimization_goal: 'LINK_CLICKS' },
  ];

  let adSet;
  let adSetErr;
  for (let i = 0; i < adSetAttempts.length; i++) {
    const adSetPayload = adSetAttempts[i];
    console.log(`[publishDraft] step=adsets try=${i + 1} payload:`, JSON.stringify(adSetPayload));
    try {
      adSet = await metaPost(`${AD_ACCOUNT_ID}/adsets`, adSetPayload);
      adSetErr = null;
      break;
    } catch (e) {
      adSetErr = e;
      console.warn(`[publishDraft] step=adsets try=${i + 1} failed:`, e.message);
    }
  }
  if (!adSet) throw new Error(`[adsets] ${adSetErr?.message || 'Meta rejected all ad set configurations'}`);
  console.log('[publishDraft] step=adsets ok id:', adSet.id);

  // 3. Create Ad
  const adPayload = {
    name:       draft.title,
    adset_id:   adSet.id,
    creative:   { creative_id: creative.id },
    status:     'PAUSED',
  };
  console.log('[publishDraft] step=ads payload:', JSON.stringify(adPayload));
  let ad;
  try {
    ad = await metaPost(`${AD_ACCOUNT_ID}/ads`, adPayload);
  } catch (e) {
    throw new Error(`[ads] ${e.message}`);
  }
  console.log('[publishDraft] step=ads ok id:', ad.id);

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

async function setVideoThumbnail(body) {
  const { video_id, thumb_url } = body;
  if (!video_id || !thumb_url) return err('video_id and thumb_url are required', 400);
  if (!ACCESS_TOKEN) return err('META_ADS_ACCESS_TOKEN not configured', 500);

  let thumbRes;
  try {
    thumbRes = await fetch(thumb_url);
  } catch (e) {
    throw new Error(`Failed to fetch thumbnail: ${e.message}`);
  }
  if (!thumbRes.ok) throw new Error(`Could not download thumbnail (HTTP ${thumbRes.status})`);

  const buffer = Buffer.from(await thumbRes.arrayBuffer());
  const form = new FormData();
  form.append('access_token', ACCESS_TOKEN);
  form.append('thumb', new Blob([buffer], { type: 'image/jpeg' }), 'thumb.jpg');

  const apiVersion = META_API_BASE.split('/').pop();
  const url = `https://graph-video.facebook.com/${apiVersion}/${video_id}`;

  let res, rawText;
  try {
    res = await fetch(url, { method: 'POST', body: form });
    rawText = await res.text();
  } catch (fetchErr) {
    throw new Error(`Network error setting thumbnail: ${fetchErr.message}`);
  }

  let json = {};
  try { json = JSON.parse(rawText); } catch {}

  if (!res.ok || json.error) {
    const detail = json.error?.message || rawText || `HTTP ${res.status}`;
    throw new Error(`Meta thumbnail update failed: ${detail}`);
  }

  return ok({ set: true });
}

async function getAccountInfo() {
  if (!AD_ACCOUNT_ID) return err('META_AD_ACCOUNT_ID not configured', 500);

  // Note: Meta Marketing API does not expose the Funds wallet balance with
  // ads_management scope. Only amount_owed (balance field) is accessible.
  const data = await metaGet(AD_ACCOUNT_ID, {
    fields: 'balance,amount_spent,currency,spend_cap,name',
  });

  const toMajor = (v) => (v !== undefined && v !== null ? Number(v) / 100 : null);

  return ok({
    amount_owed:  toMajor(data.balance),
    amount_spent: toMajor(data.amount_spent),
    spend_cap:    toMajor(data.spend_cap),
    currency:     data.currency || 'NGN',
    name:         data.name || '',
  });
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

  let body = {};
  if (event.body) {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return err('Request body is not valid JSON — it may be too large or malformed', 400);
    }
  }

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

    // PUT /api/meta/drafts/:id  (update fields like destination_url)
    const draftUpdateMatch = path.match(/^drafts\/([^/]+)$/);
    if (draftUpdateMatch && method === 'PUT') return await updateDraft(draftUpdateMatch[1], body, userId);

    // DELETE /api/meta/drafts/:id
    const draftDeleteMatch = path.match(/^drafts\/([^/]+)$/);
    if (draftDeleteMatch && method === 'DELETE') return await deleteDraft(draftDeleteMatch[1], userId);

    // POST /api/meta/drafts/:id/publish
    const publishMatch = path.match(/^drafts\/([^/]+)\/publish$/);
    if (publishMatch && method === 'POST') return await publishDraft(publishMatch[1], body, userId);

    // POST /api/meta/ai/generate
    if (path === 'ai/generate' && method === 'POST') return await generateContent(body, userId);

    // POST /api/meta/ai/assist  (Smart Creator writing assistant)
    if (path === 'ai/assist' && method === 'POST') return await aiAssist(body);

    // POST /api/meta/upload-video
    if (path === 'upload-video' && method === 'POST') return await uploadVideoToMeta(body);

    // POST /api/meta/video-thumbnail
    if (path === 'video-thumbnail' && method === 'POST') return await setVideoThumbnail(body);

    // GET /api/meta/recommendations
    if (path === 'recommendations' && method === 'GET') return await getRecommendations();

    // GET /api/meta/context
    if (path === 'context' && method === 'GET') return await getAdsContext();

    // GET /api/meta/account
    if (path === 'account' && method === 'GET') return await getAccountInfo();

    // GET /api/meta/products-images
    if (path === 'products-images' && method === 'GET') return await getProductsWithImages();

    // GET /api/meta/catalog-products?search=xxx
    if (path === 'catalog-products' && method === 'GET') return await searchCatalogProducts(qs.search);

    // POST /api/meta/upload-image
    if (path === 'upload-image' && method === 'POST') return await uploadAdImage(body);

    // PUT /api/meta/campaigns/:id/status
    const campaignStatusMatch = path.match(/^campaigns\/([^/]+)\/status$/);
    if (campaignStatusMatch && method === 'PUT') return await updateCampaignStatus(campaignStatusMatch[1], body.status, userId);

    // PUT /api/meta/campaigns/:id/budget
    const campaignBudgetMatch = path.match(/^campaigns\/([^/]+)\/budget$/);
    if (campaignBudgetMatch && method === 'PUT') return await updateCampaignBudget(campaignBudgetMatch[1], body.daily_budget, userId);

    return err(`Unknown route: ${method} /api/meta/${path}`, 404);
  } catch (e) {
    console.error('meta-ads function error:', e);
    return err(e.message || 'Internal error', 500);
  }
}
