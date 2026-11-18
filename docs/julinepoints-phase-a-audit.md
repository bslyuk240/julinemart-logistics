# JulinePoints — Phase A audit (PRD v1.1, 17 Nov 2026)

Read-only audit of JLO (`netlify/functions`, `supabase/migrations`, `src/dashboard`) and the PWA (`C:\Users\user\julinemart-pwa`) against the PRD. Nothing was changed. Branch: `dev-unified-global-sourcing` (uncommitted global-sourcing work is present; JulinePoints should branch from `main`).

**Not verified:** live Supabase (MCP returned Unauthorized). Row counts, the real `orders`/`customers` columns and RLS need a confirming query before Phase B. Findings below come from code and migrations only.

Greenfield check: no loyalty/points/referral-code code exists anywhere in JLO, vendor-portal or src.

---

## 1. Order creation & quote — `netlify/functions/create-order.js`

- Single public endpoint, rate limited (8 per 5 min). **No auth, no customer id.** Orders carry only `customer_email` (lower-cased), name and phone. Guests and signed-in users take the same path.
- Server re-prices everything from `products`/`product_variations` (sale_price else regular_price, plus validated customisation adjustment). Client prices are ignored. Good base for a canonical quote.
- Totals (lines 315–431): `subtotal` = sum of lines; `discountAmount` = voucher (free / percentage / flat, applied to the whole subtotal); shipping = base minus influencer shipping discount minus voucher shipping discount; `total_amount = max(subtotal - discount + shipping, 0)`.
- Writes `orders` (`subtotal`, `discount_amount`, `shipping_fee_paid`, `total_amount`, `campaign_id`, `payment_reference` = `JLO-<ts>-<rand>`, `metadata` jsonb), then `order_items` (unit price and `cost_price` snapshots), then `sub_orders` per vendor. `allocated_shipping_fee` is set only when there is one vendor.
- **There is no separate "quote" endpoint.** The PWA computes its own display totals (`checkout/page.tsx` ~L349–354) and the server recomputes at order creation. PRD 4.2 wants "the canonical JLO quote, not browser-derived totals", so a new quote function is needed.
- **No transaction.** Order, items, sub-orders and voucher increment are separate inserts. A failure after the order insert leaves a pending order with no items. Points reservation must not rely on this pattern.
- Discounts are order-level only; **there is no per-line discount allocation.** The PRD's "eligible merchandise after campaign discounts" and the vendor-level refund allocation both need a per-line allocation of voucher and points value, which doesn't exist.
- Other order paths exist and are out of scope unless the PRD says otherwise: `create-gift-order.js`, `customer-gift-order.js`, `create-custom-order`/`custom-order` flows, and manual shipments. Decide whether gift boxes earn and redeem points.

## 2. Campaigns, vouchers, shipping discounts

- Table `campaign_vouchers` (`discount_type` percentage/flat/free, `discount_value`, `shipping_discount_*`, `max_uses`, `current_uses`, `valid_*`, `campaign_id`, category/SKU scope migrations). Black Friday is a voucher/campaign discount, which matches the PRD: points sit after it.
- `create-order.js` **does not apply the voucher's category/SKU scope** (the migration adds scope columns, but the code only checks status, dates and max_uses). Worth confirming whether scope is enforced elsewhere (`voucherHelpers.js`, `/api/vouchers/validate`), because points eligibility will need the same notion of "eligible lines".
- `current_uses` is incremented with read-then-write (lines 845–850): **racy**, and incremented at order creation, not at payment. `cancel-order` releases it via `releaseVoucherUsage`; abandoned unpaid orders never release it. The points reservation needs the opposite design (atomic RPC, explicit expiry).
- Influencer coupons discount shipping only. Stacks with a voucher's shipping discount.
- Stacking rule for the PRD: points apply after voucher and influencer discounts, on merchandise only. Fits the existing order of operations.

## 3. Paystack

- Two confirmation paths, both set `payment_status='paid'` guarded by `.eq('payment_status','pending')`:
  - `paystack-webhook.js` (HMAC-SHA512 verified; **signature check is skipped if `PAYSTACK_SECRET` is unset**).
  - `verify-payment.js` (called by the PWA after the inline popup; **unauthenticated**, takes any `payment_reference`).
- The status-guarded update is a usable idempotency primitive: exactly one caller flips pending to paid and gets the row back. Points commit and purchase-reward issuance should hang off that same `updatedOrder?.id` branch in both files, plus a unique idempotency key in the ledger as a second guard.
- **Neither path checks the paid amount against `orders.total_amount`.** `verify-payment` only checks `pd.status === 'success'` for the reference. This matters for points: any change to the payable amount must be enforced against Paystack's `amount`.
- **Free-order path already exists** (`verify-payment.js` L40–60): if `total_amount <= 0` it marks the order paid with channel `free_order` and **no authentication**. Anyone who knows a zero-total order's `payment_reference` can trigger it. PRD 5.1.6 (fully points-funded orders) would reuse this, so it needs: require the customer JWT, and verify points commit succeeded before marking paid.
- Webhook `charge.failed` and `refund.processed` exist. `refund.processed` marks the whole order `refunded` regardless of amount, so partial refunds are not modelled at the order status level.
- Abandoned checkout: `process-abandoned-checkout-reminders.js` exists; there is no expiry job that cancels or releases stale pending orders. A reservation TTL sweeper is new work.

## 4. Cancellations, refunds, returns

- `cancel-order.js`: unpaid orders cancellable without login; paid orders require the owning customer's JWT (email match). Cancelling a paid order auto-refunds the **full `total_amount`** through Paystack and writes `refund_records`. Refund is cash only: points would need a restore step here and for admin refunds.
- `refunds.js` (staff, role-gated): `create-refund` takes an arbitrary amount (partial allowed), creates a Paystack refund and a `refund_records` row. **No cap against remaining refundable amount, no link to order lines.** Partial refund allocation for points (PRD 11, open item) would hook here.
- Returns: `return_requests`, `returns-utils.js`, `vendor_return_debits` (vendor repays platform for refunded returns). Points reversal on return needs a hook where a return is approved/refunded.
- `refund_records` has `return_request_id` but no per-line amounts.

## 5. Vendor settlement (the PRD's key guardrail)

- Vendor earnings are **view-derived** (`vendor_earnings_summary`, `vendor_monthly_earnings`): `SUM(order_items.subtotal) * (1 - commission_rate/100)` over orders with `payment_status='paid'`, minus withdrawals and return debits.
- Because it uses `order_items.subtotal` (list price, **before** order discounts), vouchers already leave vendor earnings untouched: the platform absorbs them. **If points redemption is recorded only on `orders` and never alters `order_items.subtotal`, vendor settlement is unchanged automatically.** This is the simplest way to meet PRD 5.1.5/6. Don't spread redeemed value into item subtotals.
- Consequence: platform margin on a points order is lower by the points value. Reporting for "platform-funded loyalty cost" should be a new ledger/view, not a change to vendor views.
- A fully refunded order drops out (`payment_status` no longer `paid`). Partial refunds do not reduce vendor earnings except through return debits: pre-existing behaviour, not a JulinePoints regression, but partial refunds interacting with points need an explicit rule.
- `settlements.js` is courier payouts only (admin-only). Unrelated to points. `ledger_expenses` has `source` and `reference_type`, so a points liability expense entry is possible but probably shouldn't be recorded as cash expense at issue time. Decide with finance.

## 6. Customer identity

- Customer = Supabase Auth user. JLO verifies the Bearer JWT in `services/customerAuth.js` (`authenticateCustomer` returns `userId` and lower-cased email). `public.customers` is keyed by the auth user id (`get_storefront_customers()`); staff and vendors also appear in `users`/`vendors` and must be excluded from wallets.
- **`orders` has no `customer_id`/user id** (only email; no such column in the base migration, to be confirmed live). Order-to-user linkage is email matching (`customer-orders.js`, `cancel-order.js`). A wallet debit tied to an order needs either a new `orders.customer_id` or storing the auth user id on `order_reward_applications` at quote time. Email matching alone is spoofable for guests (create-order accepts any email), so **a wallet must be keyed on the verified auth uid, never on order email**.
- PWA sign-up uses `supabase.auth.signUp()` (`signup/page.tsx`), so `auth.users.email_confirmed_at` is available for the verified-signup requirement. A source comment in `create-order.js` mentions Google/NextAuth customers without a Supabase session, but the PWA `package.json` has no next-auth and the route auth reads the Supabase token only; confirm whether any Google sign-in users exist (they'd have no JWT and could not use points).
- Signup audit already exists (`/api/audit/signup`, server-side `SIGNUP`/`ORDER_PLACED` in `activity_logs`), and the memory notes it is server-side. Reuse for the launch cutoff and abuse review.

## 7. PWA checkout

- `checkout/page.tsx` (2,767 lines) calls `/api/orders` (a Next route proxying to JLO `create-order`), then opens Paystack inline with the JLO reference, then `/api/verify-payment`, which proxies to JLO `verify-payment`. The proxies don't forward the user's Authorization header on create (it does on the order list GET). **Create-order would need the JWT forwarded** for any authenticated points reservation.
- Promo UI is voucher/influencer toggle (`promoKind`); the voucher is validated through `/api/vouchers/validate` (JLO `voucherHelpers`, CORS-whitelisted origins). A points toggle would follow that same server-validated pattern.
- Free (zero-total) orders: the PWA already calls verify-payment directly instead of opening Paystack (~L1456). Points-funded zero payable orders would take this branch.
- Rewards page `/account/rewards` fits under `src/app/account/`. Account nav already exists.

## 8. JLO admin

- Settings pattern that exists: `global_sourcing_settings` (provider-keyed row, `metadata` jsonb, service-role RLS only). That's unversioned and has no audit trail. The PRD needs effective-dated versions, approval status and an audit table: new tables, not an extension of this one.
- Admin auth: `requireAdmin(event, roles)` in `global-sourcing-utils.js`, role lists in `services/staff-roles.js`, audit via `services/auditLog.js` (`recordStaffAudit`). Dashboard pages under `src/dashboard/pages` (Settings.tsx, Finance.tsx, Vouchers.tsx, Customers.tsx). A "Rewards" admin page fits there. No dual-approval primitive exists.
- Schema conventions: SQL migrations in `supabase/migrations` named `YYYYMMDDHHMMSS_*.sql`, `set_updated_at`/`update_updated_at_column` triggers, RLS with service-role policies, `security_invoker` views. Generated types in `src/types/supabase.ts` need regenerating after migration.

---

## Risks the PRD should absorb before Phase B

1. **Unauthenticated money paths.** `create-order` and `verify-payment` are public. Points add a wallet balance behind them: reservation must be tied to a verified JWT; the free-order path must not mark paid on reference alone.
2. **No amount reconciliation** between Paystack `amount` and `total_amount`. Add before points can reduce `total_amount`.
3. **Non-atomic order creation** and racy voucher counter. Wallet reservation must be a single Postgres RPC (`SELECT … FOR UPDATE` on the wallet row or advisory lock), called from create-order, with a unique `(order_id)` reservation.
4. **No pending-order expiry.** Reservations need a TTL job. Netlify scheduled functions already exist (`process-webhook-retries-scheduled.js`) as a pattern.
5. **Refund model is whole-order and cash only.** Partial refund points allocation (PRD open item) needs a rule, probably proportional to refunded merchandise value, restoring points first or cash first. Pick before Phase D.
6. **Order → user linkage** is email-based. Add `orders.customer_id` (nullable) populated from the verified JWT in create-order.
7. **Per-line discount allocation absent.** Eligible-value calculations use order-level subtotal minus voucher discount minus shipping. Acceptable for v1 if admin exclusions are order-level only. Category/product exclusions need line allocation.
8. **Voucher scope not enforced in create-order** (see section 2): confirm before relying on "eligible lines".
9. **Webhook signature bypass** when `PAYSTACK_SECRET` is unset: make this fail closed in production.

## Design decisions (proposed, for owner sign-off)

| # | Decision | Recommendation |
|---|---|---|
| 1 | Wallet key | `auth.users.id`; exclude staff/vendor ids. Never email. |
| 2 | Where redeemed value lives | `orders.points_discount` (new) + `order_reward_applications`; **never** touch `order_items.subtotal`, so vendor views are unchanged. |
| 3 | Reservation | Postgres RPC, row-locked wallet, one reservation per order, TTL (e.g. 30 min, config). Commit inside the `pending→paid` branch in both verify-payment and paystack-webhook, keyed idempotently. |
| 4 | Quote | New `rewards-quote` function (authenticated) that reuses create-order's pricing code (extract to a shared service), returns eligible subtotal, max redeemable, config version id. create-order accepts `points_to_redeem` and re-quotes; never trusts the PWA amount. |
| 5 | Config | New `rewards_config_versions` with effective-from, status, JSON validated server-side, `rewards_admin_audit`. Everything numeric from PRD §2 lives there; invariants (unique signup, unique daily claim, one referral per referee first order) are DB unique constraints. |
| 6 | Timezone/daily claim | Unique `(user_id, claim_date)` where `claim_date` is computed in Postgres with the configured zone (`Africa/Lagos`), inside the claim RPC. |
| 7 | Launch cutoff | Compare `auth.users.created_at` and `email_confirmed_at` to config cutoff; provenance row is unique on user id. |
| 8 | Referral first order | Unique `(referee_id)` on `referral_awards`; created from the paid branch; `pending → available` via scheduled sweep after the hold, only if the order isn't refunded/cancelled. |
| 9 | Refund of points | Proportional to refunded merchandise value; cash refund reduced by points portion only if config says so (open PRD item, needs decision). |
| 10 | Gift boxes | Out of scope for v1 unless owner says otherwise (separate order path). |

## Proposed phasing against the repo

- **B1 migration** (`rewards_*` tables, RPCs: `rewards_claim_daily`, `rewards_reserve`, `rewards_commit`, `rewards_release`, `rewards_reverse`), RLS service-role only, customers read their own wallet via an authenticated RPC.
- **B2 JLO functions:** `rewards-wallet` (GET, customer JWT), `rewards-claim` (POST), `rewards-quote`, plus admin `admin-rewards-config` (requireAdmin, audited).
- **B3 dashboard** Rewards admin page + reporting views.
- **C/D** hooks in `create-order`, `verify-payment`, `paystack-webhook`, `cancel-order`, `refunds`, returns; PWA `/account/rewards` and the checkout toggle (forward JWT on create).
- Feature flag: `rewards_config_versions` with `enabled=false` default, so merge-to-main (Netlify deploys on main) is safe.

## Open questions for the owner

1. Gift boxes and custom orders: earn/redeem or excluded?
2. Partial return: do redeemed points come back, and in what proportion?
3. If the conversion rate changes, do existing balances keep earned naira value (snapshot) or float?
4. Are there Google-only sign-in customers with no Supabase session?
5. Should the platform book points as a liability when issued, or only recognise cost at redemption? (Finance/accounting decision; the ledger supports either.)
6. Expiry stays off at launch per PRD: confirm.
