/**
 * Compute seller performance snapshots from orders, returns, and reviews.
 */

const TRUSTED_SELLER_MIN_ORDERS = 25;
const TRUSTED_SELLER_MIN_FULFILMENT = 92;
const TRUSTED_SELLER_MAX_DISPUTE_RATE = 3;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function pct(num, den) {
  if (!den || den <= 0) return null;
  return round2((num / den) * 100);
}

export async function computeSellerMetricsForVendor(adminClient, vendorId) {
  const { data: subOrders, error: subErr } = await adminClient
    .from('sub_orders')
    .select('id, status, delivered_at, created_at')
    .eq('vendor_id', vendorId);

  if (subErr) throw subErr;

  const rows = subOrders || [];
  const terminal = rows.filter((r) =>
    ['delivered', 'cancelled', 'refunded', 'failed'].includes(String(r.status || '').toLowerCase())
  );
  const delivered = rows.filter((r) => String(r.status || '').toLowerCase() === 'delivered');
  const successful_orders = delivered.length;

  const fulfilment_rate = pct(delivered.length, terminal.length || rows.length);

  const onTime = delivered.filter((r) => {
    if (!r.delivered_at || !r.created_at) return false;
    const hours = (new Date(r.delivered_at).getTime() - new Date(r.created_at).getTime()) / 3600000;
    return hours <= 72;
  });
  const on_time_dispatch = pct(onTime.length, delivered.length);

  const { count: returnCount } = await adminClient
    .from('return_requests')
    .select('id', { count: 'exact', head: true })
    .eq('vendor_id', vendorId);

  const dispute_rate = pct(returnCount || 0, Math.max(successful_orders, 1));

  const { data: reviews } = await adminClient
    .from('product_reviews')
    .select('rating')
    .eq('vendor_id', vendorId)
    .eq('status', 'approved');

  let product_accuracy = null;
  if (reviews?.length) {
    const good = reviews.filter((r) => Number(r.rating) >= 4).length;
    product_accuracy = pct(good, reviews.length);
  }

  const { data: verifications } = await adminClient
    .from('seller_verifications')
    .select('verification_type, status')
    .eq('vendor_id', vendorId);

  const approvedTypes = (verifications || [])
    .filter((v) => v.status === 'approved')
    .map((v) => v.verification_type);
  const verificationLevel = computeVerificationLevel(approvedTypes);

  const seller_quality_score = computeSellerQualityScore({
    successful_orders,
    fulfilment_rate,
    product_accuracy,
    on_time_dispatch,
    dispute_rate,
    verificationLevel,
  });

  const snapshot = {
    vendor_id: vendorId,
    successful_orders,
    fulfilment_rate,
    product_accuracy,
    on_time_dispatch,
    response_rate: null,
    avg_response_minutes: null,
    dispute_rate,
    repeat_customer_rate: null,
    seller_quality_score,
    computed_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await adminClient
    .from('seller_performance_snapshots')
    .upsert(snapshot, { onConflict: 'vendor_id' });

  if (upsertErr) throw upsertErr;

  await adminClient
    .from('vendors')
    .update({ seller_quality_score, updated_at: new Date().toISOString() })
    .eq('id', vendorId);

  if (
    successful_orders >= TRUSTED_SELLER_MIN_ORDERS &&
    (fulfilment_rate ?? 0) >= TRUSTED_SELLER_MIN_FULFILMENT &&
    (dispute_rate ?? 100) <= TRUSTED_SELLER_MAX_DISPUTE_RATE
  ) {
    await adminClient.from('seller_verifications').upsert(
      {
        vendor_id: vendorId,
        verification_type: 'trusted_seller',
        status: 'approved',
        verified_at: new Date().toISOString(),
        evidence: { source: 'metrics_job', snapshot },
      },
      { onConflict: 'vendor_id,verification_type' }
    );
  }

  return snapshot;
}

/** Composite 0–100 score for catalog/search ranking (Phase 3). */
export function computeSellerQualityScore({
  successful_orders,
  fulfilment_rate,
  product_accuracy,
  on_time_dispatch,
  dispute_rate,
  verificationLevel,
}) {
  let score = 40;
  if (fulfilment_rate != null) score += (fulfilment_rate - 50) * 0.35;
  if (product_accuracy != null) score += (product_accuracy - 50) * 0.25;
  else score += 5;
  if (on_time_dispatch != null) score += (on_time_dispatch - 50) * 0.15;
  if (dispute_rate != null) score -= Math.min(dispute_rate * 2.5, 25);
  score += Math.min(verificationLevel, 5) * 4;
  if (successful_orders >= 10) score += 3;
  if (successful_orders >= 50) score += 5;
  return round2(Math.max(0, Math.min(100, score)));
}

export async function computeAllSellerMetrics(adminClient) {
  const { data: vendors, error } = await adminClient
    .from('vendors')
    .select('id')
    .eq('is_active', true);

  if (error) throw error;

  const results = { updated: 0, errors: [] };
  for (const vendor of vendors || []) {
    try {
      await computeSellerMetricsForVendor(adminClient, vendor.id);
      results.updated += 1;
    } catch (err) {
      results.errors.push({ vendor_id: vendor.id, message: err?.message || String(err) });
    }
  }
  return results;
}

export function computeVerificationLevel(approvedTypes) {
  const set = new Set(approvedTypes || []);
  const has = (...types) => types.every((t) => set.has(t));

  if (set.has('julinemart_assured')) return 5;
  if (set.has('trusted_seller')) return 4;
  if (set.has('physical_store')) return 3;
  if (set.has('business_registration')) return 2;
  if (has('identity', 'phone', 'bank_account')) return 1;
  if (set.has('identity')) return 1;
  return 0;
}

export function buildVendorTrustProfile(vendorId, verifications, metrics) {
  const approved = (verifications || [])
    .filter((v) => v.status === 'approved')
    .map((v) => v.verification_type);

  const level = computeVerificationLevel(approved);
  const protect_eligible = level >= 1 || approved.includes('julinemart_assured');

  return {
    vendor_id: vendorId,
    level,
    verifications: approved,
    metrics: metrics || null,
    protect_eligible,
  };
}
