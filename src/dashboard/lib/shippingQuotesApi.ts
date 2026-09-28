const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

export type ShippingQuote = {
  id: string;
  provider: string;
  courier: string;
  service_name: string;
  amount: number;
  currency: string;
  estimated_delivery_min_days: number | null;
  estimated_delivery_max_days: number | null;
  pickup_available: boolean | null;
  expires_at: string | null;
  shipping_margin: number;
};

export type ProviderResult = {
  provider: string;
  ok: boolean;
  error: string | null;
  quote_count: number;
};

export type ShippingQuotesPayload = {
  order_number?: number | string | null;
  origin: { name?: string; address?: string; city?: string; state?: string };
  destination: { name?: string; address?: string; city?: string; state?: string };
  package: {
    weight: number;
    length: number;
    width: number;
    height: number;
    quantity: number;
    declared_value: number;
    ready: boolean;
    missing: string[];
  };
  customer_shipping_charge: number;
  shipment_status: 'booked' | 'not_booked';
  fulfilment_provider?: string | null;
  fulfilment_courier_name?: string | null;
  fulfilment_service_name?: string | null;
  tracking_number?: string | null;
  courier_shipment_id?: string | null;
  waybill_url?: string | null;
  carrier_cost?: number | null;
  shipping_margin?: number | null;
  quotes_requested_at?: string | null;
  quotes_expires_at?: string | null;
  selected_lane?: string;
  quotes: ShippingQuote[];
  providers: ProviderResult[];
};

export type PackageOverride = {
  weight: number;
  length: number;
  width: number;
  height: number;
};

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const error = new Error(data.error || 'Request failed') as Error & { missing?: string[]; data?: ShippingQuotesPayload };
    error.missing = data.missing;
    error.data = data.data;
    throw error;
  }
  return data;
}

export async function fetchShippingQuoteStatus(subOrderId: string, headers: HeadersInit): Promise<ShippingQuotesPayload> {
  const res = await fetch(`${functionsBase}/shipping-quotes?subOrderId=${encodeURIComponent(subOrderId)}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const data = await parseJson(res);
  return data.data;
}

export async function requestShippingQuotes(
  subOrderId: string,
  headers: HeadersInit,
  opts: { action?: 'refresh' | 'retry'; provider?: string; package_override?: PackageOverride } = {},
): Promise<ShippingQuotesPayload> {
  const res = await fetch(`${functionsBase}/shipping-quotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      subOrderId,
      action: opts.action || 'refresh',
      provider: opts.provider,
      package_override: opts.package_override,
    }),
  });
  const data = await parseJson(res);
  return data.data;
}

export async function createQuotedShipment(subOrderId: string, quoteId: string, headers: HeadersInit) {
  const res = await fetch(`${functionsBase}/shipping-create-shipment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ subOrderId, quoteId }),
  });
  const data = await parseJson(res);
  return data.data;
}

export async function fetchShippingProviders(headers: HeadersInit) {
  const res = await fetch(`${functionsBase}/shipping-providers`, { headers });
  const data = await parseJson(res);
  return data.data as Array<{
    id: string;
    code: string;
    name: string;
    enabled: boolean;
    environment: 'sandbox' | 'production';
    has_credentials: boolean;
  }>;
}

export async function updateShippingProvider(
  payload: { code: string; enabled?: boolean; environment?: 'sandbox' | 'production' },
  headers: HeadersInit,
) {
  const res = await fetch(`${functionsBase}/shipping-providers`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const data = await parseJson(res);
  return data.data;
}
