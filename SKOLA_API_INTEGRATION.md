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
| `riders.list` | `GET /riders` |
| `riders.read` | `GET /riders/:id` |
| `riders.status.read` | `GET /riders/:id/status` |
| `products.list` / `products.search` | `GET /products` |
| `products.read` | `GET /products/:id` |
| `categories.list` | `GET /categories` |

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
