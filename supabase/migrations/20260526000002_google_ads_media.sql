-- Add Display and Video ad media fields to google_ad_drafts
-- No new env vars needed — uses the same GOOGLE_ADS_CONFIG credentials

ALTER TABLE google_ad_drafts
  ADD COLUMN IF NOT EXISTS video_url        text,
  ADD COLUMN IF NOT EXISTS logo_url         text,
  ADD COLUMN IF NOT EXISTS long_headline    text,
  ADD COLUMN IF NOT EXISTS image_url_square text;

COMMENT ON COLUMN google_ad_drafts.video_url        IS 'YouTube video URL for VIDEO campaign type';
COMMENT ON COLUMN google_ad_drafts.logo_url          IS 'Logo image URL for Responsive Display Ads (optional)';
COMMENT ON COLUMN google_ad_drafts.long_headline     IS 'Long headline up to 90 chars — used for Display RDA and Video in-stream';
COMMENT ON COLUMN google_ad_drafts.image_url_square  IS 'Square (1:1) image URL for Display ads; falls back to image_url if not set';
