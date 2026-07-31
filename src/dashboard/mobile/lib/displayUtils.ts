export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function statusStyle(status: string): string {
  const map: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    assigned: 'bg-blue-100 text-blue-700',
    in_transit: 'bg-blue-100 text-blue-700',
    delivered: 'bg-green-100 text-green-700',
    pending_review: 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
  };
  return map[status] ?? 'bg-gray-100 text-gray-700';
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').toUpperCase();
}

export function formatNaira(amount: number): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
}

/** List/catalog rows: simple products use parent price; variable products use variation min–max. */
export function formatProductListPrice(product: {
  type?: string;
  regular_price?: number | null;
  sale_price?: number | null;
  price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
}): string {
  const min = Number(product.min_price) || 0;
  const max = Number(product.max_price) || 0;

  if (product.type === 'variable' && min > 0) {
    return max > min ? `${formatNaira(min)} – ${formatNaira(max)}` : formatNaira(min);
  }

  const single =
    product.price ??
    product.sale_price ??
    product.regular_price ??
    (min > 0 ? min : null);

  if (single != null && Number(single) > 0) return formatNaira(Number(single));
  if (min > 0) return max > min ? `${formatNaira(min)} – ${formatNaira(max)}` : formatNaira(min);

  return '—';
}
