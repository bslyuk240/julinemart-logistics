// Admin-triggered on-demand refresh of internal_whatsapp_templates.meta_template_status
// against Meta's real Graph API status — see services/internalWhatsapp.js's
// syncWhatsAppTemplateStatuses() for why this exists (that field was never
// kept in sync after template creation). Also runs automatically on a
// schedule (sync-whatsapp-templates-scheduled.js) — this is the manual
// "sync now" button's endpoint, for the moment an admin wants a fresh read
// without waiting for the next scheduled run.

import { requireAdmin, headers, jsonResponse } from './services/global-sourcing-utils.js';
import { syncWhatsAppTemplateStatuses } from './services/internalWhatsapp.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const result = await syncWhatsAppTemplateStatuses();
    if (!result.synced) {
      return jsonResponse(503, { success: false, error: `WhatsApp template sync is not configured (${result.reason})` });
    }
    return jsonResponse(200, { success: true, data: result });
  } catch (error) {
    return jsonResponse(502, { success: false, error: error.message });
  }
}
