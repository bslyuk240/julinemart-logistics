-- JulinePoints Rewards — Phase C: earning
-- Sign-up bonus, manual daily claim + streak, purchase rewards, referral
-- attribution and first-order tier awards, vesting sweep, referral review.
--
-- Every amount, rate, window and switch is read from the ACTIVE
-- rewards_config_versions policy at call time (or from the version stamped on
-- an award when it was earned). Nothing commercial is hard-coded here. The
-- invariants (one signup bonus per account, one claim per account per
-- programme-local day, one referral award per referee, one reward per order)
-- are unique constraints, so config cannot bypass them.
--
-- All functions are SECURITY DEFINER and executable by service_role only.

-- ── 0. Links ─────────────────────────────────────────────────────────────────
-- Orders were keyed only by email. customer_id is set by create-order from the
-- verified JWT; guest orders stay NULL and never earn rewards.
alter table public.orders add column if not exists customer_id uuid;
create index if not exists idx_orders_customer_id
  on public.orders (customer_id) where customer_id is not null;

alter table public.rewards_accounts add column if not exists referral_code text;
create unique index if not exists rewards_accounts_referral_code_key
  on public.rewards_accounts (referral_code) where referral_code is not null;

-- ── 1. Tables ────────────────────────────────────────────────────────────────
create table if not exists public.rewards_signup_claims (
  user_id            uuid primary key,                 -- uniqueness = once per account
  config_version_id  uuid references public.rewards_config_versions (id),
  ledger_id          uuid references public.rewards_ledger (id),
  claimed_at         timestamptz not null default now()
);

create table if not exists public.rewards_daily_claims (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  claim_date          date not null,                   -- programme-local calendar date
  streak_count        integer not null,
  points_awarded      integer not null default 0,
  streak_bonus_points integer not null default 0,
  config_version_id   uuid references public.rewards_config_versions (id),
  created_at          timestamptz not null default now(),
  constraint rewards_daily_claims_one_per_day unique (user_id, claim_date)
);

create table if not exists public.rewards_referrals (
  id            uuid primary key default gen_random_uuid(),
  referrer_id   uuid not null,
  referee_id    uuid not null,
  code          text not null,
  attributed_at timestamptz not null default now(),
  constraint rewards_referrals_one_per_referee unique (referee_id),
  constraint rewards_referrals_no_self check (referrer_id <> referee_id)
);

create table if not exists public.rewards_referral_attempts (
  id          uuid primary key default gen_random_uuid(),
  referee_id  uuid not null,
  code        text,
  outcome     text not null,                           -- 'attributed' | 'rejected'
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_rewards_referral_attempts_referee
  on public.rewards_referral_attempts (referee_id, created_at desc);

create table if not exists public.rewards_referral_awards (
  id                 uuid primary key default gen_random_uuid(),
  referral_id        uuid not null references public.rewards_referrals (id),
  referrer_id        uuid not null,
  referee_id         uuid not null,
  order_id           uuid not null,
  qualifying_amount  numeric(14, 2) not null,
  tier_min_ngn       numeric(14, 2) not null,          -- tier snapshot
  points             integer not null check (points >= 0),
  status             text not null default 'pending'
                       check (status in ('pending', 'in_review', 'available', 'void')),
  void_reason        text,
  signals            jsonb not null default '[]'::jsonb,
  config_version_id  uuid not null references public.rewards_config_versions (id),
  ledger_id          uuid references public.rewards_ledger (id),
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  vested_at          timestamptz,
  constraint rewards_referral_awards_one_per_referee unique (referee_id),
  constraint rewards_referral_awards_one_per_order unique (order_id)
);
create index if not exists idx_rewards_referral_awards_status
  on public.rewards_referral_awards (status);
create index if not exists idx_rewards_referral_awards_referrer
  on public.rewards_referral_awards (referrer_id);

create table if not exists public.rewards_purchase_awards (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null,
  user_id            uuid not null,
  eligible_amount    numeric(14, 2) not null,
  points             integer not null check (points > 0),
  status             text not null default 'pending'
                       check (status in ('pending', 'available', 'void')),
  void_reason        text,
  config_version_id  uuid not null references public.rewards_config_versions (id),
  ledger_id          uuid references public.rewards_ledger (id),
  created_at         timestamptz not null default now(),
  vested_at          timestamptz,
  constraint rewards_purchase_awards_one_per_order unique (order_id)
);
create index if not exists idx_rewards_purchase_awards_status
  on public.rewards_purchase_awards (status);
create index if not exists idx_rewards_purchase_awards_user
  on public.rewards_purchase_awards (user_id);

-- Referral attribution is immutable once locked.
create or replace function public.rewards_referral_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'rewards_referrals rows are immutable once locked';
  end if;
  if new.referrer_id is distinct from old.referrer_id
     or new.referee_id is distinct from old.referee_id
     or new.code is distinct from old.code
     or new.attributed_at is distinct from old.attributed_at then
    raise exception 'rewards_referrals rows are immutable once locked';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rewards_referral_guard on public.rewards_referrals;
create trigger trg_rewards_referral_guard
  before update or delete on public.rewards_referrals
  for each row execute function public.rewards_referral_guard();

-- ── 2. Helpers ───────────────────────────────────────────────────────────────
create or replace function public.rewards_is_storefront_customer(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.customers c where c.id = p_user)
     and not exists (select 1 from public.users u where u.id = p_user)
     and not exists (select 1 from public.vendors v where v.user_id = p_user);
$$;

-- Active config row if the programme is enabled, else NULL.
create or replace function public.rewards_enabled_config()
returns public.rewards_config_versions
language plpgsql stable security definer set search_path = public as $$
declare
  v public.rewards_config_versions;
begin
  v := public.rewards_active_config();
  if v.id is null or coalesce((v.policy->'programme'->>'enabled')::boolean, false) = false then
    return null;
  end if;
  return v;
end;
$$;

create or replace function public.rewards_get_referral_code(p_user uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_try  integer := 0;
begin
  perform public.rewards_ensure_wallet(p_user);
  select referral_code into v_code from public.rewards_accounts where user_id = p_user;
  if v_code is not null then
    return v_code;
  end if;
  loop
    v_try := v_try + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      update public.rewards_accounts set referral_code = v_code
      where user_id = p_user and referral_code is null;
      select referral_code into v_code from public.rewards_accounts where user_id = p_user;
      return v_code;
    exception when unique_violation then
      if v_try >= 8 then raise; end if;
    end;
  end loop;
end;
$$;

-- ── 3. Sign-up bonus ─────────────────────────────────────────────────────────
create or replace function public.rewards_claim_signup(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v      public.rewards_config_versions;
  pol    jsonb;
  au     record;
  launch timestamptz;
  pts    integer;
  rate   numeric;
  l      public.rewards_ledger;
begin
  v := public.rewards_enabled_config();
  if v.id is null then return jsonb_build_object('awarded', false, 'reason', 'programme_disabled'); end if;
  pol := v.policy;
  if not coalesce((pol->'signup'->>'enabled')::boolean, false) then
    return jsonb_build_object('awarded', false, 'reason', 'signup_disabled');
  end if;
  if not public.rewards_is_storefront_customer(p_user) then
    return jsonb_build_object('awarded', false, 'reason', 'not_eligible');
  end if;
  if exists (select 1 from public.rewards_signup_claims where user_id = p_user) then
    return jsonb_build_object('awarded', false, 'reason', 'already_claimed');
  end if;

  select id, created_at, email_confirmed_at into au from auth.users where id = p_user;
  if not found then return jsonb_build_object('awarded', false, 'reason', 'not_found'); end if;

  launch := (pol->'programme'->>'launch_at')::timestamptz;
  if launch is null or au.created_at < launch then
    return jsonb_build_object('awarded', false, 'reason', 'registered_before_launch');
  end if;
  if coalesce((pol->'signup'->>'require_verified_email')::boolean, true) and au.email_confirmed_at is null then
    return jsonb_build_object('awarded', false, 'reason', 'email_not_verified');
  end if;

  pts  := coalesce((pol->'signup'->>'points')::integer, 0);
  rate := (pol->'programme'->>'points_to_ngn')::numeric;

  insert into public.rewards_signup_claims (user_id, config_version_id)
  values (p_user, v.id) on conflict (user_id) do nothing;
  if not found then
    return jsonb_build_object('awarded', false, 'reason', 'already_claimed');
  end if;

  if pts > 0 then
    l := public.rewards_post_ledger(
      p_user, pts, 'signup_bonus', 'signup', 'signup:' || p_user::text,
      'user', p_user::text, v.id, pts * rate, null, null);
    update public.rewards_signup_claims set ledger_id = l.id where user_id = p_user;
  end if;
  return jsonb_build_object('awarded', true, 'points', pts);
end;
$$;

-- ── 4. Daily claim + streak ──────────────────────────────────────────────────
create or replace function public.rewards_claim_daily(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v       public.rewards_config_versions;
  pol     jsonb;
  tz      text;
  today   date;
  prev    record;
  cur     record;
  streak  integer;
  pts     integer;
  bonus   integer := 0;
  rate    numeric;
  bal     integer;
  bal_before integer;
  next_at timestamptz;
begin
  v := public.rewards_enabled_config();
  if v.id is null then raise exception 'rewards_disabled' using errcode = 'P0001'; end if;
  pol := v.policy;
  if not coalesce((pol->'daily_claim'->>'enabled')::boolean, false) then
    raise exception 'daily_claim_disabled' using errcode = 'P0001';
  end if;
  if not public.rewards_is_storefront_customer(p_user) then
    raise exception 'not_eligible' using errcode = 'P0001';
  end if;

  tz    := pol->'programme'->>'timezone';
  rate  := (pol->'programme'->>'points_to_ngn')::numeric;
  today := (now() at time zone tz)::date;
  next_at := ((today + 1)::timestamp at time zone tz);

  perform public.rewards_ensure_wallet(p_user);
  -- Serialise concurrent claims for this account (two devices, double taps).
  select balance_points into bal_before
  from public.rewards_accounts where user_id = p_user for update;

  select * into cur from public.rewards_daily_claims
  where user_id = p_user and claim_date = today;
  if found then
    return jsonb_build_object(
      'already_claimed', true, 'claim_date', today, 'streak', cur.streak_count,
      'points', cur.points_awarded, 'streak_bonus_points', cur.streak_bonus_points,
      'balance', bal_before, 'next_claim_at', next_at);
  end if;

  select claim_date, streak_count into prev from public.rewards_daily_claims
  where user_id = p_user order by claim_date desc limit 1;

  if not found then
    streak := 1;
  elsif prev.claim_date = today - 1 then
    streak := prev.streak_count + 1;
  elsif (pol->'streak'->>'reset_policy') = 'grace'
        and (today - prev.claim_date) <= 1 + coalesce((pol->'streak'->>'grace_days')::integer, 0) then
    streak := prev.streak_count + 1;
  else
    streak := 1;
  end if;

  pts := coalesce((pol->'daily_claim'->>'points')::integer, 0);
  if coalesce((pol->'streak'->>'enabled')::boolean, false)
     and streak % greatest((pol->'streak'->>'length_days')::integer, 1) = 0 then
    bonus := coalesce((pol->'streak'->>'bonus_points')::integer, 0);
  end if;

  insert into public.rewards_daily_claims
    (user_id, claim_date, streak_count, points_awarded, streak_bonus_points, config_version_id)
  values (p_user, today, streak, pts, bonus, v.id);

  if pts > 0 then
    perform public.rewards_post_ledger(
      p_user, pts, 'daily_claim', 'daily_claim', 'daily:' || p_user::text || ':' || today::text,
      'daily_claim', today::text, v.id, pts * rate, null, null);
  end if;
  if bonus > 0 then
    perform public.rewards_post_ledger(
      p_user, bonus, 'streak_bonus', 'streak', 'streak:' || p_user::text || ':' || today::text,
      'daily_claim', today::text, v.id, bonus * rate, null, null);
  end if;

  select balance_points into bal from public.rewards_accounts where user_id = p_user;
  return jsonb_build_object(
    'already_claimed', false, 'claim_date', today, 'streak', streak,
    'points', pts, 'streak_bonus_points', bonus,
    'balance_before', bal_before, 'balance', bal, 'next_claim_at', next_at);
end;
$$;

-- ── 5. Referral attribution ──────────────────────────────────────────────────
create or replace function public.rewards_register_referral(p_referee uuid, p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v        public.rewards_config_versions;
  pol      jsonb;
  code     text := upper(btrim(coalesce(p_code, '')));
  au       record;
  referrer uuid;
  reason   text;
begin
  v := public.rewards_enabled_config();
  if v.id is null then return jsonb_build_object('ok', false, 'reason', 'programme_disabled'); end if;
  pol := v.policy;

  if not coalesce((pol->'referral'->>'enabled')::boolean, false) then
    reason := 'referrals_disabled';
  elsif code = '' then
    reason := 'missing_code';
  elsif not public.rewards_is_storefront_customer(p_referee) then
    reason := 'not_eligible';
  end if;

  if reason is null then
    select id, email, created_at into au from auth.users where id = p_referee;
    select user_id into referrer from public.rewards_accounts where referral_code = code;
    if not found then
      reason := 'unknown_code';
    elsif referrer = p_referee then
      reason := 'self_referral';
    elsif exists (select 1 from public.rewards_referrals where referee_id = p_referee) then
      reason := 'already_referred';
    elsif au.created_at < now() - ((pol->'referral'->>'window_days')::integer * interval '1 day') then
      reason := 'outside_attribution_window';
    elsif exists (
      select 1 from public.orders o
      where o.payment_status = 'paid'
        and (o.customer_id = p_referee or lower(o.customer_email) = lower(au.email))
    ) then
      reason := 'existing_customer';
    end if;
  end if;

  if reason is not null then
    insert into public.rewards_referral_attempts (referee_id, code, outcome, reason)
    values (p_referee, nullif(code, ''), 'rejected', reason);
    return jsonb_build_object('ok', false, 'reason', reason);
  end if;

  insert into public.rewards_referrals (referrer_id, referee_id, code)
  values (referrer, p_referee, code)
  on conflict (referee_id) do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_referred');
  end if;

  insert into public.rewards_referral_attempts (referee_id, code, outcome)
  values (p_referee, code, 'attributed');
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 6. Order paid: record pending purchase + referral awards ─────────────────
-- Called from the single pending->paid transition in verify-payment and
-- paystack-webhook. Idempotent (unique order_id / referee_id). Points are NOT
-- credited here: awards wait as 'pending' until the vesting sweep confirms
-- delivery and the configured return/refund hold.
create or replace function public.rewards_on_order_paid(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v         public.rewards_config_versions;
  pol       jsonb;
  o         record;
  eligible  numeric;
  rate      numeric;
  raw_pts   numeric;
  pts       integer;
  cap       integer;
  ref       record;
  tier      record;
  sigs      jsonb := '[]'::jsonb;
  result    jsonb := '{}'::jsonb;
  referrer_phone text;
begin
  select id, customer_id, subtotal, discount_amount, customer_phone, delivery_address,
         delivery_city, payment_status
    into o from public.orders where id = p_order_id;
  if not found or o.customer_id is null or o.payment_status <> 'paid' then
    return jsonb_build_object('skipped', 'no_eligible_customer');
  end if;
  v := public.rewards_enabled_config();
  if v.id is null then return jsonb_build_object('skipped', 'programme_disabled'); end if;
  if not public.rewards_is_storefront_customer(o.customer_id) then
    return jsonb_build_object('skipped', 'not_storefront_customer');
  end if;
  pol  := v.policy;
  rate := (pol->'programme'->>'points_to_ngn')::numeric;

  -- Eligible merchandise: after product/campaign discounts, excluding shipping.
  -- (Points-funded value is excluded once checkout redemption exists in Phase D.)
  eligible := greatest(coalesce(o.subtotal, 0) - coalesce(o.discount_amount, 0), 0);

  -- Purchase reward
  if coalesce((pol->'purchase'->>'enabled')::boolean, false) and eligible > 0 then
    raw_pts := eligible * (pol->'purchase'->>'rate_percent')::numeric / 100 / rate;
    pts := case pol->'purchase'->>'rounding'
             when 'ceil'  then ceil(raw_pts)
             when 'round' then round(raw_pts)
             else floor(raw_pts) end;
    cap := (pol->'purchase'->>'max_points_per_order')::integer;
    if cap is not null and pts > cap then pts := cap; end if;
    if pts > 0 then
      insert into public.rewards_purchase_awards
        (order_id, user_id, eligible_amount, points, config_version_id)
      values (p_order_id, o.customer_id, eligible, pts, v.id)
      on conflict (order_id) do nothing;
      result := result || jsonb_build_object('purchase_points', pts);
    end if;
  end if;

  -- Referral reward: the referee's first qualifying order only.
  if coalesce((pol->'referral'->>'enabled')::boolean, false) then
    select id, referrer_id into ref from public.rewards_referrals where referee_id = o.customer_id;
    if found and not exists (select 1 from public.rewards_referral_awards where referee_id = o.customer_id) then
      select (t->>'min_ngn')::numeric as min_ngn, (t->>'points')::integer as points
        into tier
      from jsonb_array_elements(pol->'referral'->'tiers') t
      where eligible >= (t->>'min_ngn')::numeric
        and ((t->>'max_ngn') is null or eligible < (t->>'max_ngn')::numeric)
      limit 1;
      if found then
        -- Abuse signals -> manual review, never automatic accusation.
        select regexp_replace(coalesce(phone, ''), '\D', '', 'g') into referrer_phone
          from public.customers where id = ref.referrer_id;
        if length(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')) >= 7 and (
             regexp_replace(o.customer_phone, '\D', '', 'g') = referrer_phone
             or exists (
               select 1 from public.orders r
               where r.customer_id = ref.referrer_id
                 and regexp_replace(coalesce(r.customer_phone, ''), '\D', '', 'g')
                     = regexp_replace(o.customer_phone, '\D', '', 'g'))) then
          sigs := sigs || to_jsonb('same_phone_as_referrer'::text);
        end if;
        if length(btrim(coalesce(o.delivery_address, ''))) >= 6 and exists (
             select 1 from public.orders r
             where r.customer_id = ref.referrer_id
               and lower(btrim(r.delivery_address)) = lower(btrim(o.delivery_address))
               and lower(btrim(coalesce(r.delivery_city, ''))) = lower(btrim(coalesce(o.delivery_city, '')))) then
          sigs := sigs || to_jsonb('same_address_as_referrer'::text);
        end if;

        insert into public.rewards_referral_awards
          (referral_id, referrer_id, referee_id, order_id, qualifying_amount,
           tier_min_ngn, points, status, signals, config_version_id)
        values (ref.id, ref.referrer_id, o.customer_id, p_order_id, eligible,
                tier.min_ngn, tier.points,
                case when jsonb_array_length(sigs) > 0 then 'in_review' else 'pending' end,
                sigs, v.id)
        on conflict do nothing;
        result := result || jsonb_build_object('referral_points', tier.points, 'referral_signals', sigs);
      end if;
    end if;
  end if;

  return result;
end;
$$;

-- ── 7. Vesting sweep ─────────────────────────────────────────────────────────
-- Moves pending awards to the ledger once every sub-order is delivered and the
-- hold stored on the version the award was earned under has elapsed. Voids them
-- if the order was cancelled/refunded first. Safe to run repeatedly.
create or replace function public.rewards_vest_pending(p_limit integer default 500)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        record;
  o        record;
  pol      jsonb;
  rate     numeric;
  hold     integer;
  last_del timestamptz;
  l        public.rewards_ledger;
  vested   integer := 0;
  voided   integer := 0;
begin
  -- purchase awards
  for a in
    select * from public.rewards_purchase_awards
    where status = 'pending' order by created_at limit p_limit for update skip locked
  loop
    select overall_status, payment_status, updated_at into o from public.orders where id = a.order_id;
    if not found or o.overall_status in ('cancelled', 'refunded') or o.payment_status in ('refunded', 'failed') then
      update public.rewards_purchase_awards set status = 'void', void_reason = 'order_cancelled_or_refunded'
        where id = a.id;
      voided := voided + 1;
      continue;
    end if;
    select policy into pol from public.rewards_config_versions where id = a.config_version_id;
    hold := coalesce((pol->'purchase'->>'hold_days')::integer, 0);
    rate := (pol->'programme'->>'points_to_ngn')::numeric;
    if exists (select 1 from public.sub_orders s where s.main_order_id = a.order_id and s.status <> 'delivered')
       or not exists (select 1 from public.sub_orders s where s.main_order_id = a.order_id) then
      continue;
    end if;
    select coalesce(max(delivered_at), o.updated_at) into last_del
      from public.sub_orders where main_order_id = a.order_id;
    if last_del + hold * interval '1 day' > now() then continue; end if;

    l := public.rewards_post_ledger(
      a.user_id, a.points, 'purchase_reward', 'purchase', 'purchase:' || a.order_id::text,
      'order', a.order_id::text, a.config_version_id, a.points * rate, null, null);
    update public.rewards_purchase_awards
      set status = 'available', ledger_id = l.id, vested_at = now() where id = a.id;
    vested := vested + 1;
  end loop;

  -- referral awards (in_review ones wait for an admin decision)
  for a in
    select * from public.rewards_referral_awards
    where status = 'pending' order by created_at limit p_limit for update skip locked
  loop
    select overall_status, payment_status, updated_at into o from public.orders where id = a.order_id;
    if not found or o.overall_status in ('cancelled', 'refunded') or o.payment_status in ('refunded', 'failed') then
      update public.rewards_referral_awards set status = 'void', void_reason = 'order_cancelled_or_refunded'
        where id = a.id;
      voided := voided + 1;
      continue;
    end if;
    select policy into pol from public.rewards_config_versions where id = a.config_version_id;
    hold := coalesce((pol->'referral'->>'hold_days')::integer, 0);
    rate := (pol->'programme'->>'points_to_ngn')::numeric;
    if exists (select 1 from public.sub_orders s where s.main_order_id = a.order_id and s.status <> 'delivered')
       or not exists (select 1 from public.sub_orders s where s.main_order_id = a.order_id) then
      continue;
    end if;
    select coalesce(max(delivered_at), o.updated_at) into last_del
      from public.sub_orders where main_order_id = a.order_id;
    if last_del + hold * interval '1 day' > now() then continue; end if;

    if a.points > 0 then
      l := public.rewards_post_ledger(
        a.referrer_id, a.points, 'referral_reward', 'referral', 'referral:' || a.referee_id::text,
        'order', a.order_id::text, a.config_version_id, a.points * rate, null, null);
      update public.rewards_referral_awards
        set status = 'available', ledger_id = l.id, vested_at = now() where id = a.id;
    else
      update public.rewards_referral_awards set status = 'available', vested_at = now() where id = a.id;
    end if;
    vested := vested + 1;
  end loop;

  return jsonb_build_object('vested', vested, 'voided', voided);
end;
$$;

-- ── 8. Admin review of flagged referral awards ───────────────────────────────
create or replace function public.rewards_review_referral_award(
  p_award_id uuid, p_decision text, p_reviewer uuid, p_reason text default null)
returns public.rewards_referral_awards
language plpgsql security definer set search_path = public as $$
declare
  r public.rewards_referral_awards;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;
  update public.rewards_referral_awards
     set status = case when p_decision = 'approve' then 'pending' else 'void' end,
         void_reason = case when p_decision = 'reject' then coalesce(p_reason, 'rejected_in_review') else null end,
         reviewed_by = p_reviewer, reviewed_at = now()
   where id = p_award_id and status = 'in_review'
   returning * into r;
  if not found then raise exception 'award not found or not awaiting review'; end if;
  return r;
end;
$$;

-- ── 9. Lock down ─────────────────────────────────────────────────────────────
alter table public.rewards_signup_claims     enable row level security;
alter table public.rewards_daily_claims      enable row level security;
alter table public.rewards_referrals         enable row level security;
alter table public.rewards_referral_attempts enable row level security;
alter table public.rewards_referral_awards   enable row level security;
alter table public.rewards_purchase_awards   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'rewards_signup_claims', 'rewards_daily_claims', 'rewards_referrals',
    'rewards_referral_attempts', 'rewards_referral_awards', 'rewards_purchase_awards']
  loop
    execute format('drop policy if exists "service role full access %1$s" on public.%1$s', t);
    execute format(
      'create policy "service role full access %1$s" on public.%1$s for all to service_role using (true) with check (true)', t);
  end loop;
end
$$;

revoke all on function public.rewards_is_storefront_customer(uuid)     from public, anon, authenticated;
revoke all on function public.rewards_enabled_config()                 from public, anon, authenticated;
revoke all on function public.rewards_get_referral_code(uuid)          from public, anon, authenticated;
revoke all on function public.rewards_claim_signup(uuid)               from public, anon, authenticated;
revoke all on function public.rewards_claim_daily(uuid)                from public, anon, authenticated;
revoke all on function public.rewards_register_referral(uuid, text)    from public, anon, authenticated;
revoke all on function public.rewards_on_order_paid(uuid)              from public, anon, authenticated;
revoke all on function public.rewards_vest_pending(integer)            from public, anon, authenticated;
revoke all on function public.rewards_review_referral_award(uuid, text, uuid, text) from public, anon, authenticated;

grant execute on function public.rewards_is_storefront_customer(uuid)  to service_role;
grant execute on function public.rewards_enabled_config()              to service_role;
grant execute on function public.rewards_get_referral_code(uuid)       to service_role;
grant execute on function public.rewards_claim_signup(uuid)            to service_role;
grant execute on function public.rewards_claim_daily(uuid)             to service_role;
grant execute on function public.rewards_register_referral(uuid, text) to service_role;
grant execute on function public.rewards_on_order_paid(uuid)           to service_role;
grant execute on function public.rewards_vest_pending(integer)         to service_role;
grant execute on function public.rewards_review_referral_award(uuid, text, uuid, text) to service_role;
