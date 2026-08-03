-- customer_notification_prefs already exists live (created outside tracked
-- migrations); recreate idempotently so this migration is safe everywhere.
create table if not exists customer_notification_prefs (
  customer_id uuid primary key references customers(id) on delete cascade,
  order_updates boolean not null default true,
  promotions boolean not null default true,
  newsletter boolean not null default false,
  sms boolean not null default false,
  push boolean not null default true,
  updated_at timestamptz not null default now()
);

-- RLS is already enabled live with an equivalent "notif_prefs: self" policy
-- (ALL, using/with_check auth.uid() = customer_id) — nothing to add here.
-- The `create table if not exists` above is a no-op against the live table;
-- it only matters for spinning up a fresh environment from scratch.
alter table customer_notification_prefs enable row level security;

-- Guest / email-level suppression — covers customers with no `customers` row
-- at all (guest checkout), which customer_notification_prefs can't reach.
create table if not exists email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  category text not null check (category in ('order_updates', 'promotions', 'newsletter', 'all')),
  reason text not null default 'unsubscribe_link',
  created_at timestamptz not null default now(),
  unique (email, category)
);

create index if not exists email_suppressions_email_idx on email_suppressions(lower(email));

alter table email_suppressions enable row level security;

-- Written/read exclusively by service-role backend code (which bypasses RLS),
-- so this policy only matters if a dashboard UI ever queries it directly.
drop policy if exists "authenticated can read email_suppressions" on email_suppressions;
create policy "authenticated can read email_suppressions"
  on email_suppressions for select
  to authenticated
  using (true);
