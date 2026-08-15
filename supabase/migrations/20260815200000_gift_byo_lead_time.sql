-- BYO expected lead days per gift fulfilment centre (commercial settings).
-- Ready-made boxes continue to use max pool-item lead_time_days.

ALTER TABLE public.gift_commercial_settings
  ADD COLUMN IF NOT EXISTS byo_lead_time_days int NOT NULL DEFAULT 1
  CHECK (byo_lead_time_days >= 0);

COMMENT ON COLUMN public.gift_commercial_settings.byo_lead_time_days IS
  'Minimum expected lead days for Build Your Own at this hub. Item pool lead may increase it. Ready-made boxes ignore this.';
