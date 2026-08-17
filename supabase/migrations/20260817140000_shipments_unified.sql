-- Shipment entity unification, phase 1 (additive only).
--
-- sub_orders and manual_shipments each independently reimplement the same
-- concept — "something is moving, someone's carrying it, here's its
-- status" — with the same delivery_status enum and near-identical columns
-- (courier_id, assigned_rider_id, tracking_number, waybill_number,
-- delivery_person_*, metadata). This table becomes the single shared home
-- for that dispatch data going forward.
--
-- Nothing existing changes in this migration: sub_orders and
-- manual_shipments keep every column they have today, untouched. This
-- table is populated by a separate backfill script and, once verified,
-- consumers (rider-jobs.js, assign-rider.js, RiderPicker, etc.) migrate to
-- read/write it one at a time. The old columns are not dropped until every
-- consumer is confirmed migrated — a later, separate migration.
--
-- return_shipments is deliberately excluded from phase 1: it has no
-- courier_id/assigned_rider_id and uses a different status vocabulary
-- (it's a Fez-pickup record, not a dispatch record) — nothing to unify
-- from it yet.

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),

  -- Where this shipment's dispatch fields actually live during the
  -- transition. Exactly one of sub_order_id / manual_shipment_id is set.
  source_type text not null check (source_type in ('sub_order', 'manual_shipment')),
  sub_order_id uuid references sub_orders(id) on delete cascade,
  manual_shipment_id uuid references manual_shipments(id) on delete cascade,
  constraint shipments_source_xor check (
    (source_type = 'sub_order' and sub_order_id is not null and manual_shipment_id is null) or
    (source_type = 'manual_shipment' and manual_shipment_id is not null and sub_order_id is null)
  ),

  -- Shared dispatch fields — the columns sub_orders and manual_shipments
  -- both already have, moved to one place.
  courier_id uuid references couriers(id),
  assigned_rider_id uuid references riders(id) on delete set null,
  status delivery_status,
  tracking_number text,
  waybill_number text,
  courier_shipment_id text,
  courier_tracking_url text,
  courier_waybill text,
  delivery_person_name text,
  delivery_person_phone text,
  delivery_person_vehicle text,
  delivery_proof_url text,
  picked_up_at timestamptz,
  out_for_delivery_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_tracking_update timestamptz,

  -- Dispatch-specific metadata only (selected_lane, eligible_lanes,
  -- rider_accepted_at, declined_by) — NOT the source row's business
  -- metadata (order_confirmation_handler, source:'pwa', etc.), which
  -- stays on sub_orders/manual_shipments where it belongs.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shipments_sub_order_id_key on shipments(sub_order_id) where sub_order_id is not null;
create unique index if not exists shipments_manual_shipment_id_key on shipments(manual_shipment_id) where manual_shipment_id is not null;
create index if not exists shipments_assigned_rider_id_idx on shipments(assigned_rider_id);
create index if not exists shipments_status_idx on shipments(status);

-- Parallels tracking_events' existing sub_order_id / manual_shipment_id
-- pattern — additive, nullable, historical rows are untouched.
alter table tracking_events add column if not exists shipment_id uuid references shipments(id) on delete set null;
create index if not exists tracking_events_shipment_id_idx on tracking_events(shipment_id);
