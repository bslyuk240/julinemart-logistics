import { useEffect, useMemo, useState } from 'react';
import { Loader, Plus, Search, Tag, Trash2 } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { catalogJson, slugifyName } from '../lib/catalogApi';

interface TagAudit {
  id: string;
  name: string;
  slug: string;
  product_count: number;
}

export default function MobileTags() {
  const notification = useNotification();
  const [tags, setTags] = useState<TagAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const json = await catalogJson<{ data: TagAudit[] }>('catalog-meta?type=tags_audit');
      setTags(json.data || []);
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load tags');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    if (!filter.trim()) return tags;
    const q = filter.toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(q) || t.slug.includes(q));
  }, [tags, filter]);

  const emptyTags = visible.filter((t) => t.product_count === 0);

  const deleteTag = async (id: string, name: string) => {
    if (!window.confirm(`Delete tag "${name}"?`)) return;
    setDeleting((d) => new Set(d).add(id));
    try {
      await catalogJson(`catalog-meta?type=tags&id=${id}`, { method: 'DELETE' });
      setTags((prev) => prev.filter((t) => t.id !== id));
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

  const deleteBulk = async () => {
    setBulkConfirm(false);
    const ids = [...selected];
    for (const id of ids) {
      try {
        await catalogJson(`catalog-meta?type=tags&id=${id}`, { method: 'DELETE' });
        setTags((prev) => prev.filter((t) => t.id !== id));
        setSelected((prev) => {
          const s = new Set(prev);
          s.delete(id);
          return s;
        });
      } catch {
        /* continue */
      }
    }
    notification.success('Bulk delete', `Removed ${ids.length} tag(s)`);
  };

  const createTag = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    setCreating(true);
    try {
      const json = await catalogJson<{ data: TagAudit }>('catalog-meta?type=tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), slug: newSlug.trim() }),
      });
      setTags((prev) => [...prev, { ...json.data, product_count: 0 }]);
      setCreateOpen(false);
      setNewName('');
      setNewSlug('');
      setSlugManual(false);
      notification.success('Created', `Tag "${json.data.name}" added`);
    } catch (err) {
      notification.error('Create failed', err instanceof Error ? err.message : 'Unable to create tag');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Tags</h1>
              <p className="text-xs text-gray-500">Audit and clean product tags</p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white"
              aria-label="Add tag"
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
              placeholder="Filter tags…"
              className="w-full bg-transparent text-sm outline-none"
              style={{ fontSize: '16px' }}
            />
          </div>

          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700">
              {tags.filter((t) => t.product_count > 0).length} active
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
              {tags.filter((t) => t.product_count === 0).length} empty
            </span>
            {selected.size > 0 && (
              <button type="button" onClick={() => setBulkConfirm(true)} className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700">
                Delete {selected.size} selected
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No tags found.</div>
          ) : (
            <div className="space-y-2">
              {visible.map((tag) => {
                const checked = selected.has(tag.id);
                return (
                  <div
                    key={tag.id}
                    className={`flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ${checked ? 'ring-primary-600' : 'ring-gray-100'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const s = new Set(prev);
                          e.target.checked ? s.add(tag.id) : s.delete(tag.id);
                          return s;
                        })
                      }
                      className="h-4 w-4 shrink-0"
                    />
                    <Tag className={`h-4 w-4 shrink-0 ${tag.product_count > 0 ? 'text-primary-600' : 'text-gray-300'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{tag.name}</p>
                      <p className="truncate text-xs text-gray-500">{tag.slug}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        tag.product_count === 0 ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {tag.product_count}
                    </span>
                    <button
                      type="button"
                      disabled={deleting.has(tag.id)}
                      onClick={() => deleteTag(tag.id, tag.name)}
                      className="shrink-0 text-red-500 disabled:opacity-40"
                      aria-label="Delete tag"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {emptyTags.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setSelected((prev) => {
                  const s = new Set(prev);
                  const allSelected = emptyTags.every((t) => s.has(t.id));
                  emptyTags.forEach((t) => (allSelected ? s.delete(t.id) : s.add(t.id)));
                  return s;
                })
              }
              className="w-full rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-xs font-semibold text-amber-800"
            >
              Toggle select all empty ({emptyTags.length})
            </button>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} ariaLabel="Create tag">
        <h3 className="text-base font-bold text-gray-900">New tag</h3>
        <div className="space-y-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (!slugManual) setNewSlug(slugifyName(e.target.value));
            }}
            placeholder="Name"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <input
            type="text"
            value={newSlug}
            onChange={(e) => {
              setNewSlug(e.target.value);
              setSlugManual(true);
            }}
            placeholder="slug"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 font-mono text-sm"
            style={{ fontSize: '16px' }}
          />
        </div>
        <button
          type="button"
          disabled={creating || !newName.trim() || !newSlug.trim()}
          onClick={createTag}
          className="rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {creating ? 'Creating…' : 'Create tag'}
        </button>
      </Sheet>

      <Sheet open={bulkConfirm} onClose={() => setBulkConfirm(false)} ariaLabel="Confirm bulk delete">
        <p className="text-sm text-gray-700">
          Delete <strong>{selected.size}</strong> tag(s)? This cannot be undone.
        </p>
        <button type="button" onClick={deleteBulk} className="rounded-lg bg-red-600 py-3 text-sm font-semibold text-white">
          Confirm delete
        </button>
      </Sheet>
    </>
  );
}
