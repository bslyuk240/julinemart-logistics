ALTER TABLE meta_ad_drafts
  ADD COLUMN IF NOT EXISTS meta_creative_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_id       text,
  ADD COLUMN IF NOT EXISTS meta_adset_id    text,
  ADD COLUMN IF NOT EXISTS published_at     timestamptz;
