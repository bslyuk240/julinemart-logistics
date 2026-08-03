import crypto from 'crypto';

const SECRET = process.env.UNSUBSCRIBE_TOKEN_SECRET;

if (!SECRET) {
  console.warn(
    '[unsubscribeToken] UNSUBSCRIBE_TOKEN_SECRET is not set — using an insecure ' +
    'dev-only fallback. Set a dedicated secret in Netlify env vars before sending ' +
    'any real unsubscribe-linked email.'
  );
}

function tokenPayload(email, category) {
  return `${String(email).trim().toLowerCase()}:${category}`;
}

export function makeUnsubscribeToken(email, category) {
  return crypto
    .createHmac('sha256', SECRET || 'dev-only-insecure-unsubscribe-secret')
    .update(tokenPayload(email, category))
    .digest('hex')
    .slice(0, 32);
}

export function verifyUnsubscribeToken(email, category, token) {
  if (!token || typeof token !== 'string') return false;
  const expected = makeUnsubscribeToken(email, category);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
