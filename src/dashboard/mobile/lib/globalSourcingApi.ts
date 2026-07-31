import { functionsAuthHeader, functionsBase } from './functionsAuth';

export async function callGlobalSourcing<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const urls = [`/api/${endpoint}`, `${functionsBase}/${endpoint}`];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888/api/${endpoint}`);
    urls.push(`http://localhost:8888${functionsBase}/${endpoint}`);
  }
  let lastError: Error | null = null;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const response = await fetch(urls[i], {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(await functionsAuthHeader()),
          ...(init.headers || {}),
        },
      });
      if (response.status === 404 && i < urls.length - 1) continue;
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
      return body as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Request failed');
    }
  }
  throw lastError ?? new Error('Request failed');
}

export interface HubOption {
  id: string;
  name: string;
  code: string;
  is_default?: boolean | null;
  metadata?: Record<string, unknown> | null;
}

export interface VendorOption {
  id: string;
  store_name: string;
  woocommerce_vendor_id: string;
}

export interface SearchProduct {
  provider: string;
  external_product_id: string;
  title: string;
  images: string[];
  category: string | null;
  source_price: number | null;
  currency: string;
  variants_summary: string | null;
}

export interface ImportedProduct {
  id: string;
  name: string;
  status: string;
  provider: string;
  image: string | null;
  external_product_id: string | null;
  fulfillment_mode: string | null;
  receiving_hub?: { name: string } | null;
  vendor?: { store_name: string } | null;
  updated_at: string | null;
}

export interface ProductVariant {
  external_variant_id: string | null;
  title: string;
  sku?: string | null;
  image?: string | null;
  source_price: number | null;
  currency: string;
  attributes?: Record<string, string>;
  inbound_shipping_usd?: number | null;
}

export interface ProductDetails {
  provider: string;
  external_product_id: string;
  supplier_source?: string;
  supplier_product_id?: string;
  supplier_url?: string | null;
  title: string;
  description: string;
  description_images?: string[];
  images: string[];
  variants: ProductVariant[];
  source_price: number | null;
  currency?: string;
  inbound_shipping_usd?: number | null;
}

export interface PricingPreview {
  provider?: string;
  supplier_price_usd: number;
  inbound_shipping_quote_usd?: number;
  import_buffer_usd?: number;
  landed_cost_usd?: number;
  exchange_rate?: number;
  final_price_ngn: string;
  landed_cost_ngn?: number;
  suggested_retail_ngn?: number;
  estimated_inbound_days_min?: number | null;
  estimated_inbound_days_max?: number | null;
  carrier_name?: string | null;
  usd_to_ngn_rate_used?: number;
  usd_to_ngn_rate_source?: string;
  fx_rate_fetched_at?: string | null;
  fx_rate_note?: string | null;
}

export interface ImportJobData {
  job_id: string;
  status: string;
  result?: { imported_variation_count?: number; warnings?: string[] };
}

export const CJ_SEARCH_PAGE_SIZE = 50;

export async function runImportJob(jobId: string, maxAttempts = 120): Promise<ImportJobData> {
  for (let i = 0; i < maxAttempts; i += 1) {
    let job: ImportJobData;
    try {
      const res = await callGlobalSourcing<{ data: ImportJobData }>('global-sourcing-import-jobs', {
        method: 'POST',
        body: JSON.stringify({ job_id: jobId }),
      });
      job = res.data;
    } catch {
      const fallback = await callGlobalSourcing<{ data: ImportJobData }>(
        `global-sourcing-import-jobs?job_id=${encodeURIComponent(jobId)}`,
        { method: 'GET' },
      );
      job = fallback.data;
    }
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Import job timed out');
}

export async function pollImportJob(jobId: string, maxAttempts = 60): Promise<ImportJobData> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const res = await callGlobalSourcing<{ data: ImportJobData }>(
      `global-sourcing-import-jobs?job_id=${encodeURIComponent(jobId)}`,
      { method: 'GET' },
    );
    const job = res.data;
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Import job timed out');
}
