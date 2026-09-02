-- Links an outbound WhatsApp message back to the giveaway_broadcasts run it
-- was sent as part of (nullable — most sends, e.g. 1:1 agent messages, never
-- belong to a broadcast). Needed so the webhook handler can reconcile a
-- broadcast's sent/failed counts when Meta's async delivery-status callback
-- flips a message from "sent" to "failed" after the fact (e.g. "User's
-- number is part of an experiment") — until now those counts were only ever
-- set once, synchronously, at send time, and never updated again, so the
-- admin's Broadcast History could permanently show "1/1 sent" for a message
-- that actually never reached anyone.
alter table internal_whatsapp_messages
  add column broadcast_id uuid references giveaway_broadcasts(id) on delete set null;

create index idx_internal_whatsapp_messages_broadcast_id
  on internal_whatsapp_messages (broadcast_id)
  where broadcast_id is not null;
