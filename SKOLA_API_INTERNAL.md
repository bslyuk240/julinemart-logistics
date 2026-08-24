# Skola / Custom API Integration — Internal Engineering Reference

Internal documentation for the external service-API integration layer
(built for Skola Workforce; generic enough for any "Custom API" partner).
For the partner-facing reference, see `SKOLA_API_INTEGRATION.md` — hand
that one out, not this one.

## 1. What this is

Two independent capabilities, sharing one auth/crypto foundation:

1. **Outbound-call API** (`/api/v1/*`) — external systems call *us*,
   authenticated with a long-lived bearer token scoped to specific
   capabilities.
2. **Outbound webhook delivery** — *we* push events to an external URl,
   HMAC-signed, with retry.

Both are additive: nothing existing was rewired to depend on them, except
the one hook into `orderStatusHelper.js` described in §5.

## 2. Files

```
netlify/functions/
  public-api.js                        # /api/v1/* router — orders/shipments/vendors/riders/notes
  admin-service-api-keys.js            # admin: mint/list/revoke service API keys
  admin-webhook-endpoints.js           # admin: configure outbound webhook URL + secret
  process-webhook-retries-scheduled.js # cron */5 * * * * — retries pending/failed deliveries
  detect-delayed-shipments-scheduled.js# cron */30 * * * * — fires shipment.delayed once per shipment
  helpers/orderStatusHelper.js         # existing file — now also fires order.updated on status change
  cancel-order.js                      # existing file — fires order.updated on cancellation
  verify-payment.js                    # existing file — fires order.updated on payment confirmation
  paystack-webhook.js                  # existing file — fires order.updated on charge.success / refund.processed
  fez-create-shipment.js               # existing file — fires order.updated promoting pending -> processing
  fez-create-shipment-batch.js         # existing file — fires order.updated promoting pending -> processing
  admin-gift-ops.js                    # existing file — fires order.updated on gift order 'complete' -> delivered
  services/
    secretsCrypto.js                   # AES-256-GCM encrypt/decrypt (webhook secrets at rest)
    serviceApiKeyAuth.js               # bearer-token auth + capability check for public-api.js
    webhookDelivery.js                 # sendWebhookEvent() — sign + POST + log, called synchronously from producers
    shipmentSummary.js                 # pre-existing — reused for GET /shipments* response shaping

src/dashboard/
  components/settings-developer/IntegrationsPanel.tsx  # admin UI: Settings → Integrations tab
  pages/Settings.tsx                                    # wires the new tab in
  lib/settingsDeveloperContent.ts                        # API_ENDPOINT_GROUPS entries for the in-app API reference

supabase/migrations/20260824120000_skola_service_api_integration.sql
```

## 3. Database schema

| Table | Purpose |
|---|---|
| `service_api_keys` | `id, name, key_prefix, key_hash, scopes text[], is_active, created_by, created_at, revoked_at, last_used_at` |
| `webhook_endpoints` | `id, name, url, secret_encrypted, event_types text[], is_active, created_by, created_at, updated_at` |
| `webhook_deliveries` | `id, webhook_endpoint_id, event_id, event_type, payload jsonb, status, attempts, last_attempt_at, next_attempt_at, last_error, created_at` |
| `shipment_notes` | `id, shipment_id, source, author, note, created_at` |

All four have RLS **enabled with no policies** — the established convention
in this project for tables that are only ever touched by service-role
Netlify functions (see `couriers`, `email_config`, etc). This means
anon/authenticated get zero rows; only the service-role key (used
exclusively server-side) bypasses RLS. Supabase's advisor flags this as
`rls_enabled_no_policy` at **INFO** level, not a warning — that's expected
and correct here, don't "fix" it by adding open policies.

`key_hash` and `secret_encrypted` are the only place a credential value
ever touches disk:
- **API keys are hashed, not encrypted** (`serviceApiKeyAuth.js:hashApiKey`,
  plain SHA-256). We only ever need to check equality, never recover the
  original token, so there's no decrypt path and no key to leak. The
  plaintext token is generated in `admin-service-api-keys.js`, returned once
  in the create response, and never persisted.
- **Webhook secrets are encrypted, not hashed** (`secretsCrypto.js`) — we
  *do* need to recover them at delivery time to compute the HMAC. Same
  AES-256-GCM scheme as `save-courier-credentials.js`/`fezAuth.js`
  (`gcm:<iv>:<tag>:<ciphertext>`, keyed by `ENCRYPTION_KEY`), reused
  deliberately rather than reinvented — that env var is already set in
  Netlify production (see the 2026-08 security hardening pass memory) and
  in `.env.local` for local dev. No new secret to provision.

## 4. Request flow — `/api/v1/*`

`netlify.toml` rewrites `/api/v1/*` to `/.netlify/functions/public-api`
with **no `:splat`** — same pattern as `meta-ads.js` and
`save-courier-credentials.js`. `event.path` retains the real incoming path
(`/api/v1/shipments/9f2a.../notes`), and `public-api.js` parses it itself:

```js
const path = event.path.replace(/^\/api\/v1\/?/, '').replace(/\/+$/, '');
const segments = path.split('/').filter(Boolean);
```

Every route handler calls `authenticateServiceApiRequest(event,
requiredCapability)` first — it hashes the bearer token, looks up
`service_api_keys` by `key_hash`, checks `is_active` and that
`scopes` includes the required capability, and fire-and-forgets a
`last_used_at` touch. Returns `{ errorResponse }` (401/403/500, already
JSON-shaped) or `{ apiKey, adminClient }`.

`GET /shipments*` reuses `shipmentSummary.js` (`fetchSourceDetails` +
`summarizeShipment`) rather than re-deriving the sub_order/manual_shipment
join logic — that module already resolves pickup/dropoff for both shipment
sources correctly (it's shared with the rider app), so this endpoint's
shape is proven, not new code.

## 5. Outbound webhook wiring

`sendWebhookEvent(eventType, data)` (`webhookDelivery.js`) is the only entry
point producers should call. It:
1. Loads active `webhook_endpoints` rows subscribed to `eventType` (empty
   `event_types` = subscribed to everything).
2. Signs the raw JSON body with each endpoint's decrypted secret.
3. POSTs immediately; logs the outcome to `webhook_deliveries`
   (`status: 'success'` or `'pending'` with `next_attempt_at` set).

It is always called fire-and-forget (`.catch(...)`) from producers — a
webhook hiccup must never fail or delay the underlying state change.

**Current producers:**
- `order.updated` fires from every current call site that writes
  `orders.overall_status`, each firing directly after its own update
  succeeds (fetching the pre-update value first purely to report an
  accurate `previous_status`):
  - `helpers/orderStatusHelper.js`, inside `refreshOverallOrderStatus()` —
    the central chokepoint for the sub-order-driven status pipeline. Called
    from `rider-jobs.js`, `fez-webhook.js`, `fez-fetch-tracking.js`,
    `global-sourcing-inbound-shipments.js`, and `local-status.js` (rider
    status advances and courier tracking sync).
  - `cancel-order.js` — writes `overall_status: 'cancelled'` directly
    (it has its own eligibility checks that don't map onto
    `refreshOverallOrderStatus`'s sub-order-priority logic, so it can't
    reuse that helper).
  - `verify-payment.js` (customer-facing inline verification) and
    `paystack-webhook.js`'s `charge.success` handler — both write
    `overall_status: 'processing'` guarded by
    `.eq('payment_status', 'pending')`, so exactly one of the two actually
    performs the transition for a given payment (the other's `UPDATE`
    matches zero rows and is a no-op) — no duplicate `order.updated` for
    the same payment.
  - `paystack-webhook.js`'s `refund.processed` handler — writes
    `overall_status: 'refunded'`.
  - `fez-create-shipment.js` and `fez-create-shipment-batch.js` — both
    promote `pending` → `processing` when the first courier shipment is
    created for an order still sitting at `pending`.
  - `admin-gift-ops.js` — the `complete` action promotes a gift order (and
    its linked `orders` row) to `delivered`.

  This was verified exhaustively by grepping every `overall_status:`
  literal write in `netlify/functions/` (8 files) and every call into
  `orderStatusHelper.js`'s dynamic write — all are now covered except
  order **creation** (`create-order.js`, `services/gift-order-insert.js`),
  which doesn't fire `order.updated` on purpose: it's a create, not a
  transition, so `previous_status` wouldn't mean anything. Same reasoning
  for `paystack-webhook.js`'s `charge.failed` handler, which only touches
  `payment_status`, never `overall_status`. If a new call site starts
  writing `orders.overall_status` in the future, it needs its own
  `sendWebhookEvent('order.updated', ...)` call — nothing enforces this
  automatically.
- `shipment.delayed` — `detect-delayed-shipments-scheduled.js`, cron
  `*/30 * * * *`. Threshold is `SKOLA_DELAYED_THRESHOLD_HOURS` (env var,
  default 24). Fires **once** per shipment: after sending, it stamps
  `shipments.metadata.skola_delayed_notified_at` so the next run's
  `.is("metadata->>'skola_delayed_notified_at'", null)` filter excludes it.
  If you ever need to re-notify (e.g. threshold changed), clear that
  metadata key manually.

**Retry:** `process-webhook-retries-scheduled.js`, cron `*/5 * * * *`.
Backoff schedule in `BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360]`; after 6
attempts a delivery is marked `dead` and stops retrying (still queryable —
see §7). Every retry reuses the original `event_id`, by design — the
partner side is expected to dedupe.

### Adding a new event type

1. Call `sendWebhookEvent('your.event_type', { ...relevant fields })` from
   wherever the triggering state change happens (fire-and-forget, wrapped
   in `.catch()`).
2. Add it to `EVENT_TYPES` in `IntegrationsPanel.tsx` so admins can scope a
   webhook to it.
3. Document the payload shape in `SKOLA_API_INTEGRATION.md` §5.

### Adding a new capability / endpoint

1. Add the capability string to `CAPABILITIES` in
   `admin-service-api-keys.js` (this is the allowlist admins can grant).
2. Add the route + handler in `public-api.js`, gated by
   `authenticateServiceApiRequest(event, 'your:capability')`.
3. Update the module-level capability table comment in `public-api.js`.
4. Add it to `CAPABILITIES` in `IntegrationsPanel.tsx` (so it's checkbox-able
   in the admin UI) and to `API_ENDPOINT_GROUPS` in
   `settingsDeveloperContent.ts` (so it shows in Settings → API Reference).
5. Document it in `SKOLA_API_INTEGRATION.md` §4.

## 6. Admin UI

**Settings → Integrations** (`src/dashboard/pages/Settings.tsx`, new
`integrations` tab → `IntegrationsPanel.tsx`), admin-only (same
`requireAdmin(['admin'])` gate as the rest of `/api/admin/*`):

- **Service API keys** — create (name + capability checkboxes), list
  (name, prefix, scopes, active/revoked, last used), revoke. The plaintext
  token is shown exactly once in the create response and never again —
  there is no "reveal" affordance anywhere because the value doesn't exist
  server-side to reveal.
- **Outbound webhooks** — create/edit (name, URL, secret, optional event
  type filter), pause/resume (`is_active`), delete. List never returns the
  secret, only `secret_configured: true/false`.

## 7. Ops / troubleshooting

- **A partner says events aren't arriving:** check `webhook_deliveries` for
  their `webhook_endpoint_id` — `status` tells you `success` / still
  retrying (`pending`/`failed`) / gave up (`dead`), and `last_error` has the
  HTTP status or network error from the most recent attempt.
- **A key seems unused / candidate for cleanup:** `service_api_keys
  .last_used_at` — `null` means it's never been used since creation.
- **Delayed-shipment webhook not firing for a shipment you expect:** check
  `shipments.metadata->>'skola_delayed_notified_at'` — if already set, it
  already fired once and won't again.
- **Local testing:** `ENCRYPTION_KEY` must be set (it already is, in
  `.env.local`) or `secretsCrypto.js`/webhook delivery will throw loudly
  rather than silently storing/sending anything insecurely — this is
  intentional, matching the no-hardcoded-fallback-key fix from the 2026-08
  security hardening pass elsewhere in the codebase.

## 8. Known scope cuts (deliberate, not oversights)

- **No application-level rate limiting on `/api/v1/*`.** The repo has an
  Upstash-backed limiter (`services/rate-limit.js`) used elsewhere; it
  wasn't wired in here to keep the first cut simple. Add it the same way if
  a partner needs it enforced.
- **`order.updated` covers every current `overall_status` writer** (see §5
  for the full list) but is not a guarantee against future drift — anyone
  adding a new place that writes `orders.overall_status` needs to also call
  `sendWebhookEvent('order.updated', ...)` there; nothing enforces that
  automatically (e.g. a DB trigger would, at the cost of losing the
  request-context fields like which payment/rider action caused it).
- **PII minimization is a judgment call, not a hard requirement from the
  spec** — customer email is never returned by design; phone/address are
  included where operationally necessary (delivery coordination). Revisit
  if Skola's use case needs email.
- **`shipments/delayed` is age-based**, not compared against a
  promised-delivery-date, because JLO doesn't track one today.
