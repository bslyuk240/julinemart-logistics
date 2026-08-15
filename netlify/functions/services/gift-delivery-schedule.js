/**
 * Gift G5 — delivery date validation against GFC lead times and hub flags.
 */

const LAGOS_TZ = 'Africa/Lagos';

function parseDateOnly(value) {
  if (!value) return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Calendar date in Africa/Lagos as UTC midnight components. */
function todayInLagos() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysUtc(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function isBefore(a, b) {
  return a.getTime() < b.getTime();
}

function hubCutoffPassed(cutoffTime) {
  if (!cutoffTime) return false;
  const nowParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LAGOS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(nowParts.find((p) => p.type === 'hour')?.value || 0);
  const min = Number(nowParts.find((p) => p.type === 'minute')?.value || 0);
  const nowMins = h * 60 + min;

  const [ch, cm] = String(cutoffTime).split(':').map(Number);
  if (!Number.isFinite(ch)) return false;
  const cutoffMins = ch * 60 + (Number.isFinite(cm) ? cm : 0);
  return nowMins >= cutoffMins;
}

/**
 * Compute earliest deliverable date from max component lead time + packaging buffer.
 */
export function computeEarliestDeliveryDate({
  gfc,
  maxLeadTimeDays = 0,
  packBufferDays = 1,
}) {
  const today = todayInLagos();
  let minDaysOut = Math.max(0, Number(maxLeadTimeDays || 0)) + packBufferDays;

  if (minDaysOut === packBufferDays && gfc?.same_day_supported && !hubCutoffPassed(gfc.cutoff_time)) {
    minDaysOut = 0;
  } else if (minDaysOut === packBufferDays && gfc?.next_day_supported) {
    minDaysOut = Math.min(minDaysOut, 1);
  }

  return addDaysUtc(today, minDaysOut);
}

export function validateRequestedDeliveryDate({ gfc, requestedDate, maxLeadTimeDays = 0 }) {
  const parsed = parseDateOnly(requestedDate);
  if (!parsed) {
    return { valid: false, error: 'Invalid delivery date format (use YYYY-MM-DD)' };
  }

  const today = todayInLagos();
  if (isBefore(parsed, today)) {
    return { valid: false, error: 'Delivery date cannot be in the past' };
  }

  const earliest = computeEarliestDeliveryDate({ gfc, maxLeadTimeDays });
  if (isBefore(parsed, earliest)) {
    return {
      valid: false,
      error: `Earliest delivery for this gift is ${formatDateOnly(earliest)} (pool lead time + packing)`,
      earliest_date: formatDateOnly(earliest),
    };
  }

  const maxDate = addDaysUtc(today, 90);
  if (parsed.getTime() > maxDate.getTime()) {
    return { valid: false, error: 'Delivery date must be within 90 days' };
  }

  return {
    valid: true,
    requested_delivery_date: formatDateOnly(parsed),
    earliest_date: formatDateOnly(earliest),
    latest_date: formatDateOnly(maxDate),
  };
}

export async function maxLeadTimeForGiftLines(adminClient, lines, gfcId) {
  let maxLead = 0;

  const productIds = [...new Set(lines.filter((l) => l.product_id).map((l) => l.product_id))];
  if (productIds.length) {
    const { data: poolRows } = await adminClient
      .from('gift_pool_inventory')
      .select('product_id, variation_id, lead_time_days')
      .eq('gift_fulfilment_centre_id', gfcId)
      .in('product_id', productIds)
      .eq('active', true);

    for (const line of lines.filter((l) => l.product_id)) {
      const pool =
        (poolRows || []).find(
          (r) =>
            r.product_id === line.product_id &&
            (r.variation_id === line.variation_id || (!r.variation_id && !line.variation_id))
        ) ||
        (poolRows || []).find((r) => r.product_id === line.product_id);
      maxLead = Math.max(maxLead, Number(pool?.lead_time_days || 0));
    }
  }

  const sourcedIds = [...new Set(lines.filter((l) => l.pool_sourced_item_id).map((l) => l.pool_sourced_item_id))];
  if (sourcedIds.length) {
    const { data: sourcedRows } = await adminClient
      .from('gift_pool_sourced_items')
      .select('id, lead_time_days')
      .eq('gift_fulfilment_centre_id', gfcId)
      .in('id', sourcedIds);

    for (const row of sourcedRows || []) {
      maxLead = Math.max(maxLead, Number(row.lead_time_days || 0));
    }
  }

  return maxLead;
}

export async function loadGfcSchedulingContext(adminClient, gfcId) {
  const { data, error } = await adminClient
    .from('gift_fulfilment_centres')
    .select(
      'id, code, name, state, city, same_day_supported, next_day_supported, cutoff_time, supported_delivery_zones'
    )
    .eq('id', gfcId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export function validateOccasionDate(occasionDate) {
  if (!occasionDate) return { valid: true, occasion_date: null };
  const parsed = parseDateOnly(occasionDate);
  if (!parsed) return { valid: false, error: 'Invalid occasion date' };

  const today = todayInLagos();
  const maxFuture = addDaysUtc(today, 365);
  if (isBefore(parsed, addDaysUtc(today, -1))) {
    return { valid: false, error: 'Occasion date cannot be more than a day in the past' };
  }
  if (parsed.getTime() > maxFuture.getTime()) {
    return { valid: false, error: 'Occasion date must be within one year' };
  }
  return { valid: true, occasion_date: formatDateOnly(parsed) };
}
