-- Persistent in-app notification history (rider-app-ux-rebuild.md #18).
-- Push delivery itself already works (sendPushToCustomer -> the PWA's FCM
-- send endpoint) but nothing about an individual notification survives
-- past the OS notification tray — a rider who dismisses or misses a push
-- has no way to see it again. This is the missing record of it.
create table rider_notifications (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references riders(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index rider_notifications_rider_id_idx on rider_notifications(rider_id, created_at desc);
