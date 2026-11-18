-- rewards_restore_points: a replay of the same key now says so, instead of
-- reporting the points as restored again (the ledger was already idempotent).
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
  if exists (select 1 from public.rewards_ledger where idempotency_key = p_key) then
    return jsonb_build_object('restored', 0, 'reason', 'already_applied', 'idempotent', true);
  end if;
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
