-- Giveaway/Campaign Engine Phase 4: remarketing to non-winners.
-- Mirrors early_bird_voucher_id/grand_prize_voucher_id exactly — links an
-- existing campaign_vouchers row, mints nothing new.
alter table campaigns add column consolation_voucher_id uuid references campaign_vouchers(id) on delete set null;
comment on column campaigns.consolation_voucher_id is 'Giveaway only. Optional voucher offered to non-winning entrants after the draw ("didn''t win? here''s a reward anyway") via the WhatsApp broadcast''s campaign_non_winners audience.';
