-- ─── Google Ads Integration ───────────────────────────────────────────────────

-- Campaign cache (synced from Google Ads API)
create table if not exists public.google_campaigns_cache (
  id                    uuid primary key default gen_random_uuid(),
  account_key           text not null,            -- 'julinemart' | 'services' | 'skolahq'
  customer_id           text not null,
  account_name          text not null,
  google_campaign_id    text not null,
  name                  text not null,
  status                text not null,            -- ENABLED | PAUSED | REMOVED
  campaign_type         text,                     -- SEARCH | DISPLAY | VIDEO | PERFORMANCE_MAX
  budget_amount_micros  bigint,
  impressions           bigint   default 0,
  clicks                bigint   default 0,
  cost_micros           bigint   default 0,
  conversions           numeric  default 0,
  ctr                   numeric  default 0,
  average_cpc_micros    bigint   default 0,
  synced_at             timestamptz default now(),
  created_at            timestamptz default now(),
  unique (customer_id, google_campaign_id)
);

-- Ad drafts (mirrors meta_ad_drafts pattern, adapted for Google RSA format)
create table if not exists public.google_ad_drafts (
  id                    uuid primary key default gen_random_uuid(),
  account_key           text not null,            -- 'julinemart' | 'services' | 'skolahq'
  customer_id           text not null,
  title                 text not null,
  headlines             text[]   not null default '{}',   -- up to 15, max 30 chars each
  descriptions          text[]   not null default '{}',   -- up to 4, max 90 chars each
  final_url             text,
  image_url             text,
  campaign_type         text     default 'SEARCH',        -- SEARCH | DISPLAY | VIDEO | PERFORMANCE_MAX
  call_to_action        text     default 'LEARN_MORE',
  status                text     default 'draft',         -- draft | approved | rejected | published
  ai_generated          boolean  default false,
  suggested_budget_ngn  numeric,
  google_campaign_id    text,
  google_ad_group_id    text,
  google_ad_id          text,
  rejection_note        text,
  published_at          timestamptz,
  created_by            uuid references public.users(id),
  approved_by           uuid references public.users(id),
  approved_at           timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- Audit log
create table if not exists public.google_action_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users(id),
  account_key  text,
  action       text not null,
  resource     text,
  resource_id  text,
  details      jsonb,
  status       text default 'success',
  error_msg    text,
  created_at   timestamptz default now()
);

-- RLS
alter table public.google_campaigns_cache  enable row level security;
alter table public.google_ad_drafts        enable row level security;
alter table public.google_action_logs      enable row level security;

-- Service role full access
create policy "service_role_google_campaigns"  on public.google_campaigns_cache  for all using (true);
create policy "service_role_google_drafts"     on public.google_ad_drafts        for all using (true);
create policy "service_role_google_logs"       on public.google_action_logs      for all using (true);
