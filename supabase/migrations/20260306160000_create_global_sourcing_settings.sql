create table if not exists public.global_sourcing_settings (
  provider text primary key,
  default_import_buffer_usd numeric(12, 2) null,
  default_markup_percent numeric(8, 2) null,
  default_markup_flat_ngn numeric(12, 2) null,
  default_usd_to_ngn_rate numeric(12, 4) null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.global_sourcing_settings enable row level security;

drop policy if exists "Service role has full access to global_sourcing_settings" on public.global_sourcing_settings;
create policy "Service role has full access to global_sourcing_settings"
  on public.global_sourcing_settings
  for all
  to service_role
  using (true)
  with check (true);

drop trigger if exists trg_global_sourcing_settings_updated_at on public.global_sourcing_settings;

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
      create trigger trg_global_sourcing_settings_updated_at
      before update on public.global_sourcing_settings
      for each row execute procedure public.set_updated_at()
    ';
  else
    execute '
      create trigger trg_global_sourcing_settings_updated_at
      before update on public.global_sourcing_settings
      for each row execute function update_updated_at_column()
    ';
  end if;
end
$$;
