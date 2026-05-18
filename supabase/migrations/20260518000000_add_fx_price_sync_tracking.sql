-- Track the USD/NGN rate that was active at the last CJ product price sync.
-- Used to compute whether the 3% threshold has been crossed since the last sync.
ALTER TABLE public.global_sourcing_settings
  ADD COLUMN IF NOT EXISTS fx_last_price_sync_rate  numeric(18,6) NULL,
  ADD COLUMN IF NOT EXISTS fx_last_price_sync_at    timestamptz   NULL;

COMMENT ON COLUMN public.global_sourcing_settings.fx_last_price_sync_rate IS
  'USD/NGN rate that was applied during the most recent automated FX price sync run';
COMMENT ON COLUMN public.global_sourcing_settings.fx_last_price_sync_at IS
  'Timestamp of the most recent automated FX price sync run';
