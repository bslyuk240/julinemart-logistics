-- Return + Refunds foundational schema
-- Creates/extends return_requests and return_shipments with triggers and indexes

create extension if not exists "uuid-ossp";

-- return_requests
create table if not exists public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null,
  order_number text,
  wc_customer_id bigint,
  customer_email text,
  customer_name text,
  vendor_id bigint,
  hub_id uuid,
  preferred_resolution text check (preferred_resolution in ('refund','replacement')) not null,
  reason_code text,
  reason_note text,
  images jsonb default '[]'::jsonb,
  status text not null default 'requested',
  fez_shipment_id text,
  fez_tracking text,
  fez_method text check (fez_method in ('pickup','dropoff')),
  inspection_result text,
  inspection_notes text,
  inspected_by uuid references public.users(id),
  inspected_at timestamptz,
  refund_status text default 'none',
  refund_amount numeric(12,2),
  refund_currency text default 'NGN',
  refund_method text,
  refund_wc_id bigint,
  refund_raw jsonb,
  refund_completed_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- return_shipments
create table if not exists public.return_shipments (
  id uuid primary key default gen_random_uuid(),
  return_request_id uuid references public.return_requests(id) on delete cascade,
  return_code text,
  fez_tracking text,
  method text check (method in ('pickup','dropoff')),
  status text default 'pending',
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_return_requests_updated_at on public.return_requests;
create trigger trg_return_requests_updated_at
before update on public.return_requests
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_return_shipments_updated_at on public.return_shipments;
create trigger trg_return_shipments_updated_at
before update on public.return_shipments
for each row execute procedure public.set_updated_at();

-- indexes
create index if not exists idx_return_requests_order_id on public.return_requests(order_id);
create index if not exists idx_return_requests_status on public.return_requests(status);
create index if not exists idx_return_shipments_request on public.return_shipments(return_request_id);
