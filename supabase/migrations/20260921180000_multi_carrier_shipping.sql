-- Multi-carrier JLO fulfilment: providers, quotes, location mappings, audit.
-- Extends existing sub_orders rather than creating a second shipment entity.
-- Local rider lanes and delivery_status values are unchanged.

create table if not exists shipping_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  enabled boolean not null default true,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into shipping_providers (code, name, enabled, environment, config)
values
  ('fez', 'FEZ', true, 'production', '{}'::jsonb),
  ('shipbubble', 'Shipbubble', true, 'sandbox', '{}'::jsonb)
on conflict (code) do nothing;

create table if not exists shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  sub_order_id uuid references sub_orders(id) on delete cascade,
  provider text not null,
  provider_quote_id text,
  courier_name text,
  service_name text,
  cost numeric not null,
  currency text not null default 'NGN',
  eta_min_days integer,
  eta_max_days integer,
  pickup_available boolean,
  quote_status text not null default 'active'
    check (quote_status in ('active', 'selected', 'booked', 'expired', 'superseded')),
  requested_at timestamptz not null default now(),
  expires_at timestamptz,
  provider_metadata jsonb not null default '{}'::jsonb
);

create index if not exists shipping_quotes_sub_order_idx on shipping_quotes(sub_order_id, requested_at desc);
create index if not exists shipping_quotes_order_idx on shipping_quotes(order_id);

create table if not exists provider_location_mappings (
  id uuid primary key default gen_random_uuid(),
  location_key text not null,
  provider text not null,
  provider_location_id text,
  provider_address_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_key, provider)
);

create table if not exists shipping_fulfilment_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  order_id uuid,
  sub_order_id uuid,
  shipment_id uuid,
  provider text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shipping_fulfilment_actions_sub_order_idx
  on shipping_fulfilment_actions(sub_order_id, created_at desc);

alter table sub_orders add column if not exists fulfilment_provider text;
alter table sub_orders add column if not exists fulfilment_courier_name text;
alter table sub_orders add column if not exists fulfilment_service_name text;
alter table sub_orders add column if not exists carrier_cost numeric;
alter table sub_orders add column if not exists shipping_margin numeric;
alter table sub_orders add column if not exists selected_quote_id uuid references shipping_quotes(id) on delete set null;
alter table sub_orders add column if not exists quotes_requested_at timestamptz;
alter table sub_orders add column if not exists quotes_expires_at timestamptz;
alter table sub_orders add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
alter table sub_orders add column if not exists jlo_tracking_number text;
alter table sub_orders add column if not exists package_override jsonb;

alter table shipments add column if not exists fulfilment_provider text;
alter table shipments add column if not exists fulfilment_courier_name text;
alter table shipments add column if not exists carrier_cost numeric;
alter table shipments add column if not exists shipping_margin numeric;
alter table shipments add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

alter table shipping_providers enable row level security;
alter table shipping_quotes enable row level security;
alter table provider_location_mappings enable row level security;
alter table shipping_fulfilment_actions enable row level security;
