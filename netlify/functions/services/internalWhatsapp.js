/**
 * Internal WhatsApp outreach — Sales Rep / Ops Manager agents messaging
 * vendors and leads via the WhatsApp Business Platform (Cloud API).
 *
 * Deliberately separate from the deprecated customer-support WhatsApp
 * tables (whatsapp_*, replaced by support_sessions/support_messages) — see
 * migration 20260828120000_internal_whatsapp_outreach.sql. Not a public
 * customer-care number; agent-driven only.
 *
 * WhatsApp's 24h rule: freeform text only works within 24h of the contact's
 * last inbound message (service_window_expires_at). Outside that window,
 * only an approved template can open/continue the conversation. This module
 * enforces that at sendText time rather than letting Meta's own rejection
 * be the only signal.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const WA_API_BASE = 'https://graph.facebook.com/v21.0';
// These must be scoped to "functions"/"runtime" in Netlify's env var
// settings, not just "builds" — a builds-only scope leaves this undefined
// here at runtime even though `netlify env:get` shows a value is set.
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';

async function waPost(path, body) {
  if (!PHONE_NUMBER_ID) throw new Error('WHATSAPP_PHONE_NUMBER_ID is not configured');
  if (!ACCESS_TOKEN) throw new Error('WHATSAPP_ACCESS_TOKEN is not configured');
  const res = await fetch(`${WA_API_BASE}/${PHONE_NUMBER_ID}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message || `WhatsApp API error on ${path}`);
  return json;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
}

async function getOrCreateThread({ phone, contactName, contactType, vendorId }) {
  const normalized = normalizePhone(phone);
  const { data: existing } = await supabase
    .from('internal_whatsapp_threads')
    .select('*')
    .eq('contact_phone', normalized)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('internal_whatsapp_threads')
    .insert({
      contact_phone: normalized,
      contact_name: contactName || null,
      contact_type: contactType,
      vendor_id: vendorId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return created;
}

async function recordMessage({ threadId, direction, messageType, content, templateName, metaMessageId, status, sentByAgent, errorMessage }) {
  const { error } = await supabase.from('internal_whatsapp_messages').insert({
    thread_id: threadId,
    direction,
    message_type: messageType,
    content: content || null,
    template_name: templateName || null,
    meta_message_id: metaMessageId || null,
    status,
    sent_by_agent: sentByAgent || null,
    error_message: errorMessage || null,
  });
  if (error) throw error;
}

/** Freeform text — only valid within the contact's 24h service window. */
export async function sendWhatsAppText({ to, message, contactName, contactType = 'lead', vendorId, sentByAgent }) {
  if (!to) throw new Error('to (phone number) is required');
  if (!message || !message.trim()) throw new Error('message is required');

  const thread = await getOrCreateThread({ phone: to, contactName, contactType, vendorId });
  const windowOpen = thread.service_window_expires_at && new Date(thread.service_window_expires_at) > new Date();
  if (!windowOpen) {
    throw new Error(
      `Cannot send freeform text — this contact's 24h service window is ${thread.service_window_expires_at ? 'closed' : 'not open (they have never messaged in)'}. Use whatsapp.template.send to reach them instead.`,
    );
  }

  try {
    const result = await waPost('messages', {
      messaging_product: 'whatsapp',
      to: normalizePhone(to),
      type: 'text',
      text: { body: message },
    });
    const metaMessageId = result.messages?.[0]?.id || null;
    await recordMessage({ threadId: thread.id, direction: 'outbound', messageType: 'text', content: message, metaMessageId, status: 'sent', sentByAgent });
    return { thread_id: thread.id, message_id: metaMessageId };
  } catch (e) {
    await recordMessage({ threadId: thread.id, direction: 'outbound', messageType: 'text', content: message, status: 'failed', sentByAgent, errorMessage: e.message });
    throw e;
  }
}

/**
 * Approved-template send — the only way to initiate/continue outside the
 * 24h window. `variables` fills the template's {{1}}, {{2}}, ... slots in
 * order. Does NOT check meta_template_status itself — a template stuck on
 * 'PENDING' will simply fail against the real API with a clear Meta error,
 * which is more trustworthy than this function's own possibly-stale copy
 * of the approval state.
 */
export async function sendWhatsAppTemplate({ to, templateName, variables = [], language, contactName, contactType = 'lead', vendorId, sentByAgent }) {
  if (!to) throw new Error('to (phone number) is required');
  if (!templateName) throw new Error('templateName is required');

  const { data: template, error: templateErr } = await supabase
    .from('internal_whatsapp_templates')
    .select('*')
    .eq('name', templateName)
    .eq('is_active', true)
    .maybeSingle();
  if (templateErr) throw templateErr;
  if (!template) throw new Error(`Unknown or inactive template "${templateName}"`);

  const thread = await getOrCreateThread({ phone: to, contactName, contactType, vendorId });

  const components = variables.length
    ? [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v) })) }]
    : [];

  try {
    const result = await waPost('messages', {
      messaging_product: 'whatsapp',
      to: normalizePhone(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: language || template.language || 'en' },
        ...(components.length ? { components } : {}),
      },
    });
    const metaMessageId = result.messages?.[0]?.id || null;
    await recordMessage({ threadId: thread.id, direction: 'outbound', messageType: 'template', templateName, content: template.template_content, metaMessageId, status: 'sent', sentByAgent });
    return { thread_id: thread.id, message_id: metaMessageId };
  } catch (e) {
    await recordMessage({ threadId: thread.id, direction: 'outbound', messageType: 'template', templateName, status: 'failed', sentByAgent, errorMessage: e.message });
    throw e;
  }
}

export async function listWhatsAppThreads({ contactType } = {}) {
  let q = supabase.from('internal_whatsapp_threads').select('*').order('last_message_at', { ascending: false, nullsFirst: false });
  if (contactType) q = q.eq('contact_type', contactType);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function readWhatsAppThread({ phone, limit = 30 }) {
  const normalized = normalizePhone(phone);
  const { data: thread, error: threadErr } = await supabase
    .from('internal_whatsapp_threads')
    .select('*')
    .eq('contact_phone', normalized)
    .maybeSingle();
  if (threadErr) throw threadErr;
  if (!thread) return { thread: null, messages: [] };

  const { data: messages, error: msgErr } = await supabase
    .from('internal_whatsapp_messages')
    .select('*')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (msgErr) throw msgErr;
  return { thread, messages: (messages || []).reverse() };
}

export async function listWhatsAppTemplates() {
  const { data, error } = await supabase.from('internal_whatsapp_templates').select('*').eq('is_active', true).order('name');
  if (error) throw error;
  return data || [];
}

/** Records an inbound message + advances the 24h window — called by the webhook handler. */
export async function recordInboundWhatsAppMessage({ from, contactName, text, metaMessageId }) {
  const thread = await getOrCreateThread({ phone: from, contactName, contactType: 'lead' });
  await recordMessage({ threadId: thread.id, direction: 'inbound', messageType: 'text', content: text, metaMessageId, status: 'delivered' });
  return thread;
}
