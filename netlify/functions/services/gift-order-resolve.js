/**
 * Resolve gift box / builder lines into commercial components (G4.5).
 */
import {
  catalogUnitPrice,
  poolKey,
  resolveUnitCost,
} from './gift-commercial.js';

const PRODUCT_SELECT =
  'id, name, slug, sku, regular_price, sale_price, cost_price, vendor_id, hub_id, gift_eligible, status';

export async function resolveVendorCatalogLine(adminClient, item, gfcId, poolMap) {
  const { data: product, error } = await adminClient
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('id', item.product_id)
    .maybeSingle();

  if (error) throw error;
  if (!product?.gift_eligible || product.status !== 'published') {
    throw new Error(`Product unavailable for gifting: ${product?.name || item.product_id}`);
  }

  let variation = null;
  if (item.variation_id) {
    const { data: v } = await adminClient
      .from('product_variations')
      .select('id, regular_price, sale_price, cost_price, sku, vendor_id, hub_id')
      .eq('id', item.variation_id)
      .maybeSingle();
    variation = v;
  }

  const pool =
    poolMap.get(poolKey(item.product_id, item.variation_id)) ||
    poolMap.get(poolKey(item.product_id, null));

  if (!pool || pool.available_qty < item.quantity) {
    throw new Error(`Insufficient pool stock for "${product.name}"`);
  }

  const unitCost = resolveUnitCost({
    componentCost: item.component_cost,
    giftProgramCost: pool.gift_program_cost,
    productCostPrice: variation?.cost_price ?? product.cost_price,
  });

  const settlementUnit = catalogUnitPrice(product, variation);
  if (settlementUnit <= 0) {
    throw new Error(`Product "${product.name}" has no catalog price for vendor settlement`);
  }

  const payoutStatus =
    item.vendor_payout_status && item.vendor_payout_status !== 'pending'
      ? item.vendor_payout_status
      : pool?.vendor_pre_settled
        ? 'pre_settled'
        : 'pending';

  const qty = item.quantity;
  const vendorId = variation?.vendor_id || product.vendor_id || null;
  const hubId = variation?.hub_id || product.hub_id || null;

  return {
    line_source: 'vendor_catalog',
    product_id: product.id,
    pool_sourced_item_id: null,
    vendor_id: vendorId,
    name: product.name,
    sku: variation?.sku || product.sku || null,
    quantity: qty,
    gift_program_cost: unitCost,
    vendor_settlement_unit_price: settlementUnit,
    vendor_settlement_subtotal: settlementUnit * qty,
    vendor_payout_status: payoutStatus,
    variation_id: variation?.id || null,
    variation_details: variation ? { attributes: variation.attributes || [] } : null,
    hub_id: hubId,
    customisation_spec: item.customisation_spec || null,
    order_item: {
      product_id: product.id,
      product_name: product.name,
      product_sku: variation?.sku || product.sku || null,
      variation_id: variation?.id || null,
      variation_details: variation ? { attributes: variation.attributes || [] } : null,
      vendor_id: vendorId,
      hub_id: hubId,
      unit_price: settlementUnit,
      cost_price: unitCost,
      quantity: qty,
      subtotal: settlementUnit * qty,
    },
  };
}

export async function resolveSourcedLine(adminClient, item, gfcId) {
  const sourcedId = item.pool_sourced_item_id;
  if (!sourcedId) throw new Error('pool_sourced_item_id required for jlo_sourced line');

  const { data: sourced, error } = await adminClient
    .from('gift_pool_sourced_items')
    .select('*')
    .eq('id', sourcedId)
    .eq('gift_fulfilment_centre_id', gfcId)
    .eq('active', true)
    .maybeSingle();

  if (error) throw error;
  if (!sourced) throw new Error('Sourced pool item not found or inactive');
  if (sourced.available_qty < item.quantity) {
    throw new Error(`Insufficient stock for "${sourced.name}"`);
  }

  const qty = item.quantity;
  const unitCost = resolveUnitCost({
    componentCost: item.component_cost,
    giftProgramCost: sourced.gift_program_cost,
    productCostPrice: sourced.gift_program_cost,
  });

  return {
    line_source: 'jlo_sourced',
    product_id: null,
    pool_sourced_item_id: sourced.id,
    vendor_id: null,
    name: sourced.name,
    sku: sourced.sku || null,
    quantity: qty,
    gift_program_cost: unitCost,
    vendor_settlement_unit_price: 0,
    vendor_settlement_subtotal: 0,
    vendor_payout_status: 'not_applicable',
    variation_id: null,
    variation_details: null,
    hub_id: null,
    order_item: null,
  };
}

export async function loadPoolMap(adminClient, gfcId, productIds) {
  if (!productIds.length) return new Map();
  const { data: poolRows, error } = await adminClient
    .from('gift_pool_inventory')
    .select('product_id, variation_id, available_qty, gift_program_cost, active, vendor_pre_settled')
    .eq('gift_fulfilment_centre_id', gfcId)
    .in('product_id', productIds)
    .eq('active', true);

  if (error) throw error;
  return new Map((poolRows || []).map((r) => [poolKey(r.product_id, r.variation_id), r]));
}

export async function resolveBoxItemLines(adminClient, boxItems, gfcId) {
  const vendorProductIds = boxItems
    .filter((i) => (i.line_source || 'vendor_catalog') === 'vendor_catalog')
    .map((i) => i.product_id)
    .filter(Boolean);

  const poolMap = await loadPoolMap(adminClient, gfcId, [...new Set(vendorProductIds)]);
  const lines = [];

  for (const item of boxItems) {
    const source = item.line_source || 'vendor_catalog';
    if (source === 'jlo_sourced') {
      lines.push(await resolveSourcedLine(adminClient, item, gfcId));
    } else {
      lines.push(await resolveVendorCatalogLine(adminClient, item, gfcId, poolMap));
    }
  }

  const componentCostTotal = lines.reduce(
    (s, l) => s + Number(l.gift_program_cost || 0) * l.quantity,
    0
  );
  const vendorSettlementSubtotal = lines.reduce(
    (s, l) => s + Number(l.vendor_settlement_subtotal || 0),
    0
  );
  const vendorOrderItems = lines.filter((l) => l.order_item).map((l) => l.order_item);

  return { lines, componentCostTotal, vendorSettlementSubtotal, vendorOrderItems };
}

/** Resolve gift builder session lines (Mode B) — same commercial shape as ready-made boxes. */
export async function resolveBuilderItemLines(adminClient, builderItems, gfcId) {
  const vendorProductIds = builderItems
    .filter((i) => (i.line_source || 'vendor_catalog') === 'vendor_catalog')
    .map((i) => i.product_id)
    .filter(Boolean);

  const poolMap = await loadPoolMap(adminClient, gfcId, [...new Set(vendorProductIds)]);
  const lines = [];

  for (const item of builderItems) {
    const source = item.line_source || 'vendor_catalog';
    if (source === 'jlo_sourced') {
      lines.push(await resolveSourcedLine(adminClient, item, gfcId));
    } else {
      lines.push(await resolveVendorCatalogLine(adminClient, item, gfcId, poolMap));
    }
  }

  const componentCostTotal = lines.reduce(
    (s, l) => s + Number(l.gift_program_cost || 0) * l.quantity,
    0
  );
  const vendorSettlementSubtotal = lines.reduce(
    (s, l) => s + Number(l.vendor_settlement_subtotal || 0),
    0
  );
  const vendorOrderItems = lines.filter((l) => l.order_item).map((l) => l.order_item);

  return { lines, componentCostTotal, vendorSettlementSubtotal, vendorOrderItems };
}
