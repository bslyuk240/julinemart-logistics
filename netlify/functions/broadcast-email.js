/**
 * POST /api/broadcast-email  — Admin only
 * Sends a newsletter / broadcast email to customers, vendors, or both.
 *
 * Body:
 *   audience   : 'customers' | 'vendors' | 'both'
 *   subject    : string
 *   body       : string  (plain text — rendered inside a simple wrapper.
 *                Supports inline images via ![alt](https://...) — see
 *                renderInlineImages below. Everything else is escaped as
 *                literal text; a malformed or non-https url is left as the
 *                original literal text rather than becoming a broken/live tag.)
 *   image_url  : string  (optional — must be https; rendered as a header image.
 *                Get one from POST /api/meta/upload-image, the same upload
 *                endpoint the Meta Ads composer uses.)
 */

import { createClient } from '@supabase/supabase-js';
import { getTransport } from './services/emailNotifications.js';
import { logNotificationHistory, EMAIL_HISTORY_ACTION } from './services/notificationHistory.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const adminClient = createClient(supabaseUrl, serviceKey);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SEND_CONCURRENCY = 8;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Matches ![alt](https://...) — both captures use bounded, negated single-char
// classes (no nested/overlapping quantifiers), so this can't ReDoS on adversarial
// input. Runs AFTER the &/</> escaping pass below, so a literal & inside a query
// string already reads as &amp; here — that's correct, not a bug, since it must
// stay that way inside the eventual src="..." attribute.
const INLINE_IMAGE_RE = /!\[([^\]\r\n]{0,200})\]\((https:\/\/[^\s")'<>]{1,2000})\)/g;
const MAX_INLINE_IMAGES = 10;

function escapeAttr(value) {
  // The &/</> pass already ran on this text; only quotes remain unescaped,
  // and this string is about to be spliced into a "..."-delimited attribute.
  return value.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Body text has already been through the &/</> escaping pass when this runs,
// so a match's alt/url captures are themselves already escaped — the only
// extra step needed before using them in an attribute is quote-escaping.
// Anything that isn't a well-formed https url (checked by un-escaping just for
// validation, never for output) is left as the original literal text — never
// silently dropped, never rendered as a broken or unexpectedly-live tag.
function renderInlineImages(escapedBody) {
  let count = 0;
  return escapedBody.replace(INLINE_IMAGE_RE, (match, altEscaped, urlEscaped) => {
    if (count >= MAX_INLINE_IMAGES) return match;
    const urlForValidation = urlEscaped.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    if (!isValidImageUrl(urlForValidation)) return match;
    count += 1;
    return `<img src="${escapeAttr(urlEscaped)}" alt="${escapeAttr(altEscaped)}" style="display:block;max-width:100%;height:auto;margin:12px 0;border:0">`;
  });
}

function buildHtml(subject, body, from, imageUrl) {
  const escapedRaw = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const escaped = renderInlineImages(escapedRaw).split('\n').join('<br>');
  // imageUrl already passed isValidImageUrl() at the call site (https only) —
  // still escape quotes before splicing into the src attribute.
  const imageRow = imageUrl
    ? `<tr><td style="padding:0"><img src="${escapeAttr(imageUrl)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`
    : '';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;width:100%">
        <tr><td style="background:#7c3aed;padding:24px 32px">
          <h1 style="margin:0;color:#fff;font-size:20px">JulineMart</h1>
        </td></tr>
        ${imageRow}
        <tr><td style="padding:32px">
          <h2 style="margin:0 0 16px;color:#111827;font-size:18px">${subject}</h2>
          <p style="margin:0;color:#374151;font-size:15px;line-height:1.7">${escaped}</p>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;color:#9ca3af;font-size:12px">
          You received this because you have an account on JulineMart. Sent by ${from}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function isValidImageUrl(value) {
  if (!value) return true; // optional field
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function logEmailAttempt({ recipient, subject, status, errorMessage, resendMessageId, source }) {
  try {
    await adminClient.from('email_logs').insert({
      recipient,
      subject,
      status,
      error_message: errorMessage,
      resend_message_id: resendMessageId || null,
      source: source || null,
      sent_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[broadcast-email] email_logs insert failed:', e?.message);
  }
}

async function sendOneRecipient(tx, email, subject, textBody, html, source) {
  try {
    const result = await tx.transport.sendMail({
      from: tx.from,
      to: email,
      subject,
      text: textBody,
      html,
    });
    // Resend's response carries the message id (SMTP transports don't) — without
    // this, resend-webhook.js has no key to match its later delivered/bounced
    // update back to this row, and the row is stuck at 'sent' forever even
    // though Resend's own dashboard shows the real outcome.
    await logEmailAttempt({ recipient: email, subject, status: 'sent', errorMessage: null, resendMessageId: result?.id, source });
    return { ok: true };
  } catch (err) {
    const errorMessage = err?.message || 'Unknown error';
    console.error(`[broadcast-email] Failed to send to ${email}:`, errorMessage);
    await logEmailAttempt({ recipient: email, subject, status: 'failed', errorMessage, source });
    return { ok: false, error: errorMessage };
  }
}

async function sendInBatches(tx, emails, subject, textBody, html, source) {
  const list = [...emails];
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < list.length; i += SEND_CONCURRENCY) {
    const batch = list.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map((email) => sendOneRecipient(tx, email, subject, textBody, html, source)),
    );
    for (const result of results) {
      if (result.ok) sent += 1;
      else {
        failed += 1;
        if (errors.length < 5 && result.error) errors.push(result.error);
      }
    }
  }

  return { sent, failed, errors };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'Method Not Allowed' });

  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json(401, { success: false, error: 'Unauthorized' });
    }

    const anonClient = createClient(
      supabaseUrl,
      process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: authErr,
    } = await anonClient.auth.getUser();
    if (authErr || !user) return json(401, { success: false, error: 'Invalid token' });

    const { data: profile } = await adminClient.from('users').select('role').eq('id', user.id).single();
    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return json(403, { success: false, error: 'Forbidden — admin or manager only' });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { success: false, error: 'Invalid JSON' });
    }

    const { audience, subject, body: emailBody, image_url: imageUrl } = body;
    if (!audience || !subject?.trim() || !emailBody?.trim()) {
      return json(400, { success: false, error: 'audience, subject, and body are required' });
    }
    if (!['customers', 'vendors', 'both'].includes(audience)) {
      return json(400, { success: false, error: 'audience must be customers | vendors | both' });
    }
    if (imageUrl && !isValidImageUrl(imageUrl)) {
      return json(400, { success: false, error: 'image_url must be a valid https URL' });
    }

    const emails = new Set();

    if (audience === 'customers' || audience === 'both') {
      const { data: customers, error: customerErr } = await adminClient.rpc('get_storefront_customers');
      if (customerErr) {
        console.error('[broadcast-email] get_storefront_customers failed:', customerErr.message);
        return json(500, { success: false, error: 'Could not load customer recipients' });
      }
      for (const c of customers || []) {
        if (c.email) emails.add(String(c.email).trim().toLowerCase());
      }
    }

    if (audience === 'vendors' || audience === 'both') {
      const { data: vendors, error: vendorErr } = await adminClient
        .from('vendors')
        .select('email')
        .eq('is_active', true);
      if (vendorErr) {
        console.error('[broadcast-email] vendors query failed:', vendorErr.message);
        return json(500, { success: false, error: 'Could not load vendor recipients' });
      }
      for (const v of vendors || []) {
        if (v.email) emails.add(String(v.email).trim().toLowerCase());
      }
    }

    if (emails.size === 0) {
      return json(200, {
        success: true,
        sent: 0,
        failed: 0,
        total: 0,
        message: 'No recipients found',
      });
    }

    const tx = await getTransport();
    if (!tx) {
      return json(503, {
        success: false,
        error: 'Email is not configured or disabled. Check Settings → Email.',
      });
    }

    const subjectTrimmed = subject.trim();
    const bodyTrimmed = emailBody.trim();
    const html = buildHtml(subjectTrimmed, bodyTrimmed, tx.from, imageUrl || null);

    const { sent, failed, errors } = await sendInBatches(
      tx,
      emails,
      subjectTrimmed,
      bodyTrimmed,
      html,
      `admin:${user.email}`,
    );

    const responseBody = {
      success: failed === 0,
      partial: sent > 0 && failed > 0,
      sent,
      failed,
      total: emails.size,
      message:
        failed === 0
          ? 'Broadcast sent'
          : sent > 0
            ? 'Broadcast partially sent'
            : 'Broadcast failed for all recipients',
      errors: errors.length ? errors : undefined,
    };

    const historyId = await logNotificationHistory(adminClient, {
      action: EMAIL_HISTORY_ACTION,
      userId: user.id,
      actorEmail: user.email,
      request: {
        audience: audience === 'vendors' ? 'all_vendors' : 'all_customers',
        title: subjectTrimmed,
        message: bodyTrimmed,
        type: 'general',
        data: { channel: 'email', emailAudience: audience, sent, failed, total: emails.size, imageUrl: imageUrl || null },
      },
      response: responseBody,
      success: responseBody.success,
      statusCode: 200,
      meta: { sent, failed, matchedTokensCount: emails.size },
    });

    return json(200, { ...responseBody, historyId });
  } catch (err) {
    console.error('[broadcast-email] Unhandled error:', err);
    return json(500, {
      success: false,
      error: err instanceof Error ? err.message : 'Broadcast email failed',
    });
  }
};
