-- Proof of Delivery levels: orders/shipments at or above the "verified"
-- value threshold (see services/shipmentSummary.js's POD_VERIFIED_THRESHOLD_NGN)
-- require a customer signature in addition to the delivery photo. Mirrors
-- delivery_proof_url's existing placement — sub_orders (the source table
-- rider-jobs.js writes to directly) and the unified shipments table (what
-- the rider app and everything else actually reads from). manual_shipments
-- deliberately excluded, matching delivery_proof_url's existing asymmetry —
-- that table has no per-status-column tracking at all, only the unified
-- shipments row carries it for that source type.

alter table sub_orders add column if not exists signature_url text;
alter table shipments add column if not exists signature_url text;
