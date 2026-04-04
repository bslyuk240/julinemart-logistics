create table if not exists public.global_sourcing_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider text not null default 'cj',
  request_type text not null default 'link',
  source_url text not null,
  source_domain text null,
  status text not null default 'submitted',
  note text null,
  requested_quantity integer null,
  vendor_id uuid null references public.vendors(id) on delete set null,
  receiving_hub_id uuid null references public.hubs(id) on delete set null,
  cj_request_id text null,
  cj_pid text null,
  cj_vid text null,
  resolved_product_title text null,
  resolved_variant_title text null,
  raw_request_payload jsonb not null default '{}'::jsonb,
  raw_response_payload jsonb not null default '{}'::jsonb,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint global_sourcing_requests_status_check
    check (status in ('submitted', 'processing', 'ready_to_import', 'failed')),
  constraint global_sourcing_requests_request_type_check
    check (request_type in ('link'))
);

create index if not exists idx_global_sourcing_requests_status
  on public.global_sourcing_requests(status);

create index if not exists idx_global_sourcing_requests_provider
  on public.global_sourcing_requests(provider);

create index if not exists idx_global_sourcing_requests_cj_request_id
  on public.global_sourcing_requests(cj_request_id);

create index if not exists idx_global_sourcing_requests_receiving_hub_id
  on public.global_sourcing_requests(receiving_hub_id);

create index if not exists idx_global_sourcing_requests_created_at
  on public.global_sourcing_requests(created_at desc);

create index if not exists idx_global_sourcing_requests_provider_source_url_status
  on public.global_sourcing_requests(provider, source_url, status, created_at desc);

alter table public.global_sourcing_requests enable row level security;

drop policy if exists "Service role has full access to global_sourcing_requests" on public.global_sourcing_requests;
create policy "Service role has full access to global_sourcing_requests"
  on public.global_sourcing_requests
  for all
  to service_role
  using (true)
  with check (true);

drop trigger if exists trg_global_sourcing_requests_updated_at on public.global_sourcing_requests;

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
      create trigger trg_global_sourcing_requests_updated_at
      before update on public.global_sourcing_requests
      for each row execute procedure public.set_updated_at()
    ';
  else
    execute '
      create trigger trg_global_sourcing_requests_updated_at
      before update on public.global_sourcing_requests
      for each row execute function update_updated_at_column()
    ';
  end if;
end
$$;
