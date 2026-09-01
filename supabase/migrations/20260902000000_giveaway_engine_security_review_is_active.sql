-- Security review finding (pre-merge): the giveaway engine's RLS policies and
-- SECURITY DEFINER draw functions checked only `role in ('admin','manager')`,
-- with no `is_active` check — unlike this codebase's own established, more
-- recent hardened pattern (20260731000004_security_hardening_manual_shipments.sql,
-- which explicitly adds `u.is_active = true` alongside the role check).
--
-- Concrete impact: the Giveaways admin page writes directly to Supabase from
-- the browser session (supabase.from('giveaway_entries')/.rpc('draw_giveaway_winner')
-- etc.) with no intermediary Netlify function — RLS and these functions' own
-- internal checks are the SOLE authorization boundary. Deactivating a staff
-- account (users.is_active = false) does not itself revoke their existing
-- Supabase Auth session/JWT (no auth.admin.signOut/ban call happens on
-- deactivation), so a deactivated admin/manager's still-valid session
-- retained full read/write access to entrant PII and could trigger/manipulate
-- the prize draw. Fixes all five affected objects from Phase 1 and Phase 2:
-- giveaway_entries (select/update), giveaway_draws (select),
-- whatsapp_marketing_consent (select), giveaway_broadcasts (select), and
-- both draw/redraw functions.

drop policy if exists "giveaway_entries_admin_select" on giveaway_entries;
create policy giveaway_entries_admin_select
  on giveaway_entries for select to authenticated
  using (exists (select 1 from users where id = auth.uid() and is_active = true and role in ('admin', 'manager')));

drop policy if exists "giveaway_entries_admin_update" on giveaway_entries;
create policy giveaway_entries_admin_update
  on giveaway_entries for update to authenticated
  using (exists (select 1 from users where id = auth.uid() and is_active = true and role in ('admin', 'manager')))
  with check (exists (select 1 from users where id = auth.uid() and is_active = true and role in ('admin', 'manager')));

drop policy if exists "giveaway_draws_admin_select" on giveaway_draws;
create policy giveaway_draws_admin_select
  on giveaway_draws for select to authenticated
  using (exists (select 1 from users where id = auth.uid() and is_active = true and role in ('admin', 'manager')));

drop policy if exists "whatsapp_marketing_consent_admin_select" on whatsapp_marketing_consent;
create policy whatsapp_marketing_consent_admin_select
  on whatsapp_marketing_consent for select to authenticated
  using (exists (select 1 from users where id = auth.uid() and is_active = true and role in ('admin', 'manager')));

drop policy if exists "giveaway_broadcasts_admin_select" on giveaway_broadcasts;
create policy giveaway_broadcasts_admin_select
  on giveaway_broadcasts for select to authenticated
  using (exists (select 1 from users where id = auth.uid() and is_active = true and role in ('admin', 'manager')));

create or replace function draw_giveaway_winner(p_campaign_id uuid)
returns giveaway_draws
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_winner_id uuid;
  v_eligible_count integer;
  v_draw giveaway_draws;
begin
  select exists(select 1 from users where id = auth.uid() and is_active = true and role in ('admin', 'manager'))
    into v_is_admin;
  if not v_is_admin then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from giveaway_draws where campaign_id = p_campaign_id and status = 'completed') then
    raise exception 'a winner has already been drawn for this campaign; use forfeit_and_redraw_giveaway_winner instead';
  end if;

  select count(*) into v_eligible_count
  from giveaway_entries
  where campaign_id = p_campaign_id and status = 'valid' and winner_status = 'none';

  if v_eligible_count = 0 then
    raise exception 'no eligible entries to draw from';
  end if;

  select id into v_winner_id
  from giveaway_entries
  where campaign_id = p_campaign_id and status = 'valid' and winner_status = 'none'
  order by random()
  limit 1;

  insert into giveaway_draws (campaign_id, winning_entry_id, eligible_entry_count, drawn_by)
  values (p_campaign_id, v_winner_id, v_eligible_count, auth.uid())
  returning * into v_draw;

  update giveaway_entries set winner_status = 'selected' where id = v_winner_id;

  return v_draw;
end;
$$;

create or replace function forfeit_and_redraw_giveaway_winner(p_campaign_id uuid, p_reason text)
returns giveaway_draws
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_prior_draw giveaway_draws;
  v_winner_id uuid;
  v_eligible_count integer;
  v_new_draw giveaway_draws;
begin
  select exists(select 1 from users where id = auth.uid() and is_active = true and role in ('admin', 'manager'))
    into v_is_admin;
  if not v_is_admin then
    raise exception 'forbidden';
  end if;

  select * into v_prior_draw
  from giveaway_draws
  where campaign_id = p_campaign_id and status = 'completed'
  order by drawn_at desc
  limit 1;

  if v_prior_draw.id is null then
    raise exception 'no active draw to forfeit for this campaign';
  end if;

  update giveaway_draws set status = 'forfeited', forfeit_reason = p_reason where id = v_prior_draw.id;
  update giveaway_entries set winner_status = 'forfeited' where id = v_prior_draw.winning_entry_id;

  select count(*) into v_eligible_count
  from giveaway_entries
  where campaign_id = p_campaign_id and status = 'valid' and winner_status = 'none';

  if v_eligible_count = 0 then
    raise exception 'no eligible entries remain to redraw from';
  end if;

  select id into v_winner_id
  from giveaway_entries
  where campaign_id = p_campaign_id and status = 'valid' and winner_status = 'none'
  order by random()
  limit 1;

  insert into giveaway_draws (campaign_id, winning_entry_id, eligible_entry_count, drawn_by, redraw_of)
  values (p_campaign_id, v_winner_id, v_eligible_count, auth.uid(), v_prior_draw.id)
  returning * into v_new_draw;

  update giveaway_entries set winner_status = 'selected' where id = v_winner_id;

  return v_new_draw;
end;
$$;
