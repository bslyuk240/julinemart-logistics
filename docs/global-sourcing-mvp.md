# Global Sourcing Phase 2

## What was added

- Admin route: `/admin/global-sourcing`
- CJ auth/search/product detail functions running on Netlify
- Source by Link request intake and status tracking for supported external supplier URLs
- Landed-price quote endpoint for CJ variant imports
- Woo import/writeback for sourced products and variations
- Automatic CJ supplier order placement for sourced `cj_hub` sub-orders
- Manual CJ supplier-order grouping from the inbound shipments admin view
- Inbound shipment admin actions for supplier-order retry and received-at-hub updates
- Supabase migrations for:
  - `cj_inbound_shipments`
  - `manual_supplier_orders`
  - `manual_supplier_order_items`
  - `provider_auth_tokens`

## Route and page

- Route registration lives in `src/routes.tsx`
- Sidebar entry lives in `src/dashboard/components/DashboardLayout.tsx`
- The page lives in `src/dashboard/pages/GlobalSourcing.tsx`
- The page has five sections:
- CJ Products
- Source by Link
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
- `netlify/functions/global-sourcing-source-link.js`
  - Lists source-link requests
  - Submits new source-link requests to CJ
  - Refreshes CJ sourcing status for one request
  - Retries failed requests deliberately
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
  - Creates one manual CJ supplier order record for multiple inbound rows
  - Retries CJ supplier-order creation for one sourced shipment
  - Marks an inbound shipment as received at hub

## Shared backend helpers

- `netlify/functions/services/global-sourcing-utils.js`
  - Admin auth with Supabase session bearer token
  - Source-link URL validation and normalization
  - Remote source-page metadata extraction for CJ sourcing submission
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
  - Submits and refreshes CJ source-link requests
  - Creates CJ supplier orders for sourced sub-orders
  - Reconciles partial supplier-order state after webhook retries or partial failures

## Source by Link flow

- Source by Link is an intake path only
- It does not create a second fulfillment engine
- Supported source domains in this MVP:
  - `1688`
  - `Alibaba`
  - `AliExpress`
- Admin flow:
  - paste a supported supplier URL
  - optionally add note and expected quantity
  - submit to CJ sourcing
  - refresh CJ status until the request becomes `ready_to_import`
  - continue into the same landed-price and Woo import flow already used by CJ catalog products

## Source-link request lifecycle

- Local table: `public.global_sourcing_requests`
- Local statuses:
  - `submitted`
  - `processing`
  - `ready_to_import`
  - `failed`
- Duplicate handling:
  - an existing `submitted`, `processing`, or `ready_to_import` request for the same normalized URL is reused instead of resubmitted
  - a failed request is not silently duplicated; the admin must use an explicit retry action
- A request becomes `ready_to_import` once CJ returns a usable `cj_pid`
- `cj_vid` is used when CJ provides a direct variant id
- if CJ only returns product-level identity or a variant SKU, the admin continues into the existing CJ details flow and can confirm the resolved variant before quoting/import

## How source-link requests become importable

- Source-link requests do not import directly into Woo
- When a request is ready:
  - the admin clicks `Continue to Import`
  - JLO hydrates the resolved CJ product through the existing `cj-product-details` function
  - the existing landed-price quote action is reused
  - the existing Woo import/writeback path is reused
- This preserves:
  - Woo as source of truth for products and prices
  - existing sourcing meta keys
  - existing webhook recognition
  - existing automatic CJ supplier-order creation for sourced `cj_hub` items

## Manual vs automatic in Source by Link

- Manual:
  - submit source URL
  - refresh CJ sourcing status
  - continue into import
  - run landed-price quote
  - import into Woo
- Automatic after import and order placement:
  - sourced item recognition in `woocommerce-webhook.js`
  - sub-order creation with sourcing metadata
  - automatic CJ supplier-order creation for eligible `cj_hub` sourced shipments
  - inbound shipment tracking to JulineMart hub

## Manual supplier-order workflow

Ops can now use the inbound shipments tab for batched manual CJ ordering without removing the existing automatic path.

Workflow:

1. Woo checkout still creates normal app `orders` and `sub_orders`
2. Sourced `cj_hub` rows still create `cj_inbound_shipments`
3. Ops opens `/admin/global-sourcing` -> `Inbound Shipments`
4. Ops selects multiple compatible pending rows
5. The page reuses the existing `Open on CJ` link pattern to open the exact CJ product page
6. Ops places one combined quantity order on CJ manually
7. Ops saves:
   - `CJ Order ID`
   - `Date Ordered`
   - `Notes`
8. JLO records one `manual_supplier_orders` row plus linked `manual_supplier_order_items`
9. Each linked inbound row remains individually receivable at hub and continues through the normal JLO dispatch flow

Compatibility rules for manual grouping:

- provider must be `cj`
- rows must still be awaiting supplier ordering
- rows cannot already have a supplier order reference
- rows cannot already be attached to another manual supplier order
- rows must share the same CJ product and CJ variant

This keeps the manual workflow operationally safe because ops is expected to place one quantity order against one exact CJ product/variant page.

## CJ sourcing caveats

- CJ source-link submission needs a source product title and image
- JLO currently extracts those from the supplier page metadata before calling CJ
- If the supplier page cannot be fetched or does not expose enough metadata, submission fails clearly in the admin UI
- CJ query responses may return product-level identity before variant-level identity; in that case the admin continues through the existing CJ details/import screen and confirms the resolved variant there

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
- `_usd_to_ngn_rate_source_snapshot`
- `_fx_rate_fetched_at_snapshot`
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
- `public.manual_supplier_orders` stores one manually-entered supplier order header
- `public.manual_supplier_order_items` links that manual order to one or more inbound rows / sub-orders / orders
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
    "supplier_order_mode": "automatic",
    "supplier_order_status": "awaiting_supplier_order",
    "manual_supplier_order_id": null,
    "supplier_ordered_at": null,
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

## Supplier-order modes and statuses

Supplier ordering now has two additive modes:

- `automatic`
  - existing webhook/Netlify path creates the CJ order automatically when eligible
- `manual`
  - admin groups compatible inbound rows and records one CJ order after placing it directly on CJ

Supplier-order statuses now tracked on inbound rows and mirrored into sourcing metadata:

- `awaiting_supplier_order`
- `supplier_order_placed`
- `supplier_shipped`
- `received_at_hub`

The older `inbound_status` values are still preserved where existing code depends on them. The new supplier-order status layer is additive and is used for admin filtering and manual-order visibility.

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

Automatic creation now skips any row already committed to manual supplier ordering:

- if `supplier_order_mode = manual`, auto-create is skipped
- if `manual_supplier_order_id` is already set, auto-create is skipped
- if a `cj_order_id` already exists, the existing idempotent reconciliation still applies

This prevents webhook retries from creating duplicate CJ orders after ops has chosen the manual path.

## Idempotency and retry rules

- A sourced sub-order will not create another CJ order if `cj_order_id` already exists in `sub_orders.metadata.global_sourcing` or `cj_inbound_shipments`
- A sourced sub-order will not auto-create a CJ order if it has already been locked to manual supplier ordering
- The webhook path reconciles partial state if one side was updated but the other was not
- Admin retry action refuses to create a second CJ order when an existing `cj_order_id` is already present
- Received-at-hub action is idempotent:
  - shipment status can be retried safely
  - tracking event creation is deduplicated
  - push notification is only attempted on the first received-at-hub milestone
- Manual supplier orders remain compatible with received-at-hub:
  - linked inbound rows still update `sub_orders.metadata.global_sourcing.inbound_status`
  - linked inbound rows still create the received-at-hub tracking event once
  - linked inbound rows still participate in normal downstream dispatch
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

FX provider and cache:

- `EXCHANGERATE_API_KEY`
- `EXCHANGERATE_API_BASE_URL`
- `FX_RATE_CACHE_MINUTES`

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
- Source-link request intake, persistence, retry, and status refresh
- Automatic CJ supplier-order creation for sourced sub-orders
- Manual CJ supplier-order grouping for compatible inbound rows
- Retry-safe admin action to create or reconcile supplier orders
- Idempotent received-at-hub action with tracking and push support

## What is still not implemented

- Full admin retry tooling for every CJ failure mode beyond one shipment action
- CJ inbound-status polling from CJ after order creation
- Manual editing of an existing manual supplier-order group after it has been saved
- Automatic background polling for source-link request status
- Dedicated customer PWA badge rendering for product sourcing
- A proven WordPress post-author writeback path for WCFM-specific ownership if the Woo site requires it
- A dedicated Woo checkout hook that guarantees product sourcing meta is mirrored into order line item meta before webhook delivery
