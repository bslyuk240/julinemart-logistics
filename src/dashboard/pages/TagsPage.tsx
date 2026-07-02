import { useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';
import { Tag, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';

interface TagAudit {
  id: string;
  name: string;
  slug: string;
  product_count: number;
}

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession();
  return `Bearer ${data.session?.access_token || ''}`;
}

function functionsUrl(path: string) {
  const base =
    (import.meta as any).env?.VITE_NETLIFY_FUNCTIONS_URL ||
    window.location.origin;
  return `${base.replace(/\/$/, '')}/.netlify/functions/${path}`;
}

export default function TagsPage() {
  const [tags, setTags] = useState<TagAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuthHeader();
      const res = await fetch(functionsUrl('catalog-meta?type=tags_audit'), {
        headers: { Authorization: auth },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');
      setTags(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const deleteTag = async (id: string, name: string) => {
    if (!window.confirm(`Delete tag "${name}"? This cannot be undone.`)) return;
    setDeleting((d) => new Set(d).add(id));
    try {
      const auth = await getAuthHeader();
      const res = await fetch(functionsUrl(`catalog-meta?type=tags&id=${id}`), {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Delete failed');
      setTags((prev) => prev.filter((t) => t.id !== id));
      setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
      setSuccess(`Deleted "${name}"`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting((d) => { const s = new Set(d); s.delete(id); return s; });
    }
  };

  const deleteBulk = async () => {
    setConfirmBulk(false);
    const ids = [...selected];
    for (const id of ids) {
      const tag = tags.find((t) => t.id === id);
      if (!tag) continue;
      setDeleting((d) => new Set(d).add(id));
      try {
        const auth = await getAuthHeader();
        const res = await fetch(functionsUrl(`catalog-meta?type=tags&id=${id}`), {
          method: 'DELETE',
          headers: { Authorization: auth },
        });
        const json = await res.json();
        if (json.success) {
          setTags((prev) => prev.filter((t) => t.id !== id));
          setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
        }
      } catch {}
      setDeleting((d) => { const s = new Set(d); s.delete(id); return s; });
    }
    setSuccess(`Deleted ${ids.length} tag(s)`);
    setTimeout(() => setSuccess(null), 3000);
  };

  const visible = tags.filter(
    (t) =>
      filter === '' ||
      t.name.toLowerCase().includes(filter.toLowerCase()) ||
      t.slug.includes(filter.toLowerCase())
  );

  const emptyTags = visible.filter((t) => t.product_count === 0);
  const allEmptySelected = emptyTags.length > 0 && emptyTags.every((t) => selected.has(t.id));

  const toggleSelectEmpty = () => {
    if (allEmptySelected) {
      setSelected((prev) => {
        const s = new Set(prev);
        emptyTags.forEach((t) => s.delete(t.id));
        return s;
      });
    } else {
      setSelected((prev) => {
        const s = new Set(prev);
        emptyTags.forEach((t) => s.add(t.id));
        return s;
      });
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Tags</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
          Audit product tags — see which are in use and remove stale ones.
        </p>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontWeight: 700 }}>✕</button>
        </div>
      )}
      {success && (
        <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 14 }}>
          {success}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags..."
            style={{ flex: 1, minWidth: 200, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
          />
          <button
            onClick={load}
            disabled={loading}
            style={{ padding: '7px 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Refresh
          </button>
          {emptyTags.length > 0 && (
            <button
              onClick={toggleSelectEmpty}
              style={{ padding: '7px 14px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#92400e' }}
            >
              {allEmptySelected ? 'Deselect' : 'Select'} all empty ({emptyTags.length})
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => setConfirmBulk(true)}
              style={{ padding: '7px 14px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#b91c1c', fontWeight: 600 }}
            >
              Delete selected ({selected.size})
            </button>
          )}
        </div>

        {confirmBulk && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <AlertTriangle size={18} color="#c2410c" />
            <span style={{ fontSize: 14, flex: 1 }}>Delete <strong>{selected.size}</strong> tag(s)? This cannot be undone.</span>
            <button onClick={deleteBulk} style={{ padding: '5px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Confirm Delete</button>
            <button onClick={() => setConfirmBulk(false)} style={{ padding: '5px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        )}

        {/* Summary chips */}
        {!loading && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 20, padding: '3px 12px' }}>
              {tags.filter((t) => t.product_count > 0).length} active
            </span>
            <span style={{ fontSize: 13, background: '#fef9c3', border: '1px solid #fde047', color: '#713f12', borderRadius: 20, padding: '3px 12px' }}>
              {tags.filter((t) => t.product_count === 0).length} empty (no products)
            </span>
            <span style={{ fontSize: 13, background: '#f3f4f6', border: '1px solid #d1d5db', color: '#374151', borderRadius: 20, padding: '3px 12px' }}>
              {tags.length} total
            </span>
          </div>
        )}

        {loading ? (
          <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading...</p>
        ) : visible.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 14 }}>No tags found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', width: 36, color: '#6b7280', fontWeight: 600 }}></th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 600 }}>Name</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 600 }}>Slug</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 600, textAlign: 'center' }}>Products</th>
                <th style={{ padding: '8px 10px', width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((tag) => (
                <tr
                  key={tag.id}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    background: selected.has(tag.id) ? '#fef9c3' : tag.product_count === 0 ? '#fafafa' : '#fff',
                  }}
                >
                  <td style={{ padding: '8px 10px' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(tag.id)}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const s = new Set(prev);
                          e.target.checked ? s.add(tag.id) : s.delete(tag.id);
                          return s;
                        });
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag size={13} color={tag.product_count > 0 ? '#6366f1' : '#d1d5db'} />
                    <span style={{ fontWeight: tag.product_count > 0 ? 500 : 400, color: tag.product_count === 0 ? '#9ca3af' : '#111827' }}>
                      {tag.name}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#6b7280', fontSize: 13 }}>
                    {tag.slug}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block',
                      minWidth: 28,
                      padding: '2px 8px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      background: tag.product_count === 0 ? '#f3f4f6' : tag.product_count < 3 ? '#fef3c7' : '#d1fae5',
                      color: tag.product_count === 0 ? '#9ca3af' : tag.product_count < 3 ? '#92400e' : '#065f46',
                    }}>
                      {tag.product_count}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <button
                      onClick={() => deleteTag(tag.id, tag.name)}
                      disabled={deleting.has(tag.id)}
                      title="Delete tag"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4, borderRadius: 4, opacity: deleting.has(tag.id) ? 0.4 : 1 }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
