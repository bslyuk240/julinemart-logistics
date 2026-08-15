/**
 * Campaign voucher validation for gift orders.
 * Gift box = one sellable SKU; vendor lines inside are settled separately.
 */
import {
  validateVoucher,
  recordVoucherRedemption,
} from '../helpers/voucherHelpers.js';
import { resolveBoxItemLines, resolveBuilderItemLines } from './gift-order-resolve.js';
import {
  computeCustomerGiftTotal,
  loadGiftCommercialSettings,
} from './gift-commercial.js';
import {
  normalizeGiftSku,
  normalizeOccasionSlug,
  normalizeRecipientSlug,
  uniqueSlugs,
} from './gift-voucher-tags.js';
import { ensureBuilderSessionBoxSku } from './gift-box-sku.js';

export function computeGiftVoucherDiscount(voucher, customerSubtotal) {
  const subtotal = Math.max(0, Number(customerSubtotal || 0));
  if (!subtotal) return 0;

  switch (voucher.discount_type) {
    case 'percentage':
      return Math.min(
        subtotal,
        Math.round((subtotal * Number(voucher.discount_value || 0)) / 100)
      );
    case 'fixed_amount':
      return Math.min(Number(voucher.discount_value || 0), subtotal);
    case 'free':
      return subtotal;
    default:
      return 0;
  }
}

function normalizeStringArray(values) {
  return (values || []).map((v) => String(v || '').trim()).filter(Boolean);
}

export function voucherHasGiftScope(voucher) {
  return (
    normalizeStringArray(voucher.gift_box_skus).length > 0 ||
    normalizeStringArray(voucher.gift_occasion_slugs).length > 0 ||
    normalizeStringArray(voucher.gift_recipient_slugs).length > 0
  );
}

export function voucherHasMarketplaceScope(voucher) {
  return (
    normalizeStringArray(voucher.product_ids).length > 0 ||
    normalizeStringArray(voucher.product_skus).length > 0 ||
    normalizeStringArray(voucher.vendor_ids).length > 0 ||
    normalizeStringArray(voucher.category_ids).length > 0
  );
}

export function validateGiftVoucherScope(voucher, giftContext) {
  const boxSkus = normalizeStringArray(voucher.gift_box_skus).map(normalizeGiftSku);
  const occasionSlugs = normalizeStringArray(voucher.gift_occasion_slugs).map((s) => s.toLowerCase());
  const recipientSlugs = normalizeStringArray(voucher.gift_recipient_slugs).map((s) => s.toLowerCase());

  const contextBoxSku = normalizeGiftSku(giftContext.boxSku);
  const contextOccasions = uniqueSlugs((giftContext.occasionSlugs || []).map((s) => s.toLowerCase()));
  const contextRecipients = uniqueSlugs((giftContext.recipientSlugs || []).map((s) => s.toLowerCase()));

  if (boxSkus.length > 0) {
    if (!contextBoxSku || !boxSkus.includes(contextBoxSku)) {
      return {
        isValid: false,
        message: 'Voucher does not apply to this gift box SKU',
      };
    }
  }

  if (occasionSlugs.length > 0) {
    if (!contextOccasions.some((slug) => occasionSlugs.includes(slug))) {
      return {
        isValid: false,
        message: 'Voucher does not apply to this gift occasion',
      };
    }
  }

  if (recipientSlugs.length > 0) {
    if (!contextRecipients.some((slug) => recipientSlugs.includes(slug))) {
      return {
        isValid: false,
        message: 'Voucher does not apply to this gift recipient type',
      };
    }
  }

  return { isValid: true, message: 'Voucher applies to this gift order' };
}

async function resolveGfc(adminClient, code, gfcId) {
  let q = adminClient.from('gift_fulfilment_centres').select('id, code').eq('active', true);
  if (gfcId) q = q.eq('id', gfcId);
  else if (code) q = q.eq('code', String(code).trim().toLowerCase());
  else q = q.eq('is_default', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

function collectOccasionSlugs(...sources) {
  return uniqueSlugs(sources.flatMap((src) => {
    if (!src) return [];
    if (Array.isArray(src)) {
      return src.map((v) => normalizeOccasionSlug(v)).filter(Boolean);
    }
    const slug = normalizeOccasionSlug(src);
    return slug ? [slug] : [];
  }));
}

function collectRecipientSlugs(...sources) {
  return uniqueSlugs(sources.flatMap((src) => {
    if (!src) return [];
    if (Array.isArray(src)) {
      return src.map((v) => normalizeRecipientSlug(v)).filter(Boolean);
    }
    const slug = normalizeRecipientSlug(src);
    return slug ? [slug] : [];
  }));
}

/**
 * Resolve gift checkout into voucher context (box SKU + tags + commercial lines).
 */
export async function resolveGiftVoucherContext(adminClient, body) {
  const gfc = await resolveGfc(adminClient, body.gfc_code, body.gfc_id);
  if (!gfc) throw new Error('Gift fulfilment centre not found');

  const checkoutOccasion = body.occasion || body.checkout_occasion || null;

  if (body.builder_session_token) {
    const { data: session, error: sessErr } = await adminClient
      .from('gift_builder_sessions')
      .select(`
        id,
        gift_packaging_type_id,
        recipient_type,
        occasion,
        box_sku,
        gift_packaging_types ( id, code, sku, price )
      `)
      .eq('session_token', String(body.builder_session_token).trim())
      .maybeSingle();
    if (sessErr) throw sessErr;
    if (!session) throw new Error('Builder session not found');

    const boxSku = await ensureBuilderSessionBoxSku(adminClient, session);

    const { data: builderItems, error: biErr } = await adminClient
      .from('gift_builder_items')
      .select(
        'product_id, variation_id, quantity, component_cost, line_source, pool_sourced_item_id'
      )
      .eq('gift_builder_session_id', session.id);
    if (biErr) throw biErr;

    const resolved = await resolveBuilderItemLines(adminClient, builderItems || [], gfc.id);
    const packaging = session.gift_packaging_types;
    let packagingFee = 0;
    if (packaging?.price != null) packagingFee = Number(packaging.price);

    const settings = await loadGiftCommercialSettings(adminClient, gfc.id);
    const pricing = computeCustomerGiftTotal({
      componentCostTotal: resolved.componentCostTotal,
      packagingFee,
      settings,
    });

    return {
      orderKind: 'gift_custom',
      boxSku,
      occasionSlugs: collectOccasionSlugs(session.occasion, checkoutOccasion),
      recipientSlugs: collectRecipientSlugs(session.recipient_type),
      customerSubtotal: pricing.customerSubtotal,
      lines: resolved.lines,
      vendorSettlementSubtotal: resolved.vendorSettlementSubtotal,
    };
  }

  if (body.gift_box_slug || body.gift_box_id) {
    let boxQuery = adminClient
      .from('gift_boxes')
      .select('id, slug, sku, list_price, recipient_types, occasion_types')
      .eq('gift_fulfilment_centre_id', gfc.id)
      .eq('active', true);

    if (body.gift_box_id) boxQuery = boxQuery.eq('id', body.gift_box_id);
    else boxQuery = boxQuery.eq('slug', String(body.gift_box_slug).trim().toLowerCase());

    const { data: box, error: boxErr } = await boxQuery.maybeSingle();
    if (boxErr) throw boxErr;
    if (!box) throw new Error('Gift box not found');

    const { data: boxItems, error: itemsErr } = await adminClient
      .from('gift_box_items')
      .select(
        'product_id, variation_id, quantity, component_cost, line_source, pool_sourced_item_id'
      )
      .eq('gift_box_id', box.id);
    if (itemsErr) throw itemsErr;

    const resolved = await resolveBoxItemLines(adminClient, boxItems || [], gfc.id);

    return {
      orderKind: 'gift_ready_made',
      boxSku: box.sku || box.slug,
      occasionSlugs: collectOccasionSlugs(box.occasion_types, checkoutOccasion),
      recipientSlugs: collectRecipientSlugs(box.recipient_types),
      customerSubtotal: Number(box.list_price || 0),
      lines: resolved.lines,
      vendorSettlementSubtotal: resolved.vendorSettlementSubtotal,
    };
  }

  if (body.order_subtotal != null) {
    return {
      orderKind: body.order_kind || 'gift_unknown',
      boxSku: body.gift_box_sku ? normalizeGiftSku(body.gift_box_sku) : null,
      occasionSlugs: collectOccasionSlugs(body.occasion, checkoutOccasion),
      recipientSlugs: collectRecipientSlugs(body.recipient_type, body.recipient),
      customerSubtotal: Number(body.order_subtotal),
      lines: [],
      vendorSettlementSubtotal: 0,
    };
  }

  throw new Error('gift_box_slug, builder_session_token, or order_subtotal required');
}

export async function validateGiftCampaignVoucher(adminClient, params) {
  const code = String(params.code || params.voucher_code || '').trim();
  const customerEmail = String(params.customerEmail || params.customer_email || '').trim();
  const giftContext = params.giftContext;

  if (!code) throw new Error('Voucher code required');
  if (!customerEmail) throw new Error('Customer email required for voucher validation');
  if (!giftContext?.customerSubtotal) throw new Error('Order subtotal required');

  const voucher = await validateVoucher(adminClient, code.toUpperCase(), { customerEmail });
  if (!voucher) throw new Error('Invalid or expired voucher code');

  const hasGiftScope = voucherHasGiftScope(voucher);
  const hasMarketplaceScope = voucherHasMarketplaceScope(voucher);

  if (hasMarketplaceScope && !hasGiftScope) {
    throw new Error('This voucher is for marketplace checkout only');
  }

  const scopeResult = validateGiftVoucherScope(voucher, giftContext);
  if (!scopeResult.isValid) {
    throw new Error(scopeResult.message || 'Voucher does not apply to this gift order');
  }

  const discountAmount = computeGiftVoucherDiscount(voucher, giftContext.customerSubtotal);

  return {
    voucher,
    discountAmount,
    code: voucher.code,
    campaign_name: voucher.campaign_name,
  };
}

export async function recordGiftVoucherRedemption(adminClient, {
  voucher,
  orderId,
  customerEmail,
  customerName,
  customerSubtotal,
  discountAmount,
  vendorSettlementSubtotal,
  orderKind,
  giftBoxSku,
}) {
  const financials = {
    originalPrice: customerSubtotal,
    discountApplied: discountAmount,
    customerPaid: Math.max(customerSubtotal - discountAmount, 0),
    julinemartAbsorbed: discountAmount,
  };

  await recordVoucherRedemption(adminClient, {
    voucherId: voucher.id,
    orderId,
    customerEmail,
    customerName,
    financials,
    vendorPayout: vendorSettlementSubtotal,
    orderMetadata: {
      order_kind: orderKind,
      gift_order: true,
      gift_box_sku: giftBoxSku || null,
      platform_discount_absorbed: true,
    },
  });
}
