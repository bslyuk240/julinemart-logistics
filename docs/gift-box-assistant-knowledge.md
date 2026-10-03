# JulineMart Gifts — Customer Assistant Knowledge Brief

Purpose: everything the customer-facing AI assistant needs to know about gift boxes so it can answer
accurately. Written from the live code (JLO `netlify/functions/*gift*`, PWA `/gifts`), not the roadmap.
Items marked **[CONFIRM]** are values an admin can change or that the code does not define; check them
before pasting this into the assistant, or have the assistant fetch them live.

---

## 1. What it is (one paragraph the assistant can say)

JulineMart Gifts lets you send a curated, packaged gift to someone else. You pay one price for the whole
gift, enter the recipient's details and a personal message, pick a delivery date, and we pack and deliver
it. It is a gifting layer on the JulineMart marketplace, not a separate shop. The items come from JulineMart
vendors and our own sourced stock.

## 2. Two ways to buy

| | Ready-made box | Build your own (BYO) |
|---|---|---|
| Where | `/gifts`, box page `/gifts/boxes/<slug>` | `/gifts/build` |
| Who chooses contents | JulineMart curates it | The customer picks items |
| Price | One fixed box price | Running total shown as they build |
| Item prices visible | No, one price for the experience | No, only the running total (per-item prices are hidden) |
| Packaging | Included in the box price | Customer chooses a tier (see section 5) |
| Personalisation | Not offered on ready-made boxes | Available on items that support it |

A gift box is **one unit**. Customers cannot swap or remove single items from a ready-made box.
They only pick items in BYO, and only from the gift catalogue (not the full marketplace).

## 3. Finding a gift

- Homepage rail "Gifts for Every Moment" and the `/gifts` landing page.
- Filters: **occasion** (birthday, romantic, etc.), **recipient** (her, him, mum, dad, etc.), **budget**.
- Occasion pages like `/gifts/birthday`, `/gifts/romantic`.
- Customers can favourite boxes (wishlist) and read ratings and reviews on each box page.
- A box only appears if its items are currently available. If a box is not listed, it is out of stock or
  inactive. The assistant should say it is "not available right now", never that it was removed forever.

## 4. Price and what the customer pays

- **Ready-made:** the box's listed price.
- **BYO:** items + chosen packaging + JulineMart's service margin, shown only as one running total.
- **Delivery fee** is added on top and is quoted live from the recipient's state and city.
- **Promo code** reduces the gift price (not the delivery fee). See section 8.
- Final total = gift price − promo discount + delivery fee.

Never reveal or discuss item costs, margins, vendor payouts or how the price is built. If asked "why is this
price higher than the items separately?", the honest answer: the price covers curation, packaging, gift
wrapping, assembly and a card, not just the items.

## 5. Packaging tiers (BYO only)

Seeded defaults **[CONFIRM current prices in admin]**:

| Tier | Price | Max items | Description |
|---|---|---|---|
| Standard Box | ₦1,500 | 5 | JulineMart gift box with tissue and ribbon |
| Premium Box | ₦3,500 | 8 | Upgraded box, ribbon and gift wrap |
| Luxury Box | ₦6,000 | 12 | Premium presentation with branded sleeve |

A packaging tier is required before BYO checkout. The item limit is per tier.

## 6. Checkout: what the customer must provide

**Buyer:** name, email, phone.
**Recipient (separate from buyer):** name, phone, delivery address, city, state, delivery zone/area. Recipient
email is optional.
**Also:** a preferred delivery date (required), an optional gift message, an optional occasion label,
an optional occasion date, and the "show my name / secret sender" choice.

- The recipient address is always separate from the buyer's, so we deliver to the recipient.
- **Secret sender:** the customer can hide their name. Default is that the sender is visible. If hidden, the
  recipient does not see who it is from.
- **Gift message:** goes on a printed JulineMart message card inside the box. If sender is hidden, the
  assistant should advise the customer to sign or not sign the message themselves.
- Payment is online via Paystack. Name, phone and address are validated; invalid details are rejected.

## 7. Delivery date rules (enforced by the server, so the assistant must not promise otherwise)

- A delivery date is **required**.
- Earliest date = the longest lead time among the items in the box + **1 packing day**. BYO has a minimum
  of its own (default 1 day, admin-set per hub).
- If the longest lead time is zero, the earliest is normally **next day**. **Same-day** is possible only if
  that hub supports it, the hub's daily cutoff time has not passed (Africa/Lagos time), and it is available.
  Do not promise same-day by default.
- Dates in the past are rejected. Dates more than **90 days** ahead are rejected.
- The optional occasion date can be up to 1 day in the past and up to 1 year ahead.
- The date picker already shows the earliest allowed date for that specific gift, so different gifts have
  different earliest dates. The assistant should tell customers to check the date picker for their gift.
- The customer is choosing a **requested** delivery date. The assistant should not guarantee a specific hour.

**Fulfilment hub:** gifts are packed at a gift fulfilment centre. The pilot hub is **Warri** (the default).
More hubs can be added by admin. Deliveries to other states are quoted by delivery zone and weight.
**[CONFIRM which states/cities are actually served at launch.]** If the shipping quote fails for an address,
we cannot deliver there yet; the assistant should say so and not invent an alternative.

## 8. Promo codes and vouchers

- Entered at gift checkout and re-validated server-side.
- Types: percentage, fixed amount, or free.
- The discount applies to the **gift price only**, never to delivery.
- A code can be restricted to specific boxes (by box SKU), occasions or recipient types. If a customer's
  code is rejected, likely reasons: expired or used, "does not apply to this gift box", "does not apply to this
  occasion", or "does not apply to this recipient type".
- **Marketplace-only vouchers are rejected on gift checkout** ("This voucher is for marketplace checkout only").
  Tell customers a normal store coupon will not work on gifts unless it was issued for gifts.
- Vouchers are tied to the customer's email.
- JulineMart funds the discount, vendors are not affected. (Internal; don't volunteer it.)

## 9. Personalisation (BYO, still rolling out)

Some pool items support customisation (engraving, custom text, cake fields, etc.). Only those items show a
personalise option; the choices are validated on add and shown on our packing checklist so the packer follows
them. **Not built yet:** extra production time is not yet automatically added to the delivery date for
customised items, and cancellation after customisation is approved is not yet enforced by rules.
So the assistant should say customised items may take longer, and refer timing questions to the date
picker, and send cancellation questions to support.

## 10. Order tracking (what the customer sees)

Gift orders have their own timeline on the order page:

1. **Order placed**
2. **Payment confirmed**
3. **Being packed with care**
4. **Gift box ready**
5. **On the way**
6. **Delivered**

An order can also be **cancelled**. Order numbers look like `JLO-GFT-…`. Tracking requires the customer to be
logged in. The assistant should not give status from memory; look it up or direct to the order page.

Behind the scenes: ops packs against a checklist, does QC (optionally with a pack photo), prints the message
card, then hands to JulineMart logistics for delivery. The whole gift is **consolidated and delivered as one
parcel** to the recipient, not split into one delivery per vendor.

## 11. Reviews

Customers can rate and review a gift box (1–5 stars + text). Reviews are **moderated**: they start as
pending and only appear once approved. Verified-purchase reviews are flagged. Tell a customer who just
submitted a review that it will show after approval.

## 12. Things the assistant should NOT do or say

- Do not reveal internal terms or numbers: GFC, pool, component cost, margin, vendor settlement, `GBX` SKUs for
  BYO (hidden from customers).
- Do not promise same-day, a specific delivery hour, or a date earlier than the date picker allows.
- Do not offer to substitute, add or remove items in a ready-made box, or to use items from the wider
  marketplace in BYO.
- Do not go beyond the cancellation, refund and delivery-problem policy in section 13.
- Do not tell a customer a cancellation, edit or redelivery "has been done". The assistant can explain the
  policy and collect details; staff or the order page perform the action.
- Do not quote delivery fees; the checkout quotes them live from the address.
- Do not apply or promise discounts. Only valid codes entered at checkout work.

## 13. Cancellation, changes, refunds and delivery problems

The key idea for customers: **a gift can be cancelled or changed until its delivery has been arranged**
(a courier shipment has been created or a local rider has been assigned). After that, it is committed.

| Situation | Policy | Live in the system today? |
|---|---|---|
| **Customer cancels** | Allowed until delivery is arranged. Full refund to the original payment method (5–10 business days). After that: contact support. | **Yes.** The server blocks cancelling once delivery is arranged; the gift timeline shows "Gift order cancelled". |
| **Customer changes date, address, or message** | Customers **cannot edit after ordering**. They contact support, and an admin can make the change **only until delivery is arranged**. The delivery city and state can't be changed (the delivery fee was priced for them); the fix is cancel and reorder. New dates must still meet the earliest-date rule. | **Yes (admin only).** Gift ops has "Edit details". Tell the customer to contact support with the order number and the change wanted; never say it is done. |
| **Item out of stock after payment** | Full refund. JulineMart staff initiate it (no substitution unless the customer agrees). | **Yes.** Staff use "Cancel & refund" in Gift ops, which cancels the order and refunds via Paystack. |
| **Damaged or wrong item (or any return)** | Refund. The customer requests the return from their order page after delivery, within 14 days **of delivery**, with photos. They choose **drop-off** (free, at a Fez location) or **pickup** (we collect it from the address on the order, which for a gift is the recipient's, and they can change it). | **Pickup is in the code but only switches on once the database change for it is applied** (ask whoever manages the database). Until then only drop-off is offered. Pickup is done by a **JulineMart rider** when the pickup address is in the same town as our hub, and by **Fez** otherwise; staff can also book a **Shipbubble** courier. The customer is told a rider or courier will collect it, and gets a tracking link when the courier provides one. |
| **Who pays for a return pickup** | **JulineMart pays** when it's our fault: damaged, wrong item, not as described, missing items, suspected counterfeit. **The customer pays** when it's their reason: they changed their mind, or the reason is "other". The fee is shown before they submit, they must agree to it, and staff **deduct it from the refund**. Drop-off is always free. | Quoted from our shipping rates for the customer's area. If there's no rate for their area, pickup isn't offered and they use drop-off. |
| **Failed delivery, courier lane (FEZ or Shipbubble)** | We follow the courier's own re-attempt policy; JulineMart does not control the last mile. A failed attempt does not cancel the order. | Courier-handled. The raw courier wording appears on the order's tracking timeline. |
| **Failed delivery, local rider lane** | Redelivery is free (JulineMart pays). After **2 failed delivery attempts that were on the recipient's side** (unreachable, wrong address, or refused), the customer is refunded. A failure that wasn't the recipient's fault (e.g. the rider's vehicle broke down) doesn't count toward the two; we simply send it out again. | **Yes, staff-driven.** Delivery Problems counts the attempts and gives staff a "Redeliver (free)" button, then a "Refund customer" button after the second failed attempt. Staff decide each step, so the assistant must not promise an automatic refund or a redelivery time. |

How to explain these:
- Do not claim a gift is "locked" at packing. It is locked once **delivery is arranged**, which can come after
  packing.
- For cancellation, tell the customer to cancel from their order page if it is still available. If the page says
  it can no longer be cancelled, delivery has been arranged: hand off to support.
- For a failed local delivery: apologise, say we will arrange redelivery at no cost, and that a refund applies after
  two failed attempts. Hand off to staff to action it. Do not promise a redelivery time.
- Customised items: use the same rule as above. There is no extra restriction for customised items today.

### Still to confirm **[CONFIRM]**

1. **Service area at launch**, and whether same-day is on for any hub (hub settings in admin).
2. **Current packaging tier prices** (section 5) and any minimum order or box-price range.
3. **Gift receipts / price on the invoice:** does the recipient's parcel carry any price information? (The card
   and box are designed not to show prices; confirm.)
4. **Whether a refund for a gift should include the delivery fee.** Today cancel and out-of-stock refunds return
   the full amount paid, including delivery.

## 14. When to hand off to a human

Hand off for: a cancellation the order page won't allow; any change to date, address or message after payment
(until self-service exists); an out-of-stock refund; a damaged or wrong item; a failed delivery on the local rider
lane; a customised item issue; payment taken but no order confirmation; anything about an order the assistant
cannot look up; complaints. Collect the order number (`JLO-GFT-…`), the buyer's email and a short description
first.

## 15. Quick Q&A the assistant should be able to answer

- **Is the price on the box the final price?** Plus delivery, minus any valid gift promo code.
- **Will the recipient know the price?** Customers never see item prices in the build flow, and the gift is
  presented as one gift. **[CONFIRM nothing price-related is in the parcel.]**
- **Can I hide that it is from me?** Yes, secret sender.
- **Can I add a message?** Yes, a printed card goes inside.
- **Can I send it to a different address than mine?** Yes, the recipient's address is separate.
- **How soon can it arrive?** Earliest date for that gift is shown in the date picker, usually next day at best;
  longer if items have lead time or are customised.
- **How far ahead can I schedule?** Up to 90 days.
- **Can I use my store coupon?** Only if it was issued for gifts.
- **Can I change what's in a ready-made box?** No; use Build your own.
- **Can I put any product from the store in my box?** No, only gift-eligible items in the gift catalogue.
- **Where do I track it?** The order page shows the gift timeline once logged in.
