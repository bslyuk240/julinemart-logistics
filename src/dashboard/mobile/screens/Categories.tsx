import { useEffect, useMemo, useState } from 'react';
import { FolderTree, Loader, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  type CategoryAudit,
  buildCategoryTree,
  catalogJson,
  slugifyName,
} from '../lib/catalogApi';

const emptyForm = { name: '', slug: '', parentId: '', description: '', imageUrl: '' };

export default function MobileCategories() {
  const notification = useNotification();
  const [categories, setCategories] = useState<CategoryAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [slugManual, setSlugManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const json = await catalogJson<{ data: CategoryAudit[] }>('catalog-meta?type=categories_audit');
      setCategories(json.data || []);
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load categories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const visible = useMemo(() => {
    if (!filter.trim()) return tree;
    const q = filter.toLowerCase();
    const ids = new Set(categories.filter((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q)).map((c) => c.id));
    return tree.filter((c) => ids.has(c.id));
  }, [tree, categories, filter]);

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

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSlugManual(false);
    setFormOpen(true);
  };

  const openEdit = (c: CategoryAudit) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      slug: c.slug,
      parentId: c.parent_id || '',
      description: c.description || '',
      imageUrl: c.image_url || '',
    });
    setSlugManual(true);
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.slug.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        parent_id: form.parentId || null,
        description: form.description.trim() || null,
        image_url: form.imageUrl.trim() || null,
      };
      const path = editingId ? `catalog-meta?type=categories&id=${editingId}` : 'catalog-meta?type=categories';
      const json = await catalogJson<{ data: CategoryAudit }>(path, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (editingId) {
        setCategories((prev) => prev.map((c) => (c.id === editingId ? { ...c, ...json.data } : c)));
      } else {
        setCategories((prev) => [...prev, { ...json.data, product_count: 0 }]);
      }
      notification.success('Saved', `Category "${json.data.name}" ${editingId ? 'updated' : 'created'}`);
      setFormOpen(false);
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (id: string, name: string) => {
    if (!window.confirm(`Delete category "${name}"?`)) return;
    setDeleting((d) => new Set(d).add(id));
    try {
      await catalogJson(`catalog-meta?type=categories&id=${id}`, { method: 'DELETE' });
      setCategories((prev) => prev.filter((c) => c.id !== id));
      notification.success('Deleted', `"${name}" removed`);
    } catch (err) {
      notification.error('Delete failed', err instanceof Error ? err.message : 'Unable to delete');
    } finally {
      setDeleting((d) => {
        const s = new Set(d);
        s.delete(id);
        return s;
      });
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Categories</h1>
              <p className="text-xs text-gray-500">Category tree for products and filters</p>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white"
              aria-label="Add category"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-gray-100">
            <Search className="h-4 w-4 shrink-0 text-gray-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter categories…"
              className="w-full bg-transparent text-sm outline-none"
              style={{ fontSize: '16px' }}
            />
          </div>

          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700">
              {categories.filter((c) => !c.parent_id).length} top-level
            </span>
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700">
              {categories.filter((c) => c.parent_id).length} subcategories
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No categories found.</div>
          ) : (
            <div className="space-y-2">
              {visible.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-xl bg-white p-3 ring-1 ring-gray-100">
                  <FolderTree className="h-4 w-4 shrink-0 text-primary-600" style={{ marginLeft: c.depth * 8 }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{c.name}</p>
                    <p className="truncate text-xs text-gray-500">{c.slug}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                    {c.product_count}
                  </span>
                  <button type="button" onClick={() => openEdit(c)} className="shrink-0 text-primary-600" aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={deleting.has(c.id)}
                    onClick={() => deleteCategory(c.id, c.name)}
                    className="shrink-0 text-red-500 disabled:opacity-40"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} ariaLabel={editingId ? 'Edit category' : 'New category'}>
        <h3 className="text-base font-bold text-gray-900">{editingId ? 'Edit category' : 'New category'}</h3>
        <div className="space-y-3">
          <input
            type="text"
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({
                ...f,
                name,
                slug: slugManual ? f.slug : slugifyName(name),
              }));
            }}
            placeholder="Name"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <input
            type="text"
            value={form.slug}
            onChange={(e) => {
              setSlugManual(true);
              setForm((f) => ({ ...f, slug: e.target.value }));
            }}
            placeholder="slug"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 font-mono text-sm"
            style={{ fontSize: '16px' }}
          />
          <select
            value={form.parentId}
            onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          >
            <option value="">— Top level —</option>
            {parentOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {'  '.repeat(c.depth)}
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <input
            type="url"
            value={form.imageUrl}
            onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            placeholder="Image URL (optional)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
        </div>
        <button
          type="button"
          disabled={saving || !form.name.trim() || !form.slug.trim()}
          onClick={save}
          className="rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Saving…' : editingId ? 'Update category' : 'Create category'}
        </button>
      </Sheet>
    </>
  );
}
