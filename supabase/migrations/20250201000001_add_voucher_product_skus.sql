-- Add product SKU filters for vouchers
ALTER TABLE campaign_vouchers
  ADD COLUMN product_skus TEXT[];
