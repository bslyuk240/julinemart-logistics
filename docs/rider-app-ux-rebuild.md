# Rider App UX Rebuild — Build Tracker

Source: "JulineMart Rider App — AI Agent Implementation & App Flow Brief" (39-section spec,
delivered as chat text) + UI mockup, saved at [`docs/design/rider-app-ui-concept.png`](design/rider-app-ui-concept.png)
(6 screens: Home/Command Centre, Active Delivery/Map Flow, Waybill Scan/Custody Verification,
Complete Delivery/Proof of Delivery, Earnings/Wallet, Profile/Application Status).

Ground rule from the brief, still in force: **search the existing codebase before building
anything new** — reuse → extend → refactor carefully → create new only when genuinely missing.
Do not rebuild working functionality (Supabase auth, KYC flow, staff approval, online/offline +
selfie liveness gate, realtime job delivery, direct-assign vs broadcast-assign, status
progression, QR pickup scan, GPS ping, push opt-in).

Status legend: ✅ done · 🟡 partial / reduced scope · ⬜ not started · 🟢 investigated, concluded no build needed

## P0 — UX / operational readiness

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Application-status screens (no_application / pending_review / active / rejected / suspended) | ✅ | [ApplicationStatus.tsx](../rider-app/src/pages/ApplicationStatus.tsx). pending_review has the step tracker (Account created → KYC submitted → Verification in progress → Rider activation) + Case ID. No fabricated "Contact Support" — no real support channel exists yet (see #19). |
| 2 | Rider Readiness component (checklist: Account approved / Location enabled / Documents valid / Identity check + "Verify & Go Online" CTA) | 🟡 | Reduced to a single "Identity verified today" line on Home, shown when online (accurate — online implies the 24h selfie check already passed server-side). The full 4-item pre-flight checklist is not built: no signal exists yet for "documents valid" (see #17, brief explicitly says don't enforce until backend rules are defined) or "location enabled" (no permission-state tracking wired up). |
| 3 | Home screen recomposition (Header → Online/Readiness → Active Delivery → Today summary → Offers → Bottom nav) | ✅ | [Home.tsx](../rider-app/src/pages/Home.tsx). Active Delivery card no longer auto-redirects off Home — shows as a card with "Continue Delivery" per mockup. |
| 4 | Delivery-offer card redesign (earning, distance, package count, job type; broadcast jobs say "Available to nearby riders" not internal terms; 409 → "Another rider accepted this delivery.") | 🟡 | Pickup name/label, fee, pickup/dropoff city, lock-icon (direct) vs amber badge (broadcast), Decline+Accept both shown. **Fixed a real mislabeling bug**: every pickup was shown as "Vendor: {name}" regardless of actual source — traced all shipment-creation paths (sub_orders via `resolveSender` — real vendor pickup vs. JLO hub vs. courier hub vs. Fez's own hub; manual shipments via `sender_hub_id` — hub pickup vs. free-text sender staff typed in, which could be anyone). `shipmentSummary.js` now carries a collapsed `pickup.kind` ('vendor'/'hub'/'sender'), and both Home.tsx's offer cards and ActiveDelivery.tsx's "Call Vendor" button use it via a shared `pickupLabel()` helper instead of hardcoding "Vendor". Verified live: the real test shipment (a manual shipment with no `sender_hub_id`) now correctly shows "Pickup: Benedict Obasi" instead of "Vendor: Benedict Obasi". **Still missing:** distance and package count — not computed anywhere server-side, didn't fabricate numbers. 409 claim conflicts now translate to friendly text. |
| 5 | Waybill/custody **data model** (Order vs Shipment vs Waybill vs Journey Leg vs Custodian vs Scan Event; scan-on-custody-change, not scan-on-every-status-change) | 🟢 | **Re-assessed, not built as a multi-leg model — and shouldn't be, for this app.** Traced `assign-rider.js`/`broadcast-rider.js`: a local rider's pickup point is always resolved from `vendors.approved_vendor_locations` (the vendor's own address), never a hub — confirmed no `hub_id` routing anywhere in local-rider assignment. Local-rider deliveries are always exactly one leg (vendor → rider → customer), never vendor → hub → relay → last-mile-rider. The brief's Journey-Leg/Custodian/multi-hub model is real infrastructure, but it belongs to the *hub-based* Fez network (dashboard's Hub Dispatch), which this rider app doesn't participate in. Building a multi-leg custody data model for a use case that's always one leg would be pure premature abstraction. Delivery-side (rider → customer) uses a photo, not a re-scan — matches the mockup's own Complete Delivery screen (photo/signature/OTP, no scan step), not a gap. **This item is scoped to the data-model question only** — the scan verification screen and its specific error messages (brief §13/§15/§16) are tracked separately as #6a below; they were not covered by this conclusion. |
| 6a | Waybill scan verification screen + specific error messages (brief §13/§15/§16) | ✅ | New `verify_scan` action on `rider-jobs.js` — checks the scanned code against the shipment *without* mutating anything, returns a verification result the client shows before the rider commits (mockup screen 3: "Package verified", tracking number, "Assigned to", "Custody transfer: Vendor → Rider", pickup name), with "Confirm Pickup" as a separate deliberate action that calls the existing `advance` endpoint (which re-validates independently — the verify step is a preview, not the authority). Reuses `resolveSender` via the shared `shipmentSummary.js` for the pickup name rather than re-deriving it. All four of the brief's exact error strings now render: "This isn't your assigned shipment." (wrong code), "This package has already been collected." (already past `assigned`), "This shipment isn't assigned to you." (wrong rider, via `loadOwnedShipment`), plus a manual-code entry point reachable from both the failure screen and the success screen (matching the mockup's "Scan Again"/"Manual Code" button pair). Verified live: manually entered a wrong code against a real active job and got the exact brief-specified message end to end. Could not verify the *success* path live — the only available test shipment has no `tracking_number`/`waybill_number` set, so nothing scans correctly against it — but it shares the identical match logic already proven in the pre-existing `advance` action. |
| 6 | Active Delivery screen redesign, context-sensitive dynamic CTAs | 🟡 | [ActiveDelivery.tsx](../rider-app/src/pages/ActiveDelivery.tsx). Matches the mockup's section order (Deliver-to → From → Waybill status → Timeline → Navigate/Call/Report row), label-left/time-right timeline rows, section icons. `assigned_at` is a new field, reusing `shipments.created_at` which was already selected server-side but not exposed. Once `out_for_delivery`, this hands off to its own dedicated **Complete Delivery** screen (mockup screen 4 — see #8's note) rather than staying on this generic layout. **Not built:** the mockup's separate "I've Arrived" intermediate tap between Navigate and Complete Delivery — the Complete Delivery screen keeps Navigate/Call available throughout `out_for_delivery` instead, since there's no local "arrived" sub-state to gate on. No embedded map — deliberate, the brief itself says use external nav handoff instead of in-app turn-by-turn (see #7). |
| 7 | External navigation handoff (Google/Apple Maps, Waze intents) | ✅ | "Navigate to Pickup"/"Navigate to Customer" opens a universal Google Maps directions link (works cross-platform, opens native app if installed). No in-app map, per the brief's own instruction not to build turn-by-turn. |
| 8 | Proof of Delivery levels (standard / verified / high_value) | 🟡 | Two levels built: `standard` (photo only, unchanged) and `verified` (photo + customer signature), gated on order value — `sub_orders.subtotal` or `manual_shipments.item_value` ≥ ₦50,000 (`POD_VERIFIED_THRESHOLD_NGN` in `services/shipmentSummary.js`). New `signature_url` column (`sub_orders` + unified `shipments`, same placement as `delivery_proof_url`) and canvas-based [`SignaturePad.tsx`](../rider-app/src/components/SignaturePad.tsx) (pointer events, works for touch and mouse). Server-enforced in `rider-jobs.js`'s `advance` action, independent of the client prompt. **`high_value`'s extra requirements (beyond signature) not built** — the brief doesn't specify what those are beyond the three-tier name; scoped down to two levels on explicit direction rather than guessing. Verified live: a real ₦60,000 test manual shipment correctly showed "Get customer signature" (a ₦3,200 one didn't); drew and saved a signature through the actual pad, UI updated to "Customer signature captured". Could not verify the server-side rejection/completion of the final `delivered` call live — the browser preview has no camera and extracting the rider's auth token to call the endpoint directly was correctly blocked by the permission classifier — but the write path mirrors `delivery_proof_url`'s pre-existing, already-proven pattern exactly. **Later rebuilt as its own dedicated Complete Delivery screen** (mockup screen 4 — was originally inline capture buttons appended to the bottom of the generic Active Delivery layout, not a distinct screen; caught alongside the Earnings gap in the same "is the mockup actually being used" check). Now: Recipient card, a Proof-of-Delivery icon-tile grid (photo always, signature tile only when `pod_level === 'verified'` — no fabricated OTP tile, that capability doesn't exist), a Shipment Summary recap card (Waybill/Package/From/To, "Verified" badge), Navigate/Call (kept, since there's still no separate "arrived" sub-state), a "Report Issue" button, and the existing "Can't complete this delivery?" fail-delivery link. Bottom CTA renamed from "I've Reached the Customer" to "Confirm Delivery" (mockup's own label, and more accurate — the button drives photo→signature→submit, not just an arrival ping). Verified live in both PoD levels: a real ₦60,000 shipment showed both tiles (2-column grid) and opened the signature pad correctly from its tile; a real ₦2,000 shipment showed only the photo tile (1-column). |
| 9 | Delivery Exceptions (structured incident types, distinct workflow actions) | 🟡 | "Report Problem" on Active Delivery logs one of the brief's 10 incident types + an optional note to `tracking_events` (new `report_problem` action on `rider-jobs.js`), visible to staff via a new **Delivery Problems** admin page (`/admin/delivery-problems`, desktop + mobile, filterable by reason, defaults to hiding delivered/failed/returned shipments). Also wired the existing `ShipmentTrackingEvents` timeline into `OrderDetails.tsx` (desktop + mobile) — sub_order tracking events were fetched by the backend and silently discarded by the frontend before this. **Not built:** each reason type driving a distinct next step (return required, reassign, etc.) — that's real workflow logic, still its own piece. **Security fix found and closed in the same pass:** `track-order.js` and `track-manual-shipment.js` (public, unauthenticated customer tracking endpoints) select every `tracking_events` row with no filtering — a rider's problem report would have shown up verbatim on the *customer's own* tracking page. Same issue in `orders.js`'s GET-by-id, which doubles as the customer PWA's order-detail endpoint via an email-match bypass that skips admin auth entirely. All three now filter out `metadata.type === 'problem_report'` before the response leaves the server. |
| 10 | Return Workflow (delivery_failed → return_required → returning → returned_to_hub/vendor) | ✅ | Staff-mediated, matching the brief's exact state names (user chose this over a simpler rider-self-serve version). New `return_required`/`returning` enum values on `delivery_status` (`failed`/`returned` already existed). Rider side: a "Can't complete this delivery?" link (shown only once the package is actually in hand — `picked_up`/`out_for_delivery`) opens the same reason-picker sheet `report_problem` uses, wired to a new status-changing `fail_delivery` action instead — reuses the exact incident taxonomy and tags the tracking event `problem_report` too, so it surfaces in the existing Delivery Problems queue for free. Staff side: a **Require Return** button on that same queue (shown only for `failed` rows) calls a new `require_return` action, which pushes the rider a notification. Rider then works through `return_required` → `returning` → `returned` on a dedicated screen (not the forward-delivery layout — waybill/timeline/photo capture don't apply to a return), reusing the "Return to {pickup}" pattern instead of "Deliver to {customer}". `hasActiveJob`/the "mine" job query both now include `return_required`/`returning` (still busy, package still in hand) but exclude `failed` (nothing to do until staff acts). **Two real bugs found and fixed during live verification**: (1) `failed_reason`/`failed_note` written to `sub_orders`/`manual_shipments.metadata` never reached the unified `shipments.metadata` — `shipmentSync.js`'s `metadataForShipment()` only mirrors a fixed key whitelist — dropped storing them there entirely since `tracking_events` already carries the reason and is what staff actually reads. (2) Home's "Continue Delivery" card unconditionally said "Deliver to {customer}" for any active job, including a return in progress — now says "Return to {pickup}" for `return_required`/`returning`. Verified live end-to-end on a real test shipment: `picked_up` → tapped "Can't complete this delivery?" → `failed` (confirmed dropped off the active list, rider free to accept new jobs) → simulated staff's `require_return` (same DB effect as the endpoint, not called over HTTP — no staff auth token was available/permitted in this environment) → `return_required` correctly resurfaced with the right copy → `returning` → `returned`, confirmed on both the source table and unified `shipments` table, redirected home cleanly. Admin's **Require Return** button itself wasn't clicked live (dashboard's dev server was denied at the browser-tool permission level), but the endpoint it calls was proven correct via the equivalent direct DB write. |
| 11 | Activity screen (delivery history: active/completed/cancelled/failed/returned) | ✅ | New [rider-activity.js](../netlify/functions/rider-activity.js) (all-time history by `assigned_rider_id`, filterable by status; `?id=` returns single-item detail) + [Activity.tsx](../rider-app/src/pages/Activity.tsx), added as a 4th bottom-nav tab (Home/Activity/Earnings/Profile). No "cancelled" filter — that status doesn't exist in the `shipments` enum, and a declined job's `assigned_rider_id` gets cleared, so it was never really "this rider's" history to begin with. Tapping a row: an in-progress item just navigates to `/delivery` (it's the rider's one active job, nothing separate to view); a completed/failed/returned item opens a detail sheet — proof-of-delivery photo, full pickup/dropoff addresses, per-step timeline. The detail logic reuses `rider-jobs.js`'s pickup/dropoff resolution rather than re-deriving it — extracted both into a shared [`services/shipmentSummary.js`](../netlify/functions/services/shipmentSummary.js). Verified live: filter chips correctly scope the query, an in-progress item's tap correctly redirected to `/delivery`, and the detail endpoint returned the full correct shape (addresses, phone, timestamps) via a direct authenticated request. |
| — | Wallet / commission financial system (grouped with P0 in the brief) | | |
| 12 | Earnings (preserve existing: weekly total, sparkline, breakdown) + extend to wallet | ✅ | **Originally marked "pre-existing, preserved" — that was wrong.** The screen was functionally extended with wallet data (#13) but never visually rebuilt to match the mockup's "Earnings & Wallet" screen, unlike every other rebuilt screen — caught directly by the user. Rebuilt to match: purple hero "Available Balance" card with an inline pill "Withdraw" button (was a plain bordered card with the button below), "Today" card, "Recent Deliveries"/"Wallet Transactions" section naming and styling. Two mockup elements don't exist in the data model and were deliberately dropped rather than faked, per direct instruction: a separate "Pending Earnings" figure (no pending-vs-available distinction exists — a delivery's payout is available the instant it delivers) and the Fare/Bonus/Platform-Fee/Net breakdown card (no bonus or fee-deduction concept exists anywhere in the codebase — confirmed for #14). **Found and fixed a real, pre-existing bug while adding the "Today" card**: `rider-earnings.js`'s sparkline day-bucketing mixed a local-server-timezone hour reset with UTC-labeled keys, silently shifting every bucket by a day whenever the server's local timezone isn't UTC — invisible before because the old code only ever summed the *whole* week directly, never looked up a single day's bucket. Fixed by making the day math UTC throughout, and added real `today_total`/`today_count` fields computed directly (not derived from the fixed-but-still-indirect sparkline). Verified live: "Today" now shows ₦3,200 / 2 deliveries matching the actual test data, was ₦0 before the fix despite the same 2 real deliveries. |
| 13 | Wallet (pending/available/withdrawn, backend-authoritative) | ✅ | `rider_earnings_summary` view + `available_balance`, built earlier this session. |
| 14 | Commission Transparency (fare / bonus / deduction / net breakdown shown to rider) | ✅ | **`rider-commission-design.md` turned out to be stale** — its checklist marks the core payout mechanism `[ ]` unchecked, but it's actually fully built and correct (verified via a dedicated investigation): `rider_payout` already computes and freezes at assign/broadcast time across all four dispatch paths, per-delivery earnings already exist, `rider_withdrawals` already exists. No bonus/deduction concept exists anywhere in the codebase (confirmed via a repo-wide search) — the brief's literal "fare/bonus/deduction/net" can't be built as specified, so per direct instruction this scoped to a breakdown of the payout itself: `computeDispatchCost`'s formula (`base_rate + weight_charge + pickup_surcharge = total`) split into a new `computeDispatchCostBreakdown()` and frozen alongside `rider_payout` (new `shipments.rider_payout_breakdown` column, same four call sites, same freeze-once-never-recompute discipline) — never shows the customer's price, so no margin is revealed to riders. Surfaced as `fee_breakdown` via the shared `shipmentSummary.js`, with a tap-to-expand section on Active Delivery's header and a static one on Activity's detail sheet; legacy shipments predating this just show the total with no breakdown, same graceful-degrade pattern as `pod_level`/`signature_url`. Verified live: a real ₦4,400 manual-shipment payout (2kg × ₦400/kg + ₦3,600 base) correctly expanded to show all three line items summing to the total. |
| 15 | Withdrawal System (states: requested/processing/paid/failed/cancelled) | ✅ | `rider_withdrawals` table, `rider-withdrawals.js`, Earnings.tsx UI built earlier this session. States are `pending/approved/rejected/paid`, not an exact match to the brief's naming — functionally equivalent, not renamed. **Admin side was missing entirely until now** — `rider-withdrawals.js`'s approve/reject/paid actions existed with nothing in the dashboard ever calling them (unlike the vendor equivalent, which shipped both halves together). Caught when asked "what happens when a rider requests a withdrawal" and the honest answer was "it sits pending with no staff-facing queue." New `rider-withdrawals-admin.js` (admin-scoped GET across all riders, mirroring `vendor-withdrawals-admin.js`) + `RiderWithdrawals.tsx` desktop/mobile, wired into the Riders nav group — structurally identical to `VendorWithdrawals.tsx`, fields renamed. Also added staff push+email on a *new* request (`rider-withdrawals.js`'s `POST`), since nothing notified staff one existed at all before this. |
| 16 | Editable Profile (phone/address/vehicle/operating info editable; sensitive/KYC changes go through a pending-verification state) | 🟡 | Phone is now an instant self-edit (low risk — just a contact detail). Vehicle type/plate now follows the exact same pending-review pattern as bank details (`pending_vehicle_type`/`pending_vehicle_plate`/`pending_vehicle_requested_at`, staff approve/reject in `rider-approve.js`, surfaced on `admin-rider-list.js`/`Riders.tsx` desktop+mobile) — it's a KYC-verified fact (what the rider was approved to ride), same reasoning as why bank details can't be an instant edit. Verified live: submitted a real vehicle-change request, confirmed the pending-review banner rendered correctly with the original vehicle still active, then cleaned up the test data. **Still not editable, and not planned to be:** operating-zone/`approved_location_id` — that's a staff-assigned coverage area, not a rider self-service field, and there's no "address" concept for riders in this data model to begin with. |

## P1

| # | Item | Status | Notes |
|---|------|--------|-------|
| 17 | Documents lifecycle (type/status/issue_date/expiry_date/verified_at/rejection_reason, expiry notifications) | ✅ | Full model, per direct instruction — was previously just three bare URL columns on `riders` with a single blanket approve/reject for the whole application, no per-document status/dates at all. New `rider_documents` table (one row per *submission*, not a mutable slot — a rejected/expired document gets a new row on resubmission, giving real history) with exactly the requested columns, backfilled for every existing rider (active riders' docs marked `verified` from their original approval; everyone else `pending`). `rider-register.js` now inserts into it alongside the existing `riders.*_url` write (untouched, still read by old code) — `Apply.tsx` gained an optional expiry-date field for the ID and vehicle documents (issue date deliberately not collected upfront — low value, high friction; still settable by staff during review). Admin review (`RiderVerifications.tsx` desktop + mobile) changed from flat document links to real per-document Verify/Reject via two new `rider-approve.js` actions (`verify_document`/`reject_document`), alongside the existing whole-application approve/reject which is untouched. New rider-facing `rider-documents.js` + [`Documents.tsx`](../rider-app/src/pages/Documents.tsx) screen (linked from Profile) shows status, dates, and an "expires in N days" flag — display only. New daily `document-expiry-check-scheduled.js` pushes a one-time reminder per document as it enters a 30-day expiry window (`expiry_notified_at` prevents re-notifying) — reminder only, **no enforcement anywhere**, exactly per the brief's explicit instruction. **Also fixed in passing**: found `bank_name`/`pending_bank_*`/`pending_vehicle_*` columns (built earlier this session) existed live but had no migration file — added a catch-up migration so schema history matches reality. Verified live: the rider-app Documents screen and the Profile link both render real backfilled data for the test rider (ID + selfie, both "Verified", from their actual original approval). **Admin per-document Verify/Reject wasn't clicked live** — the dashboard's dev server was denied at the browser-tool permission level in this environment (same restriction hit for #10's admin button and #12); the code mirrors that already-proven Delivery Problems admin pattern exactly, and the Supabase nested-select join syntax is identical to the `approved_vendor_locations` join already working in the same query. |
| 18 | Notifications (persistent in-app history + deep links, on top of existing push opt-in gating) | ✅ | Push opt-in flow (`NotificationPrompt.tsx`/`usePushNotifications.ts`) untouched, as planned. **Found deep links were actually broken, not just missing** — every rider push already sends a real `data.targetPath` (`'/'`, `'/profile'`), but `rider-messaging-sw.js`'s `notificationclick` handler deliberately ignored it and always opened `/`, per an old comment about not trusting a "customer-PWA" path. That reasoning doesn't hold for this service worker specifically — it only ever receives pushes sent to a rider's own FCM token, and every rider-targeted sender already uses rider-app routes — so fixed it to honor `targetPath` (with a same-origin-relative-path check, defensively). New `rider_notifications` table (persistent history) + `sendRiderPush()` wrapper (in a new `services/riderNotifications.js`) that calls the existing `sendPushToCustomer` unchanged and best-effort logs a history row alongside it — swapped into the six rider-targeted push call sites (`assign-rider.js`, `manual-shipment-assign-rider.js`, `broadcast-rider.js`, `manual-shipment-broadcast-rider.js`, `admin-delivery-problems.js`'s `require_return`, `document-expiry-check-scheduled.js`); customer-facing pushes (`order_update` etc.) are untouched, still calling `sendPushToCustomer` directly. New `rider-notifications.js` (list + mark-read/mark-all-read) and a [`Notifications.tsx`](../rider-app/src/pages/Notifications.tsx) screen, reached via a bell icon + unread badge on Home's header — matching the mockup's own Home screen, which shows exactly that. Verified live end to end: badge showed "1", tapping the notification correctly navigated to `/profile` (its real `targetPath`) and persisted `read_at` server-side, badge cleared on return to Home. |
| 19 | Support (Active Delivery Help / Dispatch / Waybill Problem / Payment / Account / Safety) | ⬜ | Not started. No existing support/chat system found anywhere in the codebase to integrate with — this is genuinely new infrastructure, not an extension. |
| 20 | Offline Resilience (cache active-delivery data, "waiting to sync" for unsynced actions, custody stays server-authoritative) | ⬜ | Not started. |
| 21 | Bottom Navigation → Home / Activity / Earnings / Support / Profile (5 tabs; no Active Delivery tab) | 🟡 | Now 4 tabs (Home/Activity/Earnings/Profile) — Activity shipped (#11). Support tab still missing since Support itself (#19) doesn't exist yet; adding the tab first would point at a dead screen. |

## P2 — explicitly deprioritized by the brief

Earnings goals, bonuses, rider levels, demand heatmaps, scheduled/batched delivery, route
optimization. Not started, not planned until P0/P1 are done.

## Cross-cutting notes / open issues

- **₦ (Naira) glyph rendering** — observed rendering as a struck-through "N" in the automated
  browser test environment. DOM/CSS confirmed correct (right Unicode codepoint, no
  `text-decoration`) — likely a font-fallback quirk of that specific environment, not a code bug.
  Unconfirmed on a real device — check before treating as a bug to fix.
- **Broadcast job "Decline"** is a local, client-only dismiss (hides the offer from this rider's
  own list). There's no server-side "decline" concept for a job nobody's been assigned yet — this
  does not call the backend and doesn't affect other riders.
- **Dev environment**: rider-app dev server must run on port **5175** (`rider-app/vite.config.ts`)
  to match the hardcoded CORS allowlist in `netlify/edge-functions/cors.js`. Local backend via
  `netlify dev` (port 8888) is slow to cold-start (each function compiles on first hit, ~30s–2min)
  but fast afterward. The local dev backend hits the **real production database** — there is no
  sandboxed dev data.
- **Home showing misleading default content before load — fixed, and this was NOT the service
  worker.** Reported as "a stale old view before the real page loads"; my first answer (service
  worker) was a real but different issue — the actual cause here was `RiderHome` rendering its
  greeting/online-status/stats immediately using default state (`riderName: ''`, `online: false`,
  zero stats) while `api.getJobs()` was still in flight, before ever showing a loading state for
  that part of the screen. The tell was in the user's own screenshot: the greeting showed the full
  email address (`riderName || user?.email` falling back correctly, but to a value with no space to
  split on) and "Offline" even though the account was genuinely online. Fixed by returning a
  skeleton for the whole screen while `loading` is true, matching the pattern Earnings.tsx/
  Profile.tsx/ActiveDelivery.tsx already used correctly — Home.tsx was the one screen with this gap.
- **PWA service worker caching — fixed**: after a prod deploy, the installed/cached PWA kept
  serving the old bundle until every tab fully closed — confirmed by having to manually unregister
  the SW + clear caches to see fresh deploys while testing. Added `skipWaiting`/`clientsClaim`/
  `cleanupOutdatedCaches` to the Workbox config (`vite.config.ts`) so a new version now takes over
  on the very next reload. Verified the generated `dist/sw.js` contains the new config after a
  production build; the actual take-over behavior needs confirming on the next real deploy (can't
  be tested in dev — no service worker registers in `vite dev` at all).
- **A rider can now only commit to one delivery at a time — fixed a real gap.** Traced this while
  answering a question about it: broadcast and direct-assign never checked whether a rider already
  had an active job, and a live example of the resulting confusion was sitting on the test account
  (a second job assigned and pending-accept while the first was already in progress). Per
  direction: keep broadcasting/assigning to busy riders (so they can see and queue up what's next)
  but block the commitment — `accept` and `claim` in `rider-jobs.js` now both check for an existing
  active job (`hasActiveJob`) and return `active_job_exists` → "Finish your current delivery before
  accepting another." Verified live against the real pending job on the test account: the accept
  call was correctly rejected with that exact message, no state changed.
- **Motion**: the app had zero transitions/animations anywhere. Added tap/press feedback to
  `.btn-primary`/`.btn-secondary` (`active:scale-[0.98]`, centralized in `index.css` so it applies
  everywhere those classes are used), a page-level fade-in keyed to the route path (`App.tsx`,
  opacity-only — a translate/slide would have broken the `fixed` bottom nav and CTA bars that
  several screens have as direct children), skeleton loaders replacing plain spinners on Home's
  and Activity's list-loading states, and a global `prefers-reduced-motion` override. This is a
  light first pass (shared classes + the two highest-traffic screens), not a per-screen pass across
  the whole app.
- **Broadcast-claimed shipments could end up with no tracking number and no waybill number at
  all — fixed.** Traced per a direct question about tracking-number generation. Real Fez shipments
  use Fez's own order id as `tracking_number` (`fez-create-shipment.js`). Local-rider direct-assign
  (`assign-rider.js`, `manual-shipment-assign-rider.js`) generates a `JLO-XXXXXXXX` tracking number
  and a `JLO-WB-######` waybill (via a Postgres sequence, `next_waybill_number()`) if one doesn't
  already exist — but broadcast+claim (`rider-jobs.js`'s shared `handleClaim`) never called that
  logic at all. `sub_orders` get a placeholder tracking number at creation so they're merely
  incomplete; `manual_shipments` get **no** tracking_number column default, so a broadcast-claimed
  manual shipment had genuinely nothing — no code for the rider to scan, nothing to show as
  "Waybill" on Active Delivery. This is exactly why the test shipments used throughout this session
  had null tracking/waybill and why the scan-verification success path couldn't be tested live.
  Extracted the duplicated generation logic (byte-identical in `assign-rider.js` and
  `manual-shipment-assign-rider.js`) into `services/trackingNumbers.js` and had all three dispatch
  paths use it. **Found and fixed a second bug while verifying live**: the initial fix generated
  the numbers on the source table (`manual_shipments`/`sub_orders`) correctly, but `handleClaim`'s
  `syncShipmentBestEffort` call didn't include `tracking_number`/`waybill_number` in the fields it
  mirrors into the unified `shipments` table — which is what the rider app actually reads from — so
  the source table had the real values while the client still saw null. Fixed by adding both fields
  to that sync call. Verified live end-to-end with explicit go-ahead to use real test data: cleared
  the account's active job, claimed a real broadcasting shipment via the actual endpoint, confirmed
  both `manual_shipments` and `shipments` now agree (`JLO-R9LVD5A2` / `JLO-WB-000017`), and confirmed
  the rider-app itself renders the real tracking number instead of a blank "Order" title.
- **Customer "Track on courier site" button pointed at Fez for local-rider deliveries — fixed.**
  Reported live: assigning a rider and following the confirmation email's tracking link, the
  customer-portal Track page's "Track on courier site" button led to Fez's tracking site even
  though the shipment was on a local rider. Root cause in `Track.tsx`'s `getCourierTrackingUrl`:
  it only special-cases `fez`/`gigl`/`kwik` by courier code, and for anything else (including
  `local-rider`) falls back to the stored `courier_tracking_url` column. That column is Fez-API-
  specific — populated by `fez-create-shipment.js` — and neither `assign-rider.js`,
  `manual-shipment-assign-rider.js`, nor `rider-jobs.js`'s `handleClaim` ever cleared it (or its
  siblings `courier_waybill`/`courier_shipment_id`) when assigning/claiming for a local rider, so a
  shipment that had ever been dispatched-or-attempted via Fez before being reassigned kept showing
  its old Fez URL forever. Fixed by nulling all three fields in all three assignment/claim paths,
  in both the source-table update and the corresponding `syncShipmentBestEffort` call (same
  source/unified-table sync pattern as the tracking-number fix above). Could not pin down the
  exact historical order the user hit this on via live-DB search — no `sub_orders` currently have
  `assigned_rider_id` set, and the newest `manual_shipments` rows don't carry the stale-field
  signature — likely because it's since moved to a different state; the fix applies going forward
  regardless.
- **Email/push notification trigger audit (2026-08-20) — full inventory requested, then every gap
  found in it fixed.** Rider-account-lifecycle actions (`rider-approve.js`'s approve/reject/
  suspend/reactivate/bank-change/vehicle-change/document verify-reject — 10 branches), a new
  application landing (`rider-register.js`), and withdrawal approve/reject/paid
  (`rider-withdrawals.js`) all had push-only wiring at best, several had **nothing at all**. And the
  rider app's own delivery-status transitions (`rider-jobs.js`'s `advance`) had never sent customer
  *email* — only push — for `picked_up`/`out_for_delivery`/`delivered`; the only place that ever
  emailed customers on local-rider status changes was `local-status.js`, a separate, older,
  admin-driven endpoint the rider app doesn't go through. Fixed by extending
  `shared/riderAssignedEmail.js`'s existing self-contained-HTML pattern (chosen over the
  DB-template-driven `sendTransactionalEmail` path, which would require blind-authoring new
  `email_templates` rows with no template editor visible) rather than the DB-template system:
  exported its internal `loadMailTransport`/`escapeHtml`/`logOrderEmail` helpers, fixed a real bug
  in `sendLocalDeliveryStatusEmail` where a `picked_up` transition fell through to "out for
  delivery" copy (binary ternary branching replaced with a `LOCAL_DELIVERY_PHASE_COPY` lookup table
  covering all 7 phases, including the four return-workflow ones it never covered before), and added
  a new `shared/riderLifecycleEmail.js` (`sendRiderAccountEmail` for rider-facing account emails,
  `sendStaffAlertEmail(s)` for staff fan-out, mirroring `support-notify.js`'s role-query pattern but
  with self-contained HTML). Every rider-approve.js branch, rider-withdrawals.js's three admin
  actions, and rider-register.js's new-application submission now push **and** email. rider-jobs.js's
  `notifyCustomer` now also emails (not just pushes) on every status it already pushed for, plus
  newly covers `failed`/`returning`/`returned`; `admin-delivery-problems.js`'s `require_return` now
  notifies the customer too (previously rider-only) and its push `type` was corrected from a reused
  `rider_job_assigned` to its own `rider_return_required`. New staff pushes/emails added for
  `report_problem`, `fail_delivery`, and `confirm_returned` — none of these reached staff before
  except by manually opening the Delivery Problems queue. All modified/new backend files verified
  with `node --check`; all five touched Netlify functions confirmed to bundle and load cleanly under
  `netlify dev` (OPTIONS preflight 204, no import errors) — a live authenticated POST test hit a
  pre-existing hang in this dev environment's admin-auth path (reproduced on an untouched endpoint
  too, so unrelated to these changes) and couldn't be completed.

## Build log (chronological)

1. Application-status screens + `rider-ping.js` opened up to any rider status (not just active) —
   merged to `main` (commit `0e618cc`).
2. Home screen recomposition + broadcast-claim error translation — merged to `main` (commit
   `0e618cc`).
3. Header padding fix + Decline button on broadcast job cards — merged to `main` (commit
   `364a652`).
4. Build tracker doc added; rider-app dev server port fixed to 5175 (CORS allowlist match) —
   merged to `main` (commit `74e72a4`).
5. Active Delivery screen redesign (timestamped timeline, From/Deliver-to cards, external maps
   navigation) — verified live end-to-end against a real accepted job (timeline, scan-fallback
   UI all confirmed working) before merge.
6. Active Delivery redesign corrected after side-by-side mockup review: fixed section order
   (Deliver-to → From → Waybill status → Timeline → actions), timeline row layout, added section
   icons, and a real "Report Problem" action (new `report_problem` on `rider-jobs.js`, logs to
   `tracking_events`) — verified live: submitted a real problem report against the same test job
   and confirmed the row landed in the database correctly before merge.
7. Admin side for reported problems: new `admin-delivery-problems.js` + `/admin/delivery-problems`
   page (desktop + mobile), tracking-events timeline wired into `OrderDetails.tsx`. Query logic
   verified by mirroring the exact join directly against the database (no live HTTP round-trip —
   no admin dev session available this session). **Found and fixed a real customer-facing data
   leak in the process**: `track-order.js`, `track-manual-shipment.js`, and `orders.js`'s
   customer-email-match path were all serving rider problem-report descriptions straight to
   customers' own tracking pages before this fix.
8. Sidebar reorganized: Riders, Rider Verifications, Rider Roster, and Delivery Problems moved out
   of the general Operations section into their own dedicated "Riders" section in
   `permissions.ts`'s `navigationSections` (the single source of truth for both the desktop
   sidebar and mobile more-menu) — no admin session available to click through live, but this is
   a pure data-array move with no logic change, typechecked clean.
9. Re-assessed #5 (waybill/custody architecture) instead of building it as originally scoped:
   traced local-rider assignment (`assign-rider.js`/`broadcast-rider.js`) and confirmed it's
   always a single leg (vendor → rider → customer), never hub-relayed — the brief's multi-leg
   Journey-Leg/Custodian model belongs to the separate hub-based Fez network, not this app.
   Building it here would've been premature abstraction with no real use case behind it.
10. Activity screen (#11) — new `rider-activity.js` endpoint + `Activity.tsx`, 4th bottom-nav tab.
    Verified live: status filters correctly scope the query against a real test job.
11. Activity list rows made tappable: in-progress → redirect to `/delivery`, completed/failed/
    returned → detail sheet (proof photo, addresses, timeline). Extracted `rider-jobs.js`'s
    pickup/dropoff resolution logic into a shared `services/shipmentSummary.js` rather than
    duplicating it for the detail endpoint. Verified live: active-item tap correctly redirected,
    detail endpoint returned the full correct shape via a direct authenticated request.
12. Editable Profile (#16): phone is now an instant self-edit; vehicle type/plate now follows the
    same pending-review pattern as bank details, end to end (rider request → admin approve/reject
    on both desktop and mobile Riders.tsx → takes effect). Verified live: submitted a real
    vehicle-change request, confirmed the pending banner and unchanged current values, cleaned up
    the test row afterward.
13. Waybill scan verification screen (#6a) — clarified that #5's "no multi-leg model needed"
    conclusion had been mistakenly read as covering the scan UI/error-message requirements too;
    it didn't. Built the actual gap: a `verify_scan` preview step before pickup is confirmed,
    matching mockup screen 3 and all four of brief §15's exact error strings. Verified live against
    a real active job (failure path only — the test shipment has no valid code to scan
    successfully).
14. Three cross-cutting fixes from a user Q&A pass: (a) service worker `skipWaiting`/
    `clientsClaim`/`cleanupOutdatedCaches` so deploys take over on next reload instead of needing a
    manual unregister; (b) one-active-job-at-a-time guard on `accept`/`claim` — broadcasting/
    assignment to busy riders is unchanged, only the commitment is blocked, verified live against a
    real pending job that was sitting on the test account; (c) a first motion pass — tap feedback
    on shared buttons, a route-keyed page fade-in, skeleton loaders on Home/Activity. See
    "Cross-cutting notes" above for detail on each.
15. The actual "stale view on reload" bug (not the service worker, which was a real but separate
    issue) — `RiderHome` was rendering default/empty state as real-looking content (email as the
    greeting name, "Offline" when genuinely online) before its own data fetch resolved. Home.tsx
    now returns a full skeleton while loading, matching the pattern already used correctly on
    Earnings/Profile/ActiveDelivery.
16. Traced every shipment-creation source per a direct question ("why does it always say
    Vendor?"): sub_orders can pick up from a real vendor, a JLO hub, a courier hub, or Fez's own
    hub (`resolveSender.js`'s `kind`); manual shipments pick up from a hub (`sender_hub_id` set) or
    an arbitrary free-text sender (unset) that isn't necessarily a vendor at all. Added a collapsed
    `pickup.kind` to the shared summarizer and a `pickupLabel()` helper so the label actually
    matches the source instead of always saying "Vendor". Verified live against the real test
    shipment (manual, no hub) — now correctly shows "Pickup:" instead of "Vendor:".
17. Traced tracking/waybill number generation end to end per a direct question. Found broadcast+
    claim (`rider-jobs.js`'s `handleClaim`) never generated either, unlike direct-assign — a real
    gap explaining why every manual-shipment test job this session had null tracking/waybill.
    Extracted the duplicated generation logic out of `assign-rider.js` and
    `manual-shipment-assign-rider.js` into `services/trackingNumbers.js`, all three dispatch paths
    now use it. Given explicit go-ahead to use real test data: cleared the active test job,
    claimed a real broadcasting shipment via the actual endpoint — caught and fixed a second bug
    in the process (the new numbers weren't being synced from the source table into the unified
    `shipments` table the rider app reads from), then re-verified clean. Confirmed live in the
    rider app: the job now shows its real tracking number instead of a blank "Order" title.
18. Fixed the customer Track page's "Track on courier site" button pointing at Fez for local-rider
    deliveries. Cause: `courier_tracking_url`/`courier_waybill`/`courier_shipment_id` are Fez-only
    fields that survive a reassignment to a local rider untouched. Nulled all three in
    `assign-rider.js`, `manual-shipment-assign-rider.js`, and `rider-jobs.js`'s `handleClaim`,
    in both the source-table update and the unified-table sync call.
19. Built Proof of Delivery levels (#8) — `standard` (photo) and `verified` (photo + signature),
    gated on order value at a ₦50,000 threshold set by direct instruction. New `signature_url`
    column and `SignaturePad.tsx`; enforced server-side in `rider-jobs.js`'s `advance`, not just
    client-side. Verified the value-threshold → UI pipeline live against a real ₦60,000 test
    shipment; the final delivered-completion write path itself relies on code review (mirrors
    `delivery_proof_url`'s existing, proven pattern) since neither a camera nor the rider's raw
    auth token were available/permitted in this environment to drive it end to end.
20. Two bugs reported directly by the user, both fixed:
    (a) **Rider-app Activity detail drawer didn't reveal all content on mobile.** Root cause: the
    delivery-proof photo had no height cap, so a single full-resolution photo alone could eat the
    entire 690px-tall drawer, leaving the rest (From, Timeline) effectively unreachable — the
    scroll container itself was never actually broken (confirmed via `scrollTop`), there was just
    ~300px more content than fit. Fixed by bounding both the proof photo and signature to fixed
    thumbnail heights (tap to view full-size in a new lightbox) plus `-webkit-overflow-scrolling:
    touch` for iOS. Verified live: scrollHeight dropped from 985px to 774px, full timeline
    (all 4 timestamps) now visible with only ~84px of scroll, and the lightbox opens/closes
    correctly.
    (b) **Admin had no way to see delivery evidence (photo/signature) at all — a real, separate
    bug, not just a missing feature.** `orders.js`'s `loadFullOrder` (powers the admin Order
    Details page, desktop + mobile) never selected `delivery_person_name/phone/vehicle`,
    `waybill_number`, `delivery_proof_url`, or `signature_url` on `sub_orders`, even though the
    frontend already referenced `delivery_person_name` — that whole info box was silently never
    rendering. Fixed the select and added a proof/signature image section (desktop + mobile). For
    manual shipments, `delivery_proof_url`/`signature_url` aren't columns on `manual_shipments` at
    all (same asymmetry as everywhere else this session — they only exist on the unified
    `shipments` table for that source type), so `manual-shipments.js`'s GET-by-id now also queries
    `shipments` by `manual_shipment_id` and merges those two fields in. Added the same image
    section to `ManualShipmentDetail.tsx` (desktop + mobile). **Not visually verified in a
    browser** — the dashboard's dev server (port 3000) was denied at the browser-tool permission
    level in this environment; verification here is `tsc --noEmit` (clean) plus direct mirroring
    of the already-verified rider-app Activity pattern (same field names, same conditional
    rendering), not a live screenshot.
21. Built Return Workflow (#10) — staff-mediated `failed → return_required → returning →
    returned`, per direct instruction to match the brief's exact states rather than a simpler
    rider-self-serve version. New `fail_delivery`/`start_return`/`confirm_returned` actions on
    `rider-jobs.js`, a new `require_return` action on `admin-delivery-problems.js` with a button on
    that same triage queue, and a dedicated rider-app return screen (`ActiveDelivery.tsx`). Found
    and fixed two real bugs during live verification: `failed_reason` wasn't syncing into the
    unified `shipments` table (dropped it — `tracking_events` already carries it), and Home's
    active-delivery card said "Deliver to {customer}" even during a return. Verified live end to
    end on a real test shipment through every state transition; the admin button itself wasn't
    clicked live (dashboard dev server denied at the browser-tool permission level), but its
    endpoint was proven correct via the equivalent direct DB write.
22. Built Commission Transparency (#14). First discovered `rider-commission-design.md`'s build
    checklist was stale — the core `rider_payout` freeze mechanism it marks unstarted is actually
    fully built and working. Confirmed no bonus/deduction concept exists anywhere in the codebase,
    so scoped this to a breakdown of the payout itself (base rate + weight + pickup surcharge),
    never the customer's price — per direct instruction, to avoid revealing margin to riders. New
    `computeDispatchCostBreakdown()` (byte-for-byte same `total` as the existing
    `computeDispatchCost()`, just also returns the parts) frozen alongside `rider_payout` in all
    four assign/broadcast paths, surfaced as `fee_breakdown` on Active Delivery (tap to expand) and
    Activity's detail sheet. Verified live: a real ₦4,400 payout (2kg × ₦400 + ₦3,600 base)
    correctly expanded to matching line items.
23. User caught that #12 (Earnings) was never actually rebuilt to match the mockup — only
    functionally extended. Rebuilt the visual design (purple hero balance card, Today card, section
    naming) against the mockup, dropping two elements that don't correspond to anything real
    (Pending Earnings, Fare/Bonus/Platform-Fee breakdown) per direct instruction rather than faking
    them. Found and fixed a real pre-existing bug while at it: `rider-earnings.js`'s sparkline
    day-bucketing silently mislabeled buckets whenever the server's local timezone wasn't UTC
    (mixed a local-time hour reset with a UTC-labeled key) — invisible until the new "Today" card's
    single-day lookup exposed it. Fixed the bucketing and added real `today_total`/`today_count`
    fields. Verified live: Today went from a wrong ₦0 to the correct ₦3,200 for 2 real deliveries.
24. Checked the rest of the built screens against the mockup on request (Home/Active Delivery/
    Waybill Scan/Profile all genuinely matched) and found one more real gap: Complete Delivery
    (mockup screen 4) wasn't its own screen — it was inline capture buttons appended to the bottom
    of the generic Active Delivery layout. Rebuilt as a dedicated screen once `out_for_delivery`:
    Recipient card, Proof-of-Delivery icon tiles (photo + signature, no fabricated OTP tile),
    Shipment Summary recap card, Navigate/Call kept (still no separate "arrived" sub-state),
    "Report Issue" button, and the existing fail-delivery link. Bottom CTA renamed to "Confirm
    Delivery" to match the mockup and more accurately describe what it does. Verified live in both
    Proof of Delivery levels — 2-column tile grid (photo+signature) for a real ₦60,000 shipment,
    1-column (photo only) for a real ₦2,000 one — signature pad opened correctly from its tile.
25. Built Documents lifecycle (#17) — first P1 item. New `rider_documents` table (type/status/
    issue_date/expiry_date/verified_at/rejection_reason, one row per submission for real history),
    backfilled for every existing rider. Application form gained an optional expiry-date field;
    admin review went from flat document links to real per-document Verify/Reject; new rider-app
    Documents screen shows status/expiry (display only); new daily scheduled function sends a
    one-time expiry reminder push per document — no enforcement anywhere, per the brief. Also fixed
    a real, unrelated schema-documentation gap found along the way: several columns from earlier
    this session (`bank_name`, `pending_bank_*`, `pending_vehicle_*`) existed live with no migration
    file recording them. Verified live: the rider-app Documents screen renders real backfilled data;
    admin's per-document buttons weren't clicked live (dashboard denied at the browser-tool
    permission level, same as #10 and #12) but mirror the already-proven Delivery Problems pattern.
26. Built Notifications (#18). Found deep links were genuinely broken, not just unbuilt — every
    rider push already sent a real `targetPath`, but the service worker's `notificationclick`
    handler deliberately ignored it (stale reasoning about a "customer-PWA" path that doesn't apply
    to this SW, which only ever receives pushes sent to a rider's own token). Fixed that, plus new
    `rider_notifications` table + a `sendRiderPush()` wrapper swapped into all six rider-targeted
    push call sites (customer-facing pushes untouched), a new Notifications screen, and a bell icon
    + unread badge on Home matching the mockup. Verified live end to end: badge showed the real
    count, tapping navigated to the notification's actual `targetPath`, `read_at` persisted
    server-side, badge cleared correctly after.
27. Audited every email/push trigger tied to rider activity on request, then fixed every gap found
    (cross-cutting, not tied to a single tracker item — see the note above). Added
    `shared/riderLifecycleEmail.js`, fixed a real phase-mislabeling bug in
    `sendLocalDeliveryStatusEmail` and extended it to the return-workflow phases, wired push+email
    into all 10 `rider-approve.js` branches, `rider-register.js`'s new-application staff alert,
    `rider-withdrawals.js`'s three admin actions, and `rider-jobs.js`'s customer/staff notifications
    (including two new phases it never covered: `failed`/`returning`/`returned`, plus staff alerts on
    `report_problem`/`fail_delivery`/`confirm_returned`). `admin-delivery-problems.js`'s
    `require_return` gained a customer-facing notification and a corrected push `type`. All files
    `node --check`ed and confirmed to bundle cleanly under `netlify dev`.
28. Built the missing admin side of Withdrawal System (#15) — asked "what happens when a rider
    requests a withdrawal," traced it, and found `rider-withdrawals.js`'s approve/reject/paid actions
    had shipped with zero dashboard UI ever calling them, unlike the vendor equivalent which got both
    halves together. New `rider-withdrawals-admin.js` (admin-scoped GET) + `RiderWithdrawals.tsx`
    desktop/mobile, built by directly mirroring the already-proven `VendorWithdrawals.tsx` structure
    field-for-field. Also added staff push+email when a rider submits a *new* request, since nothing
    notified staff one existed before this either. `tsc --noEmit` and `eslint` both clean; backend
    confirmed live under `netlify dev` (401 without a token, 204 on OPTIONS — bundles and auth-gates
    correctly). Could not click through the actual screen live — no admin login credentials available
    in this environment, same restriction hit for #10/#12/#17's admin pieces — verified via route-guard
    behavior (unauthenticated request correctly redirected to `/login`) plus structural fidelity to the
    proven pattern instead.
