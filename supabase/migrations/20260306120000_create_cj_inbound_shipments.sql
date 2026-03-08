create table if not exists public.cj_inbound_shipments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  woo_order_id text null,
  sub_order_id uuid null references public.sub_orders(id) on delete set null,
  vendor_id uuid null references public.vendors(id) on delete set null,
  hub_id uuid null references public.hubs(id) on delete set null,
  provider text not null default 'cj',
  cj_order_id text null,
  cj_pid text null,
  cj_vid text null,
  inbound_tracking_number text null,
  supplier_status text null,
  inbound_status text not null default 'awaiting_supplier_fulfillment',
  carrier_name text null,
  estimated_arrival_at timestamptz null,
  received_at_hub_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_cj_inbound_shipments_sub_order_id
  on public.cj_inbound_shipments(sub_order_id);

create index if not exists idx_cj_inbound_shipments_woo_order_id
  on public.cj_inbound_shipments(woo_order_id);

create index if not exists idx_cj_inbound_shipments_cj_order_id
  on public.cj_inbound_shipments(cj_order_id);

create index if not exists idx_cj_inbound_shipments_hub_id
  on public.cj_inbound_shipments(hub_id);

create index if not exists idx_cj_inbound_shipments_inbound_status
  on public.cj_inbound_shipments(inbound_status);

drop trigger if exists trg_cj_inbound_shipments_updated_at on public.cj_inbound_shipments;

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
      create trigger trg_cj_inbound_shipments_updated_at
      before update on public.cj_inbound_shipments
      for each row execute procedure public.set_updated_at()
    ';
  else
    execute '
      create trigger trg_cj_inbound_shipments_updated_at
      before update on public.cj_inbound_shipments
      for each row execute function update_updated_at_column()
    ';
  end if;
end
$$;
