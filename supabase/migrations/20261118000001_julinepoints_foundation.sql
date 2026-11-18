-- JulinePoints Rewards — Phase B foundation
-- Versioned admin config, wallet accounts, append-only ledger, admin audit.
-- All commercial values live in rewards_config_versions.policy (editable from
-- JLO admin); nothing here hard-codes reward amounts. The seeded version 1 is
-- DISABLED, so applying this migration changes no customer-facing behaviour.
--
-- Access model: RLS on, service_role only. Customers read their wallet through
-- the rewards-wallet Netlify function (verified JWT), never directly.

-- ── 1. Versioned config ──────────────────────────────────────────────────────
create table if not exists public.rewards_config_versions (
  id              uuid primary key default gen_random_uuid(),
  version         integer generated always as identity,
  status          text not null default 'draft'
                    check (status in ('draft', 'published', 'cancelled')),
  effective_from  timestamptz,
  policy          jsonb not null check (jsonb_typeof(policy) = 'object'),
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_by    uuid,
  published_at    timestamptz,
  cancelled_by    uuid,
  cancelled_at    timestamptz,
  constraint rewards_published_has_effective_from
    check (status <> 'published' or (effective_from is not null and published_at is not null))
);

create index if not exists idx_rewards_config_effective
  on public.rewards_config_versions (effective_from desc)
  where status = 'published';

-- A published version is immutable. The only allowed change is cancelling one
-- that has not taken effect yet (rollback of a future config). Drafts are free.
create or replace function public.rewards_config_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'only draft rewards config versions can be deleted';
    end if;
    return old;
  end if;

  if old.status = 'draft' then
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'published' and new.status = 'cancelled' then
    if old.effective_from <= now() then
      raise exception 'a rewards config version that is already effective cannot be cancelled; publish a newer version instead';
    end if;
    if new.policy is distinct from old.policy or new.effective_from is distinct from old.effective_from then
      raise exception 'rewards config policy is immutable once published';
    end if;
    new.updated_at := now();
    return new;
  end if;

  raise exception 'rewards config version % is immutable (status %)', old.id, old.status;
end;
$$;

drop trigger if exists trg_rewards_config_guard on public.rewards_config_versions;
create trigger trg_rewards_config_guard
  before update or delete on public.rewards_config_versions
  for each row execute function public.rewards_config_guard();

-- The version that applies at a given moment: latest published version whose
-- effective_from has passed. New events use this; old events keep the
-- config_version_id they were stamped with.
create or replace function public.rewards_active_config(p_at timestamptz default now())
returns public.rewards_config_versions
language sql stable security definer set search_path = public as $$
  select * from public.rewards_config_versions
  where status = 'published' and effective_from <= p_at
  order by effective_from desc, version desc
  limit 1;
$$;

-- ── 2. Wallet accounts ───────────────────────────────────────────────────────
-- Keyed by the verified auth user id (never email). balance_points is a cache
-- of SUM(rewards_ledger.points); rewards_reconciliation flags any drift.
create table if not exists public.rewards_accounts (
  user_id                uuid primary key,
  balance_points         integer not null default 0 check (balance_points >= 0),
  lifetime_earned_points integer not null default 0 check (lifetime_earned_points >= 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ── 3. Append-only ledger ────────────────────────────────────────────────────
create table if not exists public.rewards_ledger (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  entry_type         text not null check (entry_type in (
                       'signup_bonus', 'daily_claim', 'streak_bonus', 'purchase_reward',
                       'referral_reward', 'redemption', 'redemption_refund',
                       'reversal', 'adjustment', 'expiry')),
  points             integer not null check (points <> 0),   -- credit +, debit -
  source             text not null,
  reference_type     text,
  reference_id       text,
  config_version_id  uuid references public.rewards_config_versions (id),
  naira_value        numeric(14, 2),                         -- snapshot at posting time
  idempotency_key    text not null,
  reason             text,
  created_by         uuid,                                   -- admin for adjustments
  created_at         timestamptz not null default now(),
  constraint rewards_ledger_idempotency_key_unique unique (idempotency_key)
);

create index if not exists idx_rewards_ledger_user_created
  on public.rewards_ledger (user_id, created_at desc);
create index if not exists idx_rewards_ledger_reference
  on public.rewards_ledger (reference_type, reference_id);

create or replace function public.rewards_append_only_guard()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; post a compensating entry instead', tg_table_name;
end;
$$;

drop trigger if exists trg_rewards_ledger_append_only on public.rewards_ledger;
create trigger trg_rewards_ledger_append_only
  before update or delete on public.rewards_ledger
  for each row execute function public.rewards_append_only_guard();

-- ── 4. Admin audit ───────────────────────────────────────────────────────────
create table if not exists public.rewards_admin_audit (
  id                 uuid primary key default gen_random_uuid(),
  actor_id           uuid,
  actor_email        text,
  action             text not null,
  config_version_id  uuid references public.rewards_config_versions (id) on delete set null,
  before_state       jsonb,
  after_state        jsonb,
  reason             text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_rewards_admin_audit_created
  on public.rewards_admin_audit (created_at desc);

-- A draft may be deleted, which nulls the FK via ON DELETE SET NULL (an UPDATE),
-- so audit rows are only protected against deletion and manual edits of content.
create or replace function public.rewards_audit_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'rewards_admin_audit is append-only';
  end if;
  if new.id is distinct from old.id
     or new.actor_id is distinct from old.actor_id
     or new.actor_email is distinct from old.actor_email
     or new.action is distinct from old.action
     or new.before_state is distinct from old.before_state
     or new.after_state is distinct from old.after_state
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    raise exception 'rewards_admin_audit is append-only';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rewards_audit_guard on public.rewards_admin_audit;
create trigger trg_rewards_audit_guard
  before update or delete on public.rewards_admin_audit
  for each row execute function public.rewards_audit_guard();

-- ── 5. Posting RPCs (service_role only) ──────────────────────────────────────
create or replace function public.rewards_ensure_wallet(p_user_id uuid)
returns public.rewards_accounts
language plpgsql security definer set search_path = public as $$
declare
  v_row public.rewards_accounts;
begin
  insert into public.rewards_accounts (user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  select * into v_row from public.rewards_accounts where user_id = p_user_id;
  return v_row;
end;
$$;

-- The only way to move points. Idempotent on idempotency_key: a replay returns
-- the original entry and changes nothing. The account row is locked so
-- concurrent postings serialise and a debit can never take the balance below 0.
create or replace function public.rewards_post_ledger(
  p_user_id           uuid,
  p_points            integer,
  p_entry_type        text,
  p_source            text,
  p_idempotency_key   text,
  p_reference_type    text default null,
  p_reference_id      text default null,
  p_config_version_id uuid default null,
  p_naira_value       numeric default null,
  p_reason            text default null,
  p_created_by        uuid default null
)
returns public.rewards_ledger
language plpgsql security definer set search_path = public as $$
declare
  v_existing public.rewards_ledger;
  v_balance  integer;
  v_row      public.rewards_ledger;
begin
  if p_points is null or p_points = 0 then
    raise exception 'points must be non-zero';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  select * into v_existing from public.rewards_ledger where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  insert into public.rewards_accounts (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select balance_points into v_balance
  from public.rewards_accounts where user_id = p_user_id for update;

  -- Another transaction may have posted the same key while we waited for the lock.
  select * into v_existing from public.rewards_ledger where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  if v_balance + p_points < 0 then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  insert into public.rewards_ledger (
    user_id, entry_type, points, source, reference_type, reference_id,
    config_version_id, naira_value, idempotency_key, reason, created_by
  ) values (
    p_user_id, p_entry_type, p_points, p_source, p_reference_type, p_reference_id,
    p_config_version_id, p_naira_value, p_idempotency_key, p_reason, p_created_by
  ) returning * into v_row;

  update public.rewards_accounts
  set balance_points = balance_points + p_points,
      lifetime_earned_points = lifetime_earned_points + greatest(p_points, 0),
      updated_at = now()
  where user_id = p_user_id;

  return v_row;
end;
$$;

-- ── 6. Reconciliation view ───────────────────────────────────────────────────
create or replace view public.rewards_reconciliation
with (security_invoker = true) as
select
  a.user_id,
  a.balance_points                        as cached_balance,
  coalesce(sum(l.points), 0)::integer     as ledger_balance,
  a.balance_points - coalesce(sum(l.points), 0)::integer as drift
from public.rewards_accounts a
left join public.rewards_ledger l on l.user_id = a.user_id
group by a.user_id, a.balance_points
having a.balance_points <> coalesce(sum(l.points), 0);

-- ── 7. Lock down ─────────────────────────────────────────────────────────────
alter table public.rewards_config_versions enable row level security;
alter table public.rewards_accounts        enable row level security;
alter table public.rewards_ledger          enable row level security;
alter table public.rewards_admin_audit     enable row level security;

drop policy if exists "service role full access rewards_config_versions" on public.rewards_config_versions;
create policy "service role full access rewards_config_versions"
  on public.rewards_config_versions for all to service_role using (true) with check (true);
drop policy if exists "service role full access rewards_accounts" on public.rewards_accounts;
create policy "service role full access rewards_accounts"
  on public.rewards_accounts for all to service_role using (true) with check (true);
drop policy if exists "service role full access rewards_ledger" on public.rewards_ledger;
create policy "service role full access rewards_ledger"
  on public.rewards_ledger for all to service_role using (true) with check (true);
drop policy if exists "service role full access rewards_admin_audit" on public.rewards_admin_audit;
create policy "service role full access rewards_admin_audit"
  on public.rewards_admin_audit for all to service_role using (true) with check (true);

revoke all on function public.rewards_active_config(timestamptz)  from public, anon, authenticated;
revoke all on function public.rewards_ensure_wallet(uuid)          from public, anon, authenticated;
revoke all on function public.rewards_post_ledger(uuid, integer, text, text, text, text, text, uuid, numeric, text, uuid)
  from public, anon, authenticated;
revoke all on public.rewards_reconciliation from public, anon, authenticated;
grant execute on function public.rewards_active_config(timestamptz)  to service_role;
grant execute on function public.rewards_ensure_wallet(uuid)          to service_role;
grant execute on function public.rewards_post_ledger(uuid, integer, text, text, text, text, text, uuid, numeric, text, uuid)
  to service_role;
grant select on public.rewards_reconciliation to service_role;

-- ── 8. Initialise wallets for every existing storefront customer ─────────────
-- Same exclusions as get_storefront_customers(): staff and vendor accounts do
-- not get a wallet. Idempotent. New customers get theirs lazily on first
-- wallet read, so no trigger on customers/auth.users is needed.
insert into public.rewards_accounts (user_id)
select c.id
from public.customers c
where c.id not in (select u.id from public.users u)
  and c.id not in (select v.user_id from public.vendors v where v.user_id is not null)
on conflict (user_id) do nothing;

-- ── 9. Seed version 1 — programme DISABLED ───────────────────────────────────
-- Provisional launch values from PRD v1.1 §2. They are data, editable and
-- supersedable from JLO admin, and nothing is active until an admin enables it.
insert into public.rewards_config_versions (status, effective_from, published_at, note, policy)
select 'published', now(), now(),
  'Seed from PRD v1.1 (provisional values, programme disabled)',
  jsonb_build_object(
    'schema_version', 1,
    'programme', jsonb_build_object(
      'enabled', false, 'name', 'JulinePoints', 'launch_at', null,
      'timezone', 'Africa/Lagos', 'points_to_ngn', 5),
    'signup', jsonb_build_object('enabled', true, 'points', 100, 'require_verified_email', true),
    'daily_claim', jsonb_build_object('enabled', true, 'points', 5),
    'streak', jsonb_build_object(
      'enabled', true, 'length_days', 7, 'bonus_points', 5,
      'reset_policy', 'reset', 'grace_days', 0),
    'purchase', jsonb_build_object(
      'enabled', true, 'rate_percent', 0.5, 'rounding', 'floor',
      'max_points_per_order', null, 'hold_days', 7, 'include_points_funded_value', false),
    'referral', jsonb_build_object(
      'enabled', true, 'window_days', 30, 'hold_days', 7,
      'tiers', jsonb_build_array(
        jsonb_build_object('min_ngn', 1000,  'max_ngn', 21000, 'points', 20),
        jsonb_build_object('min_ngn', 21000, 'max_ngn', 51000, 'points', 40),
        jsonb_build_object('min_ngn', 51000, 'max_ngn', null,  'points', 100))),
    'redemption', jsonb_build_object(
      'enabled', true, 'cap_percent', 10, 'min_points', 1,
      'max_points_per_order', null, 'partial_allowed', true),
    'expiry', jsonb_build_object('enabled', false, 'days', 365, 'warn_days', 30),
    'adjustments', jsonb_build_object('dual_approval_threshold_points', 500)
  )
where not exists (select 1 from public.rewards_config_versions);
