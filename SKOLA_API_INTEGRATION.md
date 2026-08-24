# JulineMart Logistics — Custom API Integration Guide

External reference for connecting JulineMart Logistics Orchestrator (JLO) to
an outside system as a "Custom API" integration (built for **Skola
Workforce**, but the API itself is generic — anything with a bearer token
and an HTTPS listener can use it).

This document covers everything an integrator needs: authentication,
endpoints, error handling, and outbound webhooks. It does not cover how
admins mint keys or how the system is wired internally — see
`SKOLA_API_INTERNAL.md` for that.

## 1. Base URL

```
https://jlo.julinemart.com/api/v1
```

All endpoints below are relative to this base. (Non-production deploys use
their own Netlify origin instead of `jlo.julinemart.com` — ask your contact
for the URL of the environment you've been given access to.)

## 2. Authentication

Every request requires a bearer token:

```
Authorization: Bearer jlo_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- No token, or a malformed header → `401`.
- A revoked or unrecognized token → `401`.
- A valid token calling an endpoint it wasn't granted → `403`.

Tokens are **capability-scoped**. A token only works against the endpoints
whose capability it was granted at creation time — see §4. There is no
OAuth flow; a JLO admin generates your token once and hands it to you
out-of-band. If it's ever compromised, ask them to revoke it — this doesn't
affect any other integration.

## 3. Response format

Every response is JSON, always, including errors — never an empty body or
an HTML error page.

**Success (list endpoints):**
```json
{ "data": [ /* ... */ ], "count": 137 }
```

**Success (single-resource endpoints):**
```json
{ "data": { /* ... */ } }
```

**Error (any non-2xx):**
```json
{ "error": "human-readable message" }
```

| Status | Meaning |
|---|---|
| `400` | Malformed request (bad JSON body, invalid/missing required field) |
| `401` | Missing, malformed, invalid, or revoked bearer token |
| `403` | Token is valid but lacks the capability this route requires |
| `404` | Resource not found, or the route itself doesn't exist |
| `500` | Server error — safe to retry with backoff |

Note: there is currently no application-level rate limit on this API. Be a
good citizen with polling frequency; ask your contact if you need guaranteed
throughput and one can be added.

## 4. Capabilities & endpoints

| Capability | Grants |
|---|---|
| `orders:read` | `GET /orders`, `GET /orders/:id` |
| `shipments:read` | `GET /shipments`, `GET /shipments/delayed`, `GET /shipments/:id` |
| `vendors:read` | `GET /vendors`, `GET /vendors/:id` |
| `riders:read` | `GET /riders/:id/status` |
| `shipment_notes:write` | `POST /shipments/:id/notes` |

`:read` capabilities are non-destructive and safe to call freely.
`:write` capabilities change state in JLO — the one write capability
today (`shipment_notes:write`) only *appends* a note and can't corrupt or
delete anything, but treat it as the higher-risk half of the API when
deciding what to gate behind human approval on your side.

Personally identifying information is intentionally minimized: **customer
email is never returned** by this API. List endpoints omit street
addresses; the `:id` detail endpoints include them where the field exists
(delivery address, customer phone) because logistics coordination
legitimately needs it.

---

### Orders

#### `GET /orders`
Capability: `orders:read`

Query params:
| Param | Type | Notes |
|---|---|---|
| `status` | string | Filter by `overall_status` (`pending`, `processing`, `partially_shipped`, `shipped`, `delivered`, `cancelled`, `refunded`) |
| `since` | ISO 8601 datetime | Only orders created at/after this time |
| `limit` | integer | Default 25, max 100 |
| `offset` | integer | Default 0 |

```bash
curl -s "https://jlo.julinemart.com/api/v1/orders?status=processing&limit=10" \
  -H "Authorization: Bearer $SKOLA_TOKEN"
```

```json
{
  "data": [
    {
      "id": "b6b6c6b0-...",
      "order_number": 10432,
      "woocommerce_order_id": "10432",
      "customer_name": "Ada Obi",
      "delivery_city": "Ikeja",
      "delivery_state": "Lagos",
      "delivery_zone": "South West",
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

#### `GET /orders/:id`
Capability: `orders:read`

Same fields as the list, plus `customer_phone`, `delivery_address`,
`delivery_lga`, `delivery_landmark`, `subtotal`, `shipping_fee_paid`,
`tax_amount`, `discount_amount`, `payment_method`, `paid_at`, `order_notes`,
`special_instructions`, and a `sub_orders` array — one entry per
vendor/hub leg of the order:

```json
{
  "data": {
    "id": "b6b6c6b0-...",
    "order_number": 10432,
    "customer_name": "Ada Obi",
    "customer_phone": "+2348012345678",
    "delivery_address": "12 Allen Avenue",
    "delivery_landmark": "Opposite First Bank",
    "overall_status": "processing",
    "sub_orders": [
      {
        "id": "9f2a...",
        "status": "in_transit",
        "tracking_number": "FEZ-88213",
        "courier_waybill": "WB-4471",
        "vendor_name": "Ada's Fabrics",
        "hub_name": "Lagos Hub"
      }
    ]
  }
}
```

---

### Shipments

#### `GET /shipments`
Capability: `shipments:read`

Query params: `status`, `limit` (default 25, max 100), `offset`.

#### `GET /shipments/delayed`
Capability: `shipments:read`

Shipments that have been in a **non-terminal status** (i.e. not
`delivered`/`failed`/`cancelled`/`returned`) for longer than a threshold
since creation. This is an age-based heuristic, not a promised-delivery-date
comparison — JLO doesn't currently track promised delivery dates.

Query params: `hours` (default 24 — minimum age to count as delayed),
`limit`, `offset`.

```bash
curl -s "https://jlo.julinemart.com/api/v1/shipments/delayed?hours=48" \
  -H "Authorization: Bearer $SKOLA_TOKEN"
```

#### `GET /shipments/:id`
Capability: `shipments:read`

All three shipment endpoints return the same shape per shipment:

```json
{
  "id": "9f2a1e40-...",
  "tracking_number": "FEZ-88213",
  "status": "in_transit",
  "accepted": true,
  "delivery_proof_url": null,
  "signature_url": null,
  "fee_breakdown": null,
  "assigned_at": "2026-08-19T14:02:00Z",
  "picked_up_at": "2026-08-19T16:40:00Z",
  "out_for_delivery_at": null,
  "delivered_at": null,
  "failed_at": null,
  "fee": 1800,
  "order_number": 10432,
  "pod_level": "standard",
  "pickup": {
    "name": "Ada's Fabrics",
    "address": "5 Balogun St",
    "city": "Lagos",
    "state": "Lagos",
    "phone": "+2348000000000",
    "kind": "vendor"
  },
  "dropoff": {
    "customer_name": "Ada Obi",
    "customer_phone": "+2348012345678",
    "address": "12 Allen Avenue",
    "city": "Ikeja",
    "state": "Lagos",
    "landmark": "Opposite First Bank"
  }
}
```

`order_number` is `null` for shipments that originate from a manual
(non-order) shipment rather than a marketplace order.

#### `POST /shipments/:id/notes`
Capability: `shipment_notes:write`

Appends an audit-logged note to a shipment. Does not change shipment status.

```bash
curl -s -X POST "https://jlo.julinemart.com/api/v1/shipments/9f2a1e40-.../notes" \
  -H "Authorization: Bearer $SKOLA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"note": "Recipient requested redelivery after 5pm", "author": "Skola Agent #4"}'
```

| Field | Required | Notes |
|---|---|---|
| `note` | yes | Max 2000 characters |
| `author` | no | Freeform label; defaults to your API key's name |

```json
{
  "data": {
    "id": "c1d2...",
    "shipment_id": "9f2a1e40-...",
    "source": "api",
    "author": "Skola Agent #4",
    "note": "Recipient requested redelivery after 5pm",
    "created_at": "2026-08-24T10:02:00Z"
  }
}
```

---

### Vendors

#### `GET /vendors`
Capability: `vendors:read`

Query params: `active` (`true`/`false`), `limit`, `offset`.

```json
{
  "data": [
    {
      "id": "3a1f...",
      "store_name": "Ada's Fabrics",
      "store_slug": "adas-fabrics",
      "email": "ada@example.com",
      "phone": "+2348000000000",
      "city": "Lagos",
      "state": "Lagos",
      "is_active": true,
      "total_orders": 214,
      "fulfilled_orders": 201,
      "created_at": "2025-11-02T08:00:00Z"
    }
  ],
  "count": 1
}
```

#### `GET /vendors/:id`
Capability: `vendors:read`

Same fields, plus `address`, `description`, `logo_url`. Financial fields
(bank details, commission rate, tax ID) are never exposed by this API.

---

### Riders

#### `GET /riders/:id/status`
Capability: `riders:read`

```json
{
  "data": {
    "id": "77aa...",
    "full_name": "Chidi Eze",
    "phone": "+2348011112222",
    "status": "approved",
    "is_online": true,
    "last_online_at": "2026-08-24T09:58:00Z",
    "updated_at": "2026-08-24T09:58:00Z"
  }
}
```

`status` is the rider's onboarding/verification status
(`pending`/`approved`/`rejected`, etc), not a delivery status. Live
location (lat/lng) is deliberately not exposed by this endpoint.

## 5. Outbound webhooks

If you gave JLO a webhook URL and signing secret, JLO pushes events to you
as they happen — you don't need to poll for these two:

| Event type | Fires when |
|---|---|
| `order.updated` | An order's overall status changes (progresses through the fulfillment pipeline) |
| `shipment.delayed` | A shipment has been non-terminal for longer than the delay threshold (default 24h) — fired once per shipment |

### Request shape

```
POST <your webhook URL>
Content-Type: application/json
X-Skola-Event-Id: 3f9c2b10-2e41-4a2b-9c1a-1a2b3c4d5e6f
X-Skola-Signature: <hex HMAC-SHA256 of the raw JSON body, keyed by your secret>

{"event_type": "shipment.delayed", "data": { ... }}
```

`data` for `shipment.delayed`:
```json
{
  "shipment_id": "9f2a1e40-...",
  "tracking_number": "FEZ-88213",
  "status": "in_transit",
  "order_number": 10432,
  "age_hours": 31,
  "threshold_hours": 24,
  "dropoff_city": "Ikeja",
  "dropoff_state": "Lagos",
  "created_at": "2026-08-19T14:02:00Z"
}
```

`data` for `order.updated`:
```json
{
  "order_id": "b6b6c6b0-...",
  "order_number": 10432,
  "previous_status": "processing",
  "status": "shipped"
}
```

### Verifying the signature

Reject any request whose signature doesn't match — this is what proves the
request came from JLO and not an impersonator hitting your endpoint
directly.

```js
// Node.js
import crypto from 'crypto';

function isValidSkolaSignature(rawBody, signatureHeader, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signatureHeader, 'hex'));
}

// rawBody must be the exact, unparsed request body bytes — signing is
// done over the raw JSON string, not a re-serialized object.
```

### Retry & idempotency

If your endpoint doesn't respond `2xx`, JLO retries with backoff: 1m, 5m,
15m, 60m, 3h, 6h (6 attempts total, then gives up). **Every retry reuses the
same `X-Skola-Event-Id`.** Your endpoint should treat a repeated event ID as
a no-op — dedupe on it, don't process it twice. Respond `2xx` as soon as
you've durably queued the event; don't make JLO wait on your downstream
processing.

## 6. Support

Contact your JulineMart integration point of contact for a token, to report
an issue, or to request additional capabilities/endpoints.
