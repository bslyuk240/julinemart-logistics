-- Commission Transparency: riders currently see only the final rider_payout
-- number with no visibility into how it was derived. Freezes the same
-- {base_rate, weight_charge, pickup_surcharge, total} breakdown
-- computeDispatchCostBreakdown() produces, at the same moment rider_payout
-- itself gets frozen (assign/broadcast time) — never recomputed later, same
-- reasoning as rider_payout itself (docs/rider-commission-design.md §6).
-- Lives only on the unified shipments table, same placement as rider_payout.
alter table shipments add column if not exists rider_payout_breakdown jsonb;
