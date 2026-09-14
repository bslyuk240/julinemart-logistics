// Signed, non-expiring tokens that let a vendor open their own shipment's
// label/waybill straight from an email link, with no login required — same
// pattern as unsubscribeToken.js. assertWaybillAccess() otherwise requires a
// Bearer JWT, which a plain email click can never carry.
import crypto from 'crypto';

const SECRET = process.env.SHIPMENT_PRINT_TOKEN_SECRET;

function tokenPayload(subOrderId, doc) {
  return `${subOrderId}:${doc}`;
}

export function makePrintToken(subOrderId, doc) {
  if (!SECRET) {
    // No insecure fallback — a hardcoded key here would let anyone forge a
    // valid print token for any sub-order.
    throw new Error('SHIPMENT_PRINT_TOKEN_SECRET is not configured');
  }
  return crypto
    .createHmac('sha256', SECRET)
    .update(tokenPayload(subOrderId, doc))
    .digest('hex')
    .slice(0, 32);
}

export function verifyPrintToken(subOrderId, doc, token) {
  if (!token || typeof token !== 'string') return false;
  let expected;
  try {
    expected = makePrintToken(subOrderId, doc);
  } catch {
    return false;
  }
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
