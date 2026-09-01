/**
 * Vendor-owned campaign CRUD (lite builder).
 * GET    — list vendor's campaigns
 * POST   — create draft or submit for review
 * PUT    — update draft / resubmit rejected
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor } from './services/vendorAuth.js';

const STOREFRONT_BASE = (process.env.STOREFRONT_URL || 'https://julinemart.com').replace(/\/$/, '');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function buildCampaignSlug(vendor, publicTitle, slugSuffix) {
  const vendorPart = slugify(vendor.store_slug || vendor.store_name || 'store').slice(0, 40);
  const campaignPart = slugify(slugSuffix || publicTitle).slice(0, 40);
  return `${vendorPart}-${campaignPart}`;
}

const DEFAULT_SECTIONS = [
  'hero',
  'products',
  'vendor_story',
  'offer',
  'reviews',
  'cta_footer',
];

async function upsertSections(adminClient, campaignId, offerVisible) {
  await adminClient.from('campaign_sections').delete().eq('campaign_id', campaignId);
  const rows = DEFAULT_SECTIONS.map((type, index) => ({
    campaign_id: campaignId,
    section_type: type,
    order_index: index,
    is_visible: type === 'offer' ? offerVisible : !['reviews'].includes(type),
    config: {},
  }));
  const { error } = await adminClient.from('campaign_sections').insert(rows);
  if (error) throw error;
}

function buildPayload(vendor, body, existing) {
  const publicTitle = String(body.public_title || existing?.public_title || '').trim();
  if (!publicTitle) throw new Error('Campaign title is required');

  const headline = String(body.hero_headline || body.headline || existing?.hero_config?.headline || publicTitle).trim();
  const subtitle = String(body.hero_subtitle || body.subtitle || existing?.hero_config?.subtitle || '').trim();
  const heroImage = String(body.hero_image_url || body.hero_image || existing?.hero_config?.heroImageMobile || '').trim();
  const offerText = String(body.offer_display_text || body.offer_text || existing?.offer_config?.displayText || '').trim();
  const productIds = Array.isArray(body.product_ids)
    ? body.product_ids.map(String).filter(Boolean)
    : String(body.product_ids || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  const wooId = vendor.woocommerce_vendor_id;
  const slug = buildCampaignSlug(vendor, publicTitle, body.slug_suffix);

  return {
    internal_name: `${vendor.store_name}: ${publicTitle}`.slice(0, 120),
    public_title: publicTitle,
    slug,
    campaign_objective: 'vendor_promotion',
    status: existing?.status === 'active' ? 'active' : 'draft',
    target_type: 'vendor',
    target_id: wooId ? String(wooId) : null,
    vendor_id: vendor.id,
    hero_config: {
      headline,
      subtitle,
      ctaLabel: 'Shop Now',
      heroImageDesktop: heroImage || undefined,
      heroImageMobile: heroImage || undefined,
    },
    vendor_override: {
      vendorId: wooId || vendor.id,
      name: vendor.store_name,
      logoUrl: vendor.logo_url || undefined,
      story: vendor.description || undefined,
      storeLinkUrl: wooId ? `/vendor/${wooId}` : undefined,
      introVideoUrl: vendor.intro_video_url || undefined,
    },
    product_selection_rules: {
      source: productIds.length ? 'manual' : 'automatic',
      vendorId: wooId || vendor.id,
      manualProductIds: productIds.length ? productIds : undefined,
      inStockOnly: true,
      maxProducts: 12,
    },
    review_rules: { scope: 'vendor', minimumRating: 4, maxReviews: 5, verifiedPurchaseOnly: true },
    offer_config: offerText ? { displayText: offerText } : {},
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

  const { vendor, adminClient, error: authErr } = await authenticateVendor(event);
  if (authErr) {
    return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: authErr }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await adminClient
        .from('campaigns')
        .select('id, slug, public_title, status, approval_status, submitted_at, reviewed_at, review_notes, start_date, end_date, created_at, updated_at')
        .eq('vendor_id', vendor.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const campaigns = (data || []).map((row) => ({
        ...row,
        storefront_url: `${STOREFRONT_BASE}/campaigns/${row.slug}`,
      }));

      return {
        statusCode: 200,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: true, data: campaigns }),
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const submit = body.action === 'submit';

    if (event.httpMethod === 'POST') {
      const payload = buildPayload(vendor, body, null);
      const approval_status = submit ? 'pending' : 'draft';

      const { data: created, error: insertErr } = await adminClient
        .from('campaigns')
        .insert({
          ...payload,
          approval_status,
          submitted_via: 'vendor',
          submitted_at: submit ? new Date().toISOString() : null,
        })
        .select('id, slug, approval_status, status')
        .single();

      if (insertErr) throw insertErr;

      await upsertSections(adminClient, created.id, Boolean(payload.offer_config?.displayText));

      return {
        statusCode: 201,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          success: true,
          data: {
            ...created,
            storefront_url: `${STOREFRONT_BASE}/campaigns/${created.slug}`,
            message: submit ? 'Campaign submitted for JulineMart review' : 'Campaign saved as draft',
          },
        }),
      };
    }

    if (event.httpMethod === 'PUT') {
      const campaignId = body.id || body.campaign_id;
      if (!campaignId) throw new Error('Campaign id is required');

      const { data: existing, error: fetchErr } = await adminClient
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .eq('vendor_id', vendor.id)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) throw new Error('Campaign not found');

      if (existing.approval_status === 'pending') {
        throw new Error('Campaign is under review and cannot be edited');
      }
      if (existing.approval_status === 'approved' && existing.status === 'active') {
        throw new Error('Active approved campaigns cannot be edited — contact support');
      }

      const payload = buildPayload(vendor, body, existing);
      const approval_status = submit ? 'pending' : (existing.approval_status === 'rejected' ? 'draft' : existing.approval_status || 'draft');

      const { data: updated, error: updateErr } = await adminClient
        .from('campaigns')
        .update({
          ...payload,
          approval_status,
          submitted_at: submit ? new Date().toISOString() : existing.submitted_at,
          reviewed_at: submit ? null : existing.reviewed_at,
          review_notes: submit ? null : existing.review_notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId)
        .select('id, slug, approval_status, status')
        .single();

      if (updateErr) throw updateErr;

      await upsertSections(adminClient, campaignId, Boolean(payload.offer_config?.displayText));

      return {
        statusCode: 200,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          success: true,
          data: {
            ...updated,
            storefront_url: `${STOREFRONT_BASE}/campaigns/${updated.slug}`,
            message: submit ? 'Campaign resubmitted for review' : 'Campaign updated',
          },
        }),
      };
    }

    return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  } catch (err) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: err?.message || 'Request failed' }),
    };
  }
}
