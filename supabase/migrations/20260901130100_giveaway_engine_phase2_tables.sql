-- Giveaway/Campaign Engine Phase 2 (continued) — see 20260901130000 for the
-- enum widening this depends on.

-- Durable, phone-keyed marketing consent — separate from giveaway_entries
-- because the whole point is a cross-campaign list: someone who opts in
-- during one giveaway should be reachable for the NEXT campaign's drop too,
-- not just re-notified about the one they already entered.
create table whatsapp_marketing_consent (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  customer_id uuid references customers(id) on delete set null,
  opted_in boolean not null default true,
  source text,
  opted_in_at timestamptz not null default now(),
  opted_out_at timestamptz,
  opted_out_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table whatsapp_marketing_consent is 'Cross-campaign WhatsApp marketing opt-in list, fed by the "send me deals and Secret Drop alerts" checkbox on giveaway entries (and, later, other campaign types). Upserted by phone, not per-entry.';
comment on column whatsapp_marketing_consent.source is 'Free-text: which flow captured this opt-in, e.g. giveaway_entry:<campaign_id>.';

create index idx_whatsapp_marketing_consent_opted_in on whatsapp_marketing_consent(opted_in);

create or replace function update_whatsapp_marketing_consent_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger whatsapp_marketing_consent_set_updated_at
  before update on whatsapp_marketing_consent
  for each row execute function update_whatsapp_marketing_consent_timestamp();

-- Job-level record of a broadcast run (per-message delivery detail is already
-- captured for free by reusing sendWhatsAppTemplate, which writes into
-- internal_whatsapp_threads/messages) — this table is just the summary an
-- admin sees: what was sent, to how many, how many succeeded/failed.
create table giveaway_broadcasts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  template_name text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  triggered_by uuid references users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table giveaway_broadcasts is 'Summary record of one "send the secret code to the opt-in list" run. Per-recipient send status lives in internal_whatsapp_threads/messages via the reused sendWhatsAppTemplate path.';

create index idx_giveaway_broadcasts_campaign on giveaway_broadcasts(campaign_id);

alter table whatsapp_marketing_consent enable row level security;
alter table giveaway_broadcasts enable row level security;

-- No anon/public policy on either table: consent list holds phone PII and is
-- only ever written by the giveaway-submit-entry Netlify function (service
-- role, bypasses RLS); broadcasts are only ever triggered by the
-- admin-giveaway-broadcast Netlify function (also service role). Both are
-- readable from the admin dashboard by admin/manager, matching the
-- giveaway_entries precedent from Phase 1.
create policy whatsapp_marketing_consent_admin_select
  on whatsapp_marketing_consent for select to authenticated
  using (exists (select 1 from users where id = auth.uid() and role in ('admin', 'manager')));

create policy giveaway_broadcasts_admin_select
  on giveaway_broadcasts for select to authenticated
  using (exists (select 1 from users where id = auth.uid() and role in ('admin', 'manager')));

-- (b) Order-level campaign attribution. Nullable/additive — populated
-- automatically in create-order.js from the redeemed voucher's campaign_id
-- (campaign_vouchers.campaign_id already exists), not from a new checkout
-- payload field. Benefits ALL campaign types that link a voucher, not just
-- giveaways — closes the "order-level revenue attribution" gap the PWA's own
-- campaigns-build-plan.md flagged as deferred for CampaignPerformanceProductList.
alter table orders add column campaign_id uuid references campaigns(id) on delete set null;
create index idx_orders_campaign_id on orders(campaign_id);
comment on column orders.campaign_id is 'Attribution: set from campaign_vouchers.campaign_id when the order redeemed a campaign-linked voucher. Null for orders with no voucher or a standalone (non-campaign) voucher.';
