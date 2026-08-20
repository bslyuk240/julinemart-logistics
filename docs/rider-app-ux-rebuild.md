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

Status legend: ✅ done · 🟡 partial / reduced scope · ⬜ not started

## P0 — UX / operational readiness

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Application-status screens (no_application / pending_review / active / rejected / suspended) | ✅ | [ApplicationStatus.tsx](../rider-app/src/pages/ApplicationStatus.tsx). pending_review has the step tracker (Account created → KYC submitted → Verification in progress → Rider activation) + Case ID. No fabricated "Contact Support" — no real support channel exists yet (see #19). |
| 2 | Rider Readiness component (checklist: Account approved / Location enabled / Documents valid / Identity check + "Verify & Go Online" CTA) | 🟡 | Reduced to a single "Identity verified today" line on Home, shown when online (accurate — online implies the 24h selfie check already passed server-side). The full 4-item pre-flight checklist is not built: no signal exists yet for "documents valid" (see #17, brief explicitly says don't enforce until backend rules are defined) or "location enabled" (no permission-state tracking wired up). |
| 3 | Home screen recomposition (Header → Online/Readiness → Active Delivery → Today summary → Offers → Bottom nav) | ✅ | [Home.tsx](../rider-app/src/pages/Home.tsx). Active Delivery card no longer auto-redirects off Home — shows as a card with "Continue Delivery" per mockup. |
| 4 | Delivery-offer card redesign (earning, distance, package count, job type; broadcast jobs say "Available to nearby riders" not internal terms; 409 → "Another rider accepted this delivery.") | 🟡 | Vendor name, fee, pickup/dropoff city, lock-icon (direct) vs amber badge (broadcast), Decline+Accept both shown. **Missing:** distance and package count — not computed anywhere server-side, didn't fabricate numbers. 409 claim conflicts now translate to friendly text. |
| 5 | Waybill/custody architecture (Order vs Shipment vs Waybill vs Journey Leg vs Custodian vs Scan Event; scan-on-custody-change, not scan-on-every-status-change) | ⬜ | **Not started — biggest, riskiest item.** Existing QR scanner (`Scanner.tsx`) + server-side validation (`normalizeScanCode`/`scanLookup.js`, `rider-jobs.js`'s `advance` action) must be inspected and extended, not rebuilt, per the brief's explicit instruction. `tracking_events` already has `actor_type`/`source`/`metadata`/`description` that a custody trail could ride on without new columns — not yet confirmed sufficient. |
| 6 | Active Delivery screen redesign, context-sensitive dynamic CTAs | 🟡 | [ActiveDelivery.tsx](../rider-app/src/pages/ActiveDelivery.tsx). Vertical timestamped timeline (Assigned/Package collected/Out for delivery/Delivered — `assigned_at` is a new field, reusing `shipments.created_at` which was already selected but not exposed), From/Deliver-to cards, dynamic CTA label. **Not built:** the mockup's separate "I've Arrived" intermediate tap before Scan/Complete — current flow goes straight from Navigate to Scan/Complete, no local "arrived" sub-state. Report Problem button intentionally omitted — belongs to Delivery Exceptions (#9), didn't want a button that goes nowhere. |
| 7 | External navigation handoff (Google/Apple Maps, Waze intents) | ✅ | "Navigate to Pickup"/"Navigate to Customer" opens a universal Google Maps directions link (works cross-platform, opens native app if installed). No in-app map, per the brief's own instruction not to build turn-by-turn. |
| 8 | Proof of Delivery levels (standard / verified / high_value) | ⬜ | Not started. `delivery_proof_url` field already exists (pre-existing). |
| 9 | Delivery Exceptions (structured incident types, distinct workflow actions) | ⬜ | Not started. |
| 10 | Return Workflow (delivery_failed → return_required → returning → returned_to_hub/vendor) | ⬜ | Not started. |
| 11 | Activity screen (delivery history: active/completed/cancelled/failed/returned) | ⬜ | Not started. No "all deliveries" endpoint exists yet — `rider-jobs.js` only returns pending/active/available, `rider-earnings.js` only returns *delivered* in the last 7 days. |
| — | Wallet / commission financial system (grouped with P0 in the brief) | | |
| 12 | Earnings (preserve existing: weekly total, sparkline, breakdown) + extend to wallet | ✅ | Pre-existing, preserved. |
| 13 | Wallet (pending/available/withdrawn, backend-authoritative) | ✅ | `rider_earnings_summary` view + `available_balance`, built earlier this session. |
| 14 | Commission Transparency (fare / bonus / deduction / net breakdown shown to rider) | ⬜ | Not started. Backend (`rider-jobs.js`, `rider-earnings.js`) only exposes a single final `fee`/`rider_payout` number — the underlying commission math exists (two-rate-lookup mechanism, see [rider-commission-design.md](rider-commission-design.md) §4) but there's no fare/bonus/deduction line-item breakdown to surface. |
| 15 | Withdrawal System (states: requested/processing/paid/failed/cancelled) | 🟡 | Built earlier this session — `rider_withdrawals` table, `rider-withdrawals.js`, Earnings.tsx UI. States are `pending/approved/rejected/paid`, not an exact match to the brief's naming — functionally equivalent, not renamed. |
| 16 | Editable Profile (phone/address/vehicle/operating info editable; sensitive/KYC changes go through a pending-verification state) | 🟡 | Bank details done this pattern (`pending_bank_*` fields, staff approve/reject). Phone, vehicle, address are **not yet editable** at all. |

## P1

| # | Item | Status | Notes |
|---|------|--------|-------|
| 17 | Documents lifecycle (type/status/issue_date/expiry_date/verified_at/rejection_reason, expiry notifications) | ⬜ | Not started. Brief explicitly says don't add expiry *enforcement* until backend rules are defined — the lifecycle data model itself is still open. |
| 18 | Notifications (persistent in-app history + deep links, on top of existing push opt-in gating) | ⬜ | Not started. Push opt-in flow (`NotificationPrompt.tsx`) preserved as-is. |
| 19 | Support (Active Delivery Help / Dispatch / Waybill Problem / Payment / Account / Safety) | ⬜ | Not started. No existing support/chat system found anywhere in the codebase to integrate with — this is genuinely new infrastructure, not an extension. |
| 20 | Offline Resilience (cache active-delivery data, "waiting to sync" for unsynced actions, custody stays server-authoritative) | ⬜ | Not started. |
| 21 | Bottom Navigation → Home / Activity / Earnings / Support / Profile (5 tabs; no Active Delivery tab) | ⬜ | Still 3 tabs (Home/Earnings/Profile) — blocked on #11 and #19 existing first, otherwise the nav would point at dead screens. |

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
