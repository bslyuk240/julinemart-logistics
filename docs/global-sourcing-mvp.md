# Global Sourcing MVP

## What was added

- Admin route: `/admin/global-sourcing`
- Admin page: `src/dashboard/pages/GlobalSourcing.tsx`
- Netlify CJ auth/search/details functions
- Netlify Woo import writeback function
- Netlify inbound shipment admin function
- Supabase migration for `cj_inbound_shipments`
- Supabase migration for shared provider auth token caching
- Woo webhook placeholder logic for sourced sub-orders

## Route and page

- Route registration lives in `src/routes.tsx`
- Sidebar entry lives in `src/dashboard/components/DashboardLayout.tsx`
- The page has four sections:
  - CJ Products
  - Imported Products
  - Inbound Shipments
  - Settings

## Netlify functions added

- `netlify/functions/cj-auth.js`
  - Verifies backend config
  - Tests CJ auth without exposing tokens to the frontend
- `netlify/functions/cj-search-products.js`
  - Searches CJ products through a backend proxy
- `netlify/functions/cj-product-details.js`
  - Loads one CJ product and its variants for import
- `netlify/functions/global-sourcing-import-product.js`
  - Creates or updates Woo products using Woo REST
  - Converts supplier pricing to NGN before Woo writeback
  - Applies env-driven exchange rate and markup
  - Normalizes titles and descriptions deterministically
  - Writes sourcing meta to Woo product or variation records
- `netlify/functions/global-sourcing-products.js`
  - Lists Woo products that already carry sourcing meta
- `netlify/functions/global-sourcing-inbound-shipments.js`
  - Lists inbound shipment rows
  - Marks an inbound shipment as received at hub
  - Merges `sub_orders.metadata.global_sourcing`
  - Adds a tracking event and triggers a push notification

## Shared backend helpers

- `netlify/functions/services/global-sourcing-utils.js`
  - Admin auth with Supabase session bearer token
- Woo REST request helpers
- Sourcing meta helpers
- Safe `sub_orders.metadata` merge helpers
  - Deterministic content normalization helpers
  - NGN pricing calculation helpers
- `netlify/functions/services/cjAuth.js`
  - CJ access token requests
  - In-memory token caching for the current function runtime
  - Shared Supabase token caching for live/serverless reuse
  - Prefers the documented `/v1/authentication/getAccessToken` route
  - Keeps fallback attempts for slightly different endpoint shapes

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
- Additional WCFM-oriented vendor ID meta is also written so the ownership intent is explicit on the Woo product and variation records
- This MVP does not create a second vendor ownership system
- This repo still does not contain a proven WordPress post-author writeback path for WCFM, so the safest live-compatible implementation remains vendor bridge meta plus the existing JLO vendor mapping

## Inbound shipment layer

- New table: `public.cj_inbound_shipments`
- Purpose: supplier to JulineMart hub movement
- This does not replace:
  - `tracking_events`
  - `sub_orders.status`
  - existing last-mile delivery tracking

## Sub-order metadata extension

Sourced sub-orders now use the existing metadata extension point:

```json
{
  "fulfillment_mode": "cj_hub",
  "global_sourcing": {
    "provider": "cj",
    "cj_order_id": null,
    "receiving_hub_id": "<hub_uuid>",
    "inbound_status": "awaiting_supplier_fulfillment",
    "inbound_tracking_number": null
  }
}
```

Existing metadata such as `selected_lane`, `eligible_lanes`, voucher data, influencer data, and shipping P&L is preserved.

## Pricing behavior

- Supplier pricing is treated as provider currency input, normally USD
- Woo pricing is written as NGN strings accepted by Woo REST
- Current env-driven pricing controls:
  - `GLOBAL_SOURCING_USD_TO_NGN_RATE`
  - `USD_TO_NGN_RATE` fallback
  - `GLOBAL_SOURCING_MARKUP_PERCENT`
  - `GLOBAL_SOURCING_MARKUP_FLAT_NGN`
- Product and variation meta snapshots include supplier price, landed cost, exchange rate, and sale price when present

## CJ auth configuration

- Keep `CJ_API_BASE_URL` at the API root, for example `https://developers.cjdropshipping.com/api2.0`
- The backend now prefers the documented auth path under `/v1/authentication/getAccessToken`
- Optional override:
  - `CJ_AUTH_PATH`
- Use `CJ_AUTH_PATH` only if CJ changes the token route for your account or region
- Live deployments reuse a shared cached token from `provider_auth_tokens` to avoid CJ's token rate limit on serverless instances

## Content normalization

- Titles are trimmed, deduplicated, and cleaned with deterministic rules
- Descriptions are converted to plain text, duplicate lines are removed, and noisy formatting is collapsed
- The current implementation is intentionally rule-based rather than AI-generated

## What is implemented now

- Admin module scaffolding
- Backend-only CJ auth foundation
- CJ product search and inspect flow
- Woo product writeback path for sourced items
- Explicit USD to NGN conversion and markup support
- Variable product imports with normalized attributes and variation image handling
- Inbound shipment table and admin view
- Manual `Mark Received at Hub` action
- Woo webhook placeholder that prepares inbound shipment rows only for conservatively detected sourced sub-orders

## What is deferred

- Automatic CJ order creation
- A WordPress post-author writeback path for WCFM-specific ownership if the Woo site requires it
- Customer PWA badge work
- A dedicated Woo checkout hook that guarantees product sourcing meta is mirrored into Woo order line item meta

## Notes for the next phase

- If Woo order payloads do not consistently carry sourcing fields on line items, add a Woo-side hook that copies the sourcing product meta into line item meta at checkout.
- If reporting needs increase, promote `fulfillment_mode` and `receiving_hub_id` to first-class columns on `sub_orders`.
