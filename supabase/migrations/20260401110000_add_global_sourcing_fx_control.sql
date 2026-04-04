alter table public.global_sourcing_settings
  add column if not exists fx_provider text not null default 'exchangerate_host',
  add column if not exists fx_manual_override_enabled boolean not null default false,
  add column if not exists fx_manual_rate numeric(18, 6) null,
  add column if not exists fx_manual_rate_note text null,
  add column if not exists fx_live_api_enabled boolean not null default true,
  add column if not exists fx_last_fetched_rate numeric(18, 6) null,
  add column if not exists fx_last_fetched_at timestamptz null,
  add column if not exists fx_cache_expires_at timestamptz null;

