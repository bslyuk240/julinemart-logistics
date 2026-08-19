-- Broadcast dispatch (phase 1): a shipment can now be offered to every
-- online, active rider covering its pickup area instead of the
-- dispatcher hand-picking one. 'broadcasting' sits between 'pending' and
-- 'assigned' in the delivery_status lifecycle — a rider claim moves the
-- row straight to 'assigned', same end state as a direct admin assignment.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as a
-- statement that references the new value, so this is its own migration,
-- ahead of the one that adds the broadcast_* columns.
alter type delivery_status add value if not exists 'broadcasting';
