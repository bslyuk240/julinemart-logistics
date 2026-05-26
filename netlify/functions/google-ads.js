// Netlify Function: /api/google/*
// Google Ads integration for JulineMart, JulineServices, SkolaHQ
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const API_VERSION   = 'v18';
const API_BASE      = `https://googleads.googleapis.com/${API_VERSION}`;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// ── Google Ads credentials — all packed in one JSON env var to stay under
//    AWS Lambda's 4 KB env limit.
//
//    Set GOOGLE_ADS_CONFIG in Netlify as a single JSON string:
//    {
//      "developerToken": "...",
//      "clientId":       "...",
//      "clientSecret":   "...",
//      "refreshToken":   "...",
//      "managerId":      "2875419899",
//      "customerIds": {
//        "julinemart": "2248852650",
//        "services":   "5953436723",
//        "skolahq":    "1214993945"
//      }
//    }
// ─────────────────────────────────────────────────────────────────────────────
let _cfg = {};
try { _cfg = JSON.parse(process.env.GOOGLE_ADS_CONFIG || '{}'); } catch {}

const DEV_TOKEN     = _cfg.developerToken || '';
const MANAGER_ID    = (_cfg.managerId || '').replace(/-/g, '');
const CLIENT_ID     = _cfg.clientId     || '';
const CLIENT_SECRET = _cfg.clientSecret || '';
const REFRESH_TOKEN = _cfg.refreshToken || '';
const CUSTOMER_IDS  = _cfg.customerIds  || {};

// ── Account registry ─────────────────────────────────────────────────────────

const ACCOUNTS = {
  julinemart: {
    customerId: (CUSTOMER_IDS.julinemart || '').replace(/-/g, ''),
    name: 'JulineMart Nigeria',
    website: 'https://julinemart.com',
    businessType: 'ecommerce',
    geo: 'Nigeria',
    minBudgetNgn: 1000,
    campaignType: 'SEARCH',
    ctaOptions: ['SHOP_NOW', 'LEARN_MORE', 'BUY_NOW', 'GET_OFFER'],
  },
  services: {
    customerId: (CUSTOMER_IDS.services || '').replace(/-/g, ''),
    name: 'JulineServices',
    website: 'https://services.julinemart.com',
    businessType: 'marketplace',
    geo: 'Nigeria',
    minBudgetNgn: 1000,
    campaignType: 'SEARCH',
    ctaOptions: ['LEARN_MORE', 'CONTACT_US', 'SIGN_UP', 'GET_QUOTE'],
  },
  skolahq: {
    customerId: (CUSTOMER_IDS.skolahq || '').replace(/-/g, ''),
    name: 'SkolaHQ',
    website: 'https://skolahq.com',
    businessType: 'saas',
    geo: 'Nigeria',
    minBudgetNgn: 1000,
    campaignType: 'SEARCH',
    ctaOptions: ['SIGN_UP', 'LEARN_MORE', 'BOOK_NOW', 'GET_STARTED'],
    signupUrl: 'https://app.skolahq.com/signup',
    demoUrl: 'https://cal.com/skola/demo',
  },
};

// Nigeria location criterion ID (constant in Google Ads)
const NIGERIA_GEO_CRITERION_ID = '2566';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};
const ok      = (data)          => ({ statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, data }) });
const created = (data)          => ({ statusCode: 201, headers: CORS, body: JSON.stringify({ success: true, data }) });
const err     = (msg, code=500) => ({ statusCode: code, headers: CORS, body: JSON.stringify({ success: false, error: msg }) });

// ── OAuth access token (cached per cold start) ────────────────────────────────

let _accessToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry - 60_000) return _accessToken;
  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`OAuth: ${json.error_description || json.error}`);
  _accessToken = json.access_token;
  _tokenExpiry = Date.now() + json.expires_in * 1000;
  return _accessToken;
}

// ── Google Ads API helpers ────────────────────────────────────────────────────

async function buildHeaders() {
  const token = await getAccessToken();
  return {
    'Authorization':    `Bearer ${token}`,
    'developer-token':  DEV_TOKEN,
    'login-customer-id': MANAGER_ID,
    'Content-Type':     'application/json',
  };
}

async function gaqlSearch(customerId, query) {
  const headers = await buildHeaders();
  const res  = await fetch(`${API_BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST', headers,
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || json.error?.details?.[0]?.errors?.[0]?.message || `Google Ads API error (${res.status})`;
    console.error('[gaqlSearch]', msg, JSON.stringify(json.error));
    throw new Error(msg);
  }
  return json.results || [];
}

async function googleMutate(customerId, resource, operations) {
  const headers = await buildHeaders();
  const res  = await fetch(`${API_BASE}/customers/${customerId}/${resource}:mutate`, {
    method: 'POST', headers,
    body: JSON.stringify({ operations }),
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || json.error?.details?.[0]?.errors?.[0]?.message || `Mutate error on ${resource}`;
    console.error('[googleMutate]', resource, msg, JSON.stringify(json.error));
    throw new Error(msg);
  }
  return json;
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getUserId(event) {
  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  return data?.user?.id || null;
}

async function logAction(userId, accountKey, action, resource, resourceId, details, status = 'success', errorMsg) {
  await supabase.from('google_action_logs').insert({
    user_id: userId || null, account_key: accountKey || null,
    action, resource: resource || null, resource_id: resourceId || null,
    details: details || null, status, error_msg: errorMsg || null,
  });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// GET /api/google/accounts
function getAccounts() {
  const data = Object.entries(ACCOUNTS).map(([key, acc]) => ({
    key,
    name: acc.name,
    customerId: acc.customerId,
    website: acc.website,
    businessType: acc.businessType,
    campaignType: acc.campaignType,
  }));
  return ok(data);
}

// GET /api/google/campaigns?account=julinemart
async function getCampaigns(accountKey) {
  if (!accountKey || !ACCOUNTS[accountKey]) return err('Invalid account key', 400);
  const customerId = ACCOUNTS[accountKey].customerId;
  const { data, error } = await supabase
    .from('google_campaigns_cache')
    .select('*')
    .eq('account_key', accountKey)
    .eq('customer_id', customerId)
    .order('impressions', { ascending: false });
  if (error) throw error;
  return ok(data || []);
}

// POST /api/google/campaigns/sync?account=julinemart
async function syncCampaigns(accountKey, userId) {
  if (!accountKey || !ACCOUNTS[accountKey]) return err('Invalid account key', 400);
  const account    = ACCOUNTS[accountKey];
  const customerId = account.customerId;
  if (!customerId) return err(`GOOGLE_ADS_CUSTOMER_ID_${accountKey.toUpperCase()} not configured`, 500);

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE campaign.status != 'REMOVED'
      AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.impressions DESC
    LIMIT 50
  `;

  const results = await gaqlSearch(customerId, query);

  const rows = results.map((r) => ({
    account_key:           accountKey,
    customer_id:           customerId,
    account_name:          account.name,
    google_campaign_id:    r.campaign?.id || '',
    name:                  r.campaign?.name || '',
    status:                r.campaign?.status || 'UNKNOWN',
    campaign_type:         r.campaign?.advertisingChannelType || null,
    budget_amount_micros:  r.campaignBudget?.amountMicros ? Number(r.campaignBudget.amountMicros) : null,
    impressions:           Number(r.metrics?.impressions || 0),
    clicks:                Number(r.metrics?.clicks || 0),
    cost_micros:           Number(r.metrics?.costMicros || 0),
    conversions:           parseFloat(r.metrics?.conversions || 0),
    ctr:                   parseFloat(r.metrics?.ctr || 0),
    average_cpc_micros:    Number(r.metrics?.averageCpc || 0),
    synced_at:             new Date().toISOString(),
  }));

  // Replace cache for this account
  await supabase.from('google_campaigns_cache').delete()
    .eq('account_key', accountKey).eq('customer_id', customerId);

  if (rows.length > 0) {
    const { error } = await supabase.from('google_campaigns_cache').insert(rows);
    if (error) throw error;
  }

  await logAction(userId, accountKey, 'sync_campaigns', 'campaign', null, { count: rows.length });
  return ok({ synced: rows.length });
}

// PUT /api/google/campaigns/:campaignId/status?account=julinemart
async function updateCampaignStatus(accountKey, campaignId, status, userId) {
  if (!['ENABLED', 'PAUSED'].includes(status)) return err('status must be ENABLED or PAUSED', 400);
  if (!ACCOUNTS[accountKey]) return err('Invalid account key', 400);
  const customerId = ACCOUNTS[accountKey].customerId;

  await googleMutate(customerId, 'campaigns', [{
    update: {
      resourceName: `customers/${customerId}/campaigns/${campaignId}`,
      status,
    },
    updateMask: 'status',
  }]);

  await supabase.from('google_campaigns_cache')
    .update({ status, synced_at: new Date().toISOString() })
    .eq('account_key', accountKey)
    .eq('google_campaign_id', campaignId);

  await logAction(userId, accountKey, status === 'PAUSED' ? 'pause_campaign' : 'enable_campaign', 'campaign', campaignId);
  return ok({ campaign_id: campaignId, status });
}

// GET /api/google/drafts?account=julinemart
async function getDrafts(accountKey, status) {
  let q = supabase
    .from('google_ad_drafts')
    .select('*, users!google_ad_drafts_created_by_fkey(full_name, email)')
    .order('created_at', { ascending: false });
  if (accountKey) q = q.eq('account_key', accountKey);
  if (status)     q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return ok(data || []);
}

// POST /api/google/drafts
async function createDraft(body, userId) {
  const { account_key, title, headlines, descriptions, final_url, image_url,
          campaign_type, call_to_action, suggested_budget_ngn, ai_generated,
          video_url, logo_url, long_headline, image_url_square } = body;
  if (!account_key || !title || !headlines?.length || !descriptions?.length)
    return err('account_key, title, headlines, descriptions are required', 400);
  if (!ACCOUNTS[account_key]) return err('Invalid account_key', 400);

  const { data, error } = await supabase.from('google_ad_drafts').insert({
    account_key,
    customer_id:          ACCOUNTS[account_key].customerId,
    title,
    headlines:            headlines.slice(0, 15),
    descriptions:         descriptions.slice(0, 5),
    final_url:            final_url || ACCOUNTS[account_key].website,
    image_url:            image_url || null,
    campaign_type:        campaign_type || 'SEARCH',
    call_to_action:       call_to_action || 'LEARN_MORE',
    suggested_budget_ngn: suggested_budget_ngn || null,
    ai_generated:         ai_generated || false,
    created_by:           userId || null,
    status:               'draft',
    video_url:            video_url   || null,
    logo_url:             logo_url    || null,
    long_headline:        long_headline || null,
    image_url_square:     image_url_square || null,
  }).select().single();
  if (error) throw error;
  await logAction(userId, account_key, 'create_draft', 'draft', data.id, { title, campaign_type });
  return created(data);
}

// ── Media asset helpers ────────────────────────────────────────────────────────

/** Fetch an image from a URL and upload it to Google Ads as an ImageAsset.
 *  Returns the asset resource name: "customers/{cid}/assets/{assetId}" */
async function uploadImageAsset(customerId, imageUrl, assetName) {
  console.log('[uploadImageAsset] fetching:', imageUrl);
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch image (${imgRes.status}): ${imageUrl}`);
  const buffer   = await imgRes.arrayBuffer();
  const b64      = Buffer.from(buffer).toString('base64');
  const rawMime  = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  const mimeMap  = { 'image/jpeg': 'IMAGE_JPEG', 'image/jpg': 'IMAGE_JPEG',
                     'image/png': 'IMAGE_PNG', 'image/gif': 'IMAGE_GIF', 'image/webp': 'IMAGE_WEBP' };
  const mimeType = mimeMap[rawMime] || 'IMAGE_JPEG';

  const res = await googleMutate(customerId, 'assets', [{
    create: {
      name: (assetName || `Image_${Date.now()}`).slice(0, 255),
      type: 'IMAGE',
      imageAsset: { data: b64, mimeType },
    },
  }]);
  return res.results[0].resourceName;
}

/** Create a YouTube video asset in the Google Ads account.
 *  Accepts a full YouTube URL or bare video ID.
 *  Returns { resourceName, videoId }. */
async function createYouTubeVideoAsset(customerId, youtubeUrl, assetName) {
  let videoId = youtubeUrl.trim();
  try {
    const u = new URL(youtubeUrl);
    if (u.hostname.includes('youtu.be')) {
      videoId = u.pathname.slice(1).split('?')[0];
    } else {
      videoId = u.searchParams.get('v') || u.pathname.split('/').pop();
    }
  } catch { /* assume bare video ID already */ }
  if (!videoId) throw new Error('Could not extract YouTube video ID from URL');

  const res = await googleMutate(customerId, 'assets', [{
    create: {
      name: (assetName || `Video_${Date.now()}`).slice(0, 255),
      type: 'YOUTUBE_VIDEO',
      youtubeVideoAsset: { youtubeVideoId: videoId },
    },
  }]);
  return { resourceName: res.results[0].resourceName, videoId };
}

// PUT /api/google/drafts/:id/approve
async function approveDraft(id, userId) {
  const { data, error } = await supabase.from('google_ad_drafts')
    .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw error;
  await logAction(userId, data.account_key, 'approve_draft', 'draft', id, { title: data.title });
  return ok(data);
}

// PUT /api/google/campaigns/:id/budget
async function updateCampaignBudget(accountKey, campaignId, budgetNgn, userId) {
  if (!ACCOUNTS[accountKey]) return err('Invalid account key', 400);
  const ngn = Number(budgetNgn);
  if (!ngn || ngn < 500) return err('Budget must be at least ₦500', 400);

  const customerId   = ACCOUNTS[accountKey].customerId;
  const budgetMicros = Math.round(ngn * 1_000_000);

  // 1. Fetch the campaign's budget resource name
  const results = await gaqlSearch(customerId,
    `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${campaignId}`
  );
  if (!results.length) return err('Campaign not found in Google Ads', 404);

  const budgetResourceName = results[0]?.campaign?.campaignBudget;
  if (!budgetResourceName) return err('Campaign has no linked budget resource', 400);

  // 2. Mutate the budget amount
  await googleMutate(customerId, 'campaignBudgets', [{
    update:     { resourceName: budgetResourceName, amountMicros: budgetMicros },
    updateMask: 'amountMicros',
  }]);

  // 3. Update local cache
  await supabase.from('google_campaigns_cache')
    .update({ budget_amount_micros: budgetMicros, synced_at: new Date().toISOString() })
    .eq('account_key', accountKey)
    .eq('google_campaign_id', String(campaignId));

  await logAction(userId, accountKey, 'update_budget', 'campaign', String(campaignId), { budget_ngn: ngn });
  return ok({ campaign_id: campaignId, budget_amount_micros: budgetMicros });
}

// PUT /api/google/drafts/:id/reject
async function rejectDraft(id, userId, note) {
  const { data, error } = await supabase.from('google_ad_drafts')
    .update({ status: 'rejected', approved_by: userId, rejection_note: note || '' })
    .eq('id', id).select().single();
  if (error) throw error;
  await logAction(userId, data.account_key, 'reject_draft', 'draft', id, { note });
  return ok(data);
}

// DELETE /api/google/drafts/:id
async function deleteDraft(id, userId) {
  const { data: row, error: fetchErr } = await supabase
    .from('google_ad_drafts').select('id, title, account_key').eq('id', id).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) return err('Draft not found', 404);
  const { error } = await supabase.from('google_ad_drafts').delete().eq('id', id);
  if (error) throw error;
  await logAction(userId, row.account_key, 'delete_draft', 'draft', id, { title: row.title });
  return ok({ id });
}

// PUT /api/google/drafts/:id (update fields)
async function updateDraft(id, body, userId) {
  const { final_url, headlines, descriptions, suggested_budget_ngn } = body;
  const { data: existing } = await supabase.from('google_ad_drafts').select('status, account_key').eq('id', id).single();
  if (!existing) return err('Draft not found', 404);
  if (existing.status === 'published') return err('Cannot edit a published draft', 400);
  const updates = { updated_at: new Date().toISOString() };
  if (final_url !== undefined)           updates.final_url = final_url || null;
  if (headlines?.length)                 updates.headlines = headlines.slice(0, 15);
  if (descriptions?.length)              updates.descriptions = descriptions.slice(0, 4);
  if (suggested_budget_ngn !== undefined) updates.suggested_budget_ngn = suggested_budget_ngn || null;
  const { error } = await supabase.from('google_ad_drafts').update(updates).eq('id', id);
  if (error) throw error;
  return ok({ updated: true });
}

// POST /api/google/drafts/:id/publish
async function publishDraft(draftId, body, userId) {
  if (!DEV_TOKEN)  return err('GOOGLE_ADS_DEVELOPER_TOKEN not configured', 500);
  if (!MANAGER_ID) return err('GOOGLE_ADS_MANAGER_CUSTOMER_ID not configured', 500);

  const { new_campaign_name, daily_budget_ngn, campaign_id } = body;
  if (!daily_budget_ngn || Number(daily_budget_ngn) < 500)
    return err('daily_budget_ngn must be at least ₦500', 400);

  const { data: draft, error: draftErr } = await supabase
    .from('google_ad_drafts').select('*').eq('id', draftId).single();
  if (draftErr || !draft) return err('Draft not found', 404);
  if (draft.status !== 'approved') return err('Only approved drafts can be published', 400);
  if (!draft.headlines?.length || !draft.descriptions?.length)
    return err('Draft must have headlines and descriptions', 400);

  const adType       = (draft.campaign_type || 'SEARCH').toUpperCase();
  const customerId   = draft.customer_id;
  const account      = ACCOUNTS[draft.account_key];
  const budgetMicros = Math.round(Number(daily_budget_ngn) * 1_000_000);
  const finalUrl     = draft.final_url || account?.website || 'https://julinemart.com';

  let resolvedCampaignId = campaign_id;

  if (!resolvedCampaignId) {
    if (!new_campaign_name?.trim()) return err('new_campaign_name is required when not using existing campaign', 400);

    console.log('[publishDraft] Creating budget:', budgetMicros, 'type:', adType);
    const budgetRes = await googleMutate(customerId, 'campaignBudgets', [{
      create: {
        name:           `${new_campaign_name.trim()} Budget`,
        amountMicros:   budgetMicros,
        deliveryMethod: 'STANDARD',
      },
    }]);
    const budgetName = budgetRes.results[0].resourceName;

    // Network settings differ per campaign type
    const networkSettings = adType === 'DISPLAY'
      ? { targetGoogleSearch: false, targetSearchNetwork: false, targetContentNetwork: true }
      : adType === 'VIDEO'
      ? { targetYoutube: true, targetGoogleTvNetwork: false, targetContentNetwork: false }
      : { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false };

    console.log('[publishDraft] Creating campaign');
    const campaignRes = await googleMutate(customerId, 'campaigns', [{
      create: {
        name:                   new_campaign_name.trim(),
        advertisingChannelType: adType,
        status:                 'PAUSED',
        campaignBudget:         budgetName,
        networkSettings,
        geoTargetTypeSetting: {
          positiveGeoTargetType: 'PRESENCE_OR_INTEREST',
          negativeGeoTargetType: 'PRESENCE',
        },
      },
    }]);
    const campaignResourceName = campaignRes.results[0].resourceName;
    resolvedCampaignId = campaignResourceName.split('/').pop();
    console.log('[publishDraft] Campaign created:', resolvedCampaignId);

    try {
      await googleMutate(customerId, 'campaignCriteria', [{
        create: {
          campaign: campaignResourceName,
          type:     'LOCATION',
          location: { geoTargetConstant: `geoTargetConstants/${NIGERIA_GEO_CRITERION_ID}` },
        },
      }]);
    } catch (geoErr) {
      console.warn('[publishDraft] Geo target warning (non-fatal):', geoErr.message);
    }
  }

  // Ad group type per ad type
  const adGroupTypeMap = { SEARCH: 'SEARCH_STANDARD', DISPLAY: 'DISPLAY_STANDARD', VIDEO: 'VIDEO' };
  console.log('[publishDraft] Creating ad group');
  const adGroupRes = await googleMutate(customerId, 'adGroups', [{
    create: {
      name:     `${draft.title} — Ad Group`,
      campaign: `customers/${customerId}/campaigns/${resolvedCampaignId}`,
      status:   'ENABLED',
      type:     adGroupTypeMap[adType] || 'SEARCH_STANDARD',
    },
  }]);
  const adGroupResourceName = adGroupRes.results[0].resourceName;
  const adGroupId = adGroupResourceName.split('/').pop();

  // ── Create the ad based on type ───────────────────────────────────────────

  let adId;

  if (adType === 'DISPLAY') {
    // ── Responsive Display Ad ──────────────────────────────────────────────
    if (!draft.image_url) return err('Display ads require a landscape image URL (image_url)', 400);

    console.log('[publishDraft] Uploading landscape image');
    const landAsset = await uploadImageAsset(
      customerId, draft.image_url, `${draft.title} — Landscape`
    );

    // Square: use dedicated square URL if provided, else reuse landscape
    let squareAsset = landAsset;
    if (draft.image_url_square) {
      console.log('[publishDraft] Uploading square image');
      squareAsset = await uploadImageAsset(
        customerId, draft.image_url_square, `${draft.title} — Square`
      );
    }

    // Optional logo
    let logoAssets = [];
    if (draft.logo_url) {
      try {
        const logoAsset = await uploadImageAsset(
          customerId, draft.logo_url, `${draft.title} — Logo`
        );
        logoAssets = [{ asset: logoAsset }];
      } catch (logoErr) {
        console.warn('[publishDraft] Logo upload failed (non-fatal):', logoErr.message);
      }
    }

    const shortHeadlines = draft.headlines.slice(0, 5).map((text) => ({ text }));
    const longHeadline   = draft.long_headline || draft.headlines[0] || draft.title;
    const descriptions   = draft.descriptions.slice(0, 5).map((text) => ({ text }));
    const businessName   = (account?.name || 'JulineMart').slice(0, 25);

    console.log('[publishDraft] Creating Responsive Display Ad');
    const adRes = await googleMutate(customerId, 'adGroupAds', [{
      create: {
        adGroup: adGroupResourceName,
        status:  'ENABLED',
        ad: {
          finalUrls: [finalUrl],
          responsiveDisplayAd: {
            marketingImages:       [{ asset: landAsset }],
            squareMarketingImages: [{ asset: squareAsset }],
            shortHeadlines:        shortHeadlines,
            longHeadline:          { text: longHeadline.slice(0, 90) },
            descriptions:          descriptions,
            businessName,
            ...(logoAssets.length ? { logos: logoAssets } : {}),
          },
        },
      },
    }]);
    adId = adRes.results[0].resourceName.split('/').pop();

  } else if (adType === 'VIDEO') {
    // ── YouTube In-Stream Video Ad ─────────────────────────────────────────
    if (!draft.video_url) return err('Video ads require a video_url (YouTube URL or video ID)', 400);

    console.log('[publishDraft] Creating YouTube video asset');
    const { resourceName: videoAssetName, videoId } = await createYouTubeVideoAsset(
      customerId, draft.video_url, `${draft.title} — Video`
    );
    console.log('[publishDraft] YouTube video asset created, videoId:', videoId);

    const actionHeadline = (draft.long_headline || draft.headlines[0] || draft.title).slice(0, 80);
    const rawCta         = draft.call_to_action || 'LEARN_MORE';
    // In-stream actionButtonLabel is a plain short label (e.g. "Sign Up", not enum)
    const ctaLabelMap = {
      LEARN_MORE: 'Learn More', SIGN_UP: 'Sign Up', GET_STARTED: 'Get Started',
      CONTACT_US: 'Contact Us', BOOK_NOW: 'Book Now', SHOP_NOW: 'Shop Now',
      GET_OFFER:  'Get Offer',  SUBSCRIBE: 'Subscribe',
    };
    const actionButtonLabel = (ctaLabelMap[rawCta] || rawCta.replace(/_/g, ' ')).slice(0, 20);

    console.log('[publishDraft] Creating Video In-Stream Ad');
    const adRes = await googleMutate(customerId, 'adGroupAds', [{
      create: {
        adGroup: adGroupResourceName,
        status:  'ENABLED',
        ad: {
          finalUrls: [finalUrl],
          videoAd: {
            video: { asset: videoAssetName },
            inStream: {
              actionButtonLabel,
              actionHeadline,
            },
          },
        },
      },
    }]);
    adId = adRes.results[0].resourceName.split('/').pop();

  } else {
    // ── Responsive Search Ad (SEARCH, default) ─────────────────────────────
    console.log('[publishDraft] Creating RSA');
    const headlines    = draft.headlines.slice(0, 15).map((text) => ({ text }));
    const descriptions = draft.descriptions.slice(0, 4).map((text) => ({ text }));

    const adRes = await googleMutate(customerId, 'adGroupAds', [{
      create: {
        adGroup: adGroupResourceName,
        status:  'ENABLED',
        ad: {
          finalUrls:          [finalUrl],
          responsiveSearchAd: { headlines, descriptions },
        },
      },
    }]);
    adId = adRes.results[0].resourceName.split('/').pop();
  }

  console.log('[publishDraft] Ad created:', adId);

  await supabase.from('google_ad_drafts').update({
    status:             'published',
    google_campaign_id: resolvedCampaignId,
    google_ad_group_id: adGroupId,
    google_ad_id:       adId,
    published_at:       new Date().toISOString(),
  }).eq('id', draftId);

  await logAction(userId, draft.account_key, 'publish_draft', 'draft', draftId, {
    ad_type: adType, campaign_id: resolvedCampaignId, ad_group_id: adGroupId, ad_id: adId,
  });

  return ok({ campaign_id: resolvedCampaignId, ad_group_id: adGroupId, ad_id: adId });
}

// POST /api/google/ai/generate
async function generateContent(body, userId) {
  if (!ANTHROPIC_KEY) return err('ANTHROPIC_API_KEY not configured', 500);
  const { account_key, objective = 'conversions', tone = 'engaging', count = 3, context = {} } = body;
  if (!ACCOUNTS[account_key]) return err('Invalid account_key', 400);
  const account = ACCOUNTS[account_key];

  // Business-specific prompt context
  const businessContext = {
    julinemart: `JulineMart is a Nigerian e-commerce marketplace. Products include fashion, electronics, home goods, food. Target audience: Nigerian shoppers aged 18-45, mobile-first. USP: wide selection, fast delivery, trusted sellers. Currency: NGN.`,
    services: `JulineServices is a Nigerian local service discovery marketplace at services.julinemart.com. Connects customers with trusted local service providers (plumbers, electricians, cleaners, tutors, etc). Target audience: Nigerians needing local services aged 25-55. USP: verified providers, easy booking, reviews.`,
    skolahq: `SkolaHQ (skolahq.com) is a B2B school management SaaS for African schools, primarily Nigeria. All-in-one: attendance, results/report cards, fee management, parent portal, timetable, communication. Target: school owners, principals, bursars. Pricing: from ₦15,000/month. Free trial, no credit card. USP: mobile-first, built for African schools, AI-generated report card remarks, setup in minutes.`,
  }[account_key];

  const ctaMap = {
    julinemart: ['SHOP_NOW', 'BUY_NOW', 'GET_OFFER', 'LEARN_MORE'],
    services:   ['LEARN_MORE', 'CONTACT_US', 'SIGN_UP', 'GET_QUOTE'],
    skolahq:    ['SIGN_UP', 'LEARN_MORE', 'BOOK_NOW', 'GET_STARTED'],
  };

  const prompt = `You are a Google Ads expert copywriter for ${account.name}, a ${account.businessType} business in ${account.geo}.

Business context:
${businessContext}

Generate ${count} Google Responsive Search Ad (RSA) variations for this business.
Objective: ${objective}
Tone: ${tone}

Google RSA requirements (STRICT):
- Each variation needs 8-10 headlines (MAX 30 characters each, INCLUDING spaces)
- Each variation needs 3-4 descriptions (MAX 90 characters each, INCLUDING spaces)
- Headlines must be punchy, not end with punctuation
- Descriptions should include a CTA and value proposition
- Use Nigerian English naturally (e.g. "₦", local references where relevant)
- CTA options for this business: ${ctaMap[account_key].join(', ')}

Return ONLY a JSON array, no explanation:
[
  {
    "title": "short internal name",
    "headlines": ["headline1", "headline2", "headline3", "headline4", "headline5", "headline6", "headline7", "headline8"],
    "descriptions": ["desc1", "desc2", "desc3"],
    "call_to_action": "SIGN_UP",
    "suggested_budget_ngn": 3000
  }
]`;

  const res  = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return err(errBody?.error?.message || `Anthropic API error: ${res.status}`, 500);
  }
  const json  = await res.json();
  const text  = json.content?.[0]?.text || '[]';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return err('AI returned unexpected format', 500);

  const variations = JSON.parse(match[0]);
  await logAction(userId, account_key, 'generate_content', null, null, { count: variations.length });
  return ok(variations);
}

// POST /api/google/ai/assist  (brief → suggestions for Ad Creator)
// Supports campaign_type: SEARCH | DISPLAY | VIDEO
async function aiAssist(body) {
  if (!ANTHROPIC_KEY) return err('ANTHROPIC_API_KEY not configured', 500);
  const { brief, tone = 'engaging', account_key, campaign_type = 'SEARCH', cta = 'LEARN_MORE' } = body;
  if (!brief?.trim()) return err('brief is required', 400);
  if (!ACCOUNTS[account_key]) return err('Invalid account_key', 400);

  const account = ACCOUNTS[account_key];
  const adType  = (campaign_type || 'SEARCH').toUpperCase();

  let prompt;

  if (adType === 'DISPLAY') {
    prompt = `You are a Google Display Ads copywriter for ${account.name} (${account.businessType}, ${account.geo}).

Brief: "${brief.trim()}"
Tone: ${tone}

Write copy for a Responsive Display Ad. Requirements (STRICT):
- long_headline: 1 headline, MAX 90 characters including spaces. Used as the main banner headline.
- short_headlines: 3-5 short headlines, MAX 30 characters each. Used in smaller placements.
- descriptions: 3-5 descriptions, MAX 90 characters each. Include a value proposition and/or CTA.

Return ONLY a single JSON object, no explanation:
{
  "long_headline": "...",
  "short_headlines": ["...", "...", "..."],
  "descriptions": ["...", "...", "..."]
}`;
  } else if (adType === 'VIDEO') {
    prompt = `You are a YouTube Ads copywriter for ${account.name} (${account.businessType}, ${account.geo}).

Brief: "${brief.trim()}"
Tone: ${tone}
CTA button: ${cta.replace(/_/g, ' ')}

Write 3 YouTube in-stream ad variations. Requirements (STRICT):
- action_headline: shown next to the CTA button during the ad. MAX 80 characters. Should be compelling and action-driven.
- script_idea: 1-2 sentence hook for the first 5 seconds (before viewers can skip). Should grab attention immediately.

Return ONLY a JSON array, no explanation:
[
  { "action_headline": "...", "script_idea": "..." },
  { "action_headline": "...", "script_idea": "..." },
  { "action_headline": "...", "script_idea": "..." }
]`;
  } else {
    // SEARCH (existing behaviour, expanded)
    prompt = `You are a Google Search Ads copywriter for ${account.name} (${account.businessType}, ${account.geo}).

Brief: "${brief.trim()}"
Tone: ${tone}

Write 3 RSA variations. Requirements (STRICT):
- headline: MAX 30 characters including spaces.
- description: MAX 90 characters including spaces. Include a CTA.

Return ONLY a JSON array, no explanation:
[
  { "headline": "...", "description": "..." },
  { "headline": "...", "description": "..." },
  { "headline": "...", "description": "..." }
]`;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const result = await response.json();
  const text   = result.content?.[0]?.text || '';

  try {
    // Display returns an object {}, Search/Video return an array []
    const match = adType === 'DISPLAY'
      ? text.match(/\{[\s\S]*\}/)
      : text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON found');
    return ok(JSON.parse(match[0]));
  } catch {
    return err('AI returned unexpected format — please try again', 500);
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const path   = (event.path || '').replace(/^\/api\/google\/?/, '').replace(/\/$/, '');
  const method = event.httpMethod;
  const qs     = event.queryStringParameters || {};

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
    } catch {
      return err('Request body is not valid JSON', 400);
    }
  }

  const userId = await getUserId(event);

  try {
    // GET /api/google/accounts
    if (path === 'accounts' && method === 'GET') return getAccounts();

    // GET /api/google/campaigns?account=xxx
    if (path === 'campaigns' && method === 'GET') return await getCampaigns(qs.account);

    // POST /api/google/campaigns/sync?account=xxx
    if (path === 'campaigns/sync' && method === 'POST') return await syncCampaigns(qs.account || body.account_key, userId);

    // PUT /api/google/campaigns/:id/status?account=xxx
    const campaignStatusMatch = path.match(/^campaigns\/([^/]+)\/status$/);
    if (campaignStatusMatch && method === 'PUT')
      return await updateCampaignStatus(qs.account || body.account_key, campaignStatusMatch[1], body.status, userId);

    // PUT /api/google/campaigns/:id/budget
    const campaignBudgetMatch = path.match(/^campaigns\/([^/]+)\/budget$/);
    if (campaignBudgetMatch && method === 'PUT')
      return await updateCampaignBudget(qs.account || body.account_key, campaignBudgetMatch[1], body.daily_budget_ngn, userId);

    // GET /api/google/drafts?account=xxx
    if (path === 'drafts' && method === 'GET') return await getDrafts(qs.account, qs.status);

    // POST /api/google/drafts
    if (path === 'drafts' && method === 'POST') return await createDraft(body, userId);

    // PUT /api/google/drafts/:id/approve
    const approveMatch = path.match(/^drafts\/([^/]+)\/approve$/);
    if (approveMatch && method === 'PUT') return await approveDraft(approveMatch[1], userId);

    // PUT /api/google/drafts/:id/reject
    const rejectMatch = path.match(/^drafts\/([^/]+)\/reject$/);
    if (rejectMatch && method === 'PUT') return await rejectDraft(rejectMatch[1], userId, body.note);

    // PUT /api/google/drafts/:id
    const draftUpdateMatch = path.match(/^drafts\/([^/]+)$/);
    if (draftUpdateMatch && method === 'PUT') return await updateDraft(draftUpdateMatch[1], body, userId);

    // DELETE /api/google/drafts/:id
    const draftDeleteMatch = path.match(/^drafts\/([^/]+)$/);
    if (draftDeleteMatch && method === 'DELETE') return await deleteDraft(draftDeleteMatch[1], userId);

    // POST /api/google/drafts/:id/publish
    const publishMatch = path.match(/^drafts\/([^/]+)\/publish$/);
    if (publishMatch && method === 'POST') return await publishDraft(publishMatch[1], body, userId);

    // POST /api/google/ai/generate
    if (path === 'ai/generate' && method === 'POST') return await generateContent(body, userId);

    // POST /api/google/ai/assist
    if (path === 'ai/assist' && method === 'POST') return await aiAssist(body);

    return err(`Unknown route: ${method} /api/google/${path}`, 404);
  } catch (e) {
    console.error('google-ads function error:', e);
    return err(e.message || 'Internal error', 500);
  }
}
