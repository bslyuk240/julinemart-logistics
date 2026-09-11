-- Let campaign vouchers optionally discount shipping, not just the order subtotal.
-- Mirrors the shape already used by public.influencers (shipping_discount_type/value).
alter table public.campaign_vouchers
  add column if not exists shipping_discount_type text not null default 'none',
  add column if not exists shipping_discount_value numeric not null default 0;

alter table public.campaign_vouchers
  drop constraint if exists campaign_vouchers_shipping_discount_type_check;

alter table public.campaign_vouchers
  add constraint campaign_vouchers_shipping_discount_type_check
  check (shipping_discount_type in ('none', 'percentage', 'fixed', 'free'));

comment on column public.campaign_vouchers.shipping_discount_type is
  'none = voucher does not touch shipping; percentage/fixed/free mirror influencers.shipping_discount_type';
comment on column public.campaign_vouchers.shipping_discount_value is
  'Percentage (0-100) or flat NGN amount off shipping, depending on shipping_discount_type. Ignored when type is none or free.';
