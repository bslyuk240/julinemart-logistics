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

const MAX_HEADER_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_HEADER_IMAGE_TYPES = ['image/jpeg', 'image/png'];

/**
 * Best-effort pre-check against Meta's own image requirements (JPEG/PNG,
 * <=5MB — https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media)
 * so a bad header image URL fails with a clear reason here instead of an
 * opaque rejection from Meta's API. If the URL doesn't cooperate with HEAD
 * (no content-type/length, or unreachable), this deliberately lets the real
 * send attempt proceed rather than block on an inconclusive check.
 */
async function validateHeaderImage(url) {
  let res;
  try {
    res = await fetch(url, { method: 'HEAD' });
  } catch {
    return;
  }
  if (!res.ok) return;
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType && !ALLOWED_HEADER_IMAGE_TYPES.includes(contentType)) {
    throw new Error(`Header image must be JPEG or PNG (got "${contentType}").`);
  }
  const contentLength = Number(res.headers.get('content-length') || 0);
  if (contentLength && contentLength > MAX_HEADER_IMAGE_BYTES) {
    throw new Error(`Header image is ${(contentLength / 1024 / 1024).toFixed(1)}MB — WhatsApp's limit is 5MB.`);
  }
}

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

/**
 * Template names are stored lowercase_snake_case, but callers (agents
 * especially) keep sending a title-cased or spaced version — "Lead Intro"
 * instead of "lead_intro" — despite being told the exact name. Normalizing
 * here fixes it regardless of what actually gets typed, rather than relying
 * on that instruction being followed every time.
 */
function normalizeTemplateName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
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

/** Fills a template's {{1}}, {{2}}, ... slots with the real values that were actually sent, so stored history reflects what the recipient saw — not the raw pattern. Leaves an unmatched slot as-is rather than blanking it. */
function substituteTemplateVariables(body, variables = []) {
  if (!body) return body;
  return body.replace(/\{\{(\d+)\}\}/g, (match, n) => {
    const value = variables[Number(n) - 1];
    return value != null ? String(value) : match;
  });
}

async function recordMessage({ threadId, direction, messageType, content, templateName, mediaUrl, metaMessageId, status, sentByAgent, errorMessage }) {
  const { error } = await supabase.from('internal_whatsapp_messages').insert({
    thread_id: threadId,
    direction,
    message_type: messageType,
    content: content || null,
    template_name: templateName || null,
    media_url: mediaUrl || null,
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
export async function sendWhatsAppTemplate({ to, templateName, variables = [], language, contactName, contactType = 'lead', vendorId, sentByAgent, headerImageUrl }) {
  if (!to) throw new Error('to (phone number) is required');
  if (!templateName) throw new Error('templateName is required');
  if (headerImageUrl) await validateHeaderImage(headerImageUrl);

  const normalizedName = normalizeTemplateName(templateName);
  const { data: template, error: templateErr } = await supabase
    .from('internal_whatsapp_templates')
    .select('*')
    .eq('name', normalizedName)
    .eq('is_active', true)
    .maybeSingle();
  if (templateErr) throw templateErr;
  if (!template) throw new Error(`Unknown or inactive template "${templateName}"`);

  const thread = await getOrCreateThread({ phone: to, contactName, contactType, vendorId });

  // Only relevant if the template itself was created with an image header in
  // WhatsApp Manager — Meta rejects a header component on a template that
  // doesn't have one, so this is opt-in per call, not automatic.
  const components = [
    ...(headerImageUrl ? [{ type: 'header', parameters: [{ type: 'image', image: { link: headerImageUrl } }] }] : []),
    ...(variables.length ? [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v) })) }] : []),
  ];

  try {
    const result = await waPost('messages', {
      messaging_product: 'whatsapp',
      to: normalizePhone(to),
      type: 'template',
      template: {
        name: template.name,
        language: { code: language || template.language || 'en' },
        ...(components.length ? { components } : {}),
      },
    });
    const metaMessageId = result.messages?.[0]?.id || null;
    const sentContent = substituteTemplateVariables(template.template_content, variables);
    await recordMessage({ threadId: thread.id, direction: 'outbound', messageType: 'template', templateName: template.name, content: sentContent, mediaUrl: headerImageUrl, metaMessageId, status: 'sent', sentByAgent });
    return { thread_id: thread.id, message_id: metaMessageId };
  } catch (e) {
    const attemptedContent = substituteTemplateVariables(template.template_content, variables);
    await recordMessage({ threadId: thread.id, direction: 'outbound', messageType: 'template', templateName: template.name, content: attemptedContent, mediaUrl: headerImageUrl, status: 'failed', sentByAgent, errorMessage: e.message });
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

const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';

/**
 * `internal_whatsapp_templates.meta_template_status` is only ever a locally
 * stored copy of what Meta reported at *creation* time — nothing previously
 * kept it in sync, so a template approved on Meta's side (Manager shows
 * "Active") could sit at 'PENDING' here indefinitely. sendWhatsAppTemplate()
 * deliberately doesn't gate on this field for send decisions (see its own
 * comment — it trusts the real API response instead), but the stale value is
 * still what admins see in the UI, which is misleading. This pulls the real
 * status from Meta's Graph API and updates the local copy to match.
 *
 * Requires WHATSAPP_BUSINESS_ACCOUNT_ID (the WABA id, not the phone number
 * id) — a real value only available from Meta Business Manager, same as the
 * phone/token pair. No-ops (does not throw) if it isn't set, so a missing
 * env var degrades to "nothing synced" rather than breaking the caller.
 *
 * Also seeds any template that exists on Meta but has no local row at all —
 * previously this only ever refreshed rows that already existed (every
 * template had to be added by hand via a migration), so a template created
 * directly in Meta Business Manager could never appear here no matter how
 * many times this ran. Body text for a newly-seeded row is pulled from
 * Meta's own BODY component, same text `sendWhatsAppTemplate()` will
 * substitute {{n}} into when actually sending.
 */
export async function syncWhatsAppTemplateStatuses() {
  if (!WHATSAPP_BUSINESS_ACCOUNT_ID) {
    console.warn('[syncWhatsAppTemplateStatuses] WHATSAPP_BUSINESS_ACCOUNT_ID not configured — skipping');
    return { synced: false, reason: 'not_configured' };
  }
  if (!ACCESS_TOKEN) {
    console.warn('[syncWhatsAppTemplateStatuses] WHATSAPP_ACCESS_TOKEN not configured — skipping');
    return { synced: false, reason: 'not_configured' };
  }

  const metaTemplates = [];
  let url = `${WA_API_BASE}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?fields=name,status,category,language,components&limit=250`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error?.message || 'Failed to list templates from Meta');
    metaTemplates.push(...(json.data || []));
    url = json.paging?.next || null;
  }

  // Meta allows the same template name in multiple languages — keep the
  // first (most recently created, per Meta's default ordering) match per
  // name+language pair rather than per name alone, matching how templates
  // are looked up by name in sendWhatsAppTemplate (name only, language is a
  // per-send override) — good enough since this project has one language
  // per template today, and this doesn't regress if that changes.
  const metaByNameAndLanguage = new Map(
    metaTemplates.map((t) => [`${normalizeTemplateName(t.name)}::${t.language}`, t])
  );

  const { data: localTemplates, error: localError } = await supabase
    .from('internal_whatsapp_templates')
    .select('id, name, language, meta_template_status, category');
  if (localError) throw localError;

  let updated = 0;
  const unmatched = [];
  const localKeys = new Set();
  for (const local of localTemplates || []) {
    localKeys.add(`${normalizeTemplateName(local.name)}::${local.language}`);
    const match = metaByNameAndLanguage.get(`${normalizeTemplateName(local.name)}::${local.language}`);
    if (!match) {
      unmatched.push(local.name);
      continue;
    }
    if (match.status !== local.meta_template_status || match.category !== local.category) {
      await supabase
        .from('internal_whatsapp_templates')
        .update({ meta_template_status: match.status, category: match.category, updated_at: new Date().toISOString() })
        .eq('id', local.id);
      updated += 1;
    }
  }

  let seeded = 0;
  for (const meta of metaTemplates) {
    const key = `${normalizeTemplateName(meta.name)}::${meta.language}`;
    if (localKeys.has(key)) continue;
    localKeys.add(key); // guards against Meta listing the same name+language twice across pages
    const bodyText = (meta.components || []).find((c) => c.type === 'BODY')?.text;
    if (!bodyText) continue; // no BODY component (e.g. media-only template) — nothing to substitute variables into, skip rather than seed a broken row
    const { error: insertError } = await supabase.from('internal_whatsapp_templates').insert({
      name: meta.name,
      category: meta.category,
      language: meta.language,
      template_content: bodyText,
      meta_template_status: meta.status,
      is_active: true,
    });
    if (!insertError) seeded += 1;
  }

  return { synced: true, checked: (localTemplates || []).length, updated, seeded, unmatchedInMeta: unmatched };
}

/** Records an inbound message + advances the 24h window — called by the webhook handler. */
export async function recordInboundWhatsAppMessage({ from, contactName, text, metaMessageId }) {
  const thread = await getOrCreateThread({ phone: from, contactName, contactType: 'lead' });
  await recordMessage({ threadId: thread.id, direction: 'inbound', messageType: 'text', content: text, metaMessageId, status: 'delivered' });
  return thread;
}
