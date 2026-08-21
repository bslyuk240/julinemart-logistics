-- manual_shipments already has sender_hub_id (pickup FROM a hub) but no
-- equivalent for "drop this at a hub" — needed for the new first-mile
-- vendor/sender -> hub rider leg (mirrors sub_orders.hub_id, which already
-- served this purpose for catalog orders).
alter table manual_shipments add column if not exists destination_hub_id uuid references hubs(id);
