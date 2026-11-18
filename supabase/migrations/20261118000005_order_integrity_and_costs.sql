-- Order integrity + JulinePoints cost visibility
--   1. Atomic voucher claim/release (replaces read-then-write counters)
--   2. Expiry of abandoned unpaid checkouts
--   3. Partial points restore (staff-chosen) and a reverse that restores only
--      what is still outstanding
--   4. rewards_cost_summary: platform-funded loyalty cost, separate from vendor
--      earnings (which are derived from order_items and are untouched)

-- ── 1. Atomic voucher usage ──────────────────────────────────────────────────
-- One statement, so two checkouts can never both take the last use. The existing
-- max-uses trigger still flips the voucher to 'used' on the update.
create or replace function public.claim_voucher_use(p_voucher_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  update public.campaign_vouchers
     set current_uses = coalesce(current_uses, 0) + 1
   where id = p_voucher_id
     and status = 'active'
     and (max_uses is null or coalesce(current_uses, 0) < max_uses)
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- Gives one use back. Only reactivates a voucher the max-uses trigger marked
-- 'used'; never touches one an admin paused.
create or replace function public.release_voucher_use(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.campaign_vouchers
     set current_uses = greatest(coalesce(current_uses, 0) - 1, 0),
         status = case
                    when status = 'used'
                         and (max_uses is null or greatest(coalesce(current_uses, 0) - 1, 0) < max_uses)
                    then 'active'
                    else status
                  end
   where upper(code) = upper(btrim(coalesce(p_code, '')))
     and coalesce(current_uses, 0) > 0;
end;
$$;

-- ── 2. Abandoned checkout expiry ─────────────────────────────────────────────
-- Cancels unpaid checkouts created by create-order after p_hours, gives back the
-- voucher use and the points hold. Looks only at the last 30 days so old legacy
-- rows are left alone, and only at orders from the storefront checkout (custom
-- and gift orders have their own payment flows and are excluded).
create or replace function public.expire_abandoned_orders(p_hours integer default 48, p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o record;
  n integer := 0;
begin
  for o in
    select id, order_number, metadata->>'voucher_code' as voucher_code
    from public.orders
    where payment_status = 'pending'
      and overall_status = 'pending'
      and created_at < now() - make_interval(hours => p_hours)
      and created_at > now() - interval '30 days'
      and metadata->>'order_confirmation_handler' = 'netlify_create_order'
      and coalesce(order_kind, 'marketplace') = 'marketplace'
    order by created_at
    limit p_limit
    for update skip locked
  loop
    update public.orders set overall_status = 'cancelled', updated_at = now()
     where id = o.id and payment_status = 'pending' and overall_status = 'pending';
    if not found then continue; end if;

    update public.sub_orders set status = 'failed'
     where main_order_id = o.id and status not in ('delivered', 'returned', 'failed');

    perform public.rewards_reverse_order(o.id, 'order_expired');
    if o.voucher_code is not null then
      perform public.release_voucher_use(o.voucher_code);
    end if;

    insert into public.activity_logs (user_id, actor_email, action, resource_type, resource_id, details, source)
    values (null, null, 'ORDER_EXPIRED', 'orders', o.id::text,
            jsonb_build_object('order_number', o.order_number, 'after_hours', p_hours), 'system');
    n := n + 1;
  end loop;
  return jsonb_build_object('expired', n);
end;
$$;

-- ── 3. Points restore ────────────────────────────────────────────────────────
-- Points still restorable for an order = committed points minus anything already
-- restored. Used by both the staff partial-restore and the full reversal.
create or replace function public.rewards_restore_points(
  p_order_id uuid, p_points integer, p_key text, p_reason text default null, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r         public.rewards_reservations;
  uid       uuid;
  already   integer;
  remaining integer;
  pts       integer;
  rate      numeric;
begin
  if p_points is null or p_points <= 0 then raise exception 'points must be positive'; end if;
  select user_id into uid from public.rewards_reservations where order_id = p_order_id;
  if not found then return jsonb_build_object('restored', 0, 'reason', 'no_redemption'); end if;

  perform 1 from public.rewards_accounts where user_id = uid for update;
  select * into r from public.rewards_reservations where order_id = p_order_id for update;
  if r.status not in ('committed', 'refunded') then
    return jsonb_build_object('restored', 0, 'reason', 'not_committed');
  end if;

  select coalesce(sum(points), 0) into already from public.rewards_ledger
   where reference_type = 'order' and reference_id = p_order_id::text and entry_type = 'redemption_refund';
  remaining := (r.points - r.shortfall_points) - already;
  pts := least(p_points, remaining);
  if pts <= 0 then return jsonb_build_object('restored', 0, 'reason', 'nothing_left'); end if;

  rate := r.naira_value / r.points;
  perform public.rewards_post_ledger(
    r.user_id, pts, 'redemption_refund', 'order_partial_refund', p_key,
    'order', p_order_id::text, r.config_version_id, pts * rate, p_reason, p_actor);
  return jsonb_build_object('restored', pts, 'remaining', remaining - pts);
end;
$$;

-- Full reversal now restores only what is still outstanding (so a partial
-- restore earlier on never leads to a double restore).
create or replace function public.rewards_reverse_order(p_order_id uuid, p_reason text default 'order_reversed')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r        public.rewards_reservations;
  uid      uuid;
  already  integer;
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
    select coalesce(sum(points), 0) into already from public.rewards_ledger
     where reference_type = 'order' and reference_id = p_order_id::text and entry_type = 'redemption_refund';
    restore := (r.points - r.shortfall_points) - already;
    rate    := r.naira_value / r.points;
    if restore > 0 then
      l := public.rewards_post_ledger(
        r.user_id, restore, 'redemption_refund', 'order_reversal', 'redeem-refund:' || p_order_id::text,
        'order', p_order_id::text, r.config_version_id, restore * rate, p_reason, null);
    end if;
    update public.rewards_reservations
       set status = 'refunded', refunded_at = now(), refund_ledger_id = l.id where id = r.id;
    return jsonb_build_object('reservation', 'refunded', 'points', greatest(restore, 0));
  end if;
  return jsonb_build_object('reservation', r.status);
end;
$$;

-- ── 4. Platform-funded loyalty cost ──────────────────────────────────────────
-- Kept apart from vendor earnings: redeemed value is recorded on the ledger and
-- on orders.points_discount, never in order_items.subtotal.
create or replace view public.rewards_cost_summary
with (security_invoker = true) as
select
  coalesce(sum(points) filter (where points > 0 and entry_type in
    ('signup_bonus','daily_claim','streak_bonus','purchase_reward','referral_reward')), 0)::bigint as issued_points,
  coalesce(sum(naira_value) filter (where points > 0 and entry_type in
    ('signup_bonus','daily_claim','streak_bonus','purchase_reward','referral_reward')), 0)       as issued_ngn,
  coalesce(-sum(points) filter (where entry_type = 'redemption'), 0)::bigint                      as redeemed_points,
  coalesce(-sum(naira_value) filter (where entry_type = 'redemption'), 0)                         as redeemed_ngn,
  coalesce(sum(points) filter (where entry_type = 'redemption_refund'), 0)::bigint                as restored_points,
  coalesce(sum(naira_value) filter (where entry_type = 'redemption_refund'), 0)                   as restored_ngn,
  coalesce(sum(points) filter (where entry_type = 'adjustment'), 0)::bigint                       as adjusted_points,
  coalesce(sum(points) filter (where entry_type = 'expiry'), 0)::bigint                           as expired_points,
  (select coalesce(sum(balance_points), 0) from public.rewards_accounts)::bigint                  as outstanding_points,
  ((select coalesce(sum(points), 0) from public.rewards_purchase_awards where status = 'pending')
   + (select coalesce(sum(points), 0) from public.rewards_referral_awards where status in ('pending', 'in_review')))::bigint as pending_points
from public.rewards_ledger;

-- ── Lock down ────────────────────────────────────────────────────────────────
revoke all on function public.claim_voucher_use(uuid)                        from public, anon, authenticated;
revoke all on function public.release_voucher_use(text)                      from public, anon, authenticated;
revoke all on function public.expire_abandoned_orders(integer, integer)      from public, anon, authenticated;
revoke all on function public.rewards_restore_points(uuid, integer, text, text, uuid) from public, anon, authenticated;
revoke all on function public.rewards_reverse_order(uuid, text)              from public, anon, authenticated;
revoke all on public.rewards_cost_summary from public, anon, authenticated;

grant execute on function public.claim_voucher_use(uuid)                     to service_role;
grant execute on function public.release_voucher_use(text)                   to service_role;
grant execute on function public.expire_abandoned_orders(integer, integer)   to service_role;
grant execute on function public.rewards_restore_points(uuid, integer, text, text, uuid) to service_role;
grant execute on function public.rewards_reverse_order(uuid, text)           to service_role;
grant select on public.rewards_cost_summary to service_role;
