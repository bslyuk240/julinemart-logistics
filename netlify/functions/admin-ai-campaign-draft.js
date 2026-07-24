import { requireAdmin, headers, jsonResponse, parseJsonBody } from './services/global-sourcing-utils.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are JulineMart AI Campaign Copywriter. Write concise, high-converting landing-page copy for marketing campaign pages on a Nigerian e-commerce marketplace — customers arrive here via QR code scans, social media links, or physical posters, so copy must work instantly with no other context.

Rules:
- headline: max 8 words, punchy, benefit- or offer-led. No generic filler like "Welcome to our store".
- subtitle: one short sentence (under 18 words) that adds to the headline, never repeats it.
- badge_text: 1-3 words, e.g. "LIMITED TIME", "NEW ARRIVAL", "SALLAH SPECIAL" — return "" if nothing fits.
- cta_label: 2-4 words, action-oriented (e.g. "Shop Now", "Grab The Deal", "Visit The Store").
- vendor_story: 2-3 warm, trustworthy sentences for a "Meet the vendor" section — ONLY if a vendor name is given in context, otherwise return "".
- Never invent unverifiable facts (years in business, exact numbers, guarantees) that aren't in the given context.
- Friendly, direct Nigerian-marketplace tone — not stiff or overly formal.
- Return ONLY valid JSON with no markdown fences, no commentary: {"headline":"","subtitle":"","badge_text":"","cta_label":"","vendor_story":""}`;

function parseAiJson(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

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
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 220)}`);
  }

  const payload = await response.json();
  return String(payload?.content?.[0]?.text || '').trim();
}

const TARGET_TYPE_LABELS = {
  vendor: 'a single vendor spotlight',
  category: 'a product category collection',
  product: 'a single featured product',
  collection: 'a curated product collection',
  multi_vendor: 'multiple vendors together',
  general: 'a general marketplace promotion',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  const body = parseJsonBody(event.body);
  if (!body) return jsonResponse(400, { success: false, error: 'Invalid JSON body' });

  const publicTitle = String(body.public_title || '').trim();
  const campaignObjective = String(body.campaign_objective || '').trim();
  const targetType = String(body.target_type || 'general').trim();
  const vendorName = String(body.vendor_name || '').trim();
  const categoryName = String(body.category_name || '').trim();
  const extraContext = String(body.context || '').trim();

  if (!publicTitle && !campaignObjective && !extraContext) {
    return jsonResponse(400, {
      success: false,
      error: 'Provide at least a campaign title, objective, or extra context',
    });
  }

  try {
    const targetLabel = TARGET_TYPE_LABELS[targetType] || TARGET_TYPE_LABELS.general;

    const userPrompt = [
      'Generate landing-page copy for a JulineMart marketing campaign.',
      '',
      `Campaign title (working name, may be internal): ${publicTitle || '(none provided)'}`,
      `Campaign objective: ${campaignObjective || '(none provided)'}`,
      `This campaign type is: ${targetLabel}.`,
      vendorName ? `Vendor name: ${vendorName}` : 'No specific vendor for this campaign.',
      categoryName ? `Product category: ${categoryName}` : '',
      extraContext ? `Additional context from the admin: "${extraContext}"` : '',
      '',
      'Return JSON with keys:',
      '{"headline":"","subtitle":"","badge_text":"","cta_label":"","vendor_story":""}',
    ]
      .filter(Boolean)
      .join('\n');

    const rawText = await callClaude(userPrompt);
    const parsed = parseAiJson(rawText);
    if (!parsed) {
      throw new Error('AI returned an invalid response format. Please try again.');
    }

    const data = {
      headline: String(parsed.headline || '').trim().slice(0, 120),
      subtitle: String(parsed.subtitle || '').trim().slice(0, 200),
      badge_text: String(parsed.badge_text || '').trim().slice(0, 40),
      cta_label: String(parsed.cta_label || '').trim().slice(0, 40),
      vendor_story: String(parsed.vendor_story || '').trim().slice(0, 600),
    };

    if (!data.headline && !data.subtitle) {
      throw new Error('AI did not return usable copy. Please try again.');
    }

    return jsonResponse(200, { success: true, data });
  } catch (err) {
    console.error('admin-ai-campaign-draft error:', err);
    return jsonResponse(500, { success: false, error: err?.message || 'AI generation failed' });
  }
}
