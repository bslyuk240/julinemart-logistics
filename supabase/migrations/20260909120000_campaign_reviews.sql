-- Feedback pool for giveaway/campaign participants — deliberately a separate
-- small table from product_reviews rather than reusing it: product_reviews.
-- product_id is NOT NULL (it's built around a real product purchase), and a
-- "how was the giveaway experience" review has no product to attach to.
-- Same shape (rating/body/status/reviewer_name) so the homepage carousel can
-- merge both sources cheaply — see julinemart-pwa's homepage-reviews.ts.
--
-- No separate access-token column: giveaway_entries.id (already an
-- unguessable uuid) IS the link identity for the public review-composer
-- page — see giveaway-get-review-context.js / giveaway-submit-review.js.
-- The unique constraint on giveaway_entry_id is what makes "already
-- submitted" a real guarantee, not just a client-side check.

create table campaign_reviews (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  giveaway_entry_id uuid not null unique references giveaway_entries(id) on delete cascade,
  reviewer_name text not null,
  rating smallint not null check (rating between 1 and 5),
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_campaign_reviews_campaign_id on campaign_reviews (campaign_id);
create index idx_campaign_reviews_status on campaign_reviews (status);

alter table campaign_reviews enable row level security;

-- Public submit/read-context functions use the service-role key (bypasses
-- RLS) — this policy matches the explicit convention already used for
-- internal_whatsapp_templates rather than relying on the bypass alone.
create policy "service_role_all_campaign_reviews"
  on campaign_reviews
  for all
  to service_role
  using (true)
  with check (true);

-- Hardened admin/manager read+moderate pattern, matching
-- 20260902190000_internal_whatsapp_templates_rls_policies.sql.
create policy "campaign_reviews_select_staff"
  on campaign_reviews
  for select
  to authenticated
  using (
    exists (
      select 1 from users
      where users.id = auth.uid()
        and users.is_active = true
        and users.role in ('admin', 'manager')
    )
  );

create policy "campaign_reviews_update_staff"
  on campaign_reviews
  for update
  to authenticated
  using (
    exists (
      select 1 from users
      where users.id = auth.uid()
        and users.is_active = true
        and users.role in ('admin', 'manager')
    )
  );
