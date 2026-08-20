-- Return Workflow (staff-mediated, 3 steps): a rider who can't complete a
-- delivery marks it 'failed' (see rider-jobs.js's new fail_delivery
-- action) — the same shipment stays assigned to them since they still
-- physically hold the package. Staff review from the Delivery Problems
-- queue then moves it to 'return_required' (admin-delivery-problems.js's
-- new require_return action), the rider starts the trip back
-- ('returning'), and confirms hand-back ('returned', already an existing
-- enum value).
--
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as a
-- statement that references the new value, so this is its own migration,
-- ahead of anything that writes these statuses.
alter type delivery_status add value if not exists 'return_required';
alter type delivery_status add value if not exists 'returning';
