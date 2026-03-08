create table if not exists public.manual_supplier_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider text not null default 'cj',
  supplier_order_mode text not null default 'manual',
  cj_order_id text null,
  ordered_at timestamptz null,
  status text not null default 'awaiting_supplier_order',
  notes text null,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.manual_supplier_orders
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists provider text not null default 'cj',
  add column if not exists supplier_order_mode text not null default 'manual',
  add column if not exists cj_order_id text null,
  add column if not exists ordered_at timestamptz null,
  add column if not exists status text not null default 'awaiting_supplier_order',
  add column if not exists notes text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_manual_supplier_orders_provider_status
  on public.manual_supplier_orders(provider, status);

create index if not exists idx_manual_supplier_orders_ordered_at
  on public.manual_supplier_orders(ordered_at desc nulls last);

create unique index if not exists idx_manual_supplier_orders_provider_cj_order_id
  on public.manual_supplier_orders(provider, cj_order_id)
  where cj_order_id is not null;

drop trigger if exists trg_manual_supplier_orders_updated_at on public.manual_supplier_orders;

do $$
begin
  if exists (
    select 1
    from pg_proc proc
    join pg_namespace ns on ns.oid = proc.pronamespace
    where proc.proname = 'set_updated_at'
      and ns.nspname = 'public'
  ) then
    execute '
      create trigger trg_manual_supplier_orders_updated_at
      before update on public.manual_supplier_orders
      for each row execute procedure public.set_updated_at()
    ';
  else
    execute '
      create trigger trg_manual_supplier_orders_updated_at
      before update on public.manual_supplier_orders
      for each row execute function update_updated_at_column()
    ';
  end if;
end
$$;

create table if not exists public.manual_supplier_order_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  manual_supplier_order_id uuid not null references public.manual_supplier_orders(id) on delete cascade,
  cj_inbound_shipment_id uuid null references public.cj_inbound_shipments(id) on delete set null,
  sub_order_id uuid null references public.sub_orders(id) on delete set null,
  order_id uuid null references public.orders(id) on delete set null,
  product_id text null,
  variation_id text null,
  cj_pid text null,
  cj_vid text null,
  quantity integer not null default 1 check (quantity > 0)
);

alter table public.manual_supplier_order_items
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists manual_supplier_order_id uuid null,
  add column if not exists cj_inbound_shipment_id uuid null,
  add column if not exists sub_order_id uuid null,
  add column if not exists order_id uuid null,
  add column if not exists product_id text null,
  add column if not exists variation_id text null,
  add column if not exists cj_pid text null,
  add column if not exists cj_vid text null,
  add column if not exists quantity integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'manual_supplier_order_items_manual_supplier_order_id_fkey'
  ) then
    alter table public.manual_supplier_order_items
      add constraint manual_supplier_order_items_manual_supplier_order_id_fkey
      foreign key (manual_supplier_order_id)
      references public.manual_supplier_orders(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'manual_supplier_order_items_cj_inbound_shipment_id_fkey'
  ) then
    alter table public.manual_supplier_order_items
      add constraint manual_supplier_order_items_cj_inbound_shipment_id_fkey
      foreign key (cj_inbound_shipment_id)
      references public.cj_inbound_shipments(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'manual_supplier_order_items_sub_order_id_fkey'
  ) then
    alter table public.manual_supplier_order_items
      add constraint manual_supplier_order_items_sub_order_id_fkey
      foreign key (sub_order_id)
      references public.sub_orders(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'manual_supplier_order_items_order_id_fkey'
  ) then
    alter table public.manual_supplier_order_items
      add constraint manual_supplier_order_items_order_id_fkey
      foreign key (order_id)
      references public.orders(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'manual_supplier_order_items_quantity_check'
  ) then
    alter table public.manual_supplier_order_items
      add constraint manual_supplier_order_items_quantity_check
      check (quantity > 0);
  end if;
end
$$;

create index if not exists idx_manual_supplier_order_items_manual_order_id
  on public.manual_supplier_order_items(manual_supplier_order_id);

create index if not exists idx_manual_supplier_order_items_inbound_shipment_id
  on public.manual_supplier_order_items(cj_inbound_shipment_id);

create index if not exists idx_manual_supplier_order_items_sub_order_id
  on public.manual_supplier_order_items(sub_order_id);

create index if not exists idx_manual_supplier_order_items_order_id
  on public.manual_supplier_order_items(order_id);

create index if not exists idx_manual_supplier_order_items_variant
  on public.manual_supplier_order_items(cj_pid, cj_vid);

alter table public.cj_inbound_shipments
  add column if not exists supplier_order_mode text not null default 'automatic',
  add column if not exists supplier_order_status text not null default 'awaiting_supplier_order',
  add column if not exists manual_supplier_order_id uuid null references public.manual_supplier_orders(id) on delete set null,
  add column if not exists supplier_ordered_at timestamptz null;

create index if not exists idx_cj_inbound_shipments_supplier_order_mode
  on public.cj_inbound_shipments(supplier_order_mode);

create index if not exists idx_cj_inbound_shipments_supplier_order_status
  on public.cj_inbound_shipments(supplier_order_status);

create index if not exists idx_cj_inbound_shipments_manual_supplier_order_id
  on public.cj_inbound_shipments(manual_supplier_order_id);

update public.cj_inbound_shipments
set
  supplier_order_mode = coalesce(nullif(metadata ->> 'supplier_order_mode', ''), 'automatic'),
  supplier_order_status = case
    when inbound_status = 'received_at_hub' or received_at_hub_at is not null then 'received_at_hub'
    when coalesce(
      nullif(metadata -> 'global_sourcing' ->> 'supplier_order_status', ''),
      nullif(metadata ->> 'supplier_order_status', '')
    ) is not null then coalesce(
      nullif(metadata -> 'global_sourcing' ->> 'supplier_order_status', ''),
      nullif(metadata ->> 'supplier_order_status', '')
    )
    when inbound_status in ('supplier_shipped', 'supplier_in_transit', 'supplier_delivered') then 'supplier_shipped'
    when cj_order_id is not null then 'supplier_order_placed'
    else 'awaiting_supplier_order'
  end,
  supplier_ordered_at = coalesce(
    supplier_ordered_at,
    nullif(metadata -> 'global_sourcing' ->> 'supplier_ordered_at', '')::timestamptz,
    nullif(metadata -> 'global_sourcing' ->> 'supplier_order_created_at', '')::timestamptz
  );
