/** Production-first API base — current JLO deploy origin, not legacy :3001/:8888 defaults. */
export function getPublicApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const { origin, hostname, port } = window.location;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return origin.replace(/\/$/, '');
  }
  if (port === '8888') return origin.replace(/\/$/, '');
  return origin.replace(/\/$/, '');
}

/** Absolute URL for an API path on the active JLO deployment. */
export function buildApiUrl(path: string): string {
  const base = getPublicApiBaseUrl();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

/** Candidate URLs for authenticated admin fetches (prod origin first, Netlify dev fallback on localhost). */
export function adminFetchUrls(path: string): string[] {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const apiPath = normalized.startsWith('/api/') ? normalized : `/api/${normalized.replace(/^\//, '')}`;
  const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
  const fnPath = apiPath.replace(/^\/api\//, '/');
  const urls = [buildApiUrl(apiPath), buildApiUrl(`${functionsBase}${fnPath}`)];

  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && port !== '8888') {
      urls.push(`http://localhost:8888${apiPath}`);
      urls.push(`http://localhost:8888${functionsBase}${fnPath}`);
    }
  }

  return [...new Set(urls)];
}
