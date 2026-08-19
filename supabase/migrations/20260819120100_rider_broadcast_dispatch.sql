-- Broadcast dispatch (phase 2): the columns that record which area a
-- broadcasting shipment was offered to. Denormalized text (not a location
-- FK) because the pickup point isn't always an approved_vendor_locations
-- row — a manual shipment's sender can be free-text — so city/state text
-- matched against a rider's own approved_vendor_locations.city/state is
-- the common ground both source tables can always populate.
alter table shipments        add column if not exists broadcast_city text;
alter table shipments        add column if not exists broadcast_state text;
alter table shipments        add column if not exists broadcast_started_at timestamptz;

alter table sub_orders       add column if not exists broadcast_city text;
alter table sub_orders       add column if not exists broadcast_state text;
alter table sub_orders       add column if not exists broadcast_started_at timestamptz;

alter table manual_shipments add column if not exists broadcast_city text;
alter table manual_shipments add column if not exists broadcast_state text;
alter table manual_shipments add column if not exists broadcast_started_at timestamptz;

-- Riders poll/subscribe for "what's broadcasting near me" — this is the
-- lookup that query runs.
create index if not exists shipments_broadcasting_area_idx
  on shipments (status, broadcast_state, broadcast_city)
  where status = 'broadcasting';
