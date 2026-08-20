import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Clock, FileText, RefreshCw, X } from 'lucide-react';
import { api, DocumentType, RiderDocument } from '../lib/api';
import { BottomNav } from '../components/BottomNav';

const TYPE_LABEL: Record<DocumentType, string> = {
  id: 'Government ID',
  selfie: 'Selfie',
  vehicle: 'Vehicle document',
};

const STATUS_LABEL: Record<RiderDocument['status'], string> = {
  pending: 'Pending review',
  verified: 'Verified',
  rejected: 'Rejected',
};

const STATUS_CLASS: Record<RiderDocument['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  verified: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const STATUS_ICON = { pending: Clock, verified: Check, rejected: X };

const EXPIRY_WARNING_DAYS = 30;

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysUntil(value: string) {
  return Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export default function Documents() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<RiderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDocuments()
      .then((res) => setDocuments(res.current))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load documents'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen pb-24">
      <div className="px-6 pt-8 pb-6 bg-white border-b border-gray-100 flex items-center gap-3">
        <button type="button" onClick={() => navigate('/profile')} className="text-gray-400">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Documents</h1>
          <p className="text-xs text-gray-500 mt-0.5">Status of what you submitted</p>
        </div>
      </div>

      <div className="px-6 pt-6 space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        ) : documents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
            <FileText className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No documents on file yet</p>
          </div>
        ) : (
          documents.map((doc) => {
            const StatusIcon = STATUS_ICON[doc.status];
            const expiring =
              doc.status === 'verified' && doc.expiry_date && daysUntil(doc.expiry_date) <= EXPIRY_WARNING_DAYS;
            const expired = doc.expiry_date && daysUntil(doc.expiry_date) < 0;
            return (
              <a
                key={doc.id}
                href={doc.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-2xl border border-gray-200 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-900">{TYPE_LABEL[doc.type]}</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_CLASS[doc.status]}`}>
                    <StatusIcon className="w-3 h-3" />
                    {STATUS_LABEL[doc.status]}
                  </span>
                </div>

                {doc.status === 'rejected' && doc.rejection_reason && (
                  <p className="mt-1.5 text-xs text-red-600">{doc.rejection_reason}</p>
                )}

                {(doc.issue_date || doc.expiry_date) && (
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
                    {doc.issue_date && <span>Issued {formatDate(doc.issue_date)}</span>}
                    {doc.expiry_date && <span>Expires {formatDate(doc.expiry_date)}</span>}
                  </div>
                )}

                {(expiring || expired) && (
                  <p className={`mt-1.5 text-[11px] font-semibold ${expired ? 'text-red-600' : 'text-amber-700'}`}>
                    {expired ? 'This document has expired' : `Expires in ${daysUntil(doc.expiry_date!)} day${daysUntil(doc.expiry_date!) === 1 ? '' : 's'}`}
                  </p>
                )}
              </a>
            );
          })
        )}
      </div>

      <BottomNav />
    </div>
  );
}
