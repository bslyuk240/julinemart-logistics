# Skola Workforce: gift box knowledge entries

Paste each entry into Skola's `/knowledge` page (title + content). Each content block is under the 20,000
character limit. These are for internal agents (operations manager, sales representative, social media manager),
so they include internal status meanings and staff-side actions that the customer assistant does not get.
Last updated 2026-10-04. If a policy changes, update the matching entry here and in
`gift-box-assistant-knowledge.md`.

To push instead of paste: `POST /api/public/knowledge` with `{ externalId, title, content }` and a project API key.
Suggested externalIds are shown under each title so a re-push updates the entry instead of duplicating it.

---

## Entry 1: Gifts overview
externalId: `jm-gifts-overview`

JulineMart Gifts lets a customer send a curated, packaged gift to someone else for one price. It is a gifting layer on the JulineMart marketplace, not a separate shop. Items come from JulineMart vendors and our own sourced stock.

Two ways to buy:
1. Ready-made box (storefront /gifts, box page /gifts/boxes/<slug>). JulineMart chooses the contents and sets one fixed price. Items cannot be swapped, added or removed.
2. Build your own (/gifts/build). The customer picks gift-eligible items from the gift catalogue (not the full marketplace) and a packaging tier. They see one running total and never see per-item prices.

Customers filter by occasion, recipient and budget. A box only shows if its items are in stock; a missing box means "not available right now", not removed.

Gift order numbers look like JLO-GFT-... Gifts are fulfilled at a gift fulfilment centre. The pilot hub is Warri. The whole gift is packed and delivered as one parcel, never split per vendor.

Internal only: never reveal item costs, margins, vendor settlement or how a price is built. If asked why a box costs more than its items, say the price covers curation, packaging, wrapping, assembly and a message card.

---

## Entry 2: Gift pricing, checkout and delivery dates
externalId: `jm-gifts-checkout`

Final total = gift price - promo discount + delivery fee. The delivery fee is quoted live at checkout from the recipient's state and city; never quote a delivery fee yourself.

Promo codes reduce the gift price only, never delivery. A code can be limited to certain boxes, occasions or recipient types. Marketplace-only vouchers are rejected on gifts. Do not create, apply or promise discounts.

Packaging tiers (Build your own only; confirm current prices in admin, these were the seeded values): Standard Box 1,500 NGN up to 5 items, Premium Box 3,500 NGN up to 8 items, Luxury Box 6,000 NGN up to 12 items.

Checkout asks for: buyer name, email, phone; recipient name, phone, address, city, state, zone (recipient email optional); a required requested delivery date; optional message, occasion and occasion date; and a secret-sender choice (sender name hidden from the recipient). The message prints on a card inside the box. Payment is online via Paystack.

Delivery date rules, enforced by the server: earliest date = longest item lead time + 1 packing day. Same-day is only possible if that hub supports it and its daily cutoff (Africa/Lagos time) has not passed; never promise it. Past dates are rejected. Dates more than 90 days ahead are rejected. The customer requests a date, never a specific hour.

---

## Entry 3: Gift order statuses and what they mean
externalId: `jm-gifts-statuses`

Internal pipeline (gift_status): new, packing, packed, dispatched, delivered. A gift order can also be cancelled; if you see a cancelled order or an order with no gift status progress after a cancel or refund, treat it as closed, not as a stuck order.

What the customer sees on the order page: Order placed, Payment confirmed, Being packed with care, Gift box ready, On the way, Delivered, or Gift order cancelled.

- new: paid, waiting for ops to start. Ops packs against a checklist.
- packing: being assembled. QC happens here, optionally with a pack photo, and the message card is printed.
- packed: ready for hand-off to delivery.
- dispatched: a courier shipment exists or a rider has been assigned. Delivery is arranged from this point.
- delivered: complete.

The gift_orders tools show status, recipient city/state, occasion, requested delivery date, pack photo, QC notes and packed/dispatched/completed times. gift_orders.events.read shows who changed what and when. The tools hide recipient email and internal cost.

You can read and explain these. You cannot advance a gift status or cancel an order: those capabilities are off or approval-gated. If a status looks wrong, report it to staff instead of guessing.

---

## Entry 4: Gift cancellation, edits, refunds
externalId: `jm-gifts-cancel-edit-refund`

Policy decided by JulineMart:

- Cancel: a customer may cancel until delivery is arranged, meaning a courier shipment has been created or a rider assigned. Full refund to the original payment method through Paystack, typically 5 to 10 business days. After delivery is arranged the gift is committed; the customer must contact support. A gift is not "locked" at packing; it is locked once delivery is arranged. The same cancel rule applies to normal marketplace orders.
- Edits after payment: customers cannot edit date, address or message. They contact support with the order number and the change wanted. An admin can change recipient details, message or date only until a shipment exists. New dates must still meet the earliest-date rule. The delivery city and state cannot be changed because the fee was priced for them; the fix is cancel and reorder.
- Item out of stock after payment: full refund, started by staff ("Cancel & refund" in Gift ops). No substitution unless the customer agrees. Today the refund returns the full amount paid including delivery.

Never tell anyone a cancel, edit or refund "has been done". Agents explain the policy and collect details (order number, buyer email, what they want); staff or the customer's own order page perform the action.

---

## Entry 5: Failed delivery on gift orders
externalId: `jm-gifts-failed-delivery`

JulineMart does not control the last mile for courier deliveries.

- Courier lane (Fez or Shipbubble): the courier's own re-attempt policy applies. A failed attempt does not cancel the order. On the order timeline a failed or attempted delivery shows as "out for delivery" with the courier's own wording. Do not promise a re-attempt time.
- Local rider lane: redelivery is free; JulineMart pays. After 2 failed attempts that were on the recipient's side (unreachable, wrong address, or refused) the customer is refunded. A failure that was not the recipient's fault, for example the rider's vehicle breaking down, does not count toward the two; we simply send it out again.

Staff drive each step in Delivery Problems: a "Redeliver (free)" button, then a "Refund customer" button after the second recipient-side failure. Never promise an automatic refund or a redelivery time. Apologise, collect the order number, and route to staff.

---

## Entry 6: Returns and return pickup
externalId: `jm-returns-policy`

Return window: 72 hours (3 days) from delivery, for gift orders and normal marketplace orders alike. The window counts from the delivery date, not the payment date. Do not say 14 days.

The customer requests a return from their order page with photos. For a gift, the order address is the recipient's.

Two ways to send it back:
- Drop-off: free, at a Fez location.
- Pickup: we collect it. A JulineMart rider collects when the pickup address is in the same town as our hub; Fez collects otherwise; staff can also choose a Shipbubble courier at approval. The customer gets a tracking link when the courier provides one. If there is no shipping rate for their area, pickup is not offered and they use drop-off.

Who pays for pickup:
- JulineMart pays when it is our fault: damaged, wrong item, not as described, missing items, suspected counterfeit.
- The customer pays when it is their reason: changed their mind, or "other". The fee is shown before they submit, they must agree to it, and staff deduct it from the refund.
- Drop-off is always free.

Return stages: under review, pickup scheduled (or awaiting drop-off), in transit, at hub, inspection, approved, refund processing, refund completed (or rejected / refund failed). Only an admin or manager can approve a refund; agents see "Refund needs an admin or manager". Never promise a refund amount or date. The returns tools (returns.list, returns.read, returns.shipments.read) show reason, inspection result, refund status and amount, and reverse-shipment tracking. They were built before pickup existed, so they may not show the pickup lane or the pickup fee; if you need those, ask staff.

---

## Entry 7: Rules for what agents must never say
externalId: `jm-gifts-never-say`

- Do not promise same-day delivery, a specific delivery hour, or a date earlier than the date picker allows.
- Do not offer to swap, add or remove items in a ready-made box, or to use marketplace items in Build your own.
- Do not quote delivery fees, item prices inside a box, margins or vendor payouts.
- Do not create or promise discounts. Only valid codes entered at checkout work.
- Do not state a cancellation, edit, redelivery or refund as done, and do not promise an automatic refund.
- Do not say the return window is 14 days. It is 72 hours from delivery.
- Do not guess an order's status. Read it with the order tools or tell the person to check My Orders.
- Customised items (engraving, custom text) may take longer. Extra production time is not added to the date automatically yet, and cancellation after customisation is not enforced by a special rule. Send those questions to staff.
- Not yet confirmed, so do not state them as fact: which states and cities are served at launch, whether any hub offers same-day, whether the parcel shows any price, and whether a gift refund should include the delivery fee.

Hand off to a human for: a cancellation the order page will not allow, any change to date, address or message after payment, an out-of-stock refund, a damaged or wrong item, a failed delivery, a customised-item problem, payment taken with no confirmation, and any complaint. Collect the order number (JLO-GFT-...), the buyer's email and a short description first.

---

## Entry 8: Social media and sales guidance for gift content
externalId: `jm-gifts-marketing-guidance`

For the social media manager and sales representative when writing about gifts:

- Say what is true: a curated, packaged gift, one price, a personal message card, a chosen delivery date, optional secret sender, delivered to the recipient's address as one parcel.
- Ready-made boxes are fixed; Build your own lets the buyer pick items and a packaging tier. Do not describe swapping items inside a ready-made box.
- Say "pick your delivery date at checkout", not "same-day" or "delivered in an hour". Scheduling is possible up to 90 days ahead.
- Do not show or imply item-by-item prices or margins. The gift is presented as one price.
- Promo codes: only mention a code that staff or a live campaign has actually issued, and say it applies to the gift price, not delivery.
- Do not say gifts can be edited or swapped after ordering. Customers contact support, and staff can only change details before shipment is created.
- For returns, say customers have 72 hours from delivery, and that pickup or drop-off is available.
- Always check current boxes with gift_boxes.list / gift_boxes.read before naming a box or price; a box may be out of stock or inactive.
