import { toPublicQuote, toStoredQuote } from './quoteModel.js';
import { getEnabledProviders } from './registry.js';

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

export async function requestQuotes({ supabase, subOrder, shipment, onlyProvider = null }) {
  const providers = await getEnabledProviders(supabase, { onlyCode: onlyProvider });
  const requestedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();

  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const result = await provider.getRates({
        supabase,
        subOrder,
        shipment,
        providerRow: provider.row,
      });
      return { provider: provider.code, name: provider.name, ...result };
    }),
  );

  const providerResults = [];
  const quotes = [];

  for (const entry of settled) {
    if (entry.status === 'rejected') {
      providerResults.push({
        provider: 'unknown',
        ok: false,
        error: entry.reason?.message || 'Provider request failed.',
        quote_count: 0,
      });
      continue;
    }
    const value = entry.value;
    providerResults.push({
      provider: value.provider,
      ok: Boolean(value.ok),
      error: value.ok ? null : value.error,
      quote_count: value.ok ? (value.quotes || []).length : 0,
    });
    if (value.ok) quotes.push(...(value.quotes || []));
  }

  if (!onlyProvider) {
    await supabase
      .from('shipping_quotes')
      .update({ quote_status: 'superseded' })
      .eq('sub_order_id', subOrder.id)
      .eq('quote_status', 'active');
  } else {
    await supabase
      .from('shipping_quotes')
      .update({ quote_status: 'superseded' })
      .eq('sub_order_id', subOrder.id)
      .eq('provider', onlyProvider)
      .eq('quote_status', 'active');
  }

  const rows = quotes
    .filter((quote) => Number(quote.amount) > 0)
    .map((quote) => toStoredQuote(quote, {
      orderId: subOrder.order_id || subOrder.orders?.id,
      subOrderId: subOrder.id,
      requestedAt,
      expiresAt,
    }));

  let saved = [];
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from('shipping_quotes')
      .insert(rows)
      .select('*');
    if (error) throw error;
    saved = data || [];
  }

  saved.sort((a, b) => Number(a.cost) - Number(b.cost));

  await supabase
    .from('sub_orders')
    .update({ quotes_requested_at: requestedAt, quotes_expires_at: expiresAt })
    .eq('id', subOrder.id);

  const customerCharge = Number(subOrder.allocated_shipping_fee || subOrder.orders?.shipping_fee_paid || 0);
  return {
    requested_at: requestedAt,
    expires_at: expiresAt,
    providers: providerResults,
    quotes: saved.map((row) => toPublicQuote(row, customerCharge)),
  };
}
