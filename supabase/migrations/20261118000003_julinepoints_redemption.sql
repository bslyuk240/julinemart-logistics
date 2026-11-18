-- JulinePoints Rewards — Phase D: checkout redemption
-- Reservations, commit-on-paid, release on abandon/expiry, restore on
-- cancel/full refund, and the server-side redemption quote.
--
-- Principles
--   * The database is the single source of truth for what can be redeemed:
--     rewards_quote_redemption() applies the ACTIVE config (cap %, minimum,
--     per-order max, partial use) and the caller cannot widen it.
--   * Points are RESERVED when the order is created and DEBITED from the ledger
--     only when payment is confirmed (rewards_commit_reservation), exactly once.
--   * Redeemed value lives on orders.points_discount; order_items.subtotal is
--     never touched, so vendor earnings views are unchanged (platform-funded).
--   * Nothing commercial is hard-coded: rate, cap, minimum, partial use and the
--     optional reservation window come from the active policy.

-- ── 1. Columns ───────────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists points_redeemed integer not null default 0 check (points_redeemed >= 0),
  add column if not exists points_discount numeric(12, 2) not null default 0 check (points_discount >= 0);

alter table public.rewards_accounts
  add column if not exists reserved_points integer not null default 0 check (reserved_points >= 0);

create table if not exists public.rewards_reservations (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null,
  user_id             uuid not null,
  points              integer not null check (points > 0),
  naira_value         numeric(14, 2) not null,
  config_version_id   uuid not null references public.rewards_config_versions (id),
  status              text not null default 'reserved'
                        check (status in ('reserved', 'committed', 'released', 'refunded')),
  expires_at          timestamptz not null,
  shortfall_points    integer not null default 0 check (shortfall_points >= 0),
  ledger_id           uuid references public.rewards_ledger (id),
  refund_ledger_id    uuid references public.rewards_ledger (id),
  release_reason      text,
  created_at          timestamptz not null default now(),
  committed_at        timestamptz,
  released_at         timestamptz,
  refunded_at         timestamptz,
  constraint rewards_reservations_one_per_order unique (order_id)
);
create index if not exists idx_rewards_reservations_status_expiry
  on public.rewards_reservations (status, expires_at);
create index if not exists idx_rewards_reservations_user
  on public.rewards_reservations (user_id);

alter table public.rewards_reservations enable row level security;
drop policy if exists "service role full access rewards_reservations" on public.rewards_reservations;
create policy "service role full access rewards_reservations"
  on public.rewards_reservations for all to service_role using (true) with check (true);

-- ── 2. Redemption quote (the only place redemption rules are evaluated) ──────
-- p_eligible  : eligible merchandise in NGN (subtotal after voucher/campaign
--               discounts, shipping excluded), computed by create-order.
-- p_requested : NULL = use the maximum allowed; 0 = preview only; N = N points.
create or replace function public.rewards_quote_redemption(
  p_user uuid, p_eligible numeric, p_requested integer default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v        public.rewards_config_versions;
  pol      jsonb;
  rate     numeric;
  bal      integer := 0;
  held     integer := 0;
  avail    integer;
  cap_pts  integer;
  max_pts  integer;
  min_pts  integer;
  max_order integer;
  req      integer;
  applied  integer;
begin
  v := public.rewards_enabled_config();
  if v.id is null then return jsonb_build_object('enabled', false, 'reason', 'programme_disabled'); end if;
  pol := v.policy;
  if not coalesce((pol->'redemption'->>'enabled')::boolean, false) then
    return jsonb_build_object('enabled', false, 'reason', 'redemption_disabled');
  end if;
  if not public.rewards_is_storefront_customer(p_user) then
    return jsonb_build_object('enabled', false, 'reason', 'not_eligible');
  end if;

  rate := (pol->'programme'->>'points_to_ngn')::numeric;
  select balance_points, reserved_points into bal, held
    from public.rewards_accounts where user_id = p_user;
  bal   := coalesce(bal, 0);
  held  := coalesce(held, 0);
  avail := greatest(bal - held, 0);

  cap_pts   := floor(greatest(coalesce(p_eligible, 0), 0) * (pol->'redemption'->>'cap_percent')::numeric / 100 / rate);
  max_order := (pol->'redemption'->>'max_points_per_order')::integer;
  if max_order is not null then cap_pts := least(cap_pts, max_order); end if;
  max_pts := greatest(least(cap_pts, avail), 0);
  min_pts := coalesce((pol->'redemption'->>'min_points')::integer, 1);

  if not coalesce((pol->'redemption'->>'partial_allowed')::boolean, true) and p_requested is distinct from 0 then
    req := max_pts;                       -- all-or-none: apply everything allowed
  else
    req := coalesce(p_requested, max_pts);
  end if;
  applied := least(greatest(req, 0), max_pts);
  if applied < min_pts then applied := 0; end if;

  return jsonb_build_object(
    'enabled', true,
    'config_version_id', v.id,
    'points_to_ngn', rate,
    'available_points', avail,
    'max_points', max_pts,
    'min_points', min_pts,
    'partial_allowed', coalesce((pol->'redemption'->>'partial_allowed')::boolean, true),
    'cap_percent', (pol->'redemption'->>'cap_percent')::numeric,
    'applied_points', applied,
    'naira_value', round(applied * rate, 2));
end;
$$;

-- ── 3. Reserve ───────────────────────────────────────────────────────────────
create or replace function public.rewards_reserve(
  p_user uuid, p_order_id uuid, p_points integer, p_eligible numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v       public.rewards_config_versions;
  q       jsonb;
  ttl     integer;
  exp     timestamptz;
  res_id  uuid;
begin
  if p_points is null or p_points <= 0 then raise exception 'points must be positive'; end if;

  perform public.rewards_ensure_wallet(p_user);
  -- Serialise with other checkouts, claims and commits for this account.
  perform 1 from public.rewards_accounts where user_id = p_user for update;

  q := public.rewards_quote_redemption(p_user, p_eligible, p_points);
  if not coalesce((q->>'enabled')::boolean, false) then
    raise exception 'redemption_unavailable' using errcode = 'P0001';
  end if;
  if (q->>'applied_points')::integer <> p_points then
    raise exception 'points_unavailable' using errcode = 'P0001';
  end if;

  v   := public.rewards_enabled_config();
  ttl := coalesce((v.policy->'redemption'->>'reservation_minutes')::integer, 60);
  exp := now() + ttl * interval '1 minute';

  insert into public.rewards_reservations
    (order_id, user_id, points, naira_value, config_version_id, expires_at)
  values (p_order_id, p_user, p_points, (q->>'naira_value')::numeric, v.id, exp)
  returning id into res_id;

  update public.rewards_accounts
     set reserved_points = reserved_points + p_points, updated_at = now()
   where user_id = p_user;

  return jsonb_build_object('reservation_id', res_id, 'expires_at', exp,
                            'points', p_points, 'naira_value', (q->>'naira_value')::numeric);
end;
$$;

-- ── 4. Commit (payment confirmed) ────────────────────────────────────────────
-- Idempotent. If the reservation lapsed before payment landed (customer left the
-- Paystack popup open), it takes whatever is still available instead of failing
-- a payment that already cleared, and records any shortfall for staff.
create or replace function public.rewards_commit_reservation(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r      public.rewards_reservations;
  uid    uuid;
  bal    integer;
  pts    integer;
  rate   numeric;
  l      public.rewards_ledger;
  short  integer := 0;
begin
  select user_id into uid from public.rewards_reservations where order_id = p_order_id;
  if not found then return jsonb_build_object('status', 'none'); end if;

  perform 1 from public.rewards_accounts where user_id = uid for update;
  select * into r from public.rewards_reservations where order_id = p_order_id for update;

  if r.status = 'committed' then
    return jsonb_build_object('status', 'committed', 'points', r.points - r.shortfall_points,
                              'shortfall_points', r.shortfall_points, 'idempotent', true);
  elsif r.status = 'refunded' then
    return jsonb_build_object('status', 'refunded');
  end if;

  rate := r.naira_value / r.points;

  if r.status = 'reserved' then
    pts := r.points;
    update public.rewards_accounts
       set reserved_points = greatest(reserved_points - r.points, 0) where user_id = r.user_id;
  else  -- released/expired before payment landed: take what is still there
    select balance_points into bal from public.rewards_accounts where user_id = r.user_id;
    pts   := least(r.points, greatest(bal, 0));
    short := r.points - pts;
  end if;

  if pts > 0 then
    l := public.rewards_post_ledger(
      r.user_id, -pts, 'redemption', 'checkout', 'redeem:' || p_order_id::text,
      'order', p_order_id::text, r.config_version_id, -(pts * rate), null, null);
  end if;

  update public.rewards_reservations
     set status = 'committed', committed_at = now(), shortfall_points = short,
         ledger_id = l.id, release_reason = null
   where id = r.id;

  return jsonb_build_object('status', 'committed', 'points', pts, 'shortfall_points', short);
end;
$$;

-- ── 5. Release (abandoned / expired / cancelled before payment) ──────────────
create or replace function public.rewards_release_reservation(p_order_id uuid, p_reason text default 'released')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r   public.rewards_reservations;
  uid uuid;
begin
  select user_id into uid from public.rewards_reservations where order_id = p_order_id;
  if not found then return jsonb_build_object('status', 'none'); end if;
  perform 1 from public.rewards_accounts where user_id = uid for update;
  select * into r from public.rewards_reservations where order_id = p_order_id for update;

  if r.status <> 'reserved' then return jsonb_build_object('status', r.status); end if;

  update public.rewards_accounts
     set reserved_points = greatest(reserved_points - r.points, 0), updated_at = now()
   where user_id = r.user_id;
  update public.rewards_reservations
     set status = 'released', released_at = now(), release_reason = p_reason where id = r.id;
  return jsonb_build_object('status', 'released', 'points', r.points);
end;
$$;

-- ── 6. Reverse on cancellation / full refund ─────────────────────────────────
-- Reserved -> released. Committed -> points restored once. Also voids pending
-- earn awards for the order. Partial refunds are NOT handled here (documented
-- open policy): callers only invoke this for a cancelled or fully refunded order.
create or replace function public.rewards_reverse_order(p_order_id uuid, p_reason text default 'order_reversed')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r        public.rewards_reservations;
  uid      uuid;
  restore  integer;
  rate     numeric;
  l        public.rewards_ledger;
  out_json jsonb := '{}'::jsonb;
begin
  update public.rewards_purchase_awards
     set status = 'void', void_reason = p_reason where order_id = p_order_id and status = 'pending';
  update public.rewards_referral_awards
     set status = 'void', void_reason = p_reason where order_id = p_order_id and status in ('pending', 'in_review');

  select user_id into uid from public.rewards_reservations where order_id = p_order_id;
  if not found then return out_json; end if;

  perform 1 from public.rewards_accounts where user_id = uid for update;
  select * into r from public.rewards_reservations where order_id = p_order_id for update;

  if r.status = 'reserved' then
    update public.rewards_accounts
       set reserved_points = greatest(reserved_points - r.points, 0), updated_at = now()
     where user_id = r.user_id;
    update public.rewards_reservations
       set status = 'released', released_at = now(), release_reason = p_reason where id = r.id;
    return jsonb_build_object('reservation', 'released', 'points', r.points);
  elsif r.status = 'committed' then
    restore := r.points - r.shortfall_points;
    rate    := r.naira_value / r.points;
    if restore > 0 then
      l := public.rewards_post_ledger(
        r.user_id, restore, 'redemption_refund', 'order_reversal', 'redeem-refund:' || p_order_id::text,
        'order', p_order_id::text, r.config_version_id, restore * rate, p_reason, null);
    end if;
    update public.rewards_reservations
       set status = 'refunded', refunded_at = now(), refund_ledger_id = l.id where id = r.id;
    return jsonb_build_object('reservation', 'refunded', 'points', restore);
  end if;
  return jsonb_build_object('reservation', r.status);
end;
$$;

-- ── 7. Expiry sweep ──────────────────────────────────────────────────────────
-- Lapsed holds on unpaid orders are released; if the order turns out to be paid
-- (missed hook) the hold is committed instead. Safe to run repeatedly.
create or replace function public.rewards_expire_reservations(p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        record;
  o        record;
  released integer := 0;
  committed integer := 0;
begin
  for a in
    select order_id from public.rewards_reservations
    where status = 'reserved' and expires_at < now()
    order by expires_at limit p_limit
  loop
    select payment_status, overall_status into o from public.orders where id = a.order_id;
    if found and o.payment_status = 'paid' and o.overall_status not in ('cancelled', 'refunded') then
      perform public.rewards_commit_reservation(a.order_id);
      committed := committed + 1;
    else
      perform public.rewards_release_reservation(a.order_id, 'expired');
      released := released + 1;
    end if;
  end loop;
  return jsonb_build_object('released', released, 'committed', committed);
end;
$$;

-- ── 8. Earn on net value: exclude points-funded value unless config says so ──
create or replace function public.rewards_on_order_paid(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v         public.rewards_config_versions;
  pol       jsonb;
  o         record;
  eligible  numeric;
  earn_base numeric;
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
  select id, customer_id, subtotal, discount_amount, points_discount, customer_phone,
         delivery_address, delivery_city, payment_status
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

  -- Eligible merchandise: after product/campaign discounts, shipping excluded.
  eligible := greatest(coalesce(o.subtotal, 0) - coalesce(o.discount_amount, 0), 0);
  -- Purchase rewards additionally exclude points-funded value unless enabled.
  earn_base := greatest(
    eligible - case when coalesce((pol->'purchase'->>'include_points_funded_value')::boolean, false)
                    then 0 else coalesce(o.points_discount, 0) end, 0);

  if coalesce((pol->'purchase'->>'enabled')::boolean, false) and earn_base > 0 then
    raw_pts := earn_base * (pol->'purchase'->>'rate_percent')::numeric / 100 / rate;
    pts := case pol->'purchase'->>'rounding'
             when 'ceil'  then ceil(raw_pts)
             when 'round' then round(raw_pts)
             else floor(raw_pts) end;
    cap := (pol->'purchase'->>'max_points_per_order')::integer;
    if cap is not null and pts > cap then pts := cap; end if;
    if pts > 0 then
      insert into public.rewards_purchase_awards
        (order_id, user_id, eligible_amount, points, config_version_id)
      values (p_order_id, o.customer_id, earn_base, pts, v.id)
      on conflict (order_id) do nothing;
      result := result || jsonb_build_object('purchase_points', pts);
    end if;
  end if;

  -- Referral qualifying amount: after promotional discounts, BEFORE points
  -- redemption, shipping excluded (PRD 3.4).
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

-- ── 9. Lock down ─────────────────────────────────────────────────────────────
revoke all on function public.rewards_quote_redemption(uuid, numeric, integer)   from public, anon, authenticated;
revoke all on function public.rewards_reserve(uuid, uuid, integer, numeric)       from public, anon, authenticated;
revoke all on function public.rewards_commit_reservation(uuid)                    from public, anon, authenticated;
revoke all on function public.rewards_release_reservation(uuid, text)             from public, anon, authenticated;
revoke all on function public.rewards_reverse_order(uuid, text)                   from public, anon, authenticated;
revoke all on function public.rewards_expire_reservations(integer)                from public, anon, authenticated;
revoke all on function public.rewards_on_order_paid(uuid)                         from public, anon, authenticated;

grant execute on function public.rewards_quote_redemption(uuid, numeric, integer) to service_role;
grant execute on function public.rewards_reserve(uuid, uuid, integer, numeric)     to service_role;
grant execute on function public.rewards_commit_reservation(uuid)                  to service_role;
grant execute on function public.rewards_release_reservation(uuid, text)           to service_role;
grant execute on function public.rewards_reverse_order(uuid, text)                 to service_role;
grant execute on function public.rewards_expire_reservations(integer)              to service_role;
grant execute on function public.rewards_on_order_paid(uuid)                       to service_role;
