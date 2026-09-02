/**
 * Scheduled (daily, see netlify.toml): keeps internal_whatsapp_templates in
 * sync with Meta's real template approval status, so it doesn't silently
 * drift stale the way it did before this existed (see
 * services/internalWhatsapp.js's syncWhatsAppTemplateStatuses() for the
 * background). No-ops quietly if WHATSAPP_BUSINESS_ACCOUNT_ID isn't set.
 */
import { syncWhatsAppTemplateStatuses } from './services/internalWhatsapp.js';

export const handler = async () => {
  try {
    const result = await syncWhatsAppTemplateStatuses();
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    console.error('[sync-whatsapp-templates-scheduled] failed:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
