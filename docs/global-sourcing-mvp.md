# Global Sourcing Phase 2

## What was added

- Admin route: `/admin/global-sourcing`
- CJ auth/search/product detail functions running on Netlify
- Landed-price quote endpoint for CJ variant imports
- Woo import/writeback for sourced products and variations
- Automatic CJ supplier order placement for sourced `cj_hub` sub-orders
- Inbound shipment admin actions for supplier-order retry and received-at-hub updates
- Supabase migrations for:
  - `cj_inbound_shipments`
  - `provider_auth_tokens`

## Route and page

- Route registration lives in `src/routes.tsx`
- Sidebar entry lives in `src/dashboard/components/DashboardLayout.tsx`
- The page lives in `src/dashboard/pages/GlobalSourcing.tsx`
- The page has four sections:
  - CJ Products
  - Imported Products
  - Inbound Shipments
  - Settings

## Netlify functions

- `netlify/functions/cj-auth.js`
  - Verifies backend config
  - Tests CJ auth without exposing tokens to the frontend
- `netlify/functions/cj-search-products.js`
  - Searches CJ products through a backend proxy
- `netlify/functions/cj-product-details.js`
  - Loads one CJ product and its variants for import
- `netlify/functions/global-sourcing-price-preview.js`
  - Resolves receiving hub
  - Requests a live CJ freight quote to the selected hub
  - Builds landed-price preview data before import
- `netlify/functions/global-sourcing-import-product.js`
  - Creates or updates Woo products using Woo REST
  - Requires a real landed-price preview for sourced imports
  - Writes sourcing and pricing trace snapshots to Woo product and variation meta
- `netlify/functions/global-sourcing-products.js`
  - Lists Woo products that already carry sourcing meta
- `netlify/functions/global-sourcing-inbound-shipments.js`
  - Lists inbound shipment rows
  - Retries CJ supplier-order creation for one sourced shipment
  - Marks an inbound shipment as received at hub

## Shared backend helpers

- `netlify/functions/services/global-sourcing-utils.js`
  - Admin auth with Supabase session bearer token
  - Woo REST helpers
  - Sourcing meta helpers
  - Safe `sub_orders.metadata` merge helpers
  - Deterministic title and description normalization
  - NGN pricing helpers with exchange rate, import buffer, and markup
- `netlify/functions/services/cjAuth.js`
  - CJ access token requests
  - In-memory token caching for the current function runtime
  - Shared Supabase token caching for live/serverless reuse
  - Prefers `/v1/authentication/getAccessToken`
  - Falls back to a still-valid cached token when CJ returns token-rate-limit responses
- `netlify/functions/services/global-sourcing-cj.js`
  - Resolves receiving hub details from Supabase
  - Calls CJ freight quote endpoint for hub pricing
  - Builds landed-price preview objects
  - Creates CJ supplier orders for sourced sub-orders
  - Reconciles partial supplier-order state after webhook retries or partial failures

## Landed pricing behavior

Woo item pricing now uses landed imported cost for `cj_hub` products:

```text
landed_cost_usd =
  supplier_item_price_usd
  + inbound_shipping_quote_usd
  + import_buffer_usd

final_sell_price_ngn =
  convert_to_ngn(landed_cost_usd)
  then apply markup
```

- JLO local delivery remains a separate shipping charge
- Import fails clearly if a live CJ freight quote cannot be produced
- The admin page shows:
  - supplier price
  - inbound shipping quote
  - import buffer
  - landed cost
  - exchange rate
  - final NGN price
  - ETA and carrier when available

## Woo meta keys used

- `_global_sourcing_provider`
- `_cj_pid`
- `_cj_vid`
- `_fulfillment_mode`
- `_receiving_hub_id`
- `_origin_country`
- `_ships_from_abroad`
- `_global_sourcing_tag`
- `_estimated_inbound_days_min`
- `_estimated_inbound_days_max`
- `_supplier_price_snapshot_usd`
- `_inbound_shipping_snapshot_usd`
- `_landed_cost_snapshot_usd`
- `_usd_to_ngn_rate_snapshot`
- `_final_price_snapshot_ngn`
- `_global_sourcing_pricing_mode`
- `_landed_cost_snapshot`
- `_supplier_price_snapshot`
- `_exchange_rate_snapshot`
- `_sale_price_snapshot`
- `_jlo_vendor_id`
- `_vendor_id`
- `vendor_id`
- `_woocommerce_vendor_id`
- `_wcfm_vendor_id`
- `wcfm_vendor_id`

## Vendor mapping

- JLO resolves the selected vendor from the existing `vendors` table
- `vendors.woocommerce_vendor_id` is required for imports
- `vendors.woocommerce_vendor_id` is written back into Woo meta as the bridge field
- This implementation still does not create a second vendor ownership model
- This repo still does not contain a proven WordPress post-author writeback path for WCFM, so the safe live-compatible implementation remains vendor bridge meta plus the existing JLO vendor mapping

## Receiving hub resolution

- If `receiving_hub_id` is provided, it is used
- Otherwise the backend looks for an active hub whose `metadata` contains one of:
  - `default_inbound`
  - `is_default_inbound`
  - `defaultInbound`
  - `isDefaultInbound`
- If no explicit or default inbound hub exists, the action fails clearly
- Hub resolution currently maps:
  - id
  - name
  - code
  - address
  - city
  - state
  - postcode from hub metadata if available
  - country code and country name from hub metadata or env defaults
  - contact name and phone

## Inbound shipment and metadata layer

- `public.cj_inbound_shipments` stores supplier-to-hub movement
- `sub_orders.metadata` remains the extension point for sourcing state
- Sourced sub-orders carry:

```json
{
  "fulfillment_mode": "cj_hub",
  "global_sourcing": {
    "provider": "cj",
    "cj_order_id": "optional_cj_order_id",
    "receiving_hub_id": "<hub_uuid>",
    "inbound_status": "awaiting_supplier_fulfillment",
    "inbound_tracking_number": null,
    "items": [
      {
        "product_id": "woo_product_id",
        "variation_id": "woo_variation_id",
        "cj_pid": "cj product id",
        "cj_vid": "cj variant id",
        "quantity": 1
      }
    ]
  }
}
```

- Existing metadata such as `selected_lane`, `eligible_lanes`, voucher data, influencer data, and shipping P&L is preserved

## Automatic CJ order placement

When the Woo webhook creates sourced `cj_hub` sub-orders, the Netlify/Supabase path now attempts to create a CJ supplier order automatically if:

- `fulfillment_mode = cj_hub`
- `provider = cj`
- `receiving_hub_id` is available
- at least one sourced line has a `cj_vid`

The CJ order:

- ships to the receiving hub, not to the customer
- uses the hub contact and address as destination
- uses a stable order reference derived from Woo order id and sub-order id
- writes `cj_order_id` back to:
  - `sub_orders.metadata.global_sourcing.cj_order_id`
  - `cj_inbound_shipments.cj_order_id`
- advances inbound state to `supplier_order_created`
- records an operational tracking event
- triggers one conservative customer push notification if possible

## Idempotency and retry rules

- A sourced sub-order will not create another CJ order if `cj_order_id` already exists in `sub_orders.metadata.global_sourcing` or `cj_inbound_shipments`
- The webhook path reconciles partial state if one side was updated but the other was not
- Admin retry action refuses to create a second CJ order when an existing `cj_order_id` is already present
- Received-at-hub action is idempotent:
  - shipment status can be retried safely
  - tracking event creation is deduplicated
  - push notification is only attempted on the first received-at-hub milestone
- Failures are logged to `webhook_errors` and stored in sourcing metadata for admin follow-up

## Environment variables

Required:

- `CJ_API_KEY`
- `CJ_API_BASE_URL`
- `WOO_BASE_URL` or `WOOCOMMERCE_URL`
- `WOO_CONSUMER_KEY` or `WOOCOMMERCE_CONSUMER_KEY`
- `WOO_CONSUMER_SECRET` or `WOOCOMMERCE_CONSUMER_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`

Pricing and hub defaults:

- `GLOBAL_SOURCING_USD_TO_NGN_RATE`
- `USD_TO_NGN_RATE`
- `GLOBAL_SOURCING_IMPORT_BUFFER_USD`
- `GLOBAL_SOURCING_MARKUP_PERCENT`
- `GLOBAL_SOURCING_MARKUP_FLAT_NGN`
- `GLOBAL_SOURCING_DEFAULT_COUNTRY_CODE`
- `GLOBAL_SOURCING_DEFAULT_COUNTRY_NAME`

Optional auth override:

- `CJ_AUTH_PATH`

## What is implemented now

- Admin module scaffolding
- Backend-only CJ auth foundation
- CJ product search and inspect flow
- Landed-price quote before Woo import
- Woo product writeback path for sourced items
- Shared CJ token cache for serverless/live auth reuse
- Inbound shipment table and admin view
- Automatic CJ supplier-order creation for sourced sub-orders
- Retry-safe admin action to create or reconcile supplier orders
- Idempotent received-at-hub action with tracking and push support

## What is still not implemented

- Full admin retry tooling for every CJ failure mode beyond one shipment action
- CJ inbound-status polling from CJ after order creation
- Dedicated customer PWA badge rendering for product sourcing
- A proven WordPress post-author writeback path for WCFM-specific ownership if the Woo site requires it
- A dedicated Woo checkout hook that guarantees product sourcing meta is mirrored into order line item meta before webhook delivery
