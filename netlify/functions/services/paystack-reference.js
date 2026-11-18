/**
 * Paystack reference handling.
 *
 * The PWA deliberately opens Paystack with a FRESH reference
 * (`<orders.payment_reference>-R<TIMESTAMP>`) so a retried payment never reuses
 * a reference. That means Paystack's transaction reference is NOT what is stored
 * in orders.payment_reference. This module bridges the two:
 *
 *   - resolveOrderReference(): webhook side. Given a Paystack reference, find the
 *     order's payment_reference (stored paystack_reference, exact, or suffix-stripped).
 *   - resolveTransactionRef(): refund side. Given an order's payment_reference,
 *     find the real Paystack transaction reference (stored paystack_reference,
 *     the reference itself if Paystack knows it, or a search by amount and date
 *     for orders paid before paystack_reference was recorded).
 */

const FRESH_SUFFIX = /-R[0-9A-Z]{4,}$/;
const SEARCH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export const baseReference = (ref) => String(ref || '').replace(FRESH_SUFFIX, '');

/** Only plain reference characters may reach a PostgREST filter string. */
export const isSafeReference = (ref) =>
  typeof ref === 'string' && /^[A-Za-z0-9_.-]{4,120}$/.test(ref);

/** Paystack reference -> the order's payment_reference (or the input if no order matches). */
export async function resolveOrderReference(client, ref) {
  if (!isSafeReference(ref)) return ref;
  const { data } = await client
    .from('orders')
    .select('payment_reference')
    .or(`payment_reference.eq.${ref},paystack_reference.eq.${ref}`)
    .limit(1)
    .maybeSingle();
  if (data?.payment_reference) return data.payment_reference;

  const base = baseReference(ref);
  if (base !== ref) {
    const { data: byBase } = await client
      .from('orders')
      .select('payment_reference')
      .eq('payment_reference', base)
      .limit(1)
      .maybeSingle();
    if (byBase?.payment_reference) return byBase.payment_reference;
  }
  return ref;
}

async function paystackGet(url, secret, fetchImpl) {
  try {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${secret}` } });
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Order payment_reference -> the Paystack transaction reference to refund.
 * Never throws: on any failure returns the input so callers behave as before.
 */
export async function resolveTransactionRef(client, ref, secret, fetchImpl = globalThis.fetch) {
  if (!isSafeReference(ref)) return ref;

  const { data: order } = await client
    .from('orders')
    .select('id, payment_reference, paystack_reference, total_amount, paid_at, created_at')
    .or(`payment_reference.eq.${ref},paystack_reference.eq.${ref}`)
    .limit(1)
    .maybeSingle();

  if (order?.paystack_reference) return order.paystack_reference;
  if (!secret) return ref;

  // The reference itself may already be a real Paystack reference (older flows).
  const direct = await paystackGet(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`, secret, fetchImpl);
  if (direct?.status && direct?.data?.status === 'success') return ref;

  // Orders paid before paystack_reference was recorded: find the transaction by
  // amount and date, then keep what we found so this lookup happens once.
  if (order && Number(order.total_amount) > 0) {
    const when = new Date(order.paid_at || order.created_at || Date.now()).getTime();
    const qs = new URLSearchParams({
      status: 'success',
      amount: String(Math.round(Number(order.total_amount) * 100)),
      from: new Date(when - SEARCH_WINDOW_MS).toISOString(),
      to: new Date(when + SEARCH_WINDOW_MS).toISOString(),
      perPage: '100',
    });
    const list = await paystackGet(`https://api.paystack.co/transaction?${qs}`, secret, fetchImpl);
    const hit = (list?.data || []).find(
      (t) =>
        typeof t?.reference === 'string' &&
        (t.reference === order.payment_reference || t.reference.startsWith(`${order.payment_reference}-R`))
    );
    if (hit) {
      try {
        await client.from('orders').update({ paystack_reference: hit.reference }).eq('id', order.id);
      } catch { /* best effort */ }
      return hit.reference;
    }
  }
  return ref;
}
