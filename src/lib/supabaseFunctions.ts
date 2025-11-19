const DEFAULT_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_FUNCTIONS_BASE =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
  (DEFAULT_SUPABASE_URL ? `${DEFAULT_SUPABASE_URL.replace(/\/$/, '')}/functions/v1` : '/functions/v1');

export function buildFunctionUrl(functionPath: string, query?: Record<string, string>) {
  const trimmedPath = functionPath.replace(/^\/+/, '');
  const url = new URL(`${SUPABASE_FUNCTIONS_BASE.replace(/\/$/, '')}/${trimmedPath}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  return url.toString();
}

export async function callSupabaseFunction(
  functionName: string,
  options: Omit<RequestInit, 'body'> & { body?: unknown } = {}
) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...options.headers,
  });

  const res = await fetch(buildFunctionUrl(functionName), {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(payload?.error || `Failed to call ${functionName}`);
  }

  return payload;
}

export async function callSupabaseFunctionWithQuery(
  functionName: string,
  query: Record<string, string>,
  options: Omit<RequestInit, 'body'> = {}
) {
  const res = await fetch(buildFunctionUrl(functionName, query), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(payload?.error || `Failed to call ${functionName}`);
  }

  return payload;
}
