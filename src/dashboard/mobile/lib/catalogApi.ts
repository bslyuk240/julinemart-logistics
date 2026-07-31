import { supabase } from '../../contexts/AuthContext';
import { functionsBase } from './functionsAuth';

export async function catalogAuthHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function endpointUrls(path: string): string[] {
  const urls = [`/.netlify/functions/${path}`, `${functionsBase}/${path}`];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888/.netlify/functions/${path}`);
  }
  return Array.from(new Set(urls));
}

export async function catalogFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...(await catalogAuthHeader()), ...(init.headers as Record<string, string>) };
  const urls = endpointUrls(path);
  let last: Response | null = null;
  for (let i = 0; i < urls.length; i += 1) {
    const res = await fetch(urls[i], { ...init, headers });
    if (res.status === 404 && i < urls.length - 1) continue;
    last = res;
    break;
  }
  if (!last) throw new Error('Request failed');
  return last;
}

export async function catalogJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await catalogFetch(path, init);
  const json = await res.json();
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
  }
  return json as T;
}

export function slugifyName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export interface CategoryAudit {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string | null;
  image_url: string | null;
  product_count: number;
}

export interface TreeRow extends CategoryAudit {
  depth: number;
}

export function buildCategoryTree(categories: CategoryAudit[]): TreeRow[] {
  const byParent = new Map<string | null, CategoryAudit[]>();
  categories.forEach((c) => {
    const key = c.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  });
  byParent.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));

  const result: TreeRow[] = [];
  const visited = new Set<string>();
  function walk(parentId: string | null, depth: number) {
    for (const c of byParent.get(parentId) || []) {
      if (visited.has(c.id)) continue;
      visited.add(c.id);
      result.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  }
  walk(null, 0);
  categories.forEach((c) => {
    if (!visited.has(c.id)) {
      visited.add(c.id);
      result.push({ ...c, depth: 0 });
    }
  });
  return result;
}
