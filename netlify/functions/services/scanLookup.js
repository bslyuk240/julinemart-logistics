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

  // Waybill numbers are uppercase; also try without accidental spaces around dashes.
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

async function firstMatch(supabase, table, select, field, value, { ilike = false } = {}) {
  let query = supabase.from(table).select(select).limit(1);
  query = ilike ? query.ilike(field, value) : query.eq(field, value);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error(`scanLookup ${table}.${field}:`, error.message, { value });
    return null;
  }
  return data || null;
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

export async function findSubOrderByScan(supabase, rawCode, allHubIds) {
  const variants = scanCodeVariants(rawCode);
  if (!variants.length || !allHubIds?.length) return null;

  for (const ref of variants) {
    for (const field of ['tracking_number', 'courier_waybill', 'waybill_number']) {
      const { data, error } = await supabase
        .from('sub_orders')
        .select(SUB_ORDER_SELECT)
        .eq(field, ref)
        .in('hub_id', allHubIds)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(`scanLookup sub_orders.${field}:`, error.message, { ref });
        continue;
      }
      if (data) return data;
    }
  }

  return null;
}
