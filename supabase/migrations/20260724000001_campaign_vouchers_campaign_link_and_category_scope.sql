-- Links campaign_vouchers back to the campaign that generated it, and adds
-- category-scoping so category-targeted campaigns can restrict a voucher the
-- same way vendor/product-targeted campaigns already can via vendor_ids/product_ids.
alter table campaign_vouchers
  add column campaign_id uuid references campaigns(id) on delete set null,
  add column category_ids uuid[];

create index if not exists idx_campaign_vouchers_campaign_id on campaign_vouchers(campaign_id);

comment on column campaign_vouchers.campaign_id is 'Optional link back to the campaigns row that generated this voucher — nullable, standalone vouchers created directly on the Vouchers page have no campaign.';
comment on column campaign_vouchers.category_ids is 'Optional category scoping (categories.id uuids) — mirrors the product_ids/product_skus/vendor_ids restriction pattern.';
