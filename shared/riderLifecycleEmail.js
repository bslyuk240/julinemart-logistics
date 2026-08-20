/**
 * Emails for rider account-lifecycle events (application approved/rejected,
 * suspended, bank/vehicle change outcomes, document review, withdrawals)
 * and staff alerts triggered by rider activity — rider-app-ux-rebuild.md's
 * notification-triggers audit. Every one of these previously had zero
 * email (riders only ever got push, if that) — this is what closes it.
 *
 * Reuses riderAssignedEmail.js's transport/logging (same email_config, same
 * email_logs audit trail) rather than the DB-template-driven
 * sendTransactionalEmail path — that path requires a pre-seeded
 * email_templates row per template, which doesn't exist for any of these
 * and shouldn't be guessed at; self-contained HTML matches the pattern
 * already proven for every other rider-facing email in this codebase.
 */
import { loadMailTransport, escapeHtml, logOrderEmail } from './riderAssignedEmail.js';

/**
 * Generic rider-facing account email — one shared template, each call site
 * supplies its own headline/message/reason. Mirrors how rider push
 * notifications already work (a title/message pair per event).
 */
export async function sendRiderAccountEmail(supabase, { to, riderName, subject, headline, message, reason }) {
  const recipient = (to && String(to).trim()) || '';
  if (!recipient) {
    await logOrderEmail(supabase, {
      recipient: '(no rider email)',
      subject,
      status: 'failed',
      errorMessage: 'No rider email on file.',
    });
    return { sent: false, reason: 'no_recipient' };
  }

  const mt = await loadMailTransport(supabase);
  if ('error' in mt) {
    await logOrderEmail(supabase, { recipient, subject, status: 'failed', errorMessage: mt.error });
    return { sent: false, reason: mt.error };
  }

  const reasonBlock = reason
    ? `<div style="padding:14px;background:#fef2f2;border-radius:8px;margin:16px 0;border:1px solid #fecaca">
      <p style="margin:0;font-size:12px;text-transform:uppercase;color:#991b1b">Reason</p>
      <p style="margin:6px 0 0;font-size:14px;color:#7f1d1d">${escapeHtml(reason)}</p>
    </div>`
    : '';

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:28px;text-align:center">
    <h1 style="margin:0;font-size:22px">${escapeHtml(headline)}</h1>
  </div>
  <div style="padding:28px;background:#fff;color:#333">
    <p style="margin:0 0 16px">Hi ${escapeHtml(riderName || 'there')},</p>
    <p style="margin:0 0 16px;line-height:1.55">${escapeHtml(message)}</p>
    ${reasonBlock}
  </div>
  <div style="background:#f3f4f6;padding:14px;text-align:center;font-size:12px;color:#666">JulineMart Rider</div>
</div>`;

  const text = [`Hi ${riderName || 'there'},`, '', message, reason ? `\nReason: ${reason}` : '', '', '— JulineMart'].filter(Boolean).join('\n');

  try {
    await mt.transporter.sendMail({ from: mt.from, to: recipient, subject, html, text });
    await logOrderEmail(supabase, { recipient, subject, status: 'sent' });
    return { sent: true };
  } catch (err) {
    await logOrderEmail(supabase, { recipient, subject, status: 'failed', errorMessage: err?.message || String(err) });
    return { sent: false, reason: err?.message };
  }
}

/** Roles that should hear about rider-triggered staff alerts. */
const STAFF_ALERT_ROLES = ['admin', 'agent', 'manager'];

export async function getStaffAlertEmails(supabase) {
  const { data, error } = await supabase
    .from('users')
    .select('email')
    .in('role', STAFF_ALERT_ROLES)
    .eq('is_active', true)
    .not('email', 'is', null);
  if (error) {
    console.error('[riderLifecycleEmail] Failed to fetch staff emails:', error.message);
    return [];
  }
  return (data || []).map((u) => u.email).filter(Boolean);
}

/**
 * Generic staff alert email — same shared-template approach as
 * sendRiderAccountEmail, sent once per eligible staff member (call in a
 * Promise.allSettled loop over getStaffAlertEmails' result, same pattern
 * support-notify.js already uses for its own staff fan-out).
 */
export async function sendStaffAlertEmail(supabase, { to, subject, headline, message, actionUrl, actionLabel }) {
  const mt = await loadMailTransport(supabase);
  if ('error' in mt) {
    await logOrderEmail(supabase, { recipient: to, subject, status: 'failed', errorMessage: mt.error });
    return { sent: false, reason: mt.error };
  }

  const actionBlock =
    actionUrl && actionLabel
      ? `<p style="margin:20px 0 0"><a href="${actionUrl}" style="display:inline-block;padding:12px 20px;background:#6b21a8;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(actionLabel)}</a></p>`
      : '';

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#111827;color:#fff;padding:24px;text-align:center">
    <h1 style="margin:0;font-size:20px">${escapeHtml(headline)}</h1>
  </div>
  <div style="padding:24px;background:#fff;color:#333">
    <p style="margin:0 0 16px;line-height:1.55">${escapeHtml(message)}</p>
    ${actionBlock}
  </div>
  <div style="background:#f3f4f6;padding:12px;text-align:center;font-size:12px;color:#666">JulineMart Admin</div>
</div>`;

  const text = [message, actionUrl ? `\n${actionLabel || 'Open'}: ${actionUrl}` : ''].filter(Boolean).join('\n');

  try {
    await mt.transporter.sendMail({ from: mt.from, to, subject, html, text });
    await logOrderEmail(supabase, { recipient: to, subject, status: 'sent' });
    return { sent: true };
  } catch (err) {
    await logOrderEmail(supabase, { recipient: to, subject, status: 'failed', errorMessage: err?.message || String(err) });
    return { sent: false, reason: err?.message };
  }
}

/** Fan out a staff alert email to every eligible role, best-effort. */
export async function sendStaffAlertEmails(supabase, input) {
  const emails = await getStaffAlertEmails(supabase);
  await Promise.allSettled(emails.map((to) => sendStaffAlertEmail(supabase, { ...input, to })));
  return emails.length;
}
