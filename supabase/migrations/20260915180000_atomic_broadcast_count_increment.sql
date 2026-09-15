-- Fixes a real race condition confirmed live: admin-giveaway-broadcast-
-- background.js's per-recipient progress writes and
-- internal-whatsapp-webhook.js's async delivery-failure reconciliation both
-- update giveaway_broadcasts.sent_count/failed_count via plain
-- read-then-write SETs from process-local counters. Meta's async "failed"
-- status webhook can arrive well under a second after the send (confirmed:
-- 0.77s later for a real "healthy ecosystem engagement" rejection), which is
-- almost always WHILE the background function's own send loop is still
-- running — its next per-recipient write (every ~150ms+) then unconditionally
-- overwrites whatever the webhook just corrected, and its final
-- completion write does the same. Net effect on a real send: a broadcast
-- showed a clean 61/0 in giveaway_broadcasts while internal_whatsapp_messages
-- (the actual source of truth) showed 32 of those 61 as genuinely failed.
--
-- Atomic column arithmetic in a single UPDATE statement is commutative and
-- order-independent, so two concurrent callers (the send loop and the
-- webhook) can no longer clobber each other regardless of timing.

create or replace function increment_giveaway_broadcast_counts(
  p_broadcast_id uuid,
  p_sent_delta integer,
  p_failed_delta integer
)
returns void
language sql
security definer
set search_path = public
as $$
  update giveaway_broadcasts
  set sent_count = greatest(0, sent_count + p_sent_delta),
      failed_count = greatest(0, failed_count + p_failed_delta)
  where id = p_broadcast_id;
$$;

revoke all on function increment_giveaway_broadcast_counts(uuid, integer, integer) from public;
grant execute on function increment_giveaway_broadcast_counts(uuid, integer, integer) to service_role;
