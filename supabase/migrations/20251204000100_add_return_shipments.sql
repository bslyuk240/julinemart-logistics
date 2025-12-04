-- Ensure return_requests table exists (lightweight placeholder to avoid FK failure)
do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'return_requests'
  ) then
    create table public.return_requests (
      id uuid primary key default gen_random_uuid(),
      order_id uuid references public.orders(id) on delete cascade,
      reason text,
      status text default 'pending',
      created_at timestamp with time zone default now()
    );
  end if;
end $$;

-- Create return_shipments table to track outbound logistics for returns
create table if not exists public.return_shipments (
  id uuid primary key default gen_random_uuid(),
  return_request_id uuid references public.return_requests(id) on delete cascade,
  fez_tracking text,
  method text check (method in ('pickup','dropoff')),
  return_code text,
  status text default 'pending',
  created_at timestamp with time zone default now()
);

-- Index for quicker lookups by return request
create index if not exists return_shipments_return_request_id_idx
  on public.return_shipments(return_request_id);
