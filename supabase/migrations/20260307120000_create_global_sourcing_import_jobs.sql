create table if not exists public.global_sourcing_import_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'cj',
  status text not null default 'queued',
  requested_by uuid null references public.users(id) on delete set null,
  payload jsonb not null,
  cursor jsonb not null default '{}'::jsonb,
  progress_stage text null,
  progress_current integer not null default 0,
  progress_total integer not null default 0,
  result jsonb null,
  error_message text null,
  error_details jsonb null,
  started_at timestamptz null,
  completed_at timestamptz null,
  failed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint global_sourcing_import_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed'))
);

create index if not exists idx_global_sourcing_import_jobs_status_created_at
  on public.global_sourcing_import_jobs(status, created_at desc);

alter table public.global_sourcing_import_jobs enable row level security;

drop policy if exists "Service role has full access to global_sourcing_import_jobs" on public.global_sourcing_import_jobs;
create policy "Service role has full access to global_sourcing_import_jobs"
  on public.global_sourcing_import_jobs
  for all
  to service_role
  using (true)
  with check (true);

drop trigger if exists trg_global_sourcing_import_jobs_updated_at on public.global_sourcing_import_jobs;

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
      create trigger trg_global_sourcing_import_jobs_updated_at
      before update on public.global_sourcing_import_jobs
      for each row execute procedure public.set_updated_at()
    ';
  else
    execute '
      create trigger trg_global_sourcing_import_jobs_updated_at
      before update on public.global_sourcing_import_jobs
      for each row execute function update_updated_at_column()
    ';
  end if;
end
$$;
