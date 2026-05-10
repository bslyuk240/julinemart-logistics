-- PWA install event tracking for JLO Admin analytics
create table if not exists pwa_install_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  platform text,
  is_standalone boolean default false,
  customer_id text null,
  anonymous_id text null,
  user_agent text,
  source_page text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists pwa_install_events_event_idx on pwa_install_events(event_name);
create index if not exists pwa_install_events_created_idx on pwa_install_events(created_at desc);
create index if not exists pwa_install_events_platform_idx on pwa_install_events(platform);
