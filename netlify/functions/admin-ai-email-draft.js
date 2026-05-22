import { requireAdmin, headers, jsonResponse, GLOBAL_SOURCING_ALLOWED_ROLES } from './services/global-sourcing-utils.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const PURPOSES = {
  flash_sale:    'Flash sale / limited-time discount promotion',
  new_product:   'New product launch announcement',
  restock:       'Product back in stock / restock alert',
  festive:       'Festive or seasonal campaign (e.g. Christmas, Sallah, Valentine, New Year)',
  vendor_update: 'Vendor policy or platform update',
  general:       'General store announcement or newsletter',
};

const SYSTEM_PROMPT = `You are an email copywriter for JulineMart, a popular Nigerian online marketplace selling phones, electronics, fashion, and general goods.

Write engaging, professional marketing emails that feel personal and drive action.

Rules:
- Subject: 6–10 words, punchy. Start with a relevant emoji. No brackets.
- Body: 3–5 short paragraphs. Warm, friendly, Nigerian-market tone. End with a clear call to action (e.g. "Shop now at julinemart.com"). No salutation like "Dear Customer" — just start with the hook.
- Never use placeholder brackets like [NAME] or [PRODUCT] — use the actual context given, or write compelling generic copy.
- Return ONLY valid JSON with no markdown, no code fences: {"subject": "...", "body": "..."}`;

async function callClaude(userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json();
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const { purpose, context, audience } = JSON.parse(event.body || '{}');

    if (!purpose || !PURPOSES[purpose]) {
      return jsonResponse(400, { error: 'Invalid purpose. Must be one of: ' + Object.keys(PURPOSES).join(', ') });
    }

    const purposeLabel = PURPOSES[purpose];
    const audienceNote = audience === 'vendors' ? 'The audience is JulineMart vendors (sellers on the platform).'
      : audience === 'both' ? 'The audience is both customers and vendors.'
      : 'The audience is JulineMart customers (shoppers).';
    const contextNote = context?.trim()
      ? `Additional context: "${context.trim()}"`
      : 'No additional context — write effective generic copy for this purpose.';

    const userPrompt = `Purpose: ${purposeLabel}
${audienceNote}
${contextNote}

Write a JulineMart marketing email (subject + body).`;

    const aiResponse = await callClaude(userPrompt);
    const raw = aiResponse.content?.[0]?.type === 'text' ? aiResponse.content[0].text.trim() : '';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('AI returned an unexpected format — please try again');
      parsed = JSON.parse(match[0]);
    }

    if (!parsed?.subject || !parsed?.body) throw new Error('AI response was incomplete — please try again');

    return jsonResponse(200, {
      success: true,
      data: { subject: String(parsed.subject), body: String(parsed.body) },
    });
  } catch (err) {
    console.error('admin-ai-email-draft error:', err);
    return jsonResponse(500, { error: err?.message || 'AI draft failed' });
  }
}
