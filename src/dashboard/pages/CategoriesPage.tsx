import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../contexts/AuthContext';
import { FolderTree, Trash2, RefreshCw, Plus, Pencil } from 'lucide-react';

interface CategoryAudit {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string | null;
  image_url: string | null;
  product_count: number;
}

interface TreeRow extends CategoryAudit {
  depth: number;
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

// Orders categories top-level-first, each followed immediately by its
// children (alphabetically within each level) — so a flat <table>/<select>
// can render real hierarchy just via depth-based indentation.
function buildTree(categories: CategoryAudit[]): TreeRow[] {
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
    const children = byParent.get(parentId) || [];
    for (const c of children) {
      if (visited.has(c.id)) continue; // guards against an accidental cycle
      visited.add(c.id);
      result.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  }
  walk(null, 0);
  // Any row whose parent_id points at a since-deleted/unknown category —
  // surface it at top level rather than silently dropping it.
  categories.forEach((c) => {
    if (!visited.has(c.id)) {
      visited.add(c.id);
      result.push({ ...c, depth: 0 });
    }
  });
  return result;
}

const emptyForm = { name: '', slug: '', parentId: '', description: '', imageUrl: '' };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [slugManual, setSlugManual] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuthHeader();
      const res = await fetch(functionsUrl('catalog-meta?type=categories_audit'), {
        headers: { Authorization: auth },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');
      setCategories(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const tree = useMemo(() => buildTree(categories), [categories]);
  const visibleIds = useMemo(() => {
    if (!filter) return null;
    const q = filter.toLowerCase();
    return new Set(categories.filter((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q)).map((c) => c.id));
  }, [categories, filter]);
  const visible = visibleIds ? tree.filter((c) => visibleIds.has(c.id)) : tree;

  // A category can't become its own descendant's parent — offered as the
  // parent dropdown when editing, so exclude the category itself and
  // anything already under it.
  const parentOptions = useMemo(() => {
    if (!editingId) return tree;
    const excluded = new Set<string>([editingId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of categories) {
        if (c.parent_id && excluded.has(c.parent_id) && !excluded.has(c.id)) {
          excluded.add(c.id);
          grew = true;
        }
      }
    }
    return tree.filter((c) => !excluded.has(c.id));
  }, [tree, categories, editingId]);

  const handleNameChange = (val: string) => {
    setForm((f) => ({ ...f, name: val }));
    if (!slugManual) {
      setForm((f) => ({ ...f, slug: val.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }));
    }
  };

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setSlugManual(false);
    setShowForm(true);
  }

  function openEdit(c: CategoryAudit) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      slug: c.slug,
      parentId: c.parent_id || '',
      description: c.description || '',
      imageUrl: c.image_url || '',
    });
    setSlugManual(true);
    setShowForm(true);
  }

  const save = async () => {
    if (!form.name.trim() || !form.slug.trim()) return;
    setSaving(true);
    try {
      const auth = await getAuthHeader();
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        parent_id: form.parentId || null,
        description: form.description.trim() || null,
        image_url: form.imageUrl.trim() || null,
      };
      const url = editingId
        ? functionsUrl(`catalog-meta?type=categories&id=${editingId}`)
        : functionsUrl('catalog-meta?type=categories');
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Save failed');
      if (editingId) {
        setCategories((prev) => prev.map((c) => (c.id === editingId ? { ...c, ...json.data } : c)));
      } else {
        setCategories((prev) => [...prev, { ...json.data, product_count: 0 }]);
      }
      setSuccess(`Category "${json.data.name}" ${editingId ? 'updated' : 'created'}`);
      setTimeout(() => setSuccess(null), 3000);
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (id: string, name: string) => {
    if (!window.confirm(`Delete category "${name}"? This cannot be undone.`)) return;
    setDeleting((d) => new Set(d).add(id));
    try {
      const auth = await getAuthHeader();
      const res = await fetch(functionsUrl(`catalog-meta?type=categories&id=${id}`), {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Delete failed');
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setSuccess(`Deleted "${name}"`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting((d) => { const s = new Set(d); s.delete(id); return s; });
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Categories</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
          Manage the category tree — create subcategories under a parent (e.g. "Kitchenware" under "Household")
          so campaigns and product filters can target them specifically.
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
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter categories..."
            style={{ flex: 1, minWidth: 200, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
          />
          <button
            onClick={openCreate}
            style={{ padding: '7px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}
          >
            <Plus size={14} /> Add Category
          </button>
          <button
            onClick={load}
            disabled={loading}
            style={{ padding: '7px 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Refresh
          </button>
        </div>

        {showForm && (
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: 16, marginBottom: 14 }}>
            <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#0369a1' }}>
              {editingId ? 'Edit Category' : 'New Category'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px 16px', alignItems: 'center', marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Name</label>
              <input
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Kitchenware"
                style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, width: '100%', boxSizing: 'border-box' as const }}
              />
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Slug</label>
              <input
                value={form.slug}
                onChange={(e) => { setForm((f) => ({ ...f, slug: e.target.value })); setSlugManual(true); }}
                placeholder="kitchenware"
                style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontFamily: 'monospace', width: '100%', boxSizing: 'border-box' as const }}
              />
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Parent</label>
              <select
                value={form.parentId}
                onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
                style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, width: '100%', boxSizing: 'border-box' as const }}
              >
                <option value="">— None (top-level) —</option>
                {parentOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {'  '.repeat(c.depth)}{c.depth > 0 ? '— ' : ''}{c.name}
                  </option>
                ))}
              </select>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional"
                style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, width: '100%', boxSizing: 'border-box' as const }}
              />
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Image URL</label>
              <input
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                placeholder="Optional — https://..."
                style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontFamily: 'monospace', width: '100%', boxSizing: 'border-box' as const }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); setSlugManual(false); }}
                style={{ padding: '6px 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!form.name.trim() || !form.slug.trim() || saving}
                style={{ padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (!form.name.trim() || !form.slug.trim()) ? 0.5 : 1 }}
              >
                {saving ? 'Saving...' : editingId ? 'Update Category' : 'Create Category'}
              </button>
            </div>
          </div>
        )}

        {!loading && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 20, padding: '3px 12px' }}>
              {categories.filter((c) => !c.parent_id).length} top-level
            </span>
            <span style={{ fontSize: 13, background: '#eef2ff', border: '1px solid #c7d2fe', color: '#3730a3', borderRadius: 20, padding: '3px 12px' }}>
              {categories.filter((c) => c.parent_id).length} subcategories
            </span>
            <span style={{ fontSize: 13, background: '#f3f4f6', border: '1px solid #d1d5db', color: '#374151', borderRadius: 20, padding: '3px 12px' }}>
              {categories.length} total
            </span>
          </div>
        )}

        {loading ? (
          <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading...</p>
        ) : visible.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 14 }}>No categories found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 600 }}>Name</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 600 }}>Slug</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 600, textAlign: 'center' }}>Products</th>
                <th style={{ padding: '8px 10px', width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6', background: c.product_count === 0 ? '#fafafa' : '#fff' }}>
                  <td style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 10 + c.depth * 22 }}>
                    <FolderTree size={13} color={c.depth > 0 ? '#a5b4fc' : '#6366f1'} />
                    <span style={{ fontWeight: c.depth === 0 ? 600 : 400, color: '#111827' }}>{c.name}</span>
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#6b7280', fontSize: 13 }}>{c.slug}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block',
                      minWidth: 28,
                      padding: '2px 8px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      background: c.product_count === 0 ? '#f3f4f6' : '#d1fae5',
                      color: c.product_count === 0 ? '#9ca3af' : '#065f46',
                    }}>
                      {c.product_count}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => openEdit(c)}
                      title="Edit category"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', padding: 4, borderRadius: 4 }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => deleteCategory(c.id, c.name)}
                      disabled={deleting.has(c.id)}
                      title="Delete category"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4, borderRadius: 4, opacity: deleting.has(c.id) ? 0.4 : 1 }}
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
