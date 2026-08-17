-- G4.5b: Mark vendor pool/box stock as pre-paid (pre_settled) to avoid double payout

ALTER TABLE public.gift_pool_inventory
  ADD COLUMN IF NOT EXISTS vendor_pre_settled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.gift_pool_inventory.vendor_pre_settled IS
  'When true, gift orders using this pool SKU record vendor_payout_status pre_settled on line items';

ALTER TABLE public.gift_box_items
  ADD COLUMN IF NOT EXISTS vendor_payout_status text NOT NULL DEFAULT 'pending'
    CHECK (vendor_payout_status IN ('pending', 'pre_settled', 'paid', 'not_applicable'));

COMMENT ON COLUMN public.gift_box_items.vendor_payout_status IS
  'Vendor settlement status for this box component — pre_settled when stock was bought upfront';
