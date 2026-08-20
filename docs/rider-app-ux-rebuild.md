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
| 4 | Delivery-offer card redesign (earning, distance, package count, job type; broadcast jobs say "Available to nearby riders" not internal terms; 409 → "Another rider accepted this delivery.") | 🟡 | Vendor name, fee, pickup/dropoff city, lock-icon (direct) vs amber badge (broadcast), Decline+Accept both shown. **Missing:** distance and package count — not computed anywhere server-side, didn't fabricate numbers. 409 claim conflicts now translate to friendly text. |
| 5 | Waybill/custody architecture (Order vs Shipment vs Waybill vs Journey Leg vs Custodian vs Scan Event; scan-on-custody-change, not scan-on-every-status-change) | 🟢 | **Re-assessed, not built as a multi-leg model — and shouldn't be, for this app.** Traced `assign-rider.js`/`broadcast-rider.js`: a local rider's pickup point is always resolved from `vendors.approved_vendor_locations` (the vendor's own address), never a hub — confirmed no `hub_id` routing anywhere in local-rider assignment. Local-rider deliveries are always exactly one leg (vendor → rider → customer), never vendor → hub → relay → last-mile-rider. The brief's Journey-Leg/Custodian/multi-hub model is real infrastructure, but it belongs to the *hub-based* Fez network (dashboard's Hub Dispatch), which this rider app doesn't participate in. Building a multi-leg custody data model for a use case that's always one leg would be pure premature abstraction. What *does* exist and already satisfies the actual need: `rider-jobs.js`'s pickup scan (the one real custody transfer, vendor → rider) hard-gates on a code match against `tracking_number`/`waybill_number` with a rider-friendly error ("That code doesn't match this delivery — scan the label on this specific package."). Note there's a separate, more sophisticated `scanLookup.js` (`resolveScanMatch`, hub-mismatch detection) used by the dashboard's own hub-scan screens — that's the real custody infrastructure for the multi-leg network, correctly left alone. Delivery-side (rider → customer) uses a photo, not a re-scan — matches the mockup's own Complete Delivery screen (photo/signature/OTP, no scan step), not a gap. |
| 6 | Active Delivery screen redesign, context-sensitive dynamic CTAs | 🟡 | [ActiveDelivery.tsx](../rider-app/src/pages/ActiveDelivery.tsx). Matches the mockup's section order (Deliver-to → From → Waybill status → Timeline → Navigate/Call/Report row), label-left/time-right timeline rows, section icons. `assigned_at` is a new field, reusing `shipments.created_at` which was already selected server-side but not exposed. **Not built:** the mockup's separate "I've Arrived" intermediate tap before Scan/Complete — current flow goes straight from Navigate to Scan/Complete, no local "arrived" sub-state. No embedded map — deliberate, the brief itself says use external nav handoff instead of in-app turn-by-turn (see #7). |
| 7 | External navigation handoff (Google/Apple Maps, Waze intents) | ✅ | "Navigate to Pickup"/"Navigate to Customer" opens a universal Google Maps directions link (works cross-platform, opens native app if installed). No in-app map, per the brief's own instruction not to build turn-by-turn. |
| 8 | Proof of Delivery levels (standard / verified / high_value) | ⬜ | Not started. `delivery_proof_url` field already exists (pre-existing). |
| 9 | Delivery Exceptions (structured incident types, distinct workflow actions) | 🟡 | "Report Problem" on Active Delivery logs one of the brief's 10 incident types + an optional note to `tracking_events` (new `report_problem` action on `rider-jobs.js`), visible to staff via a new **Delivery Problems** admin page (`/admin/delivery-problems`, desktop + mobile, filterable by reason, defaults to hiding delivered/failed/returned shipments). Also wired the existing `ShipmentTrackingEvents` timeline into `OrderDetails.tsx` (desktop + mobile) — sub_order tracking events were fetched by the backend and silently discarded by the frontend before this. **Not built:** each reason type driving a distinct next step (return required, reassign, etc.) — that's real workflow logic, still its own piece. **Security fix found and closed in the same pass:** `track-order.js` and `track-manual-shipment.js` (public, unauthenticated customer tracking endpoints) select every `tracking_events` row with no filtering — a rider's problem report would have shown up verbatim on the *customer's own* tracking page. Same issue in `orders.js`'s GET-by-id, which doubles as the customer PWA's order-detail endpoint via an email-match bypass that skips admin auth entirely. All three now filter out `metadata.type === 'problem_report'` before the response leaves the server. |
| 10 | Return Workflow (delivery_failed → return_required → returning → returned_to_hub/vendor) | ⬜ | Not started. |
| 11 | Activity screen (delivery history: active/completed/cancelled/failed/returned) | ✅ | New [rider-activity.js](../netlify/functions/rider-activity.js) (all-time history by `assigned_rider_id`, filterable by status; `?id=` returns single-item detail) + [Activity.tsx](../rider-app/src/pages/Activity.tsx), added as a 4th bottom-nav tab (Home/Activity/Earnings/Profile). No "cancelled" filter — that status doesn't exist in the `shipments` enum, and a declined job's `assigned_rider_id` gets cleared, so it was never really "this rider's" history to begin with. Tapping a row: an in-progress item just navigates to `/delivery` (it's the rider's one active job, nothing separate to view); a completed/failed/returned item opens a detail sheet — proof-of-delivery photo, full pickup/dropoff addresses, per-step timeline. The detail logic reuses `rider-jobs.js`'s pickup/dropoff resolution rather than re-deriving it — extracted both into a shared [`services/shipmentSummary.js`](../netlify/functions/services/shipmentSummary.js). Verified live: filter chips correctly scope the query, an in-progress item's tap correctly redirected to `/delivery`, and the detail endpoint returned the full correct shape (addresses, phone, timestamps) via a direct authenticated request. |
| — | Wallet / commission financial system (grouped with P0 in the brief) | | |
| 12 | Earnings (preserve existing: weekly total, sparkline, breakdown) + extend to wallet | ✅ | Pre-existing, preserved. |
| 13 | Wallet (pending/available/withdrawn, backend-authoritative) | ✅ | `rider_earnings_summary` view + `available_balance`, built earlier this session. |
| 14 | Commission Transparency (fare / bonus / deduction / net breakdown shown to rider) | ⬜ | Not started. Backend (`rider-jobs.js`, `rider-earnings.js`) only exposes a single final `fee`/`rider_payout` number — the underlying commission math exists (two-rate-lookup mechanism, see [rider-commission-design.md](rider-commission-design.md) §4) but there's no fare/bonus/deduction line-item breakdown to surface. |
| 15 | Withdrawal System (states: requested/processing/paid/failed/cancelled) | 🟡 | Built earlier this session — `rider_withdrawals` table, `rider-withdrawals.js`, Earnings.tsx UI. States are `pending/approved/rejected/paid`, not an exact match to the brief's naming — functionally equivalent, not renamed. |
| 16 | Editable Profile (phone/address/vehicle/operating info editable; sensitive/KYC changes go through a pending-verification state) | 🟡 | Phone is now an instant self-edit (low risk — just a contact detail). Vehicle type/plate now follows the exact same pending-review pattern as bank details (`pending_vehicle_type`/`pending_vehicle_plate`/`pending_vehicle_requested_at`, staff approve/reject in `rider-approve.js`, surfaced on `admin-rider-list.js`/`Riders.tsx` desktop+mobile) — it's a KYC-verified fact (what the rider was approved to ride), same reasoning as why bank details can't be an instant edit. Verified live: submitted a real vehicle-change request, confirmed the pending-review banner rendered correctly with the original vehicle still active, then cleaned up the test data. **Still not editable, and not planned to be:** operating-zone/`approved_location_id` — that's a staff-assigned coverage area, not a rider self-service field, and there's no "address" concept for riders in this data model to begin with. |

## P1

| # | Item | Status | Notes |
|---|------|--------|-------|
| 17 | Documents lifecycle (type/status/issue_date/expiry_date/verified_at/rejection_reason, expiry notifications) | ⬜ | Not started. Brief explicitly says don't add expiry *enforcement* until backend rules are defined — the lifecycle data model itself is still open. |
| 18 | Notifications (persistent in-app history + deep links, on top of existing push opt-in gating) | ⬜ | Not started. Push opt-in flow (`NotificationPrompt.tsx`) preserved as-is. |
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
- **PWA service worker caching**: after a prod deploy, the installed/cached PWA can keep serving
  the old bundle until the service worker cycles — confirmed by having to manually unregister SW +
  clear caches to see a fresh deploy during testing. Not something this pass changed; worth
  watching if riders report not seeing updates.

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
