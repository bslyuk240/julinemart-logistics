-- Return pickups booked with a courier API (Shipbubble).
--
-- A courier-booked pickup has no manual shipment and no Fez tracking number, so
-- the return shipment records which provider holds the booking, that
-- provider's own shipment id (the webhook finds the return by it), and the
-- tracking link the customer follows.
--
-- Apply after 20261003120000_return_pickup.sql. The code checks these columns
-- exist and hides the Shipbubble option until they do.

alter table public.return_shipments
  add column if not exists provider text,
  add column if not exists provider_shipment_id text,
  add column if not exists tracking_url text;

create index if not exists idx_return_shipments_provider_shipment
  on public.return_shipments (provider, provider_shipment_id)
  where provider_shipment_id is not null;

comment on column public.return_shipments.provider is
  'Courier API that holds the pickup booking, e.g. shipbubble. Null for Fez/rider/drop-off returns.';
