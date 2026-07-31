import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader, Package, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { callGlobalSourcing, type ImportedProduct } from '../lib/globalSourcingApi';

export default function GlobalSourcingImportedPanel() {
  const { session } = useAuth();
  const notification = useNotification();
  const [products, setProducts] = useState<ImportedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await callGlobalSourcing<{ data: ImportedProduct[] }>('global-sourcing-products', { method: 'GET' });
      setProducts(res.data || []);
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load imported products');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteProduct = async (id: string, name: string) => {
    if (!session?.access_token || !window.confirm(`Delete "${name}"?`)) return;
    setDeletingId(id);
    try {
      await callGlobalSourcing(`global-sourcing-products?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setProducts((prev) => prev.filter((p) => p.id !== id));
      notification.success('Deleted', 'Imported product removed');
    } catch (err) {
      notification.error('Delete failed', err instanceof Error ? err.message : 'Unable to delete');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (products.length === 0) {
    return <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No imported products yet.</div>;
  }

  return (
    <div className="space-y-2">
      {products.map((product) => (
        <div key={product.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
          <div className="flex gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
              {product.image ? (
                <img src={product.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <Package className="h-5 w-5 text-gray-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">{product.name}</p>
              <p className="text-xs text-gray-500">CJ {product.external_product_id || 'n/a'}</p>
              <p className="text-xs text-gray-500">
                {product.vendor?.store_name || 'No vendor'} · {product.receiving_hub?.name || 'No hub'}
              </p>
              <p className="text-xs text-gray-400">
                {product.status} · {product.fulfillment_mode || '—'}
              </p>
            </div>
          </div>
          <div className="mt-2 flex gap-2 border-t border-gray-100 pt-2">
            {product.external_product_id && (
              <a
                href={`https://cjdropshipping.com/product/${product.external_product_id}.html`}
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-primary-600"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                CJ
              </a>
            )}
            <button
              type="button"
              disabled={deletingId === product.id}
              onClick={() => deleteProduct(product.id, product.name)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
            >
              {deletingId === product.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
