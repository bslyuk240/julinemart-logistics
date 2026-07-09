/**
 * Upstash-backed rate limiting for public Netlify Functions (persists across
 * serverless instances, unlike an in-memory limiter). Same Upstash Redis
 * instance as julinemart-pwa's middleware — each limiter is namespaced by
 * `prefix` so the key spaces don't collide.
 *
 * Fails open: if Redis env vars are missing or Redis errors, the request is
 * allowed through and a warning is logged, so a Redis outage never takes the
 * public catalog down.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const limiters = new Map();

function getLimiter(prefix, max, windowStr) {
  if (limiters.has(prefix)) return limiters.get(prefix);

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  const limiter =
    url && token
      ? new Ratelimit({
          redis: new Redis({ url, token }),
          limiter: Ratelimit.slidingWindow(max, windowStr),
          analytics: false,
          prefix,
        })
      : null;

  limiters.set(prefix, limiter);
  return limiter;
}

function getClientIp(event) {
  return (
    event.headers?.['x-nf-client-connection-ip'] ||
    event.headers?.['x-forwarded-for']?.split(',')[0].trim() ||
    'unknown'
  );
}

/**
 * @param {object} event - Netlify function event
 * @param {object} opts
 * @param {string} opts.name - unique limiter name (becomes the Redis key prefix)
 * @param {number} opts.max - max requests per window
 * @param {string} opts.window - Upstash duration string, e.g. '1 m'
 * @param {number} opts.retryAfterSeconds - value for the Retry-After header when limited
 * @returns {Promise<{ limited: boolean, response: object | null }>}
 */
export async function checkRateLimit(event, { name, max, window, retryAfterSeconds }) {
  const limiter = getLimiter(`rl:${name}`, max, window);
  if (!limiter) return { limited: false, response: null };

  try {
    const ip = getClientIp(event);
    const { success, limit, remaining, reset } = await limiter.limit(ip);
    if (success) return { limited: false, response: null };

    return {
      limited: true,
      response: {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': String(remaining),
          'X-RateLimit-Reset': String(reset),
          'Retry-After': String(retryAfterSeconds),
        },
        body: JSON.stringify({
          success: false,
          error: 'Too many requests. Please slow down.',
        }),
      },
    };
  } catch (error) {
    console.warn(`[rate-limit] limiter unavailable for "${name}"`, error?.message);
    return { limited: false, response: null };
  }
}
