import crypto from 'crypto';

const SECRET = process.env.UNSUBSCRIBE_TOKEN_SECRET;

function tokenPayload(email, category) {
  return `${String(email).trim().toLowerCase()}:${category}`;
}

export function makeUnsubscribeToken(email, category) {
  if (!SECRET) {
    // No insecure fallback — a hardcoded key here would let anyone forge a
    // valid unsubscribe token for any email address.
    throw new Error('UNSUBSCRIBE_TOKEN_SECRET is not configured');
  }
  return crypto
    .createHmac('sha256', SECRET)
    .update(tokenPayload(email, category))
    .digest('hex')
    .slice(0, 32);
}

export function verifyUnsubscribeToken(email, category, token) {
  if (!token || typeof token !== 'string') return false;
  let expected;
  try {
    expected = makeUnsubscribeToken(email, category);
  } catch {
    return false;
  }
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
