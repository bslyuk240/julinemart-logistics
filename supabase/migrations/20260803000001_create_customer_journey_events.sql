-- Customer journey tracking: product-view events from the storefront PWA.
-- Checkout-started / payment-completed funnel stages are derived from `orders`
-- at query time (payment_status='pending'/'paid') rather than duplicated here.
create table if not exists customer_journey_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('product_viewed')),
  customer_id uuid null,
  anonymous_id text null,
  customer_email text null,
  product_id uuid null references products(id) on delete set null,
  source_page text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_journey_events_type_idx on customer_journey_events(event_type);
create index if not exists customer_journey_events_created_idx on customer_journey_events(created_at desc);
create index if not exists customer_journey_events_email_idx on customer_journey_events(customer_email);
create index if not exists customer_journey_events_product_idx on customer_journey_events(product_id);

alter table customer_journey_events enable row level security;

-- Guests (anon key, no login) must be able to write — mirrors the verified
-- pwa_install_events INSERT policy (public, with_check true).
create policy "public can insert customer_journey_events"
  on customer_journey_events for insert
  to public
  with check (true);

-- Tighter than pwa_install_events' SELECT policy on purpose: this table holds
-- real customer emails, so only signed-in dashboard staff can read it.
create policy "authenticated can read customer_journey_events"
  on customer_journey_events for select
  to authenticated
  using (true);
