/**
 * Resend HTTP API (not SMTP). Operational mail only (orders, vendor
 * activation, Skola bulk, invoices). Auth mail (invite, password reset,
 * magic link) stays on Supabase Custom SMTP — never this module.
 *
 * A saved resend_api_key (or RESEND_API_KEY) is enough; do not set
 * EMAIL_PROVIDER=resend or point Auth SMTP at Resend.
 *
 * Templates still live in JLO; this only delivers.
 * Batch: POST /emails/batch accepts up to 100 messages per request.
 * https://resend.com/docs/api-reference/emails/send-batch-emails
 */

const RESEND_API = 'https://api.resend.com';
export const RESEND_BATCH_LIMIT = 100;

/**
 * @param {string} apiKey
 * @param {{ from: string, to: string | string[], subject: string, html?: string, text?: string, attachments?: { filename: string, content: string }[] }} input
 */
export async function sendResendEmail(apiKey, input) {
  const to = Array.isArray(input.to) ? input.to : [input.to];
  const body = {
    from: input.from,
    to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (input.replyTo) {
    body.reply_to = input.replyTo;
  }
  if (input.attachments?.length) {
    body.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
    }));
  }
  const data = await resendFetch(apiKey, '/emails', { method: 'POST', body: JSON.stringify(body) });
  return data;
}

/**
 * @param {string} apiKey
 * @param {Array<{ from: string, to: string[], subject: string, html?: string, text?: string }>} emails
 */
export async function sendResendBatch(apiKey, emails) {
  const results = [];
  for (let i = 0; i < emails.length; i += RESEND_BATCH_LIMIT) {
    const chunk = emails.slice(i, i + RESEND_BATCH_LIMIT);
    const data = await resendFetch(apiKey, '/emails/batch', {
      method: 'POST',
      body: JSON.stringify(chunk),
    });
    results.push(data);
  }
  return results;
}

/** Confirms the key can talk to Resend without sending mail. */
export async function verifyResendKey(apiKey) {
  return resendFetch(apiKey, '/domains', { method: 'GET' });
}

async function resendFetch(apiKey, path, init) {
  if (!apiKey) throw new Error('Resend API key is missing');
  const res = await fetch(`${RESEND_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.message || data.error || `Resend ${res.status}`);
  }
  return data;
}
