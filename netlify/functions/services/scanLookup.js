/**
 * Shared scan-code normalization + shipment lookup for waybill/label QR codes.
 */

export function normalizeScanCode(raw) {
  let code = String(raw ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim();

  if (!code) return '';

  if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code);
      const param =
        url.searchParams.get('trackingNumber') ||
        url.searchParams.get('tracking') ||
        url.searchParams.get('code') ||
        url.searchParams.get('waybill');
      if (param) {
        code = param.trim();
      } else {
        const segment = url.pathname.split('/').filter(Boolean).pop();
        if (segment) code = segment;
      }
    } catch {
      /* keep original */
    }
  }

  return code.trim();
}

export function scanCodeVariants(raw) {
  const base = normalizeScanCode(raw);
  if (!base) return [];

  const variants = [base];
  const upper = base.toUpperCase();
  if (upper !== base) variants.push(upper);

  const compact = base.replace(/\s+/g, '');
  if (compact !== base) variants.push(compact, compact.toUpperCase());

  return [...new Set(variants.filter(Boolean))];
}

const MANUAL_SELECT = '*';

const SUB_ORDER_SELECT = `
  id,
  main_order_id,
  hub_id,
  tracking_number,
  courier_waybill,
  waybill_number,
  metadata,
  vendors ( store_name ),
  orders:main_order_id (
    woocommerce_order_id,
    order_number,
    customer_name,
    delivery_city,
    delivery_state
  )
`;

async function firstMatch(supabase, table, select, field, value, { ilike = false, hubIds = null } = {}) {
  let query = supabase.from(table).select(select).limit(1);
  query = ilike ? query.ilike(field, value) : query.eq(field, value);
  if (hubIds?.length) query = query.in('hub_id', hubIds);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error(`scanLookup ${table}.${field}:`, error.message, { value, hubIds });
    return null;
  }
  return data || null;
}

function hubMismatchForRow(row, hubIds) {
  if (!row?.hub_id || !hubIds?.length) return false;
  return !hubIds.includes(row.hub_id);
}

export async function findManualShipmentByScan(supabase, rawCode) {
  const variants = scanCodeVariants(rawCode);
  if (!variants.length) return null;

  for (const ref of variants) {
    const attempts = [
      ['waybill_number', ref, false],
      ['waybill_number', ref, true],
      ['tracking_number', ref, false],
      ['courier_waybill', ref, false],
      ['shipment_code', ref.toUpperCase(), false],
    ];

    for (const [field, value, useIlike] of attempts) {
      const row = await firstMatch(supabase, 'manual_shipments', MANUAL_SELECT, field, value, { ilike: useIlike });
      if (row) return row;
    }
  }

  return null;
}

/**
 * Resolve an order sub-shipment from a scanned label or waybill QR.
 * Waybill numbers (JLO-WB-…) are globally unique — looked up without hub filter first.
 * Tracking numbers try the selected hub first, then fall back to a global search.
 */
export async function findSubOrderByScan(supabase, rawCode, hubIds) {
  const variants = scanCodeVariants(rawCode);
  if (!variants.length) return { row: null, hubMismatch: false };

  // 1. Formal waybill QR — global unique waybill_number
  for (const ref of variants) {
    for (const ilike of [false, true]) {
      const row = await firstMatch(supabase, 'sub_orders', SUB_ORDER_SELECT, 'waybill_number', ref, { ilike });
      if (row) return { row, hubMismatch: hubMismatchForRow(row, hubIds) };
    }
  }

  // 2. Shipping-label QR — prefer current hub, then anywhere
  for (const ref of variants) {
    for (const field of ['tracking_number', 'courier_waybill']) {
      if (hubIds?.length) {
        const row = await firstMatch(supabase, 'sub_orders', SUB_ORDER_SELECT, field, ref, { hubIds });
        if (row) return { row, hubMismatch: false };
      }

      const row = await firstMatch(supabase, 'sub_orders', SUB_ORDER_SELECT, field, ref);
      if (row) return { row, hubMismatch: hubMismatchForRow(row, hubIds) };
    }
  }

  return { row: null, hubMismatch: false };
}

export async function resolveScanMatch(supabase, rawCode, hubIds) {
  const code = normalizeScanCode(rawCode);
  if (!code) return { code: '', match: null };

  // Order waybills first — dispatch screen is order-centric; waybill numbers never overlap tables.
  const { row: subOrder, hubMismatch: subHubMismatch } = await findSubOrderByScan(supabase, code, hubIds);
  if (subOrder) {
    return {
      code,
      match: { type: 'sub_order', data: subOrder, hubMismatch: subHubMismatch },
    };
  }

  const manualShipment = await findManualShipmentByScan(supabase, code);
  if (manualShipment) {
    const hubMismatch = hubMismatchForRow(
      { hub_id: manualShipment.sender_hub_id },
      hubIds,
    );
    return {
      code,
      match: { type: 'manual_shipment', data: manualShipment, hubMismatch },
    };
  }

  return { code, match: null };
}
