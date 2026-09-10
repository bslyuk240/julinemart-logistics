import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Plus, Edit, Trash2, Loader2, X, Power } from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { logActivity } from '../lib/logActivity';

// Freeform knowledge the customer-facing AI support chat can draw on, beyond
// the shipping/refund/terms static_pages it already reads. See
// julinemart-pwa's src/app/api/support/message/route.ts buildSystemPrompt —
// it folds every active row here into the assistant's system prompt on
// every reply, so adding/editing an entry teaches it something new without
// a code deploy.

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface FormState {
  title: string;
  content: string;
  is_active: boolean;
}

const emptyForm: FormState = { title: '', content: '', is_active: true };

export function AiKnowledgePage() {
  const { user } = useAuth();
  const notification = useNotification();

  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('ai_assistant_knowledge')
      .select('id, title, content, is_active, created_by, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      notification.error('Failed to load knowledge entries', error.message);
      setLoading(false);
      return;
    }
    setEntries((data || []) as KnowledgeEntry[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return entries;
    const q = filter.toLowerCase();
    return entries.filter((e) => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
  }, [entries, filter]);

  function openCreate() {
    setEditingId(null);
    setFormData(emptyForm);
    setFormOpen(true);
  }

  function openEdit(entry: KnowledgeEntry) {
    setEditingId(entry.id);
    setFormData({ title: entry.title, content: entry.content, is_active: entry.is_active });
    setFormOpen(true);
  }

  async function handleSave() {
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
        notification.success('Entry updated', payload.title);
      } else {
        const { data: created, error } = await supabase
          .from('ai_assistant_knowledge')
          .insert({ ...payload, created_by: user?.email || 'system' })
          .select('id')
          .single();
        if (error) throw error;
        await logActivity({ action: 'AI_KNOWLEDGE_CREATE', resource_type: 'ai_assistant_knowledge', resource_id: created.id, details: { title: payload.title } });
        notification.success('Entry created', payload.title);
      }

      setFormOpen(false);
      await load();
    } catch (error: any) {
      notification.error('Failed to save entry', error?.message || 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(entry: KnowledgeEntry) {
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
  }

  async function remove(entry: KnowledgeEntry) {
    if (!window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('ai_assistant_knowledge').delete().eq('id', entry.id);
    if (error) {
      notification.error('Delete failed', error.message);
      return;
    }
    await logActivity({ action: 'AI_KNOWLEDGE_DELETE', resource_type: 'ai_assistant_knowledge', resource_id: entry.id, details: { title: entry.title } });
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-6 h-6 text-indigo-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">AI Assistant Knowledge</h1>
            <p className="text-sm text-gray-500">
              What the customer support AI chat knows beyond shipping, refunds, and terms — active entries are added to its instructions automatically.
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Entry
        </button>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search title or content..."
        className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm"
      />

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          {entries.length === 0
            ? 'No knowledge entries yet. Add one so the AI chat can answer questions it currently can\'t — e.g. an active giveaway\'s rules.'
            : 'No entries match your search.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((entry) => (
            <div key={entry.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900">{entry.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${entry.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                      {entry.is_active ? 'active' : 'inactive'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-3">{entry.content}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Updated {new Date(entry.updated_at).toLocaleString()}{entry.created_by ? ` · by ${entry.created_by}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleActive(entry)}
                    title={entry.is_active ? 'Deactivate' : 'Activate'}
                    className={`p-1.5 rounded-lg hover:bg-gray-100 ${entry.is_active ? 'text-green-600' : 'text-gray-400'}`}
                  >
                    <Power className="w-4 h-4" />
                  </button>
                  <button onClick={() => openEdit(entry)} className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(entry)} className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-900">{editingId ? 'Edit entry' : 'New entry'}</h2>
              <button onClick={() => setFormOpen(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600">Title</label>
                <input
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  value={formData.title}
                  onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g. Mirror Glow Secret Drop giveaway"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Content</label>
                <textarea
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  rows={8}
                  value={formData.content}
                  onChange={(e) => setFormData((prev) => ({ ...prev, content: e.target.value }))}
                  placeholder="Write what the AI should know, in plain sentences — e.g. how the giveaway works, entry rules, dates, prizes. It's inserted into the assistant's instructions as-is."
                />
                <p className="mt-1 text-xs text-gray-500">
                  Plain text works best — this is inserted directly into the AI's system prompt.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
                />
                Active (the AI chat can use this right away)
              </label>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
