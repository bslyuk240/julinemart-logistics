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
 * Publish a text/link post to the JulineMart Facebook Page feed.
 * @param {{ message: string, link?: string }} input
 * @returns {Promise<{ post_id: string }>}
 */
export async function postToFacebookPage({ message, link }) {
  if (!PAGE_ID) throw new Error('META_PAGE_ID is not configured');
  if (!PAGE_ACCESS_TOKEN) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
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
