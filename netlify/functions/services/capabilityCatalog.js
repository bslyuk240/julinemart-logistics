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

  // ── GIFT ──────────────────────────────────────────────────────────────
  // JulineMart's gift-box program: curated boxes (gift_boxes), the orders
  // placed against them (gift_orders, a side-table keyed off orders.id
  // with its own New -> Packing -> Packed -> Dispatch -> Delivered
  // pipeline run from Settings -> Gift Ops), and the fulfilment
  // centres/packaging options that back them.
  {
    id: 'gift_boxes.list', domain: 'gift', name: 'List Gift Boxes',
    description: 'List curated gift boxes with active/recipient/occasion filters.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/gift-boxes',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'gift_boxes.read', domain: 'gift', name: 'Read Gift Box',
    description: 'Gift box detail including its component products. Excludes internal component cost.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/gift-boxes/:id',
    input_schema: { gift_box_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'gift_orders.list', domain: 'gift', name: 'List Gift Orders',
    description: 'List gift orders through the New/Packing/Packed/Dispatch/Delivered pipeline. Omits recipient contact details.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/gift-orders',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'gift_orders.read', domain: 'gift', name: 'Read Gift Order',
    description: 'Full gift order detail: recipient, gift message, occasion, pipeline timestamps. Excludes recipient email and internal cost/settlement breakdown.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/gift-orders/:id',
    input_schema: { gift_order_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'gift_orders.events.read', domain: 'gift', name: 'Read Gift Order Timeline',
    description: 'Status-change history (packing notes, who did what, when) for one gift order.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/gift-orders/:id/events',
    input_schema: { gift_order_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'gift_orders.status.write', domain: 'gift', name: 'Advance Gift Order Status',
    description: 'Move a gift order through start_packing / mark_packed / dispatch / complete. Also promotes the linked order to delivered on complete.',
    operation_type: 'update', side_effect_type: 'internal_write', risk_level: 'medium',
    http_method: 'PATCH', endpoint: '/gift-orders/:id',
    idempotency_required: false, approval_recommended: true, enabled: false,
  },
  {
    id: 'gift_fulfilment_centres.list', domain: 'gift', name: 'List Gift Fulfilment Centres',
    description: 'Fulfilment centres backing the gift program — location, delivery zones, cutoff times.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/gift-fulfilment-centres',
    supports_pagination: true, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'gift_packaging_types.list', domain: 'gift', name: 'List Gift Packaging Types',
    description: 'Packaging options available for gift orders — name, price, max items.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/gift-packaging-types',
    supports_pagination: true, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },

  // ── RETURNS ───────────────────────────────────────────────────────────
  {
    id: 'returns.list', domain: 'returns', name: 'List Return Requests',
    description: 'List customer return/complaint requests with status/reason filters. Omits customer contact details.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/returns',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'returns.read', domain: 'returns', name: 'Read Return Request',
    description: 'Full return/complaint detail: reason, inspection result, refund status/amount, seller response. Excludes customer email and raw payment-provider payloads.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/returns/:id',
    input_schema: { return_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'returns.shipments.read', domain: 'returns', name: 'Read Return Shipments',
    description: 'Reverse-logistics shipment(s) for one return request — tracking, destination, status.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/returns/:id/shipments',
    input_schema: { return_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },

  // ── INFLUENCERS ───────────────────────────────────────────────────────
  {
    id: 'influencers.list', domain: 'influencers', name: 'List Influencers',
    description: 'List referral/affiliate partners with tier and performance totals. Omits contact details and bank info.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/influencers',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'influencers.read', domain: 'influencers', name: 'Read Influencer',
    description: 'Influencer detail including contact info and coupon/discount terms. Never returns bank details.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/influencers/:id',
    input_schema: { influencer_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'influencers.sales.read', domain: 'influencers', name: 'Read Influencer Sales',
    description: "An influencer's attributed sales and their own commission — excludes JulineMart's internal margin split and customer email.",
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/influencers/:id/sales',
    input_schema: { influencer_id: 'string (uuid)' },
    supports_pagination: true, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },

  // ── CUSTOM ORDERS ─────────────────────────────────────────────────────
  {
    id: 'custom_orders.list', domain: 'custom_orders', name: 'List Custom Order Specs',
    description: 'List personalised/made-to-order line items and their production status.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/custom-orders',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'custom_orders.read', domain: 'custom_orders', name: 'Read Custom Order Spec',
    description: 'Full customisation detail: submitted field values, proof approval, price adjustment.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/custom-orders/:id',
    input_schema: { custom_order_spec_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },

  // ── CAMPAIGNS ─────────────────────────────────────────────────────────
  {
    id: 'campaigns.list', domain: 'campaigns', name: 'List Campaigns',
    description: 'List marketing campaigns with status/approval filters.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/campaigns',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'campaigns.read', domain: 'campaigns', name: 'Read Campaign',
    description: 'Full campaign detail: offer/targeting config, hero/section layout, SEO meta. Excludes internal review notes and reviewer identity.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/campaigns/:id',
    input_schema: { campaign_id: 'string (uuid)' },
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'campaigns.analytics.read', domain: 'campaigns', name: 'Read Campaign Analytics',
    description: 'Aggregate performance (views, conversions) for one campaign.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/campaigns/:id/analytics',
    idempotency_required: false, approval_recommended: false, enabled: false,
  },

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────
  // Real external communication — these actually reach customers/vendors,
  // unlike everything else in this catalog. See capabilityCatalog.js §
  // notes and SKOLA_API_INTERNAL.md for why send/broadcast are enabled
  // with approval_recommended rather than disabled outright: the platform
  // consuming this API (not JLO) is expected to gate execute/high-risk
  // calls behind human approval using this metadata, the same way it
  // would for any other Custom API. JLO does not enforce approval itself.
  {
    id: 'notifications.email_templates.list', domain: 'notifications', name: 'List Email Templates',
    description: 'List available transactional email templates and the {{variables}} each one expects.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/notifications/email-templates',
    supports_pagination: true, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'notifications.email.send', domain: 'notifications', name: 'Send Email',
    description: 'Send an existing approved template to one recipient with variable substitution. Cannot send arbitrary/free-form HTML — template content is fixed, only the {{variables}} are caller-supplied.',
    operation_type: 'create', side_effect_type: 'external_communication', risk_level: 'medium',
    http_method: 'POST', endpoint: '/notifications/email',
    input_schema: { template_name: 'string (must match an active email_templates.name)', to: 'string (email)', data: 'object (optional, {{variable}} values)', order_id: 'string (uuid, optional — for dedup/audit)' },
    idempotency_required: false, approval_recommended: true, enabled: true,
  },
  {
    id: 'notifications.email.send_bulk', domain: 'notifications', name: 'Send Email (bulk)',
    description: 'You CAN send bulk operational email with this tool: one existing template to many recipients in a single call (max 100). List templates first, then pass template_name plus recipients: [{ to, data? }]. Uses Resend batch when Resend is configured. Cannot send arbitrary HTML. Do not claim you cannot send bulk mail or that Mailchimp is required.',
    operation_type: 'create', side_effect_type: 'external_communication', risk_level: 'high',
    http_method: 'POST', endpoint: '/notifications/email/bulk',
    input_schema: {
      template_name: 'string (must match an active email_templates.name)',
      recipients: 'array of { to: email, data?: object, order_id?: uuid } (max 100)',
      data: 'object (optional shared {{variable}} defaults merged under each recipient)',
    },
    idempotency_required: false, approval_recommended: true, enabled: true,
  },
  {
    id: 'notifications.email.schedule', domain: 'notifications', name: 'Schedule Email',
    description: 'Queue a templated email for future delivery.',
    operation_type: 'create', side_effect_type: 'external_communication', risk_level: 'medium',
    http_method: 'POST', endpoint: '/notifications/email/schedule',
    idempotency_required: false, approval_recommended: true, enabled: false,
  },
  {
    id: 'notifications.push.send', domain: 'notifications', name: 'Send Push (single recipient)',
    description: 'Send or schedule a push notification to one customer.',
    operation_type: 'create', side_effect_type: 'external_communication', risk_level: 'medium',
    http_method: 'POST', endpoint: '/notifications/push',
    input_schema: { audience: '"single"', customer_id: 'string', title: 'string', message: 'string', type: 'order_update|product|promotion|general', data: 'object (optional)', schedule_at: 'ISO datetime with timezone, prefer Z (optional — when set, always queued, never sent in this request)' },
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'notifications.push.broadcast', domain: 'notifications', name: 'Broadcast Push (bulk/segment)',
    description: 'Send or schedule a push notification to all customers, all vendors, all staff, or a platform segment. Reaches many real devices in one call.',
    operation_type: 'create', side_effect_type: 'external_communication', risk_level: 'high',
    http_method: 'POST', endpoint: '/notifications/push',
    input_schema: { audience: 'all_customers|all_vendors|all_staff|segment', title: 'string', message: 'string', type: 'order_update|product|promotion|general', segment: '{ platform: android|web } (required if audience=segment)', data: 'object (optional)', schedule_at: 'ISO datetime with timezone, prefer Z (optional — when set, always queued, never sent in this request)' },
    idempotency_required: false, approval_recommended: true, enabled: true,
  },

  // ── META ADS & SOCIAL ────────────────────────────────────────────────
  // Two distinct Graph API surfaces sharing one domain. meta.ads.* reuses
  // the same logic (metaAds functions) that JLO's own internal Ads Manager
  // dashboard uses — this is an additive extension of that code, not a
  // fork of it. meta.social.* is new: JLO had no organic Page/Instagram
  // posting capability before this. Both need env vars that must be
  // configured before calling: meta.ads.* needs META_AD_ACCOUNT_ID /
  // META_ADS_ACCESS_TOKEN / META_PAGE_ID (ad-account-scoped token);
  // meta.social.* needs META_PAGE_ACCESS_TOKEN (a Page-scoped token, NOT
  // the ads token — different permission set) and, for Instagram,
  // META_INSTAGRAM_BUSINESS_ACCOUNT_ID.
  {
    id: 'meta.ads.campaigns.list', domain: 'meta', name: 'List Meta Ad Campaigns',
    description: 'List cached Meta ad campaigns (name, status, budget, last-synced performance).',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/ads/campaigns',
    supports_pagination: false, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.ads.campaigns.sync', domain: 'meta', name: 'Sync Meta Ad Campaigns',
    description: 'Pull latest campaigns + last-30-day performance from Meta into the cache.',
    operation_type: 'create', side_effect_type: 'internal_write', risk_level: 'low',
    http_method: 'POST', endpoint: '/meta/ads/campaigns/sync',
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.ads.campaigns.status.update', domain: 'meta', name: 'Pause/Resume Meta Ad Campaign',
    description: 'Set a live campaign to ACTIVE or PAUSED. Directly controls real ad delivery/spend.',
    operation_type: 'update', side_effect_type: 'financial', risk_level: 'high',
    http_method: 'PUT', endpoint: '/meta/ads/campaigns/:id/status',
    input_schema: { campaign_id: 'string (Meta campaign id)', status: 'ACTIVE | PAUSED' },
    idempotency_required: false, approval_recommended: true, enabled: true,
  },
  {
    id: 'meta.ads.campaigns.budget.update', domain: 'meta', name: 'Update Meta Ad Campaign Budget',
    description: "Change a live campaign's daily budget (NGN). Directly controls real ad spend.",
    operation_type: 'update', side_effect_type: 'financial', risk_level: 'high',
    http_method: 'PUT', endpoint: '/meta/ads/campaigns/:id/budget',
    input_schema: { campaign_id: 'string (Meta campaign id)', daily_budget: 'number (NGN)' },
    idempotency_required: false, approval_recommended: true, enabled: true,
  },
  {
    id: 'meta.ads.drafts.list', domain: 'meta', name: 'List Meta Ad Drafts',
    description: 'List ad drafts (draft/approved/rejected/published) awaiting or past review.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/ads/drafts',
    supports_pagination: false, supports_filtering: true, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.ads.drafts.create', domain: 'meta', name: 'Create Meta Ad Draft',
    description: 'Create a new ad draft (title, copy, image, target). Does not touch Meta until approved and published.',
    operation_type: 'create', side_effect_type: 'internal_write', risk_level: 'low',
    http_method: 'POST', endpoint: '/meta/ads/drafts',
    input_schema: { title: 'string', headline: 'string (optional)', body_text: 'string', call_to_action: 'SHOP_NOW | LEARN_MORE | ORDER_NOW | GET_OFFER (optional)', image_url: 'string (optional, must be a trusted media host)', destination_url: 'string (optional)', target_audience: 'string (optional)', suggested_budget: 'number (optional, NGN)' },
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.ads.drafts.approve', domain: 'meta', name: 'Approve Meta Ad Draft',
    description: 'Approve a draft, allowing it to be published to Meta. Does not itself spend money.',
    operation_type: 'update', side_effect_type: 'internal_write', risk_level: 'medium',
    http_method: 'PUT', endpoint: '/meta/ads/drafts/:id/approve',
    input_schema: { draft_id: 'string (uuid)' },
    idempotency_required: false, approval_recommended: true, enabled: true,
  },
  {
    id: 'meta.ads.drafts.publish', domain: 'meta', name: 'Publish Meta Ad Draft',
    description: 'Publish an approved draft to Meta: creates a real ad creative/ad set/ad (created PAUSED — still requires a manual or a separate campaigns.status.update call to go live/spend).',
    operation_type: 'execute', side_effect_type: 'financial', risk_level: 'high',
    http_method: 'POST', endpoint: '/meta/ads/drafts/:id/publish',
    input_schema: { draft_id: 'string (uuid)', campaign_id: 'string (optional, existing Meta campaign id)', new_campaign_name: 'string (required if campaign_id omitted)', daily_budget: 'number (NGN, required unless the target campaign already holds its own budget)' },
    idempotency_required: false, approval_recommended: true, enabled: true,
  },
  {
    id: 'meta.ads.account.read', domain: 'meta', name: 'Read Meta Ad Account Balance',
    description: 'Ad account balance/spend/currency — for checking budget headroom before proposing spend.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/ads/account',
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.ads.recommendations.list', domain: 'meta', name: 'List Meta AI Recommendations',
    description: "Pending AI-generated suggestions for improving ad performance (JLO's own recommendation engine, not Meta's).",
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/ads/recommendations',
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.social.facebook.post', domain: 'meta', name: 'Post to Facebook Page',
    description: 'Publish an organic (unpaid) post to the JulineMart Facebook Page feed: text with an optional link, OR a photo with an optional caption — not both a link and a photo in the same post (Meta does not support that combination). Public and immediate — no draft/approval step exists yet.',
    operation_type: 'create', side_effect_type: 'external_communication', risk_level: 'high',
    http_method: 'POST', endpoint: '/meta/social/facebook/post',
    input_schema: { message: 'string (required unless image_url is set — used as the post text, or the photo caption)', link: 'string (optional, any https URL — mutually exclusive with image_url)', image_url: 'string (optional, must be a trusted media host — mutually exclusive with link)' },
    idempotency_required: false, approval_recommended: true, enabled: true,
  },
  {
    id: 'meta.social.instagram.post', domain: 'meta', name: 'Post to Instagram',
    description: 'Publish an organic (unpaid) image post to the JulineMart Instagram Business Account. Public and immediate — no draft/approval step exists yet.',
    operation_type: 'create', side_effect_type: 'external_communication', risk_level: 'high',
    http_method: 'POST', endpoint: '/meta/social/instagram/post',
    input_schema: { image_url: 'string (must be a trusted media host)', caption: 'string (optional)' },
    idempotency_required: false, approval_recommended: true, enabled: true,
  },
  {
    id: 'meta.social.page.read', domain: 'meta', name: 'Read Facebook Page Profile',
    description: 'JulineMart Facebook Page basics: name, category, follower/fan counts.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/social/facebook/page',
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.social.page.posts.list', domain: 'meta', name: 'List Facebook Page Posts',
    description: 'Recent organic Page posts with like/comment/share counts.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/social/facebook/posts',
    input_schema: { limit: 'number (optional, default 10, max 50)' },
    supports_pagination: true, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.social.page.insights.read', domain: 'meta', name: 'Read Facebook Page Insights',
    description: "Page-level Insights metrics (reach, engaged users, post engagements by default — Meta's Insights metric names change over time, so a custom metrics list can be passed).",
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/social/facebook/insights',
    input_schema: { metrics: 'comma-separated string (optional, defaults to page_post_engagements,page_views_total,page_follows)', period: 'day | week | days_28 (optional, default day)', since: 'ISO date (optional)', until: 'ISO date (optional)' },
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.social.instagram.account.read', domain: 'meta', name: 'Read Instagram Account Profile',
    description: 'JulineMart Instagram Business Account basics: username, follower count, media count.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/social/instagram/account',
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.social.instagram.media.list', domain: 'meta', name: 'List Instagram Media',
    description: 'Recent Instagram posts with like/comment counts.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/social/instagram/media',
    input_schema: { limit: 'number (optional, default 10, max 50)' },
    supports_pagination: true, supports_filtering: false, supports_search: false,
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'meta.social.instagram.insights.read', domain: 'meta', name: 'Read Instagram Account Insights',
    description: "Account-level Insights metrics (reach, profile views by default — Meta's Insights metric names change over time, so a custom metrics list can be passed).",
    operation_type: 'read', side_effect_type: 'none', risk_level: 'low',
    http_method: 'GET', endpoint: '/meta/social/instagram/insights',
    input_schema: { metrics: 'comma-separated string (optional, defaults to reach; profile_views also works but needs extra={metric_type:"total_value"})', period: 'day | week | days_28 (optional, default day)', since: 'ISO date (optional)', until: 'ISO date (optional)' },
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
    description: 'Customer profile (name, phone). Email is never returned. :id may be a UUID or a phone number.',
    operation_type: 'read', side_effect_type: 'none', risk_level: 'medium',
    http_method: 'GET', endpoint: '/customers/:id',
    input_schema: { id: 'uuid or phone' },
    idempotency_required: false, approval_recommended: false, enabled: true,
  },
  {
    id: 'customers.orders.read', domain: 'customers', name: 'Read Customer Orders',
    description: "A customer's order history (no customer email). :id may be a UUID or a phone number.",
    operation_type: 'read', side_effect_type: 'none', risk_level: 'medium',
    http_method: 'GET', endpoint: '/customers/:id/orders',
    input_schema: { id: 'uuid or phone', status: 'optional order overall_status', limit: 'number', offset: 'number' },
    supports_pagination: true, supports_filtering: true,
    idempotency_required: false, approval_recommended: false, enabled: true,
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
