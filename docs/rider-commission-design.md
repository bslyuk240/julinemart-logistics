# Rider Commission — Design Plan

Status: **design resolved, build started 2026-08-20**. This document
captures the agreed design for taking a JulineMart margin on deliveries
fulfilled by local riders, across every place a rider can pick up work. The
data prerequisite (Local Riders zone rates) and a pricing-safety bug found
while seeding it are done — the rest is still to build. See "Build
checklist" at the end for exact status.

## 1. Problem

Riders currently keep 100% of the shipping fee on every delivery they carry
(`rider-earnings.js` sums `allocated_shipping_fee` with no deduction, and the
`riders` table has no commission/wallet column at all). That's fine for
JulineMart's own orders in isolation, but the shipping fee charged to the
customer is priced as if **Fez** were doing the delivery — Fez is the only
courier with real rates configured today. A local rider is cheaper to run
than Fez. If the rider keeps the full Fez-priced fee, the entire cost
advantage of having a rider network is never captured as margin — it just
passes through to the rider instead of Fez.

Separately, `manual_shipments` (staff-created shipments not tied to a
storefront order) has **no price at all** right now — no `shipping_fee`
column exists. That has to be built before commission on manual shipments
means anything.

## 2. Shipment cases that reach the rider

| Case | Table | How it's created | Rider assignment |
|---|---|---|---|
| Storefront orders | `sub_orders` | `create-order.js` | `assign-rider.js` / `broadcast-rider.js` |
| Gift box orders | `sub_orders` | `services/gift-order-insert.js` (inserts into `sub_orders`) | same as above — no separate path |
| Custom/customised orders | `sub_orders` | `create-order.js` + `custom_order_specs` row | same as above — no separate path |
| Manual shipments | `manual_shipments` | Staff form (`CreateManualShipment.tsx`) | `manual-shipment-assign-rider.js` / `manual-shipment-broadcast-rider.js` |
| Hub Dispatch board | — | Not a data source. A bulk-action UI (`HubDispatch.tsx` desktop, `Dispatch.tsx` mobile) over sub-orders/manual shipments pending at a hub. Calls the exact same assign/broadcast endpoints. | — |
| Returns / reverse pickups | `return_shipments` | — | **Not wired to riders at all today.** No `assigned_rider_id`/`courier_id` column; Fez-pickup only. Explicitly excluded from the `shipments` unification migration ("nothing to unify from it yet"). Out of scope here — flagged as a gap if riders should handle return pickups eventually. |

Three of the four rider-reachable cases (`sub_orders`, its gift/custom
variants, and Hub Dispatch) already share one table and one rider pipeline.
The only structurally different case is `manual_shipments`.

There is also an in-progress `shipments` table (additive-only migration,
2026-08-17) that both `sub_orders` and `manual_shipments` are migrating
their dispatch fields into. `rider-jobs.js` already reads primarily from it.
This is the intended long-term single home for dispatch state, including
whatever this design adds.

## 3. Pricing architecture as it exists today (verified against the live DB)

- `couriers` table has `base_rate`/`rate_per_kg` columns, but **`calc-shipping.js`
  never reads them.** They're vestigial for pricing purposes.
- The actual price comes from `shipping_rates`: rows keyed by `zone_id` (and
  optionally `hub_id`), each with its own `flat_rate` / `per_kg_rate`, joined
  to a `courier_id` only for display/labeling.
- At checkout, `calc-shipping.js` does **not** filter by courier. It picks the
  highest-`priority` active `shipping_rates` row for the resolved zone (hub
  match first, falling back to a zone-only match if no hub-specific rate
  exists). Whichever courier that winning row happens to reference becomes
  the quoted courier — it's not a live choice between couriers.
- Checked directly: **Fez Delivery has 24 `shipping_rates` rows (one per
  zone). Every other courier — including "Local Riders" — has zero.** DHL,
  GIG Logistics, GIGL, Kwik Delivery, and Lily Cargo are selectable labels in
  the manual-shipment courier dropdown but are not wired into the pricing
  engine at all. "Local Riders" exists as a real `couriers` row (used to tag
  rider-fulfilled shipments and to appear in that dropdown) but has never
  been given a rate.
- Zone resolution itself is simple: a `zones` table with a `states` array
  column; a delivery `state` string is matched case-insensitively against
  each zone's `states` array, falling back to the first zone if nothing
  matches. City is not used for zone resolution.

**Consequence:** every quoted shipping fee today is a Fez rate, regardless of
who ends up delivering it. This is not a bug to fix — it's the mechanism the
commission design builds on.

**Bug found and fixed while seeding §12.1's data (2026-08-20):** the
hub-based rate lookup in `calc-shipping.js` (and its zone-only fallback) had
no `.order('priority', ...)` at all — just `.limit(1)` on an unordered
query. Harmless while Fez was the only courier with rows (nothing to
tie-break), but seeding a second courier's rows for the same hub+zone pairs
would have made the customer-facing quote non-deterministic — could've
silently started quoting the rider rate instead of Fez's. Added the same
`.order('priority', { ascending: false })` the vendor-direct branch already
had, *before* seeding anything, then verified directly against the DB that
Fez (`priority: 0`) still wins over the new Local Riders rows
(`priority: -1`) for a sample hub+zone.

## 4. Design: two rate lookups, not a stored percentage

Reject a flat `commission_pct` config value. Instead:

1. **Customer price** — unchanged. The existing top-priority `shipping_rates`
   lookup, which resolves to Fez's rate today. No code changes to this path.
2. **Rider payout** — a *second* lookup, using the exact same
   `baseRate + weight × per_kg_rate + pickupSurcharge` formula
   `calc-shipping.js` already runs, but filtered specifically to
   `courier_id = Local Riders` for that same zone/hub, instead of taking the
   top-priority row regardless of courier.
3. **Margin** = customer price − rider payout. Never stored as a percentage;
   it falls out naturally from having two real rate tables, and it can vary
   zone-to-zone the way a single global percentage never could (riders might
   be dramatically cheaper in a dense town, only marginally cheaper somewhere
   sprawling).

This requires no new settings page or config row. It requires the
`shipping_rates` table to actually have rows for the "Local Riders" courier.

**Done (2026-08-20):** seeded 24 rows (one per zone × hub, mirroring Fez's
exact coverage) at 80% of Fez's `flat_rate`/`per_kg_rate`, `priority: -1` so
they never win the customer-facing lookup. Placeholder numbers, not real
ones — reduce-by-20%-and-review-later was the explicit instruction, not a
finished rate card. Edit them directly on the existing `/admin/rates` page
(desktop `ShippingRates.tsx` / mobile equivalent), which already supports
per-courier, per-zone, per-hub rates — no new admin UI needed for this part.

## 5. Manual shipments: routing the same lookup through two pickup modes

`CreateManualShipment.tsx` already has `senderMode: 'hub' | 'manual'`:

- **`hub` mode** — `sender_hub_id` is set. Structurally identical to a
  sub-order's hub-based dispatch: use `hub_id = sender_hub_id`, resolve
  `zone_id` from the recipient's state exactly as checkout does today, run
  the existing hub+zone `shipping_rates` lookup.
- **`manual` mode** — a raw sender address, no hub. Priced by the
  **sender's** zone (see the resolved decision below), the same way
  `calc-shipping.js`'s `vendor_direct` branch already prices by a pickup
  point's own zone rather than the destination's — reusing that exact
  mechanism, `.eq('zone_id', senderZoneId)` with no hub filter.

**Resolved (2026-08-20): pickup location must factor in, not just
destination.** Decided against destination-only pricing for `manual` mode.
The mechanism: mirror `calc-shipping.js`'s existing `vendor_direct` branch,
which already prices by the *pickup* point's own zone rather than the
destination's (`resolvedZoneId = loc.zone_id`, the vendor's location) — a
no-hub manual shipment is structurally the same situation (a specific
non-hub pickup point), so it gets the same treatment: priced by the
**sender's** zone, not the recipient's.

This requires the sender's state to be reliably resolvable, which free text
doesn't guarantee — `CreateManualShipment.tsx`'s `manual` sender mode needs
its state field changed from a free-text input to a dropdown of the same
states `zones.states` actually matches against, exactly like `HubDispatch`
already never lets a hub be picked by typing a name. City can stay free
text (not used for zone resolution — see the zone-resolution note above);
only state needs to be constrained.

Either way, `manual_shipments` needs two new columns it doesn't have today:
- `zone_id` — resolved and stored at creation, so the assignment-time rider
  lookup doesn't need to re-derive it from the recipient address.
- `shipping_fee` — the customer-facing price, computed once at creation via
  whichever lookup path above applies. Today this column doesn't exist at
  all; manual shipments currently have no price.

## 6. When the numbers get computed and frozen

Two distinct moments per shipment, not one:

- **Customer price** (`shipping_fee` / `allocated_shipping_fee`) — computed
  once at creation (checkout for sub-orders, the manual-shipment form for
  manual shipments). Already true for sub-orders today; new behavior for
  manual shipments.
- **Rider payout** — computed once, the moment the job first becomes visible
  to a rider for a decision, **not** at final acceptance:
  - **Broadcast** (`broadcast-rider.js` / `manual-shipment-broadcast-rider.js`)
    — frozen the instant the job is posted (`status → 'broadcasting'`),
    before any specific rider is chosen. Every eligible rider needs to see
    the same number while deciding whether to claim it.
  - **Direct assign** (`assign-rider.js` / `manual-shipment-assign-rider.js`)
    — frozen the instant `assigned_rider_id` is set. Direct-assigned jobs
    still go through an accept/decline step (`rider-jobs.js` already tracks
    `rider_accepted_at` / `declined_by` in metadata) — the number must exist
    *before* that step, not after.

Neither number is ever recomputed later. If the platform's rider rates
change next month, only jobs assigned after that change pick up the new
numbers — exactly how `allocated_shipping_fee` already behaves today
(computed once, never retroactively recalculated even if `calc-shipping.js`'s
underlying rates change afterward). This matters for trust: a rider who
accepted a job at a shown price can't have that price silently change later,
and reporting on past deliveries has to stay stable regardless of rate
changes going forward.

## 7. Rider-facing display — a required change, not optional

Checked directly: `rider-app/src/pages/Home.tsx` renders `job.fee` on every
job card (both broadcast and direct-assigned), sourced from `rider-jobs.js`'s
`fee: Number(subOrder.allocated_shipping_fee ?? subOrder.courier_charge ?? 0)`
— today, the customer's full shipping fee.

Once commission exists, **that field must switch to the rider's payout**, not
the customer's fee. If it doesn't, a rider sees one number, accepts, and gets
paid a different (lower) one — which will tank claim rates and trust fast,
especially under the broadcast "first to claim" model where riders decide
quickly off the number shown. This is a required change to `rider-jobs.js`'s
response shape, not a nice-to-have.

## 8. Where the numbers live (schema)

Given the in-progress `shipments` unification table is already the read
target for `rider-jobs.js`, `rider_payout` (and whatever the customer price
resolves to at the time of assignment) belongs there — one column, one
place — rather than duplicated separately on `sub_orders` and
`manual_shipments`. For `sub_orders`-sourced rows the margin will typically
be positive (Fez-priced fee minus a cheaper rider rate); nothing needs a
special case for that, it's just what the two-lookup math produces.

New columns needed:
- `manual_shipments.zone_id` (new — doesn't exist today)
- `manual_shipments.shipping_fee` (new — doesn't exist today)
- `shipments.rider_payout` (new — the frozen, commission-adjusted number)

No new settings table, no `commission_pct` config value — see §4.

## 9. Payout: withdrawals and finance sync

### 9a. What already exists — and why it's not enough as-is

`settlements.js` already writes rider payments into `ledger_expenses`,
labeled `"Local rider payment — {name} (1 delivery, ...)"`, and
`monthly_pnl_view`'s `gross_profit = revenue − expenses` already nets that
against revenue automatically. The finance-sync plumbing is real, not
missing. Two problems with it as it stands:

1. **It settles the full fee, not a payout.** The amount written is
   `real_shipping_cost ?? allocated_shipping_fee ?? courier_charge` — today,
   the entire customer-paid shipping fee, because the rider currently keeps
   100% anyway. The moment §4's margin exists, this has to become
   `rider_payout` specifically, or the ledger expenses the full fee and the
   margin this design exists to capture disappears right back out of the P&L.
2. **It's not tied to a specific rider.** The settlement query never selects
   `assigned_rider_id`; `paid_to` is free text a staff member types by hand
   ("Local Rider" by default). It's disconnected from the `riders` table and
   from `rider-earnings.js`'s per-rider running total — today there are two
   unconnected systems: a rider-facing earnings display with no payout
   mechanism, and a staff-facing settlement tool that pays out generically
   without recording which rider it was.

### 9b. The fix — mirror `vendor_withdrawals`, not the generic settlement path

`vendor_withdrawals` + `vendor_earnings_summary` is the exact shape riders
need, already proven:

- `vendor_withdrawals`: `amount`, `status` (`pending`/`approved`/`rejected`/`paid`),
  `bank_name`/`bank_account_number`/`bank_account_name`, `payment_reference`,
  `payment_date`, `reviewed_by`/`reviewed_at`.
- `vendor_earnings_summary` (view): `available_balance = net_earnings −
  SUM(paid withdrawals)`, one row per vendor, gates how much can be requested.
- `vendor-withdrawals.js`: vendor `POST`s a request (rejected if `amount >
  available_balance`, read from the summary view) → admin `PUT`s
  `action: 'approve' | 'reject' | 'paid'`.

Riders get the identical shape:

- **`rider_withdrawals`** — same columns, `rider_id` instead of `vendor_id`.
- **`rider_earnings_summary`** (view) — `available_balance =
  SUM(shipments.rider_payout WHERE status = 'delivered') − SUM(paid
  rider_withdrawals)`. Reading from `shipments` here also fixes
  `rider-earnings.js` currently only summing `sub_orders` — manual-shipment
  deliveries start counting automatically.
- **`rider-withdrawals.js`** — mirrors `vendor-withdrawals.js`: rider requests
  (bounded by available balance), admin approves/rejects/marks paid.
- **On `action: 'paid'`** — write to `ledger_expenses` the same way
  `settlements.js` already does, same category/shape, but `paid_to` derived
  from `riders.full_name` (not free text) and amount = the withdrawal amount,
  which is bounded by real `rider_payout`, never the full fee.

The existing generic per-sub-order settlement path in `settlements.js`
should be retired once this exists — two ways to pay a rider is worse than
one, and only this path knows which rider actually got paid.

## 10. Rider onboarding needs a payout-account step — currently nothing exists

Checked directly: `riders` has zero bank/payout columns, the application
payload (`RiderApplicationPayload` in `rider-app/src/lib/api.ts`) doesn't
collect any, and `rider-profile.js` is explicitly read-only today (its own
comment says so) — so even after adding the columns, there's currently no
endpoint for a rider to ever set or edit them.

Two pieces needed, both currently absent:

1. **Collect it at application time**, alongside the NIN/ID/vehicle
   docs/guarantor info already gathered — `bank_name`, `bank_account_number`,
   `bank_account_name` added to `RiderApplicationPayload` and the `riders`
   table (mirrors where vendors already store these fields directly on their
   own profile row). Reviewed at the same approval step
   `MobileRiderVerifications`/`RiderVerifications.tsx` already handle for
   ID/vehicle/guarantor — a natural place to also eyeball that the account
   name roughly matches the applicant, same low-friction check already
   happening there for everything else.
2. **A way to edit it after approval.** `rider-profile.js` has no write path
   at all right now. Needs one (or a new `rider-profile-update.js`) so a
   rider who changes banks isn't stuck. **Resolved (2026-08-20): requires a
   review/cooling-off step, not instant self-service** — a rider submits a
   bank-detail change, it doesn't take effect immediately, and it can't be
   used as a withdrawal destination until either staff confirms it or a
   cooling-off window elapses (mirrors why the money-out direction of KYC
   gets more scrutiny than the money-in direction). Exact mechanism (staff
   approval queue vs. a fixed delay) still to be designed when this gets
   built — the decision here is *that* it needs gating, not the precise
   gate.

`rider-withdrawals.js`'s `POST` (§9b) should also reject cleanly with a
"complete your payout details first" error if `riders.bank_account_number`
is empty, rather than accepting a request it can't ever pay out.

## 11. Explicitly out of scope

**Return/reverse-pickup commission.** Riders aren't wired into returns at
all yet (§2). Nothing to design here until that pipeline exists.

**Distance or pickup-zone-based pricing** for no-hub manual shipments (§5).
Flagged as an open question, not designed.

## 12. Decisions — all three resolved 2026-08-20

1. ~~Local Riders zone rates.~~ **Resolved.** Seeded at 80% of Fez's rates
   per zone (§4) — placeholder numbers pending your own review/adjustment
   via `/admin/rates`, not final pricing.
2. ~~Whether pickup location should factor into no-hub manual-shipment
   pricing.~~ **Resolved: yes** — priced by the sender's own zone via a
   state dropdown, not the recipient's (§5).
3. ~~Whether post-approval bank-detail edits need a review step.~~
   **Resolved: yes, needs review/cooling-off**, not instant self-service
   (§10).

No open decisions remain blocking the build. What's left is implementation
(the checklist below) plus the two things §12.1 and §12.3 deliberately left
underspecified: the *real* rider rates (you review/adjust what's seeded) and
the *exact* review/cooling-off mechanism for bank-detail changes (staff
queue vs. fixed delay — a smaller design choice to make when that piece
gets built).

## Build checklist

- [x] Populate `shipping_rates` rows for the "Local Riders" courier, per zone
      — seeded 2026-08-20 at 80% of Fez's rates; review/adjust via
      `/admin/rates`
- [x] Fix missing `.order('priority', ...)` on `calc-shipping.js`'s
      hub-based rate lookup + its zone-only fallback (found while seeding
      the above — see §3)
- [ ] Add `manual_shipments.zone_id`, `manual_shipments.shipping_fee`
- [ ] Change `CreateManualShipment.tsx`'s `manual`-mode sender state field
      from free text to a dropdown (§5) — needed before sender-zone pricing
      can be computed reliably
- [ ] Compute `shipping_fee` on manual-shipment creation: `hub` mode → hub+
      destination-zone lookup; `manual` mode → sender-zone-only lookup (§5)
- [ ] Add `shipments.rider_payout`
- [ ] Compute + freeze `rider_payout` in `broadcast-rider.js`,
      `manual-shipment-broadcast-rider.js`, `assign-rider.js`,
      `manual-shipment-assign-rider.js`
- [ ] Switch `rider-jobs.js`'s `fee` field from `allocated_shipping_fee` to
      `rider_payout`
- [ ] Add `bank_name`/`bank_account_number`/`bank_account_name` to `riders`
      and `RiderApplicationPayload`; surface in the verification review screen
- [ ] Build a rider profile-update endpoint (currently none exists) for
      post-approval bank-detail edits, per the review/cooling-off decision in
      §10
- [ ] Add `rider_withdrawals` table + `rider_earnings_summary` view
- [ ] Build `rider-withdrawals.js` (request / approve / reject / paid)
- [ ] On withdrawal `action: 'paid'`, write `ledger_expenses` (mirrors
      `settlements.js`'s existing pattern, keyed to the real rider)
- [ ] Retire the generic per-sub-order rider settlement path in
      `settlements.js` once withdrawals cover that ground
- [ ] Switch `rider-earnings.js` to read `shipments.rider_payout` instead of
      `sub_orders.allocated_shipping_fee`
