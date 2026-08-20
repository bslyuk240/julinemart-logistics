/**
 * Daily: nudge riders whose verified documents are expiring soon.
 * Reminder only — no enforcement, per the brief's explicit instruction not
 * to block anything on document expiry until backend rules are defined
 * (docs/rider-app-ux-rebuild.md #17).
 */
import { createClient } from '@supabase/supabase-js';
import { sendPushToCustomer } from './services/pushNotifications.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

const REMINDER_WINDOW_DAYS = 30;

const DOC_LABEL = { id: 'ID document', vehicle: 'vehicle document', selfie: 'selfie' };

export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[document-expiry-check-scheduled] Missing Supabase credentials');
    return { statusCode: 500 };
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + REMINDER_WINDOW_DAYS);

  try {
    const { data: docs, error } = await adminClient
      .from('rider_documents')
      .select('id, rider_id, type, expiry_date, riders ( id, full_name )')
      .eq('status', 'verified')
      .is('expiry_notified_at', null)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', windowEnd.toISOString().slice(0, 10));

    if (error) throw error;

    let sent = 0;
    for (const doc of docs || []) {
      if (!doc.riders) continue;
      const daysLeft = Math.ceil((new Date(doc.expiry_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      const label = DOC_LABEL[doc.type] || 'document';
      const pushResult = await sendPushToCustomer(doc.rider_id, {
        title: 'Document expiring soon',
        message:
          daysLeft > 0
            ? `Your ${label} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — update it in the app when you can.`
            : `Your ${label} has expired — update it in the app when you can.`,
        type: 'document_expiring',
        data: { document_id: doc.id, targetPath: '/profile' },
      });
      if (pushResult.success || pushResult.skipped) {
        await adminClient.from('rider_documents').update({ expiry_notified_at: new Date().toISOString() }).eq('id', doc.id);
        sent += 1;
      }
    }

    console.log(`[document-expiry-check-scheduled] Checked ${docs?.length || 0}, notified ${sent}`);
    return { statusCode: 200 };
  } catch (err) {
    console.error('[document-expiry-check-scheduled] Failed:', err?.message);
    return { statusCode: 500 };
  }
};
