# JulineMart Logistics — Custom API Integration Guide

External reference for connecting JulineMart Logistics Orchestrator (JLO) to
an outside platform as a "Custom API" integration (built for **Skola
Workforce**, but the API itself is generic — anything with a bearer token
and an HTTPS listener can use it).

**This API is not designed around fixed agent roles.** It exposes business
capabilities grouped by domain (orders, shipments, riders, vendors,
catalogue). It has no concept of "Operations Manager" or "Sales Rep" — that
grouping happens entirely on your platform, where you assign whichever
capabilities a given agent needs out of what the connected API key allows.
A capability granted to the key is the ceiling; which agents on your side
actually use it is your decision, not something JLO's API needs to know
about.

This document covers authentication, the discovery manifest, every route,
error handling, and outbound webhooks. For how JLO admins mint keys or how
the system is wired internally, see `SKOLA_API_INTERNAL.md`.

## 1. Base URL

```
https://jlo.julinemart.com/api/v1
```

## 2. Authentication

Every request requires a bearer token:

```
Authorization: Bearer jlo_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- No token, or a malformed header → `401`.
- A revoked or unrecognized token → `401`.
- A valid token calling a route it wasn't granted the capability for → `403`.

Tokens are **capability-scoped** — see §4. There is no OAuth flow; a JLO
admin generates your token once and hands it to you out-of-band. If it's
ever compromised, ask them to revoke it — this doesn't affect any other
integration.

## 3. Response format

Every response is JSON, always, including errors.

**Success (list endpoints):** `{ "data": [...], "count": 137 }`
**Success (single-resource endpoints):** `{ "data": {...} }`
**Error (any non-2xx):** `{ "error": "human-readable message" }`

| Status | Meaning |
|---|---|
| `400` | Malformed request |
| `401` | Missing, malformed, invalid, or revoked bearer token |
| `403` | Token is valid but lacks the capability this route requires |
| `404` | Resource not found, or the route itself doesn't exist / isn't enabled yet |
| `500` | Server error — safe to retry with backoff |

No application-level rate limit exists on this API today. Ask your contact
if you need guaranteed throughput.

## 4. Discovering capabilities — `GET /capabilities`

Call this first when connecting the integration. It requires a valid
bearer token (any key), but no specific capability — it's the discovery
mechanism itself, not a business-data route:

```bash
curl -s https://jlo.julinemart.com/api/v1/capabilities \
  -H "Authorization: Bearer $YOUR_TOKEN"
```

```json
{
  "provider": "julinemart",
  "version": "1.0",
  "capabilities": [
    {
      "id": "shipments.delayed.list",
      "domain": "shipments",
      "name": "List Delayed Shipments",
      "description": "Shipments outside the configured non-terminal-status age threshold.",
      "operation_type": "read",
      "side_effect_type": "none",
      "risk_level": "low",
      "http_method": "GET",
      "endpoint": "/shipments/delayed",
      "supports_pagination": true,
      "supports_filtering": true,
      "supports_search": false,
      "idempotency_required": false,
      "approval_recommended": false,
      "enabled": true
    }
    // ... every capability below, plus disabled/roadmap ones (see §4.1)
  ],
  "events": [
    { "id": "order.updated", "domain": "orders", "description": "..." },
    { "id": "shipment.delayed", "domain": "shipments", "description": "..." }
  ]
}
```

Use this to build your tool registry programmatically rather than
hardcoding the table in §5 — the manifest is the source of truth and will
grow over time without a breaking change to existing routes.

### 4.1 `enabled: false` entries

Some capabilities are advertised but not live yet — `orders.cancel`,
`shipments.create`, `riders.location.read`, `customers.read`,
`customers.orders.read`, `operations.exceptions.list`,
`operations.summary.read`. These are real roadmap items (several are
disabled on purpose — location and customer PII need a privacy decision
first; order cancellation and shipment creation are high-risk writes).
Calling their `endpoint` today returns `404`. Don't build against them
until `enabled` flips to `true`.

## 5. Capability reference

Every route below requires the capability listed. A route with two
capabilities listed accepts **either one** (they map to the same route —
e.g. `shipments.read` and `shipments.track` are the same call, offered
under two names for different consumer mental models).

| Capability | Method & path |
|---|---|
| `orders.list` / `orders.search` | `GET /orders` |
| `orders.read` | `GET /orders/:id` |
| `orders.status` | `GET /orders/:id/status` |
| `orders.items.read` | `GET /orders/:id/items` |
| `shipments.list` | `GET /shipments` |
| `shipments.delayed.list` | `GET /shipments/delayed` |
| `shipments.read` / `shipments.track` | `GET /shipments/:id` |
| `shipments.timeline.read` | `GET /shipments/:id/timeline` |
| `shipments.notes.write` | `POST /shipments/:id/notes` |
| `vendors.list` | `GET /vendors` |
| `vendors.read` | `GET /vendors/:id` |
| `vendors.orders.read` | `GET /vendors/:id/orders` |
| `vendors.performance.read` | `GET /vendors/:id/performance` |
| `gift_boxes.list` | `GET /gift-boxes` |
| `gift_boxes.read` | `GET /gift-boxes/:id` |
| `gift_orders.list` | `GET /gift-orders` |
| `gift_orders.read` | `GET /gift-orders/:id` |
| `gift_orders.events.read` | `GET /gift-orders/:id/events` |
| `gift_fulfilment_centres.list` | `GET /gift-fulfilment-centres` |
| `gift_packaging_types.list` | `GET /gift-packaging-types` |
| `riders.list` | `GET /riders` |
| `riders.read` | `GET /riders/:id` |
| `riders.status.read` | `GET /riders/:id/status` |
| `products.list` / `products.search` | `GET /products` |
| `products.read` | `GET /products/:id` |
| `categories.list` | `GET /categories` |
| `returns.list` | `GET /returns` |
| `returns.read` | `GET /returns/:id` |
| `returns.shipments.read` | `GET /returns/:id/shipments` |
| `influencers.list` | `GET /influencers` |
| `influencers.read` | `GET /influencers/:id` |
| `influencers.sales.read` | `GET /influencers/:id/sales` |
| `custom_orders.list` | `GET /custom-orders` |
| `custom_orders.read` | `GET /custom-orders/:id` |
| `campaigns.list` | `GET /campaigns` |
| `campaigns.read` | `GET /campaigns/:id` |
| `notifications.email_templates.list` | `GET /notifications/email-templates` |
| `notifications.email.send` | `POST /notifications/email` |
| `notifications.email.send_bulk` | `POST /notifications/email/bulk` |
| `notifications.push.send` | `POST /notifications/push` (audience: `single` only) |
| `notifications.push.broadcast` | `POST /notifications/push` (any audience) |

`notifications.push.send` and `notifications.push.broadcast` share one
route — which audiences you can pass depends on which capability your key
holds (broadcast implies send).

PII is intentionally minimized for an external/agent audience: **customer
email is never returned**, list endpoints omit street addresses, and rider
GPS location is not exposed by any live capability.

---

### Orders

#### `GET /orders` — `orders.list` or `orders.search`
Query params: `status`, `since` (ISO datetime), `q` (matches customer name
or exact order number — presence of `q` is what makes this a "search" vs.
a plain list), `limit` (default 25, max 100), `offset`.

```json
{
  "data": [
    {
      "id": "b6b6c6b0-...",
      "order_number": 10432,
      "customer_name": "Ada Obi",
      "delivery_city": "Ikeja",
      "delivery_state": "Lagos",
      "overall_status": "processing",
      "payment_status": "paid",
      "total_amount": 28500,
      "created_at": "2026-08-20T09:14:02Z",
      "updated_at": "2026-08-20T09:20:11Z"
    }
  ],
  "count": 1
}
```

#### `GET /orders/:id` — `orders.read`
Adds `customer_phone`, `delivery_address`, `delivery_landmark`, pricing
breakdown, `payment_method`, `paid_at`, `order_notes`, and a `sub_orders`
array (one per vendor/hub leg):
```json
{ "data": { "...": "...", "sub_orders": [
  { "id": "9f2a...", "status": "in_transit", "tracking_number": "FEZ-88213",
    "vendor_name": "Ada's Fabrics", "hub_name": "Lagos Hub" }
] } }
```

#### `GET /orders/:id/status` — `orders.status`
```json
{ "data": { "id": "b6b6c6b0-...", "order_number": 10432, "overall_status": "processing", "payment_status": "paid", "updated_at": "2026-08-20T09:20:11Z" } }
```

#### `GET /orders/:id/items` — `orders.items.read`
```json
{ "data": [
  { "id": "...", "product_id": "PROD-123", "product_name": "Ankara Fabric (6 yards)",
    "product_sku": "ANK-006", "unit_price": 4500, "quantity": 2, "subtotal": 9000, "tax": 0,
    "warranty_type": null, "warranty_months": null }
] }
```

---

### Shipments

#### `GET /shipments` — `shipments.list`
Query params: `status`, `limit`, `offset`.

#### `GET /shipments/delayed` — `shipments.delayed.list`
Non-terminal shipments older than a threshold since creation — an
age-based heuristic, not a promised-delivery-date comparison (JLO doesn't
track one). Query params: `hours` (default 24), `limit`, `offset`.

#### `GET /shipments/:id` — `shipments.read` or `shipments.track`
```json
{
  "id": "9f2a1e40-...", "tracking_number": "FEZ-88213", "status": "in_transit",
  "accepted": true, "fee": 1800, "order_number": 10432, "pod_level": "standard",
  "pickup": { "name": "Ada's Fabrics", "city": "Lagos", "state": "Lagos", "phone": "+2348000000000", "kind": "vendor" },
  "dropoff": { "customer_name": "Ada Obi", "customer_phone": "+2348012345678", "city": "Ikeja", "state": "Lagos", "landmark": "Opposite First Bank" },
  "picked_up_at": "2026-08-19T16:40:00Z", "out_for_delivery_at": null, "delivered_at": null, "failed_at": null
}
```
`order_number` is `null` for shipments from a manual (non-order) shipment.

#### `GET /shipments/:id/timeline` — `shipments.timeline.read`
```json
{ "data": [
  { "id": "...", "status": "picked_up", "event_time": "2026-08-19T16:40:00Z",
    "location_city": "Lagos", "description": "Package picked up from vendor",
    "actor_type": "rider", "actor_name": "Chidi Eze", "source": "app" }
] }
```

#### `POST /shipments/:id/notes` — `shipments.notes.write`
```bash
curl -s -X POST "https://jlo.julinemart.com/api/v1/shipments/9f2a1e40-.../notes" \
  -H "Authorization: Bearer $YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"note": "Recipient requested redelivery after 5pm", "author": "Skola Agent #4"}'
```
`note` required (max 2000 chars), `author` optional (defaults to the key's name).

---

### Vendors

#### `GET /vendors` — `vendors.list`
Query params: `active` (`true`/`false`), `limit`, `offset`.
```json
{ "data": [{ "id": "3a1f...", "store_name": "Ada's Fabrics", "store_slug": "adas-fabrics",
  "email": "ada@example.com", "phone": "+2348000000000", "city": "Lagos", "state": "Lagos",
  "is_active": true, "total_orders": 214, "fulfilled_orders": 201, "created_at": "2025-11-02T08:00:00Z" }], "count": 1 }
```

#### `GET /vendors/:id` — `vendors.read`
Adds `address`, `description`, `logo_url`. Never exposes bank details, tax
ID, or commission rate.

#### `GET /vendors/:id/orders` — `vendors.orders.read`
```json
{ "data": [{ "id": "9f2a...", "status": "in_transit", "subtotal": 9000,
  "created_at": "2026-08-19T14:02:00Z", "order_number": 10432, "order_status": "processing" }], "count": 1 }
```

#### `GET /vendors/:id/performance` — `vendors.performance.read`
```json
{ "data": { "id": "3a1f...", "store_name": "Ada's Fabrics", "total_orders": 214,
  "fulfilled_orders": 201, "average_processing_time_hours": 6.4, "seller_quality_score": 4.7 } }
```

---

### Gift

JulineMart's curated gift-box program. A gift order is a side-record keyed
to a regular order, carrying its own pipeline:
`new → paid → packing → packed → dispatch → delivered`.

#### `GET /gift-boxes` — `gift_boxes.list`
Query params: `active` (`true`/`false`), `limit`, `offset`.
```json
{ "data": [{ "id": "...", "slug": "sweet-surprise", "name": "Sweet Surprise Box",
  "list_price": 15000, "active": true, "recipient_types": ["mother", "partner"],
  "occasion_types": ["birthday", "anniversary"], "average_rating": 4.8, "rating_count": 22 }], "count": 1 }
```

#### `GET /gift-boxes/:id` — `gift_boxes.read`
Adds `description`, `gallery_urls`, and `items` (component products —
`product_id`, `variation_id`, `quantity`). Excludes internal component
cost.

#### `GET /gift-orders` — `gift_orders.list`
Query params: `status` (matches `gift_status`), `limit`, `offset`. Omits
recipient contact details — see the detail endpoint for those.
```json
{ "data": [{ "id": "...", "order_id": "b6b6c6b0-...", "gift_box_id": "...",
  "gift_status": "packing", "recipient_city": "Lagos", "recipient_state": "Lagos",
  "occasion": "birthday", "requested_delivery_date": "2026-08-28", "created_at": "2026-08-24T10:00:00Z" }], "count": 1 }
```

#### `GET /gift-orders/:id` — `gift_orders.read`
Adds `recipient_name`, `recipient_phone`, `recipient_address`,
`gift_message`, `sender_visible`, `customer_subtotal`, `pack_photo_url`,
`qc_notes`, `packed_at`, `dispatched_at`, `completed_at`. Excludes
recipient email and internal cost/vendor-settlement breakdown.

#### `GET /gift-orders/:id/events` — `gift_orders.events.read`
```json
{ "data": [{ "id": "...", "status": "packed", "note": "QC passed, ready to dispatch",
  "actor_email": "ops@julinemart.com", "created_at": "2026-08-24T11:30:00Z" }] }
```

#### `GET /gift-fulfilment-centres` — `gift_fulfilment_centres.list`
```json
{ "data": [{ "id": "...", "name": "Lagos Gift Hub", "code": "LG1", "city": "Lagos",
  "state": "Lagos", "active": true, "is_default": true, "same_day_supported": true,
  "next_day_supported": true, "supported_delivery_zones": ["South West"] }], "count": 1 }
```

#### `GET /gift-packaging-types` — `gift_packaging_types.list`
```json
{ "data": [{ "id": "...", "code": "premium", "name": "Premium Box", "price": 2500,
  "max_items": 6, "active": true }], "count": 1 }
```

Advancing a gift order's status (packing → packed → dispatch → delivered)
is not yet exposed for external write access — `gift_orders.status.write`
is advertised in the manifest as `enabled: false`. Ask your JulineMart
contact if your use case needs it.

---

### Riders

#### `GET /riders` — `riders.list`
Query params: `status`, `online` (`true`), `limit`, `offset`.

#### `GET /riders/:id` — `riders.read`
```json
{ "data": { "id": "77aa...", "full_name": "Chidi Eze", "email": "chidi@example.com",
  "phone": "+2348011112222", "status": "approved", "vehicle_type": "motorcycle",
  "vehicle_plate": "LAG-123-XY", "is_online": true, "last_online_at": "2026-08-24T09:58:00Z" } }
```
Excludes NIN, bank details, and any document/selfie URLs.

#### `GET /riders/:id/status` — `riders.status.read`
```json
{ "data": { "id": "77aa...", "full_name": "Chidi Eze", "phone": "+2348011112222",
  "status": "approved", "is_online": true, "last_online_at": "2026-08-24T09:58:00Z" } }
```
`status` is onboarding/verification status, not a delivery status.

---

### Catalogue

#### `GET /products` — `products.list` or `products.search`
Query params: `status`, `vendor_id`, `stock_status`, `q` (matches name or
SKU), `limit`, `offset`.
```json
{ "data": [{ "id": "...", "name": "Ankara Fabric (6 yards)", "slug": "ankara-fabric-6-yards",
  "sku": "ANK-006", "status": "publish", "regular_price": 4500, "sale_price": null,
  "stock_status": "instock", "stock_quantity": 40, "vendor_id": "3a1f...",
  "average_rating": 4.5, "rating_count": 12 }], "count": 1 }
```

#### `GET /products/:id` — `products.read`
Adds `description`, `short_description`, dimensions, `is_virtual`,
warranty fields. Never returns internal cost price or supplier-sourcing
metadata.

#### `GET /categories` — `categories.list`
```json
{ "data": [{ "id": "...", "name": "Fabrics", "slug": "fabrics", "parent_id": null, "display_order": 3 }], "count": 1 }
```

---

### Returns

#### `GET /returns` — `returns.list`
Query params: `status`, `limit`, `offset`. Omits customer contact details.
```json
{ "data": [{ "id": "...", "order_number": "10432", "status": "inspecting",
  "reason": "Wrong size", "reason_code": "size_mismatch", "refund_amount": 4500,
  "refund_status": "pending", "created_at": "2026-08-20T09:00:00Z" }], "count": 1 }
```

#### `GET /returns/:id` — `returns.read`
Adds `customer_name`, `reason_note`, `images`, `evidence_urls`, inspection
result/notes, refund method/currency/dates, seller response. Excludes
customer email and the raw payment-provider refund payload.

#### `GET /returns/:id/shipments` — `returns.shipments.read`
Reverse-logistics shipment(s) created for this return — tracking,
destination, status. Same shape family as `shipments.read`.

---

### Influencers

#### `GET /influencers` — `influencers.list`
Query params: `status`, `tier`, `limit`, `offset`. Omits contact details
and bank info.
```json
{ "data": [{ "id": "...", "name": "Amaka Style", "handle": "@amakastyle",
  "platform": "instagram", "coupon_code": "AMAKA10", "tier": "gold", "status": "active",
  "total_orders": 58, "total_sales": 812000, "commission_rate": 8,
  "total_commission_earned": 64960 }], "count": 1 }
```

#### `GET /influencers/:id` — `influencers.read`
Adds `email`, `phone`, discount terms (`shipping_discount_type/value`,
`minimum_order_value`, `maximum_uses`). Never returns bank details.

#### `GET /influencers/:id/sales` — `influencers.sales.read`
```json
{ "data": [{ "id": "...", "order_number": "10432", "product_total": 28500,
  "influencer_commission_rate": 8, "influencer_commission_amount": 2280,
  "commission_status": "pending", "sale_date": "2026-08-20T09:14:00Z" }], "count": 1 }
```
Excludes JulineMart's internal margin split (admin commission, vendor
payout amount) and the customer's email.

---

### Custom Orders

Personalised / made-to-order line items and their production timeline.

#### `GET /custom-orders` — `custom_orders.list`
Query params: `status`, `order_id`, `limit`, `offset`.
```json
{ "data": [{ "id": "...", "order_id": "b6b6c6b0-...", "order_item_id": "...",
  "status": "awaiting_proof", "price_adjustment": 1500, "created_at": "2026-08-22T10:00:00Z" }], "count": 1 }
```

#### `GET /custom-orders/:id` — `custom_orders.read`
Adds `field_values` (the customer's submitted customisation answers),
`approved_proof_url`, `schema_id`.

---

### Campaigns

#### `GET /campaigns` — `campaigns.list`
Query params: `status`, `approval_status`, `limit`, `offset`.
```json
{ "data": [{ "id": "...", "slug": "back-to-school-2026", "internal_name": "Back to School 2026",
  "public_title": "Back to School Deals", "status": "live", "approval_status": "approved",
  "start_date": "2026-08-15T00:00:00Z", "end_date": "2026-09-05T00:00:00Z",
  "target_type": "storewide" }], "count": 1 }
```

#### `GET /campaigns/:id` — `campaigns.read`
Adds `target_id`, `template_id`, `section_layout`, `hero_config`,
`product_selection_rules`, `offer_config`, `meta_seo`, `vendor_id`.
Excludes internal review notes and the reviewer's identity.

---

### Notifications

**Different from everything else in this API** — these two `POST`
endpoints trigger real outbound email/push to real people. Treat them as
high-trust operations regardless of what your platform's own policy
engine decides:

#### `GET /notifications/email-templates` — `notifications.email_templates.list`
```json
{ "data": [{ "id": "...", "name": "Order Shipped", "type": "order_update",
  "subject": "Your order #{{orderNumber}} has shipped!",
  "variables": ["orderNumber", "customerName", "trackingUrl"], "is_active": true }], "count": 1 }
```

#### `POST /notifications/email` — `notifications.email.send`
Sends an **existing, admin-approved template only** — you cannot submit
arbitrary HTML/content, only pick a template by name and supply its
`{{variable}}` values. This is a deliberate constraint, not a limitation
to work around.
```bash
curl -s -X POST "https://jlo.julinemart.com/api/v1/notifications/email" \
  -H "Authorization: Bearer $YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"template_name": "Order Shipped", "to": "customer@example.com",
       "data": {"orderNumber": "10432", "customerName": "Ada", "trackingUrl": "https://..."}}'
```
| Field | Required | Notes |
|---|---|---|
| `template_name` | yes | Must match an active `email_templates.name` exactly |
| `to` | yes | Recipient address |
| `data` | no | `{{variable}}` substitution values |
| `order_id` | no | Enables dedup (won't resend the same template for the same order within 10 minutes) and shows up in the audit log |

```json
{ "data": { "sent": true } }
```
A `{ "data": { "sent": false, "reason": "duplicate" } }` response means
the dedup window caught a repeat send — not an error.

#### `POST /notifications/email/bulk` — `notifications.email.send_bulk`
Same templates as `notifications.email.send`, one call for many recipients
(max 100). When a Resend API key is saved, this uses Resend's batch API.
Otherwise it sends sequentially via the SMTP fallback. Auth mail is unchanged.

```bash
curl -s -X POST "https://jlo.julinemart.com/api/v1/notifications/email/bulk" \
  -H "Authorization: Bearer $YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"template_name": "Vendor Activation Reminder",
       "data": {"portal_products_url": "https://vendors.julinemart.com/products", "support_email": "support@julinemart.com"},
       "recipients": [
         {"to": "ada@example.com", "data": {"vendor_name": "Ada", "store_name": "Adafe"}},
         {"to": "chidi@example.com", "data": {"vendor_name": "Chidi", "store_name": "Chidi Mart"}}
       ]}'
```

```json
{ "data": { "sent": 2, "failed": 0, "skipped": 0, "results": [
  { "to": "ada@example.com", "sent": true },
  { "to": "chidi@example.com", "sent": true }
] } }
```

#### `POST /notifications/push` — `notifications.push.send` or `notifications.push.broadcast`
```bash
curl -s -X POST "https://jlo.julinemart.com/api/v1/notifications/push" \
  -H "Authorization: Bearer $YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"audience": "single", "customer_id": "77aa...", "title": "Your gift is on its way!",
       "message": "Track it here.", "type": "order_update"}'
```
| Field | Required | Notes |
|---|---|---|
| `audience` | yes | `single` (needs `notifications.push.send` or `.broadcast`) or `all_customers`/`all_vendors`/`all_staff`/`segment` (needs `.broadcast`) |
| `customer_id` | if `audience=single` | |
| `segment` | if `audience=segment` | `{ "platform": "android" \| "web" }` |
| `title`, `message` | yes | |
| `type` | yes | `order_update` \| `product` \| `promotion` \| `general` |
| `data` | no | Arbitrary JSON delivered with the push |
| `schedule_at` | no | ISO datetime (include a timezone, prefer `Z`). When set, the push is **always queued** and never sent in this request — even if the time is soon or already past (the processor sends it on the next minute tick). Omit the field entirely to send immediately. |

Immediate send response:
```json
{ "success": true, "data": { /* upstream push-service response */ }, "meta": { "audience": "single", "sent": 1, "failed": 0 } }
```
Scheduled response:
```json
{ "data": { "scheduled": true, "id": "...", "schedule_at": "2026-09-01T09:00:00Z" } }
```

## 6. Outbound webhooks

If you gave JLO a webhook URL and signing secret, JLO pushes events to you
as they happen:

| Event type | Fires when |
|---|---|
| `order.updated` | An order's overall status changes |
| `shipment.delayed` | A shipment exceeds the delay threshold — fired once per shipment |

### Request shape
```
POST <your webhook URL>
Content-Type: application/json
X-Skola-Event-Id: 3f9c2b10-2e41-4a2b-9c1a-1a2b3c4d5e6f
X-Skola-Signature: <hex HMAC-SHA256 of the raw JSON body, keyed by your secret>

{"event_type": "shipment.delayed", "data": { ... }}
```

`shipment.delayed` data:
```json
{ "shipment_id": "9f2a1e40-...", "tracking_number": "FEZ-88213", "status": "in_transit",
  "order_number": 10432, "age_hours": 31, "threshold_hours": 24,
  "dropoff_city": "Ikeja", "dropoff_state": "Lagos", "created_at": "2026-08-19T14:02:00Z" }
```

`order.updated` data:
```json
{ "order_id": "b6b6c6b0-...", "order_number": 10432, "previous_status": "processing", "status": "shipped" }
```

### Verifying the signature
```js
import crypto from 'crypto';
function isValidSignature(rawBody, signatureHeader, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signatureHeader, 'hex'));
}
// rawBody must be the exact, unparsed request body bytes.
```

### Retry & idempotency
Non-2xx responses are retried with backoff: 1m, 5m, 15m, 60m, 3h, 6h (6
attempts, then gives up). **Every retry reuses the same
`X-Skola-Event-Id`** — dedupe on it. Respond `2xx` as soon as you've
durably queued the event.

## 7. Support

Contact your JulineMart integration point of contact for a token, to
request additional capabilities, or to report an issue.
