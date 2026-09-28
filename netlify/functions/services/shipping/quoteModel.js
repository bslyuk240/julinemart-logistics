export function parseEtaDays(raw) {
  if (raw == null) return { min: null, max: null };
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const days = Math.max(0, Math.round(raw));
    return { min: days, max: days };
  }
  const text = String(raw);
  const nums = [...text.matchAll(/(\d+)/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return { min: null, max: null };
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

export function normalizeQuote({
  provider,
  providerQuoteId = null,
  courierName,
  serviceName = null,
  amount,
  currency = 'NGN',
  etaMinDays = null,
  etaMaxDays = null,
  pickupAvailable = null,
  expiresAt = null,
  rawReference = {},
}) {
  const cost = Number(amount);
  return {
    provider: String(provider || '').toLowerCase(),
    provider_quote_id: providerQuoteId == null ? null : String(providerQuoteId),
    courier_name: courierName || provider,
    service_name: serviceName || 'Standard Delivery',
    amount: Number.isFinite(cost) ? cost : 0,
    currency,
    estimated_delivery_min_days: etaMinDays,
    estimated_delivery_max_days: etaMaxDays,
    pickup_available: pickupAvailable,
    expires_at: expiresAt,
    raw_reference: rawReference || {},
  };
}

export function toStoredQuote(normalized, { orderId, subOrderId, requestedAt, expiresAt }) {
  return {
    order_id: orderId,
    sub_order_id: subOrderId,
    provider: normalized.provider,
    provider_quote_id: normalized.provider_quote_id,
    courier_name: normalized.courier_name,
    service_name: normalized.service_name,
    cost: normalized.amount,
    currency: normalized.currency || 'NGN',
    eta_min_days: normalized.estimated_delivery_min_days,
    eta_max_days: normalized.estimated_delivery_max_days,
    pickup_available: normalized.pickup_available,
    quote_status: 'active',
    requested_at: requestedAt,
    expires_at: expiresAt || normalized.expires_at,
    provider_metadata: normalized.raw_reference || {},
  };
}

export function toPublicQuote(row, customerShippingCharge) {
  const cost = Number(row.cost || 0);
  const charged = Number(customerShippingCharge || 0);
  return {
    id: row.id,
    provider: row.provider,
    provider_quote_id: row.provider_quote_id,
    courier: row.courier_name,
    service_name: row.service_name,
    amount: cost,
    currency: row.currency || 'NGN',
    estimated_delivery_min_days: row.eta_min_days,
    estimated_delivery_max_days: row.eta_max_days,
    pickup_available: row.pickup_available,
    expires_at: row.expires_at,
    quote_status: row.quote_status,
    requested_at: row.requested_at,
    shipping_margin: charged - cost,
  };
}
