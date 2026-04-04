create table if not exists public.provider_auth_tokens (
  provider text primary key,
  access_token text not null,
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.provider_auth_tokens enable row level security;

drop policy if exists "Service role has full access to provider_auth_tokens" on public.provider_auth_tokens;
create policy "Service role has full access to provider_auth_tokens"
  on public.provider_auth_tokens
  for all
  to service_role
  using (true)
  with check (true);

drop trigger if exists trg_provider_auth_tokens_updated_at on public.provider_auth_tokens;

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
      create trigger trg_provider_auth_tokens_updated_at
      before update on public.provider_auth_tokens
      for each row execute procedure public.set_updated_at()
    ';
  else
    execute '
      create trigger trg_provider_auth_tokens_updated_at
      before update on public.provider_auth_tokens
      for each row execute function update_updated_at_column()
    ';
  end if;
end
$$;
