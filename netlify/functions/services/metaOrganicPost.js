/**
 * Organic (unpaid) Meta posting — Facebook Page feed + Instagram content
 * publishing. Distinct from meta-ads.js (Marketing API / paid ads): this
 * uses the Page's own Graph API edges, not the ad account.
 *
 * Requires a Page-scoped access token — META_ADS_ACCESS_TOKEN (used by
 * meta-ads.js) is an ad-account-scoped token and is NOT guaranteed to carry
 * pages_manage_posts / instagram_content_publish permission. Configure
 * META_PAGE_ACCESS_TOKEN separately. Instagram publishing additionally
 * needs the Page's linked Instagram Business Account id
 * (META_INSTAGRAM_BUSINESS_ACCOUNT_ID) — found via
 * GET /{page-id}?fields=instagram_business_account once the Page token is set up.
 *
 * https://developers.facebook.com/docs/pages/publishing
 * https://developers.facebook.com/docs/instagram-platform/content-publishing
 */
import { createClient } from '@supabase/supabase-js';
import { assertTrustedMediaUrl } from '../meta-ads.js';

/** Basic https-URL shape check for outbound link previews — no host allowlist:
 *  unlike image_url (which is fetched by JLO's server for uploadImageToMeta,
 *  or by Meta's servers for IG media), a Facebook post `link` is just resolved
 *  by Meta for a preview card, so there is no SSRF surface here, and the
 *  whole point is linking out to arbitrary pages (e.g. julinemart.com product
 *  pages), not just JLO's own media storage hosts. */
function assertHttpsUrl(url, label = 'URL') {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`${label} is not a valid URL`); }
  if (parsed.protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const META_API_BASE = 'https://graph.facebook.com/v21.0';

const PAGE_ID = process.env.META_PAGE_ID || '';
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || '';
const IG_BUSINESS_ACCOUNT_ID = process.env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID || '';

const supabase = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

async function logOrganicAction(action, resourceId, details, status = 'success', errorMsg) {
  if (!supabase) return;
  await supabase.from('meta_action_logs').insert({
    user_id: null,
    action,
    resource: action.startsWith('instagram') ? 'instagram_post' : 'facebook_post',
    resource_id: resourceId || null,
    details: details || null,
    status,
    error_msg: errorMsg || null,
  }).then(() => {}, () => {});
}

async function metaGet(path, params = {}) {
  const url = new URL(`${META_API_BASE}/${path}`);
  url.searchParams.set('access_token', PAGE_ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message || `Meta API error on ${path}`);
  return json;
}

async function metaPost(path, params) {
  const url = new URL(`${META_API_BASE}/${path}`);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Meta API error on ${path}`);
  }
  return json;
}

/**
 * Publish a post to the JulineMart Facebook Page feed — text/link, or a
 * photo with caption. Meta's Page API has no single endpoint that does
 * both: /feed takes message+link (no image), /photos takes url+caption
 * (no link preview) and still lands as a normal feed post. Passing both
 * imageUrl and link is rejected rather than silently dropping the link.
 * @param {{ message?: string, link?: string, imageUrl?: string }} input
 * @returns {Promise<{ post_id: string }>}
 */
export async function postToFacebookPage({ message, link, imageUrl }) {
  if (!PAGE_ID) throw new Error('META_PAGE_ID is not configured');
  if (!PAGE_ACCESS_TOKEN) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  if (imageUrl && link) throw new Error('A Facebook photo post cannot also carry a link preview — send imageUrl or link, not both.');

  if (imageUrl) {
    assertTrustedMediaUrl(imageUrl, 'imageUrl');
    const json = await metaPost(`${PAGE_ID}/photos`, {
      url: imageUrl,
      ...(message ? { caption: message.trim() } : {}),
      access_token: PAGE_ACCESS_TOKEN,
    });
    const postId = json.post_id || json.id;
    await logOrganicAction('facebook_post_create', postId, { message, imageUrl });
    return { post_id: postId };
  }

  if (!message || !message.trim()) throw new Error('message is required');
  if (link) assertHttpsUrl(link, 'link');

  const json = await metaPost(`${PAGE_ID}/feed`, {
    message: message.trim(),
    ...(link ? { link } : {}),
    access_token: PAGE_ACCESS_TOKEN,
  });

  await logOrganicAction('facebook_post_create', json.id, { message, link });
  return { post_id: json.id };
}

/**
 * Publish an image post to the JulineMart Instagram Business Account.
 * Two-step Graph API flow: create a media container, then publish it.
 * @param {{ imageUrl: string, caption?: string }} input
 * @returns {Promise<{ media_id: string }>}
 */
export async function postToInstagram({ imageUrl, caption }) {
  if (!IG_BUSINESS_ACCOUNT_ID) throw new Error('META_INSTAGRAM_BUSINESS_ACCOUNT_ID is not configured');
  if (!PAGE_ACCESS_TOKEN) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  if (!imageUrl) throw new Error('imageUrl is required');

  assertTrustedMediaUrl(imageUrl, 'imageUrl');

  const container = await metaPost(`${IG_BUSINESS_ACCOUNT_ID}/media`, {
    image_url: imageUrl,
    ...(caption ? { caption } : {}),
    access_token: PAGE_ACCESS_TOKEN,
  });
  if (!container.id) throw new Error('Meta did not return a media container id');

  let published;
  try {
    published = await metaPost(`${IG_BUSINESS_ACCOUNT_ID}/media_publish`, {
      creation_id: container.id,
      access_token: PAGE_ACCESS_TOKEN,
    });
  } catch (e) {
    await logOrganicAction('instagram_post_create', container.id, { imageUrl, caption }, 'failed', e.message);
    throw new Error(`Media container created but publish failed: ${e.message}`);
  }

  await logOrganicAction('instagram_post_create', published.id, { imageUrl, caption });
  return { media_id: published.id };
}

// ── Analytics / read-only ─────────────────────────────────────────────────
// Meta periodically renames/deprecates Insights metrics, so `metrics` (and
// `extra` for edge cases like metric_type) are caller-overridable rather than
// hardcoded-only — a stale default will surface as a clear Meta API error
// naming the valid options, rather than silently doing the wrong thing.

// Verified working against the live API on 2026-08-28 (v21.0) — several
// commonly-referenced metric names (page_impressions_unique, page_fans,
// page_engaged_users, page_impressions) are rejected outright by Meta on
// this API version despite being widely documented/expected; these three
// are the ones that actually return data.
const DEFAULT_PAGE_INSIGHTS_METRICS = ['page_post_engagements', 'page_views_total', 'page_follows'];
// profile_views also works but requires metric_type=total_value (pass via
// the `extra` param) — left out of the zero-config default for that reason.
const DEFAULT_IG_INSIGHTS_METRICS = ['reach'];

/** Facebook Page profile basics — name, follower/fan counts, category. */
export async function getFacebookPageProfile() {
  if (!PAGE_ID) throw new Error('META_PAGE_ID is not configured');
  if (!PAGE_ACCESS_TOKEN) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  return metaGet(PAGE_ID, { fields: 'name,category,followers_count,fan_count,link' });
}

/** Recent Page posts with engagement counts (likes/comments/shares) — stable fields, no Insights edge involved. */
// likes.summary(true) / comments.summary(true) are gated behind Meta's "Page
// Public Content Access" feature (requires formal App Review approval, not
// just a permission grant) — verified directly against the live API, both
// fail with "(#10) requires ... 'Page Public Content Access' feature" even
// with a fully-scoped token. shares works without it. Until/unless that
// review is completed, likes/comments counts are unavailable here.
export async function listFacebookPagePosts({ limit = 10 } = {}) {
  if (!PAGE_ID) throw new Error('META_PAGE_ID is not configured');
  if (!PAGE_ACCESS_TOKEN) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  const data = await metaGet(`${PAGE_ID}/posts`, {
    fields: 'id,message,created_time,permalink_url,shares',
    limit: String(Math.min(50, Math.max(1, Number(limit) || 10))),
  });
  return (data.data || []).map((p) => ({
    id: p.id,
    message: p.message || null,
    created_time: p.created_time,
    permalink_url: p.permalink_url,
    shares: p.shares?.count ?? 0,
  }));
}

/** Page-level Insights (reach, engagement, etc.) — see comment above on `metrics`/`extra`. */
export async function getFacebookPageInsights({ metrics, period = 'day', since, until, extra } = {}) {
  if (!PAGE_ID) throw new Error('META_PAGE_ID is not configured');
  if (!PAGE_ACCESS_TOKEN) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  const metricList = Array.isArray(metrics) && metrics.length ? metrics : DEFAULT_PAGE_INSIGHTS_METRICS;
  const data = await metaGet(`${PAGE_ID}/insights`, {
    metric: metricList.join(','),
    period,
    since,
    until,
    ...(extra && typeof extra === 'object' ? extra : {}),
  });
  return data.data || [];
}

/** Instagram Business Account profile basics — username, follower count, media count. */
export async function getInstagramProfile() {
  if (!IG_BUSINESS_ACCOUNT_ID) throw new Error('META_INSTAGRAM_BUSINESS_ACCOUNT_ID is not configured');
  if (!PAGE_ACCESS_TOKEN) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  return metaGet(IG_BUSINESS_ACCOUNT_ID, { fields: 'username,name,followers_count,media_count' });
}

/** Recent Instagram media with like/comment counts — stable fields, no Insights edge involved. */
export async function listInstagramMedia({ limit = 10 } = {}) {
  if (!IG_BUSINESS_ACCOUNT_ID) throw new Error('META_INSTAGRAM_BUSINESS_ACCOUNT_ID is not configured');
  if (!PAGE_ACCESS_TOKEN) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  const data = await metaGet(`${IG_BUSINESS_ACCOUNT_ID}/media`, {
    fields: 'id,caption,media_type,timestamp,permalink,like_count,comments_count',
    limit: String(Math.min(50, Math.max(1, Number(limit) || 10))),
  });
  return data.data || [];
}

/** Instagram account-level Insights (reach, profile views, etc.) — see comment above on `metrics`/`extra`. */
export async function getInstagramInsights({ metrics, period = 'day', since, until, extra } = {}) {
  if (!IG_BUSINESS_ACCOUNT_ID) throw new Error('META_INSTAGRAM_BUSINESS_ACCOUNT_ID is not configured');
  if (!PAGE_ACCESS_TOKEN) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  const metricList = Array.isArray(metrics) && metrics.length ? metrics : DEFAULT_IG_INSIGHTS_METRICS;
  const data = await metaGet(`${IG_BUSINESS_ACCOUNT_ID}/insights`, {
    metric: metricList.join(','),
    period,
    since,
    until,
    ...(extra && typeof extra === 'object' ? extra : {}),
  });
  return data.data || [];
}
