import { fezProvider } from './providers/fezProvider.js';
import { shipbubbleProvider } from './providers/shipbubbleProvider.js';

const ADAPTERS = {
  fez: fezProvider,
  shipbubble: shipbubbleProvider,
};

export function getProviderAdapter(code) {
  return ADAPTERS[String(code || '').toLowerCase()] || null;
}

export async function listProviderRows(supabase) {
  const { data, error } = await supabase
    .from('shipping_providers')
    .select('*')
    .order('code');
  if (error) throw error;
  return data || [];
}

export async function getEnabledProviders(supabase, { onlyCode } = {}) {
  let rows = [];
  try {
    rows = await listProviderRows(supabase);
  } catch (error) {
    console.warn('[shipping.registry] shipping_providers unavailable, using defaults:', error.message);
    rows = [
      { code: 'fez', name: 'FEZ', enabled: true, environment: 'production', config: {} },
      { code: 'shipbubble', name: 'Shipbubble', enabled: true, environment: 'sandbox', config: {} },
    ];
  }

  return rows
    .filter((row) => row.enabled)
    .filter((row) => !onlyCode || row.code === onlyCode)
    .map((row) => {
      const adapter = getProviderAdapter(row.code);
      return adapter ? { ...adapter, row } : null;
    })
    .filter(Boolean);
}
