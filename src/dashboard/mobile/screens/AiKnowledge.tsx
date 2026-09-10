import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Loader, Plus, Power, Trash2 } from 'lucide-react';
import { supabase, useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { logActivity } from '../../lib/logActivity';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';

// Mobile counterpart of dashboard/pages/AiKnowledge.tsx — see that file for
// what this feeds (the PWA customer chat's system prompt).

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  created_by: string | null;
  updated_at: string;
}

interface FormState {
  title: string;
  content: string;
  is_active: boolean;
}

const emptyForm: FormState = { title: '', content: '', is_active: true };
const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm';

export default function MobileAiKnowledge() {
  const { user } = useAuth();
  const notification = useNotification();

  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ai_assistant_knowledge')
      .select('id, title, content, is_active, created_by, updated_at')
      .order('updated_at', { ascending: false });
    if (error) notification.error('Load failed', error.message);
    else setEntries((data || []) as KnowledgeEntry[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return entries;
    const q = filter.toLowerCase();
    return entries.filter((e) => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
  }, [entries, filter]);

  const openCreate = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (entry: KnowledgeEntry) => {
    setEditingId(entry.id);
    setFormData({ title: entry.title, content: entry.content, is_active: entry.is_active });
    setFormOpen(true);
  };

  const save = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      notification.error('Missing fields', 'Title and content are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: formData.title.trim(),
        content: formData.content.trim(),
        is_active: formData.is_active,
        updated_at: new Date().toISOString(),
      };
      if (editingId) {
        const { error } = await supabase.from('ai_assistant_knowledge').update(payload).eq('id', editingId);
        if (error) throw error;
        await logActivity({ action: 'AI_KNOWLEDGE_UPDATE', resource_type: 'ai_assistant_knowledge', resource_id: editingId, details: { title: payload.title } });
      } else {
        const { data: created, error } = await supabase
          .from('ai_assistant_knowledge')
          .insert({ ...payload, created_by: user?.email || 'system' })
          .select('id')
          .single();
        if (error) throw error;
        await logActivity({ action: 'AI_KNOWLEDGE_CREATE', resource_type: 'ai_assistant_knowledge', resource_id: created.id, details: { title: payload.title } });
      }
      notification.success('Saved', payload.title);
      setFormOpen(false);
      await load();
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (entry: KnowledgeEntry) => {
    const { error } = await supabase
      .from('ai_assistant_knowledge')
      .update({ is_active: !entry.is_active, updated_at: new Date().toISOString() })
      .eq('id', entry.id);
    if (error) {
      notification.error('Failed to update', error.message);
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, is_active: !e.is_active } : e)));
    await logActivity({ action: 'AI_KNOWLEDGE_TOGGLE', resource_type: 'ai_assistant_knowledge', resource_id: entry.id, details: { is_active: !entry.is_active } });
  };

  const remove = async (entry: KnowledgeEntry) => {
    if (!window.confirm(`Delete "${entry.title}"?`)) return;
    const { error } = await supabase.from('ai_assistant_knowledge').delete().eq('id', entry.id);
    if (error) {
      notification.error('Delete failed', error.message);
      return;
    }
    await logActivity({ action: 'AI_KNOWLEDGE_DELETE', resource_type: 'ai_assistant_knowledge', resource_id: entry.id, details: { title: entry.title } });
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">AI Assistant Knowledge</h1>
              <p className="text-xs text-gray-500">What the customer chat AI knows</p>
            </div>
            <button type="button" onClick={openCreate} className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>

          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search entries…"
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-gray-100"
            style={{ fontSize: '16px' }}
          />

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl bg-white py-10 text-center text-sm text-gray-500 ring-1 ring-gray-100">
              {entries.length === 0 ? 'No knowledge entries yet. Tap "New" to add one.' : 'No entries match your search.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((entry) => (
                <div key={entry.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                  <button type="button" onClick={() => openEdit(entry)} className="flex w-full gap-3 text-left">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                      <BrainCircuit className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{entry.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{entry.content}</p>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${entry.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                        {entry.is_active ? 'active' : 'inactive'}
                      </span>
                    </div>
                  </button>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleActive(entry)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold ${
                        entry.is_active ? 'border-gray-200 text-gray-700' : 'border-green-200 text-green-700'
                      }`}
                    >
                      <Power className="h-3.5 w-3.5" /> {entry.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" onClick={() => void remove(entry)} className="rounded-lg border border-red-200 p-2 text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} ariaLabel="Knowledge entry form">
        <h3 className="text-base font-bold">{editingId ? 'Edit entry' : 'New entry'}</h3>
        <div className="space-y-3">
          <input
            value={formData.title}
            onChange={(e) => setFormData((f) => ({ ...f, title: e.target.value }))}
            placeholder="Title * (e.g. Mirror Glow Secret Drop giveaway)"
            className={inputCls}
            style={{ fontSize: '16px' }}
          />
          <textarea
            value={formData.content}
            onChange={(e) => setFormData((f) => ({ ...f, content: e.target.value }))}
            placeholder="What the AI should know, in plain sentences — how it works, entry rules, dates, prizes."
            rows={8}
            className={inputCls}
            style={{ fontSize: '16px' }}
          />
          <p className="-mt-2 text-[11px] text-gray-400">Plain text — inserted directly into the AI's instructions.</p>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData((f) => ({ ...f, is_active: e.target.checked }))} />
            Active (the AI chat can use this right away)
          </label>
        </div>
        <button type="button" disabled={saving} onClick={() => void save()} className="mt-1 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? 'Saving…' : 'Save entry'}
        </button>
      </Sheet>
    </>
  );
}
