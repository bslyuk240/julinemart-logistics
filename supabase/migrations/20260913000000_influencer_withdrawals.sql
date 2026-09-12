-- Influencer self-service withdrawals: request -> staff approve/reject -> paid.
-- Column names (bank_name/account_number/account_name) intentionally match
-- influencers' own columns (not vendor/rider's bank_account_number style),
-- since influencer-profile.js already reads/writes those exact names.

create table if not exists public.influencer_withdrawals (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  amount numeric not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  bank_name text,
  account_number text,
  account_name text,
  rejection_reason text,
  notes text,
  payment_reference text,
  payment_date timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists influencer_withdrawals_influencer_id_idx
  on public.influencer_withdrawals (influencer_id);

alter table public.influencer_withdrawals enable row level security;

drop policy if exists "Service role has full access" on public.influencer_withdrawals;
create policy "Service role has full access" on public.influencer_withdrawals
  for all to service_role using (true) with check (true);

drop policy if exists "Influencer can read own withdrawals" on public.influencer_withdrawals;
create policy "Influencer can read own withdrawals" on public.influencer_withdrawals
  for select
  using (
    exists (
      select 1 from public.influencers i
      where i.id = influencer_withdrawals.influencer_id
        and i.user_id = auth.uid()
    )
  );

drop trigger if exists influencer_withdrawals_updated_at on public.influencer_withdrawals;
create trigger influencer_withdrawals_updated_at
  before update on public.influencer_withdrawals
  for each row execute function public.set_updated_at();
