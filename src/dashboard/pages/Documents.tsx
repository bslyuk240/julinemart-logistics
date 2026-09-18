import { useCallback, useEffect, useState } from 'react';
import { FileText, Upload, Download, Trash2, Loader2, File } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  content_type: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

const CATEGORIES = ['general', 'partner pack', 'policy', 'legal', 'onboarding'];

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function DocumentsPage() {
  const { session, user } = useAuth();
  const notification = useNotification();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [file, setFile] = useState<File | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }, [session?.access_token]);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin-documents', { headers: authHeaders() });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Failed to load documents');
      setDocuments(json.data || []);
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('general');
    setFile(null);
    setShowForm(false);
  };

  const handleUpload = async () => {
    if (!title.trim() || !file) {
      notification.error('Missing info', 'Give the document a title and choose a file');
      return;
    }
    setUploading(true);
    try {
      const file_base64 = await fileToBase64(file);
      const response = await fetch('/api/admin-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          category,
          file_name: file.name,
          content_type: file.type,
          file_base64,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Upload failed');
      notification.success('Uploaded', `${title.trim()} was added to the library`);
      resetForm();
      void fetchDocuments();
    } catch (err) {
      notification.error('Upload failed', err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: DocumentRow) => {
    if (!window.confirm(`Delete "${doc.title}"? This can't be undone.`)) return;
    setDeletingId(doc.id);
    try {
      const response = await fetch(`/api/admin-documents?id=${doc.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Delete failed');
      notification.success('Deleted', `${doc.title} was removed`);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      notification.error('Delete failed', err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const canDelete = user?.role === 'admin';

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-primary-600 flex-shrink-0" />
            Documents
          </h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">
            Partner packs, policies, and other business documents JulineMart staff share.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 transition-colors shrink-0"
        >
          <Upload className="w-4 h-4" />
          Upload
        </button>
      </div>

      {showForm && (
        <div className="card mb-6 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. JulineMart Logistics Partner Pack"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">File (max 15 MB)</label>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
              {uploading ? 'Uploading…' : 'Save document'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <File className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            No documents yet. Upload the first one.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900">{doc.title}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                      {doc.category}
                    </span>
                  </div>
                  {doc.description && <p className="text-sm text-gray-600 mt-0.5">{doc.description}</p>}
                  <p className="text-xs text-gray-400 mt-1">
                    {doc.file_name}
                    {doc.file_size ? ` · ${formatSize(doc.file_size)}` : ''}
                    {doc.uploaded_by_name ? ` · ${doc.uploaded_by_name}` : ''}
                    {' · '}
                    {new Date(doc.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary-600"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(doc)}
                      disabled={deletingId === doc.id}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Delete"
                    >
                      {deletingId === doc.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
