import { requireAdmin, headers, jsonResponse, GLOBAL_SOURCING_ALLOWED_ROLES } from './services/global-sourcing-utils.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const PURPOSES = {
  flash_sale:   'Flash sale / limited-time discount promotion',
  new_product:  'New product launch announcement',
  restock:      'Product back in stock / restock alert',
  festive:      'Festive or seasonal campaign (e.g. Christmas, Sallah, Valentine, New Year)',
  order_update: 'Order status or delivery update',
  general:      'General store announcement or campaign',
};

const SYSTEM_PROMPT = `You are a push notification copywriter for JulineMart, a popular Nigerian online marketplace selling phones, electronics, fashion, and general goods.

Write punchy, engaging push notifications that drive taps and conversions.

Rules:
- Title: maximum 50 characters including emoji. Always start with a relevant emoji.
- Body: maximum 100 characters. Clear, compelling. End with an action hint like "Tap to shop", "See your order", "Shop now", etc.
- Tone: exciting and trustworthy. Nigerian-market friendly. Natural, not robotic.
- Never use placeholder brackets like [NAME] or [PRODUCT] — use the actual context given, or write generic but specific copy if no context is provided.
- Return ONLY valid JSON with no extra text, no markdown, no code fences: {"title": "...", "body": "..."}`;

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
      max_tokens: 300,
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
    const { purpose, context, notifType } = JSON.parse(event.body || '{}');

    if (!purpose || !PURPOSES[purpose]) {
      return jsonResponse(400, {
        error: 'Invalid purpose. Must be one of: ' + Object.keys(PURPOSES).join(', '),
      });
    }

    const purposeLabel = PURPOSES[purpose];
    const contextNote = context?.trim()
      ? `Additional context from the sender: "${context.trim()}"`
      : 'No additional context provided — write effective generic copy for this purpose.';

    const userPrompt = `Purpose: ${purposeLabel}
Notification type: ${notifType || 'general'}
${contextNote}

Write a JulineMart push notification title and body.`;

    const aiResponse = await callClaude(userPrompt);
    const raw = aiResponse.content?.[0]?.type === 'text' ? aiResponse.content[0].text.trim() : '';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*?\}/);
      if (!match) throw new Error('AI returned an unexpected format — please try again');
      parsed = JSON.parse(match[0]);
    }

    if (!parsed?.title || !parsed?.body) {
      throw new Error('AI response was incomplete — please try again');
    }

    return jsonResponse(200, {
      success: true,
      data: {
        title: String(parsed.title).slice(0, 65),
        body: String(parsed.body).slice(0, 150),
      },
    });
  } catch (err) {
    console.error('admin-ai-notification-draft error:', err);
    return jsonResponse(500, { error: err?.message || 'AI draft failed' });
  }
}
