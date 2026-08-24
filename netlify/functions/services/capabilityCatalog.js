/**
 * Single source of truth for the JLO Custom API's capability manifest.
 *
 * This is NOT designed around fixed agent roles ("Ops Manager", "Sales
 * Rep"). It describes business capabilities JLO exposes, grouped by
 * domain. Skola Workforce (or any Custom API consumer) discovers this via
 * GET /api/v1/capabilities and turns entries into tools it can assign to
 * whatever agent needs them — JLO has no notion of which agent uses what.
 *
 * A service_api_keys row's `scopes` is the ceiling: the max capabilities
 * that connection can ever use. Which subset a given agent gets is decided
 * entirely on the platform side, not here.
 *
 * `enabled: false` entries are real, deliberate roadmap items — advertised
 * so a consumer can see what's coming, but calling them 404s today. Do not
 * flip one to `enabled: true` without actually building the route AND
 * getting a product/security sign-off proportional to its risk_level —
 * several of these (location, customer PII, shipment creation, order
 * cancellation) were left disabled on purpose, not by oversight.
 */

export const CAPABILITIES = [
  // ── ORDERS ────────────────────────────────────────────────────────────
  {
    id: 'orders.list', domain: 'orders', name: 'List Orders',
    description: 'List orders with optional status/date filters.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/orders',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'orders.search', domain: 'orders', name: 'Search Orders',
    description: 'List orders filtered by a free-text query (customer name or order number).',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/orders?q=',
    supports_pagination: true, supports_filtering: true, supports_search: true,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'orders.read', domain: 'orders', name: 'Read Order',
    description: 'Full detail for one order, including its sub-order/vendor legs.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/orders/:id',
    input_schema: { order_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'orders.status', domain: 'orders', name: 'Read Order Status',
    description: 'Lightweight status-only lookup for one order.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/orders/:id/status',
    input_schema: { order_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'orders.items.read', domain: 'orders', name: 'Read Order Items',
    description: 'Line items (products, quantities, prices) for one order.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/orders/:id/items',
    input_schema: { order_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'orders.cancel', domain: 'orders', name: 'Cancel Order',
    description: 'Cancel an order that has not yet shipped.',
    operation_type: 'execute', side_effect_type: 'destructive', risk_level: 'critical',
    http_method: 'POST', endpoint: '/orders/:id/cancel',
    idempotency_required: true, approval_recommended: true, enabled: false,
  },

  // ── SHIPMENTS ─────────────────────────────────────────────────────────
  {
    id: 'shipments.list', domain: 'shipments', name: 'List Shipments',
    description: 'List shipments with an optional status filter.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/shipments',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'shipments.read', domain: 'shipments', name: 'Read Shipment',
    description: 'Full detail for one shipment (pickup/dropoff, courier, timestamps).',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/shipments/:id',
    input_schema: { shipment_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'shipments.track', domain: 'shipments', name: 'Track Shipment',
    description: 'Alias of shipments.read for tracking-oriented consumers.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/shipments/:id',
    input_schema: { shipment_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'shipments.delayed.list', domain: 'shipments', name: 'List Delayed Shipments',
    description: 'Shipments outside the configured non-terminal-status age threshold.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/shipments/delayed',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'shipments.timeline.read', domain: 'shipments', name: 'Read Shipment Timeline',
    description: 'Ordered tracking events (status changes, courier scans) for one shipment.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/shipments/:id/timeline',
    input_schema: { shipment_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'shipments.notes.write', domain: 'shipments', name: 'Add Shipment Note',
    description: 'Append an audit-logged note to a shipment. Does not change status.',
    operation_type: 'create', side_effect_type: 'internal_write', risk_level: 'low',
    http_method: 'POST', endpoint: '/shipments/:id/notes',
    input_schema: { shipment_id: 'string (uuid)', note: 'string (max 2000 chars)', author: 'string (optional)' },
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'shipments.create', domain: 'shipments', name: 'Create Shipment',
    description: 'Dispatch a real courier shipment for an order leg (incurs real courier cost).',
    operation_type: 'execute', side_effect_type: 'financial', risk_level: 'high',
    http_method: 'POST', endpoint: '/shipments',
    idempotency_required: true, approval_recommended: true, enabled: false,
  },

  // ── RIDERS ────────────────────────────────────────────────────────────
  {
    id: 'riders.list', domain: 'riders', name: 'List Riders',
    description: 'List riders (onboarding status, online state) with optional filters.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/riders',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'riders.read', domain: 'riders', name: 'Read Rider',
    description: 'Rider profile detail (name, contact, vehicle, onboarding status). Excludes ID/bank/guarantor documents.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/riders/:id',
    input_schema: { rider_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'riders.status.read', domain: 'riders', name: 'Read Rider Status',
    description: 'Online/verification status only — the smallest rider read.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/riders/:id/status',
    input_schema: { rider_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'riders.location.read', domain: 'riders', name: 'Read Rider Location',
    description: 'Live GPS coordinates for a rider.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'medium',
    http_method: 'GET', endpoint: '/riders/:id/location',
    idempotency_required: false, approval_recommended: true, enabled: false,
  },

  // ── VENDORS ───────────────────────────────────────────────────────────
  {
    id: 'vendors.list', domain: 'vendors', name: 'List Vendors',
    description: 'List marketplace vendors with an active/inactive filter.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/vendors',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'vendors.read', domain: 'vendors', name: 'Read Vendor',
    description: 'Vendor profile detail. Excludes bank details, tax ID, and commission rate.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/vendors/:id',
    input_schema: { vendor_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'vendors.orders.read', domain: 'vendors', name: 'Read Vendor Orders',
    description: "A vendor's order legs (sub-orders) — status, order number, subtotal, created date.",
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/vendors/:id/orders',
    input_schema: { vendor_id: 'string (uuid)' },
    supports_pagination: true, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'vendors.performance.read', domain: 'vendors', name: 'Read Vendor Performance',
    description: 'Fulfillment-rate and processing-time metrics for one vendor.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/vendors/:id/performance',
    input_schema: { vendor_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },

  // ── CATALOGUE ─────────────────────────────────────────────────────────
  {
    id: 'products.list', domain: 'catalogue', name: 'List Products',
    description: 'List products with status/stock/vendor filters.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/products',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'products.search', domain: 'catalogue', name: 'Search Products',
    description: 'List products filtered by a free-text query (name or SKU).',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/products?q=',
    supports_pagination: true, supports_filtering: true, supports_search: true,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'products.read', domain: 'catalogue', name: 'Read Product',
    description: 'Full detail for one product, excluding internal cost/sourcing fields.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/products/:id',
    input_schema: { product_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'categories.list', domain: 'catalogue', name: 'List Categories',
    description: 'List product categories.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/categories',
    supports_pagination: true, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },

  // ── CUSTOMERS ─────────────────────────────────────────────────────────
  {
    id: 'customers.read', domain: 'customers', name: 'Read Customer',
    description: 'Customer profile (name, phone, order history summary). No email.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'medium',
    http_method: 'GET', endpoint: '/customers/:id',
    idempotency_required: false, approval_recommended: false, enabled: false,
  },
  {
    id: 'customers.orders.read', domain: 'customers', name: 'Read Customer Orders',
    description: "A customer's order history.",
    operation_type: 'read', side_effect_type: 'none', risk_level: 'medium',
    http_method: 'GET', endpoint: '/customers/:id/orders',
    idempotency_required: false, approval_recommended: false, enabled: false,
  },

  // ── OPERATIONS ────────────────────────────────────────────────────────
  {
    id: 'operations.exceptions.list', domain: 'operations', name: 'List Operational Exceptions',
    description: 'Cross-domain feed of things needing attention (delayed shipments, stuck orders, etc).',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/operations/exceptions',
    idempotency_required: false, approval_recommended: false, enabled: false,
  },
  {
    id: 'operations.summary.read', domain: 'operations', name: 'Read Operations Summary',
    description: 'Aggregate counts across orders/shipments/vendors for a dashboard-style view.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/operations/summary',
    idempotency_required: false, approval_recommended: false, enabled: false,
  },
];

export const EVENTS = [
  {
    id: 'order.updated', domain: 'orders',
    description: "Emitted when an order's overall status changes (payment confirmed, cancelled, refunded, promoted to processing on first shipment, delivered).",
  },
  {
    id: 'shipment.delayed', domain: 'shipments',
    description: 'Emitted once per shipment when it has been in a non-terminal status longer than the configured threshold (default 24h).',
  },
];

export function getEnabledCapabilityIds() {
  return CAPABILITIES.filter((c) => c.enabled).map((c) => c.id);
}

export function getCapabilityManifest() {
  return {
    provider: 'julinemart',
    version: '1.0',
    capabilities: CAPABILITIES,
    events: EVENTS,
  };
}
