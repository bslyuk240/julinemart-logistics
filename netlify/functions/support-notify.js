/**
 * Netlify Function: /api/support-notify
 *
 * Triggered by the PWA API routes when support chat events occur.
 * Handles two actions:
 *   human_requested — push to all staff devices + individual email to each
 *                     eligible support staff (roles: admin, agent, manager)
 *   session_created — email customer receipt (if email provided)
 *
 * Staff emails are pulled from the users table — no hardcoded list needed.
 * Control who gets notified by managing roles in the Users page.
 *
 * Secured with SUPPORT_NOTIFY_SECRET shared between JLO and PWA.
 */

import { createClient }        from '@supabase/supabase-js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { sendPushToAllStaff }     from './services/pushNotifications.js';

const SUPPORT_NOTIFY_SECRET = process.env.SUPPORT_NOTIFY_SECRET;
const JLO_BASE_URL          = process.env.URL || process.env.JLO_BASE_URL || '';

// Roles that should receive support chat email alerts
const SUPPORT_ALERT_ROLES = ['admin', 'agent', 'manager'];

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const headers = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-support-notify-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

/**
 * Fetch all active staff who should receive support alert emails.
 * Returns their email addresses.
 */
async function getSupportStaffEmails() {
  const { data, error } = await supabase
    .from('users')
    .select('email')
    .in('role', SUPPORT_ALERT_ROLES)
    .eq('is_active', true)
    .not('email', 'is', null);

  if (error) {
    console.error('[support-notify] Failed to fetch staff emails:', error.message);
    return [];
  }

  return (data ?? []).map(u => u.email).filter(Boolean);
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify shared secret
  const incoming = event.headers?.['x-support-notify-secret'] || event.headers?.['X-Support-Notify-Secret'];
  if (!SUPPORT_NOTIFY_SECRET || incoming !== SUPPORT_NOTIFY_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action, session } = body;

  if (!action || !session) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing action or session' }) };
  }

  const inboxUrl     = `${JLO_BASE_URL}/admin/support`;
  const senderEmail  = process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
  const requestedAt  = new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });

  try {
    if (action === 'human_requested') {
      // 1. Push notification to all registered staff devices (already covers everyone)
      await sendPushToAllStaff({
        title:   `Support: ${session.customer_name || 'Customer'} needs help`,
        message: session.first_message || 'A customer has requested a human agent.',
        type:    'support_chat',
        data:    { targetPath: '/admin/support' },
      });

      // 2. Email each eligible support staff member individually
      const staffEmails = await getSupportStaffEmails();
      console.log(`[support-notify] Emailing ${staffEmails.length} staff member(s)`);

      await Promise.allSettled(
        staffEmails.map(email =>
          sendTransactionalEmail({
            templateName: 'Support Chat - Staff Alert',
            to: email,
            data: {
              customer_name:  session.customer_name  || 'Unknown',
              customer_email: session.customer_email || 'Not provided',
              first_message:  session.first_message  || '',
              requested_at:   requestedAt,
              inbox_url:      inboxUrl,
              support_email:  senderEmail,
            },
          })
        )
      );

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, action, emailed: staffEmails.length }) };
    }

    if (action === 'session_created') {
      // Customer receipt — only if they provided an email
      if (session.customer_email) {
        await sendTransactionalEmail({
          templateName: 'Support Chat - Customer Receipt',
          to: session.customer_email,
          data: {
            customer_name:  session.customer_name || 'there',
            first_message:  session.first_message || '',
            support_email:  senderEmail,
          },
        });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, action }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    console.error('[support-notify] Error:', err?.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error', message: err?.message }) };
  }
};
