export type ShipmentFilter =
  | 'all'
  | 'awaiting_supplier_order'
  | 'manual_ordered'
  | 'auto_ordered'
  | 'received_at_hub';

export interface InboundShipment {
  id: string;
  created_at: string;
  provider: string;
  product_image?: string | null;
  woo_order_id: string | null;
  cj_order_id: string | null;
  cj_pid?: string | null;
  cj_vid?: string | null;
  inbound_status: string;
  inbound_tracking_number: string | null;
  supplier_order_mode?: string | null;
  supplier_order_status?: string | null;
  received_at_hub_at: string | null;
  estimated_arrival_at: string | null;
  hubs?: { name: string; code?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  sub_orders?: {
    main_order_id?: string | null;
    tracking_number: string | null;
    status?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function getShipmentSourcing(shipment: InboundShipment) {
  const subMeta = parseObject(shipment.sub_orders?.metadata);
  return parseObject(subMeta.global_sourcing);
}

export function formatInboundStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getShipmentSupplierOrderMode(shipment: InboundShipment) {
  return pickString(shipment.supplier_order_mode, getShipmentSourcing(shipment).supplier_order_mode) || 'automatic';
}

export function getShipmentSupplierOrderStatus(shipment: InboundShipment) {
  const explicit = pickString(shipment.supplier_order_status, getShipmentSourcing(shipment).supplier_order_status);
  if (explicit) return explicit;
  if (shipment.received_at_hub_at || shipment.inbound_status === 'received_at_hub') return 'received_at_hub';
  if (
    shipment.inbound_status === 'supplier_shipped' ||
    shipment.inbound_status === 'supplier_in_transit' ||
    shipment.inbound_status === 'supplier_delivered'
  ) {
    return 'supplier_shipped';
  }
  if (shipment.cj_order_id) return 'supplier_order_placed';
  return 'awaiting_supplier_order';
}

function getShipmentItems(shipment: InboundShipment): Record<string, unknown>[] {
  const sourcing = getShipmentSourcing(shipment);
  if (Array.isArray(sourcing.items)) {
    return sourcing.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  }
  const metadata = parseObject(shipment.metadata);
  if (Array.isArray(metadata.items)) {
    return metadata.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  }
  return [];
}

export function getShipmentTitle(shipment: InboundShipment): string {
  const items = getShipmentItems(shipment);
  const item = items[0] || {};
  const metadata = parseObject(shipment.metadata);
  return pickString(item.name, metadata.title, metadata.product_title, shipment.cj_pid) || 'Inbound item';
}

export function matchesShipmentFilter(shipment: InboundShipment, filter: ShipmentFilter): boolean {
  if (filter === 'all') return true;
  const mode = getShipmentSupplierOrderMode(shipment);
  const status = getShipmentSupplierOrderStatus(shipment);
  if (filter === 'awaiting_supplier_order') return status === 'awaiting_supplier_order';
  if (filter === 'manual_ordered') return mode === 'manual' && status !== 'received_at_hub';
  if (filter === 'auto_ordered') return mode === 'automatic' && status !== 'awaiting_supplier_order' && status !== 'received_at_hub';
  if (filter === 'received_at_hub') return status === 'received_at_hub' || shipment.inbound_status === 'received_at_hub';
  return true;
}

export const SHIPMENT_FILTERS: Array<{ key: ShipmentFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'awaiting_supplier_order', label: 'Awaiting' },
  { key: 'manual_ordered', label: 'Manual' },
  { key: 'auto_ordered', label: 'Auto' },
  { key: 'received_at_hub', label: 'Received' },
];

export function inboundStatusStyle(status: string): string {
  if (status === 'received_at_hub') return 'bg-green-100 text-green-700';
  if (status === 'awaiting_supplier_order') return 'bg-amber-100 text-amber-800';
  if (status.includes('shipped') || status.includes('transit')) return 'bg-blue-100 text-blue-700';
  return 'bg-gray-100 text-gray-700';
}
