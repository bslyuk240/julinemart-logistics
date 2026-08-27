/**
 * Single source of truth for Settings → Developer content.
 * Derived from live Netlify functions + netlify.toml redirects (not legacy Express :3001 routes).
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiEndpoint {
  method: HttpMethod;
  path: string;
  description: string;
  auth?: 'admin' | 'staff' | 'public' | 'webhook' | 'service';
}

export interface ApiEndpointGroup {
  category: string;
  items: ApiEndpoint[];
}

export interface WebhookEndpoint {
  id: string;
  label: string;
  path: string;
  kind: 'inbound' | 'setup';
  note: string;
  envKeys?: string[];
}

export interface DbTableInfo {
  name: string;
  description: string;
  detail: string;
}

export interface EnvVarGroup {
  title: string;
  description: string;
  vars: { key: string; note: string; serverOnly?: boolean }[];
}

export interface DeveloperNavLink {
  label: string;
  description: string;
  href: string;
  external?: boolean;
}

export const SYSTEM_ROLES = ['admin', 'manager', 'agent', 'shop_manager'] as const;

export const WORKFLOW_STEPS = [
  'Order received (JulineMart PWA checkout or admin create-order)',
  'Automatic hub split and shipping calculation (VAT included)',
  'Sub-orders created per fulfillment hub',
  'Courier assignment and Fez shipment creation',
  'Live tracking via Fez webhook until delivered',
] as const;

/** Live Netlify /api/* surface — matches netlify/functions/*.js and netlify.toml overrides. */
export const API_ENDPOINT_GROUPS: ApiEndpointGroup[] = [
  {
    category: 'Orders & checkout',
    items: [
      { method: 'POST', path: '/api/create-order', description: 'Storefront checkout ingestion (PWA)', auth: 'webhook' },
      { method: 'GET', path: '/api/orders', description: 'List orders', auth: 'staff' },
      { method: 'POST', path: '/api/orders', description: 'Create order (admin)', auth: 'staff' },
      { method: 'GET', path: '/api/orders/:id', description: 'Order details', auth: 'staff' },
      { method: 'POST', path: '/api/cancel-order', description: 'Cancel order', auth: 'staff' },
      { method: 'POST', path: '/api/verify-payment', description: 'Paystack payment verification', auth: 'public' },
      { method: 'GET', path: '/api/track-order', description: 'Customer order tracking lookup', auth: 'public' },
      { method: 'GET', path: '/api/track-manual-shipment', description: 'Public manual shipment tracking (tracking # + recipient phone)', auth: 'public' },
      { method: 'GET', path: '/api/customer-orders', description: 'Customer order history', auth: 'public' },
    ],
  },
  {
    category: 'Shipping & network',
    items: [
      { method: 'POST', path: '/api/calc-shipping', description: 'Calculate shipping cost', auth: 'public' },
      { method: 'GET', path: '/api/shipping-rates', description: 'List shipping rates', auth: 'staff' },
      { method: 'GET', path: '/api/zones', description: 'List shipping zones', auth: 'staff' },
      { method: 'GET', path: '/api/zones/:state', description: 'Zone for Nigerian state', auth: 'staff' },
      { method: 'GET', path: '/api/hubs', description: 'List fulfillment hubs', auth: 'staff' },
      { method: 'GET', path: '/api/couriers', description: 'List courier partners', auth: 'staff' },
      { method: 'PUT', path: '/api/save-courier-credentials/:courierId', description: 'Save courier API credentials', auth: 'admin' },
    ],
  },
  {
    category: 'Courier dispatch (Fez)',
    items: [
      { method: 'POST', path: '/api/fez-create-shipment', description: 'Create Fez shipment for sub-order', auth: 'staff' },
      { method: 'POST', path: '/api/fez-create-shipment-batch', description: 'Batch Fez dispatch (hub)', auth: 'staff' },
      { method: 'GET', path: '/api/fez-fetch-tracking', description: 'Pull live Fez tracking (subOrderId or shipmentId)', auth: 'staff' },
      { method: 'POST', path: '/api/generate-label', description: 'Generate shipping label (sub-order or manual shipment)', auth: 'staff' },
      { method: 'POST', path: '/api/generate-waybill', description: 'Generate waybill number', auth: 'staff' },
      { method: 'POST', path: '/api/assign-rider', description: 'Assign hub rider to sub-order', auth: 'staff' },
    ],
  },
  {
    category: 'Returns & refunds',
    items: [
      { method: 'GET', path: '/api/returns-queue', description: 'Returns / refund queue', auth: 'staff' },
      { method: 'POST', path: '/api/admin-approve-return', description: 'Approve return & trigger refund', auth: 'admin' },
      { method: 'POST', path: '/api/returns/:id/inspection', description: 'Record return inspection', auth: 'admin' },
      { method: 'POST', path: '/api/create-return-shipment', description: 'Create return Fez shipment', auth: 'staff' },
      { method: 'GET', path: '/api/return-shipments/order/:orderId', description: 'Returns for order', auth: 'staff' },
    ],
  },
  {
    category: 'Manual shipments',
    items: [
      { method: 'GET', path: '/api/manual-shipments', description: 'List manual shipments', auth: 'staff' },
      { method: 'POST', path: '/api/manual-shipments', description: 'Create manual shipment', auth: 'staff' },
      { method: 'DELETE', path: '/api/manual-shipments/:id', description: 'Delete pending manual shipment', auth: 'staff' },
      { method: 'POST', path: '/api/manual-shipment-fez-dispatch', description: 'Dispatch manual shipment via Fez', auth: 'staff' },
      { method: 'POST', path: '/api/manual-shipment-assign-rider', description: 'Assign rider to manual shipment', auth: 'staff' },
    ],
  },
  {
    category: 'Push & email',
    items: [
      { method: 'POST', path: '/api/admin/notifications/send', description: 'Send push via PWA engine (admin proxy)', auth: 'admin' },
      { method: 'GET', path: '/api/admin/device-tokens', description: 'Push subscriber registry (PII-safe)', auth: 'admin' },
      { method: 'POST', path: '/api/vendor-register-push', description: 'Register vendor FCM token', auth: 'public' },
      { method: 'GET', path: '/api/email/config', description: 'Email provider configuration', auth: 'admin' },
      { method: 'PUT', path: '/api/email/config', description: 'Update email configuration', auth: 'admin' },
      { method: 'POST', path: '/api/email/test', description: 'Send test email', auth: 'admin' },
      { method: 'GET', path: '/api/email/logs', description: 'Email delivery logs', auth: 'admin' },
      { method: 'POST', path: '/api/broadcast-email', description: 'Newsletter broadcast', auth: 'admin' },
    ],
  },
  {
    category: 'Global sourcing',
    items: [
      { method: 'GET', path: '/api/cj-auth', description: 'CJ credential status', auth: 'admin' },
      { method: 'POST', path: '/api/cj-auth', description: 'Test CJ API connection', auth: 'admin' },
      { method: 'GET', path: '/api/global-sourcing-settings', description: 'FX & pricing defaults', auth: 'admin' },
      { method: 'POST', path: '/api/global-sourcing-settings', description: 'Update sourcing settings', auth: 'admin' },
      { method: 'GET', path: '/api/fx-price-sync', description: 'FX sync status & logs', auth: 'admin' },
      { method: 'POST', path: '/api/fx-price-sync', description: 'Run FX price sync', auth: 'admin' },
      { method: 'GET', path: '/api/global-sourcing-products', description: 'Imported sourcing products', auth: 'staff' },
    ],
  },
  {
    category: 'Admin & analytics',
    items: [
      { method: 'GET', path: '/api/stats', description: 'Dashboard statistics', auth: 'staff' },
      { method: 'GET', path: '/api/analytics', description: 'Analytics aggregates', auth: 'staff' },
      { method: 'GET', path: '/api/activity-logs', description: 'Audit trail', auth: 'staff' },
      { method: 'GET', path: '/api/users', description: 'Staff user list', auth: 'admin' },
      { method: 'GET', path: '/api/settlements', description: 'Vendor settlements', auth: 'admin' },
      { method: 'GET', path: '/api/admin/settings-health', description: 'Integration env health (this panel)', auth: 'admin' },
    ],
  },
  {
    category: 'Inbound webhooks',
    items: [
      { method: 'POST', path: '/api/paystack-webhook', description: 'Paystack payment events', auth: 'webhook' },
      { method: 'POST', path: '/api/fez-webhook', description: 'Fez delivery status updates', auth: 'webhook' },
      { method: 'POST', path: '/api/notify-order-confirmation', description: 'Supabase orders INSERT → confirmation email', auth: 'webhook' },
    ],
  },
  {
    category: 'External service API (Custom API integrations) — capability manifest',
    items: [
      { method: 'GET', path: '/api/v1/capabilities', description: 'Discovery manifest — every capability + event this API offers, enabled or not (any valid key)', auth: 'service' },
      { method: 'GET', path: '/api/v1/orders', description: 'List/search orders — orders.list, orders.search', auth: 'service' },
      { method: 'GET', path: '/api/v1/orders/:id', description: 'Order details — orders.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/orders/:id/status', description: 'Lightweight status lookup — orders.status', auth: 'service' },
      { method: 'GET', path: '/api/v1/orders/:id/items', description: 'Order line items — orders.items.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/shipments', description: 'List shipments — shipments.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/shipments/delayed', description: 'Shipments past the delay threshold — shipments.delayed.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/shipments/:id', description: 'Shipment details — shipments.read / shipments.track', auth: 'service' },
      { method: 'GET', path: '/api/v1/shipments/:id/timeline', description: 'Tracking event history — shipments.timeline.read', auth: 'service' },
      { method: 'POST', path: '/api/v1/shipments/:id/notes', description: 'Append a note — shipments.notes.write', auth: 'service' },
      { method: 'GET', path: '/api/v1/vendors', description: 'List vendors — vendors.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/vendors/:id', description: 'Vendor details — vendors.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/vendors/:id/orders', description: "Vendor's order legs — vendors.orders.read", auth: 'service' },
      { method: 'GET', path: '/api/v1/vendors/:id/performance', description: 'Fulfillment/processing-time metrics — vendors.performance.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/gift-boxes', description: 'List gift boxes — gift_boxes.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/gift-boxes/:id', description: 'Gift box detail + component items — gift_boxes.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/gift-orders', description: 'List gift orders — gift_orders.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/gift-orders/:id', description: 'Gift order detail (recipient, message, occasion) — gift_orders.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/gift-orders/:id/events', description: 'Gift order status history — gift_orders.events.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/gift-fulfilment-centres', description: 'List gift fulfilment centres — gift_fulfilment_centres.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/gift-packaging-types', description: 'List gift packaging options — gift_packaging_types.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/riders', description: 'List riders — riders.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/riders/:id', description: 'Rider profile — riders.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/riders/:id/status', description: 'Rider online/verification status — riders.status.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/customers/:id', description: 'Customer profile (name, phone; no email) — customers.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/customers/:id/orders', description: "Customer's order history — customers.orders.read", auth: 'service' },
      { method: 'GET', path: '/api/v1/products', description: 'List/search catalogue products — products.list, products.search', auth: 'service' },
      { method: 'GET', path: '/api/v1/products/:id', description: 'Product detail — products.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/categories', description: 'List categories — categories.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/returns', description: 'List return/complaint requests — returns.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/returns/:id', description: 'Return request detail — returns.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/returns/:id/shipments', description: 'Reverse-logistics shipment(s) — returns.shipments.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/influencers', description: 'List referral/affiliate partners — influencers.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/influencers/:id', description: 'Influencer detail — influencers.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/influencers/:id/sales', description: 'Attributed sales + own commission — influencers.sales.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/custom-orders', description: 'List personalised order specs — custom_orders.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/custom-orders/:id', description: 'Custom order spec detail — custom_orders.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/campaigns', description: 'List marketing campaigns — campaigns.list', auth: 'service' },
      { method: 'GET', path: '/api/v1/campaigns/:id', description: 'Campaign detail incl. offer/targeting config — campaigns.read', auth: 'service' },
      { method: 'GET', path: '/api/v1/notifications/email-templates', description: 'List sendable email templates — notifications.email_templates.list', auth: 'service' },
      { method: 'POST', path: '/api/v1/notifications/email', description: 'Send an existing template to one recipient — notifications.email.send', auth: 'service' },
      { method: 'POST', path: '/api/v1/notifications/email/bulk', description: 'Send one template to many recipients (max 100) — notifications.email.send_bulk', auth: 'service' },
      { method: 'POST', path: '/api/v1/notifications/push', description: 'Send/schedule push — notifications.push.send (single) or notifications.push.broadcast (bulk/segment)', auth: 'service' },
      { method: 'GET', path: '/api/admin/service-api-keys', description: 'Mint/list/revoke service API keys + fetch the full capability catalog (Settings → Integrations)', auth: 'admin' },
      { method: 'POST', path: '/api/admin/webhook-endpoints', description: 'Configure outbound webhook URL + secret (Settings → Integrations)', auth: 'admin' },
    ],
  },
];

export const INBOUND_WEBHOOKS: WebhookEndpoint[] = [
  {
    id: 'create-order',
    label: 'Store checkout (create order)',
    path: '/api/create-order',
    kind: 'inbound',
    note: 'JulineMart PWA posts paid checkout payloads here after payment.',
  },
  {
    id: 'paystack',
    label: 'Paystack payments',
    path: '/api/paystack-webhook',
    kind: 'inbound',
    note: 'Configure in Paystack dashboard. Uses PAYSTACK_SECRET_KEY for signature validation.',
    envKeys: ['PAYSTACK_SECRET_KEY'],
  },
  {
    id: 'fez',
    label: 'Fez tracking',
    path: '/api/fez-webhook',
    kind: 'inbound',
    note: 'Fez delivery status updates for sub-orders and return shipments.',
    envKeys: ['FEZ_API_KEY', 'FEZ_USER_ID'],
  },
  {
    id: 'order-email',
    label: 'Order confirmation email',
    path: '/api/notify-order-confirmation',
    kind: 'inbound',
    note: 'Supabase Database Webhook on public.orders INSERT (when checkout bypasses create-order). Authorization: Bearer ORDER_EMAIL_WEBHOOK_SECRET.',
    envKeys: ['ORDER_EMAIL_WEBHOOK_SECRET'],
  },
];

export const WEBHOOK_SETUP_HELPERS: WebhookEndpoint[] = [
  {
    id: 'fez-register',
    label: 'Fez webhook registration (ops)',
    path: '/api/fez-register-webhook',
    kind: 'setup',
    note: 'Admin helper to register Fez callback URL — run once per environment, not an inbound URL.',
  },
];

export const DB_TABLES: DbTableInfo[] = [
  { name: 'orders', description: 'Customer orders', detail: 'PWA checkout, Paystack, manual admin entry' },
  { name: 'sub_orders', description: 'Hub splits', detail: 'One row per hub slice; courier & tracking' },
  { name: 'hubs', description: 'Fulfillment centers', detail: 'Warri, Lagos, Abuja, etc.' },
  { name: 'couriers', description: 'Delivery partners', detail: 'Fez, GIGL, Kwik — credentials in UI' },
  { name: 'zones', description: 'Shipping zones', detail: 'Six zones across Nigeria' },
  { name: 'shipping_rates', description: 'Rate matrix', detail: 'Hub × zone × courier combinations' },
  { name: 'customers', description: 'Storefront accounts', detail: 'Excludes staff & vendor auth rows' },
  { name: 'vendors', description: 'Marketplace sellers', detail: 'Store profiles, hub assignment, payouts' },
  { name: 'products', description: 'Catalog', detail: 'Vendor & global-sourcing products' },
  { name: 'manual_shipments', description: 'Non-order dispatches', detail: 'Ad-hoc Fez / rider shipments' },
  { name: 'return_requests', description: 'Customer returns', detail: 'Inspection, refund, Fez return leg' },
  { name: 'refund_records', description: 'Refund audit', detail: 'Paystack refund tracking' },
  { name: 'device_tokens', description: 'Push tokens', detail: 'Customers, vendors, staff, and riders FCM registrations' },
  { name: 'email_config', description: 'SMTP settings', detail: 'Encrypted secrets at rest' },
  { name: 'email_logs', description: 'Sent email log', detail: 'Delivery status per message' },
  { name: 'pwa_install_events', description: 'PWA telemetry', detail: 'Install & notification opt-in funnel' },
  { name: 'users', description: 'JLO staff', detail: 'admin, manager, agent, shop_manager' },
  { name: 'activity_logs', description: 'Audit trail', detail: 'Staff, customer portal & vendor portal events' },
  { name: 'support_sessions', description: 'Support chat', detail: 'Customer ↔ staff conversations' },
  { name: 'campaign_vouchers', description: 'Promo vouchers', detail: 'JulineMart-funded discounts' },
];

export const ENV_VAR_GROUPS: EnvVarGroup[] = [
  {
    title: 'Supabase',
    description: 'Database and auth — required for all functions.',
    vars: [
      { key: 'VITE_SUPABASE_URL', note: 'Project URL (client + server)' },
      { key: 'VITE_SUPABASE_ANON_KEY', note: 'Public anon key (client)' },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', note: 'Service role — server only, never expose', serverOnly: true },
    ],
  },
  {
    title: 'Payments & webhooks',
    description: 'Checkout and inbound payment events.',
    vars: [
      { key: 'PAYSTACK_SECRET_KEY', note: 'Paystack webhook signature', serverOnly: true },
      { key: 'PAYSTACK_PUBLIC_KEY', note: 'Client checkout (PWA)' },
      { key: 'WEBHOOK_SECRET', note: 'Optional — unused by active functions; dedicated secrets per webhook', serverOnly: true },
      { key: 'ORDER_EMAIL_WEBHOOK_SECRET', note: 'Bearer token for notify-order-confirmation', serverOnly: true },
    ],
  },
  {
    title: 'Push notifications',
    description: 'JLO admin proxy → PWA push engine.',
    vars: [
      { key: 'PWA_BASE_URL', note: 'Storefront origin (e.g. https://julinemart.com)', serverOnly: true },
      { key: 'NOTIFICATIONS_ADMIN_SECRET', note: 'Bulk send auth to PWA', serverOnly: true },
    ],
  },
  {
    title: 'Email',
    description: 'Transactional & broadcast email.',
    vars: [
      { key: 'EMAIL_PROVIDER', note: 'gmail | sendgrid | smtp — fallback only if no Resend key', serverOnly: true },
      { key: 'RESEND_API_KEY', note: 'Operational mail (orders, bulk). Auth stays on Supabase SMTP.', serverOnly: true },
      { key: 'EMAIL_SECRETS_ENCRYPTION_KEY', note: 'Encrypt SMTP passwords in DB', serverOnly: true },
      { key: 'EMAIL_ENABLED', note: 'Master send toggle', serverOnly: true },
      { key: 'CUSTOMER_PORTAL_URL', note: 'Tracking links in emails' },
      { key: 'VENDOR_PORTAL_URL', note: 'Vendor notification links' },
    ],
  },
  {
    title: 'Courier (Fez)',
    description: 'Also editable under Settings → Courier APIs.',
    vars: [
      { key: 'FEZ_API_KEY', note: 'Fez API secret', serverOnly: true },
      { key: 'FEZ_USER_ID', note: 'Fez account user id', serverOnly: true },
      { key: 'FEZ_API_BASE_URL', note: 'Default https://api.fezdelivery.co/api/v1', serverOnly: true },
    ],
  },
  {
    title: 'Global sourcing (CJ)',
    description: 'CJ Dropshipping import pipeline.',
    vars: [
      { key: 'CJ_API_KEY', note: 'CJ API key', serverOnly: true },
      { key: 'CJ_API_BASE_URL', note: 'CJ API base URL', serverOnly: true },
      { key: 'EXCHANGERATE_API_KEY', note: 'FX rate provider', serverOnly: true },
    ],
  },
  {
    title: 'App URLs & CORS',
    description: 'Cross-origin and portal links.',
    vars: [
      { key: 'ALLOWED_ORIGINS', note: 'Comma-separated production origins', serverOnly: true },
      { key: 'CUSTOMER_ORDER_PORTAL_URL', note: 'Order tracking page base' },
    ],
  },
];

export const DEVELOPER_RESOURCE_LINKS: DeveloperNavLink[] = [
  {
    label: 'Email settings',
    description: 'SMTP provider, templates & send log',
    href: '/admin/settings/email',
  },
  {
    label: 'Push subscribers',
    description: 'Users with saved FCM tokens (PII-safe)',
    href: '/admin/notifications/tokens',
  },
  {
    label: 'PWA monitoring',
    description: 'Install funnel & notification opt-in',
    href: '/admin/pwa-monitoring',
  },
  {
    label: 'Global sourcing',
    description: 'CJ import, FX & pricing defaults',
    href: '/admin/global-sourcing',
  },
  {
    label: 'Supabase dashboard',
    description: 'Database, backups & webhooks',
    href: 'https://supabase.com/dashboard',
    external: true,
  },
  {
    label: 'Fez API docs',
    description: 'Courier integration reference',
    href: 'https://fezdelivery.co',
    external: true,
  },
];

export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'bg-blue-100 text-blue-800',
  POST: 'bg-green-100 text-green-800',
  PUT: 'bg-amber-100 text-amber-800',
  PATCH: 'bg-yellow-100 text-yellow-800',
  DELETE: 'bg-red-100 text-red-800',
};

export const AUTH_BADGE: Record<NonNullable<ApiEndpoint['auth']>, string> = {
  admin: 'bg-gray-900 text-white',
  staff: 'bg-violet-100 text-violet-800',
  public: 'bg-emerald-100 text-emerald-800',
  webhook: 'bg-amber-100 text-amber-900',
  service: 'bg-sky-100 text-sky-800',
};

export function flattenApiEndpoints(): ApiEndpoint[] {
  return API_ENDPOINT_GROUPS.flatMap((group) => group.items);
}
