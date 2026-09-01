-- Giveaway / Secret-Code Drop engine — Phase 1 of the Campaign Engine build.
-- Extends the existing campaigns/campaign_vouchers system (does not duplicate
-- it) — see project memory `project_campaign_giveaway_engine.md` for the full
-- phased plan this belongs to.

alter table campaigns
  add column campaign_kind text not null default 'merchandising',
  add column secret_code text,
  add column entry_limit integer,
  add column early_bird_limit integer,
  add column early_bird_voucher_id uuid references campaign_vouchers(id) on delete set null,
  add column grand_prize_voucher_id uuid references campaign_vouchers(id) on delete set null,
  add column grand_prize_description text;

alter table campaigns
  add constraint campaigns_campaign_kind_check check (campaign_kind in ('merchandising', 'giveaway'));

comment on column campaigns.campaign_kind is 'merchandising = existing landing-page/product-offer campaigns; giveaway = secret-code-drop entries+draw flow.';
comment on column campaigns.secret_code is 'Giveaway only. Compared case-insensitively at entry time — a marketing gate, not a security secret.';
comment on column campaigns.entry_limit is 'Giveaway only. Null = unlimited total valid entries.';
comment on column campaigns.early_bird_limit is 'Giveaway only. First N valid entries (by entry_position) qualify for early_bird_voucher_id.';
comment on column campaigns.early_bird_voucher_id is 'Giveaway only. Existing campaign_vouchers row issued to early-bird entrants — reuses the voucher engine rather than minting new codes.';
comment on column campaigns.grand_prize_voucher_id is 'Giveaway only. Optional existing campaign_vouchers row issued to the drawn winner alongside/instead of a physical prize.';

-- New section type so a giveaway campaign can render its secret-code gate +
-- entry form inline in the existing section-driven landing page layout.
alter table campaign_sections drop constraint campaign_sections_section_type_check;
alter table campaign_sections add constraint campaign_sections_section_type_check
  check (section_type = any (array[
    'hero', 'benefits', 'vendor_story', 'products', 'offer', 'reviews',
    'media_gallery', 'cta_footer', 'giveaway_entry'
  ]));

create table giveaway_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  full_name text not null,
  whatsapp_number text not null,
  email text,
  location text,
  customer_id uuid references customers(id) on delete set null,
  source text,
  status text not null default 'valid' check (status in ('valid', 'duplicate', 'invalid')),
  invalid_reason text,
  entry_position integer,
  reward_tier text check (reward_tier in ('early_bird', 'standard')),
  marketing_opt_in boolean not null default false,
  winner_status text not null default 'none'
    check (winner_status in ('none', 'selected', 'contacted', 'verified', 'processing', 'delivered', 'forfeited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table giveaway_entries is 'One row per giveaway entry attempt (valid, duplicate, or invalid) — duplicates/invalids are kept, not rejected outright, so admin reporting matches "X submissions, Y valid, Z duplicate" style totals.';
comment on column giveaway_entries.entry_position is 'Sequential position among this campaign''s valid entries at submission time (1-based). Used to compute early-bird eligibility.';
comment on column giveaway_entries.source is 'Free-text attribution captured from the landing page (e.g. qr_source/utm value), mirrors campaign_analytics_events metadata conventions.';

create index idx_giveaway_entries_campaign_status on giveaway_entries(campaign_id, status);
create index idx_giveaway_entries_campaign_phone on giveaway_entries(campaign_id, whatsapp_number);
create index idx_giveaway_entries_winner_status on giveaway_entries(campaign_id, winner_status);

create table giveaway_draws (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  winning_entry_id uuid not null references giveaway_entries(id),
  eligible_entry_count integer not null,
  drawn_by uuid references users(id),
  drawn_at timestamptz not null default now(),
  status text not null default 'completed' check (status in ('completed', 'forfeited')),
  forfeit_reason text,
  redraw_of uuid references giveaway_draws(id)
);

comment on table giveaway_draws is 'Permanent draw audit trail. A forfeit+redraw inserts a NEW row linked via redraw_of rather than mutating the old one, so both the original and replacement winner stay on record.';

create index idx_giveaway_draws_campaign on giveaway_draws(campaign_id);

create or replace function update_giveaway_entry_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger giveaway_entries_set_updated_at
  before update on giveaway_entries
  for each row execute function update_giveaway_entry_timestamp();

-- RLS — entries/draws hold raw entrant PII (name, WhatsApp number, email,
-- location). No anon/public policy at all: writes come from the giveaway
-- Netlify functions via the service-role client (RLS bypass, same pattern as
-- voucherHelpers.js); admin reads/updates come from the dashboard's
-- authenticated browser session. Scoped to admin+manager only — narrower than
-- campaigns' admin+manager+social_media_manager, matching how Vouchers.tsx
-- (also PII/financial-adjacent) is admin-only rather than campaigns-open.
alter table giveaway_entries enable row level security;
alter table giveaway_draws enable row level security;

create policy giveaway_entries_admin_select
  on giveaway_entries for select to authenticated
  using (exists (select 1 from users where id = auth.uid() and role in ('admin', 'manager')));

create policy giveaway_entries_admin_update
  on giveaway_entries for update to authenticated
  using (exists (select 1 from users where id = auth.uid() and role in ('admin', 'manager')))
  with check (exists (select 1 from users where id = auth.uid() and role in ('admin', 'manager')));

create policy giveaway_draws_admin_select
  on giveaway_draws for select to authenticated
  using (exists (select 1 from users where id = auth.uid() and role in ('admin', 'manager')));

-- Draw/redraw run as SECURITY DEFINER functions rather than plain inserts from
-- the browser: "pick one at random" has to be one atomic, unrepeatable
-- statement so an admin can't reroll by retrying the click, and the random
-- selection itself needs to run with a privilege the RLS-scoped `authenticated`
-- role otherwise doesn't have (reading across all eligible entries at once).
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
  select exists(select 1 from users where id = auth.uid() and role in ('admin', 'manager'))
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
  select exists(select 1 from users where id = auth.uid() and role in ('admin', 'manager'))
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

grant execute on function draw_giveaway_winner(uuid) to authenticated;
grant execute on function forfeit_and_redraw_giveaway_winner(uuid, text) to authenticated;
