import { asFiniteNumber, loadGlobalSourcingPricingDefaults } from './global-sourcing-utils.js';

const SYNC_PROVIDER = 'cj';
const THRESHOLD_PERCENT = 3;
const BATCH_SIZE = 50;

/**
 * Check whether the new rate has moved ≥ THRESHOLD_PERCENT from the last sync rate.
 * Runs a full price sync if the threshold is met or if no prior sync exists.
 */
export async function checkThresholdAndSync(adminClient, newRate) {
  const { data, error } = await adminClient
    .from('global_sourcing_settings')
    .select('fx_last_price_sync_rate, fx_last_price_sync_at')
    .eq('provider', SYNC_PROVIDER)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read last sync rate: ${error.message}`);
  }

  const lastSyncRate = asFiniteNumber(data?.fx_last_price_sync_rate);

  if (lastSyncRate === null) {
    return runFxPriceSync(adminClient, { newRate, reason: 'initial_sync' });
  }

  const changePct = Math.abs((newRate - lastSyncRate) / lastSyncRate) * 100;

  if (changePct < THRESHOLD_PERCENT) {
    return {
      synced: false,
      reason: 'below_threshold',
      changePct: parseFloat(changePct.toFixed(2)),
      lastSyncRate,
      currentRate: newRate,
    };
  }

  return runFxPriceSync(adminClient, {
    newRate,
    reason: 'threshold_triggered',
    changePct: parseFloat(changePct.toFixed(2)),
    lastSyncRate,
  });
}

/**
 * Re-price every CJ simple product and all CJ variations using newRate.
 * Sale prices are re-scaled to maintain their original % discount.
 * Saves fx_last_price_sync_rate + fx_last_price_sync_at on completion.
 */
export async function runFxPriceSync(adminClient, { newRate, reason = 'manual', changePct, lastSyncRate } = {}) {
  if (!Number.isFinite(newRate) || newRate <= 0) {
    throw new Error('A valid positive USD/NGN rate is required for price sync');
  }

  const syncAt = new Date().toISOString();

  const pricingDefaults = await loadGlobalSourcingPricingDefaults(adminClient, SYNC_PROVIDER);
  const {
    import_buffer_usd: importBufferUsd,
    markup_percent: markupPercent,
    markup_flat_ngn: markupFlatNgn,
  } = pricingDefaults.values;

  let updatedSimple = 0;
  let updatedVariations = 0;
  let skipped = 0;
  const errors = [];

  // --- Simple / non-variable products ---
  let offset = 0;
  while (true) {
    const { data: products, error } = await adminClient
      .from('products')
      .select('id, regular_price, sale_price, sourcing_meta')
      .filter('sourcing_meta->>_global_sourcing_provider', 'eq', SYNC_PROVIDER)
      .neq('type', 'variable')
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      errors.push(`products fetch (offset ${offset}): ${error.message}`);
      break;
    }
    if (!products || products.length === 0) break;

    const updates = [];
    for (const product of products) {
      const update = computeProductUpdate(
        product, newRate, importBufferUsd, markupPercent, markupFlatNgn, syncAt
      );
      if (update) {
        updates.push(update);
      } else {
        skipped++;
      }
    }

    if (updates.length > 0) {
      const { error: upsertError } = await adminClient
        .from('products')
        .upsert(updates, { onConflict: 'id' });
      if (upsertError) {
        errors.push(`products upsert (offset ${offset}): ${upsertError.message}`);
      } else {
        updatedSimple += updates.length;
      }
    }

    if (products.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  // --- Product variations ---
  offset = 0;
  while (true) {
    const { data: variations, error } = await adminClient
      .from('product_variations')
      .select('id, regular_price, sale_price, sourcing_meta')
      .filter('sourcing_meta->>_global_sourcing_provider', 'eq', SYNC_PROVIDER)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      errors.push(`product_variations fetch (offset ${offset}): ${error.message}`);
      break;
    }
    if (!variations || variations.length === 0) break;

    const updates = [];
    for (const variation of variations) {
      const update = computeProductUpdate(
        variation, newRate, importBufferUsd, markupPercent, markupFlatNgn, syncAt
      );
      if (update) {
        updates.push(update);
      } else {
        skipped++;
      }
    }

    if (updates.length > 0) {
      const { error: upsertError } = await adminClient
        .from('product_variations')
        .upsert(updates, { onConflict: 'id' });
      if (upsertError) {
        errors.push(`product_variations upsert (offset ${offset}): ${upsertError.message}`);
      } else {
        updatedVariations += updates.length;
      }
    }

    if (variations.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  // Persist sync metadata regardless of errors so next threshold check is correct
  const { error: trackingError } = await adminClient
    .from('global_sourcing_settings')
    .upsert(
      { provider: SYNC_PROVIDER, fx_last_price_sync_rate: newRate, fx_last_price_sync_at: syncAt },
      { onConflict: 'provider' }
    );

  if (trackingError) {
    errors.push(`tracking upsert: ${trackingError.message}`);
  }

  // Write audit log row (fire-and-forget — never throw on logging failure)
  try {
    await adminClient.from('fx_price_sync_logs').insert({
      reason,
      rate_used: newRate,
      previous_rate: lastSyncRate ?? null,
      change_pct: changePct ?? null,
      updated_simple: updatedSimple,
      updated_variations: updatedVariations,
      skipped,
      errors: errors.length > 0 ? errors : null,
    });
  } catch {
    // non-critical
  }

  return {
    synced: true,
    reason,
    newRate,
    syncAt,
    ...(changePct !== undefined ? { changePct } : {}),
    ...(lastSyncRate !== undefined ? { lastSyncRate } : {}),
    updatedSimple,
    updatedVariations,
    skipped,
    errors: errors.length > 0 ? errors : null,
  };
}

function computeProductUpdate(row, newRate, importBufferUsd, markupPercent, markupFlatNgn, syncAt) {
  const meta = row.sourcing_meta;
  if (!meta || typeof meta !== 'object') return null;

  const supplierPriceUsd = asFiniteNumber(meta._supplier_price_snapshot_usd);
  if (supplierPriceUsd === null) return null;

  const inboundShippingUsd = asFiniteNumber(meta._inbound_shipping_snapshot_usd) ?? 0;

  const landedCostUsd = supplierPriceUsd + inboundShippingUsd + importBufferUsd;
  const baseNgn = landedCostUsd * newRate;
  const landedCostNgn = baseNgn + markupFlatNgn;
  const newRegular = landedCostNgn * (1 + markupPercent / 100);

  let newSale = null;
  const oldRegular = asFiniteNumber(row.regular_price);
  const oldSale = asFiniteNumber(row.sale_price);

  if (
    oldRegular !== null && oldRegular > 0 &&
    oldSale !== null && oldSale > 0 && oldSale < oldRegular
  ) {
    const discountFrac = (oldRegular - oldSale) / oldRegular;
    newSale = newRegular * (1 - discountFrac);
  }

  return {
    id: row.id,
    regular_price: parseFloat(newRegular.toFixed(2)),
    sale_price: newSale !== null ? parseFloat(newSale.toFixed(2)) : null,
    sourcing_meta: {
      ...meta,
      _usd_to_ngn_rate_snapshot: String(newRate),
      _fx_price_sync_at: syncAt,
    },
  };
}
