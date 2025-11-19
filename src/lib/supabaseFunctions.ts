import { supabase } from '../dashboard/contexts/AuthContext';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_FUNCTIONS_BASE =
  (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || `${SUPABASE_URL}`) || "";

function normalizeBase(base: string) {
  return base.replace(/\/$/, "");
}
async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY,
  };

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  return headers;
}
export function buildFunctionUrl(functionName: string, query?: Record<string, string>) {
  if (!SUPABASE_FUNCTIONS_BASE) {
    throw new Error("VITE_SUPABASE_FUNCTIONS_URL or VITE_SUPABASE_URL is required");
  }
  const base = normalizeBase(SUPABASE_FUNCTIONS_BASE);
  const trimmed = functionName.replace(/^\/+/, "");
  const hasFunctions = base.includes("/functions/v1");
  const url = new URL(
    hasFunctions ? `${base.replace(/\/functions\/v1$/, "")}/functions/v1/${trimmed}` : `${base}/functions/v1/${trimmed}`
  );
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value != null) url.searchParams.set(key, value);
    });
  }
  return url;
}

async function parseResponse(res: Response, functionName: string, url: URL) {
  const text = await res.text();
  console.error("[Supabase Function]", functionName, url.toString(), res.status);
  if (!res.ok) {
    throw new Error(text || `Failed ${functionName}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function callSupabaseFunction(
  functionName: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {}
) {
  const url = buildFunctionUrl(functionName);
  const authHeaders = await getAuthHeaders();
  const headers = new Headers({
    "Content-Type": "application/json",
      ...authHeaders,
    ...options.headers,
  });
  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return parseResponse(res, functionName, url);
}

export async function callSupabaseFunctionWithQuery(
  functionName: string,
  query: Record<string, string>,
  options: Omit<RequestInit, "body"> = {}
) {
  const url = buildFunctionUrl(functionName, query);
  const authHeaders = await getAuthHeaders();
  const headers = new Headers({
    "Content-Type": "application/json",
    ...authHeaders,
    ...options.headers,
  });

  const res = await fetch(url, {
    ...options,
    headers,
  });
  return parseResponse(res, functionName, url);
}
