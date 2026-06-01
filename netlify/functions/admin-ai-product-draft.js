import {
  extractDescriptionImageUrls,
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  jsonResponse,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

function toPlainText(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeHtml(value) {
  return String(value || '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .trim();
}

function getCategoryTemplateGuidance(categories) {
  const haystack = String(categories || []).toLowerCase();
  if (/(fashion|cloth|shoe|wear|apparel|bag|jewel)/i.test(haystack)) {
    return 'Focus on fabric/material, fit, sizing context, color options, styling/occasion, and care instructions.';
  }
  if (/(phone|electronic|gadget|laptop|tablet|audio|camera|tv|accessor)/i.test(haystack)) {
    return 'Focus on model/spec highlights, compatibility, performance use-cases, power/battery details where known, and what is in the box.';
  }
  if (/(beauty|skincare|cosmetic|hair|makeup|fragrance)/i.test(haystack)) {
    return 'Focus on skin/hair suitability, benefits, usage steps, key ingredients/material details, and safety/caution notes.';
  }
  if (/(home|kitchen|furniture|appliance|decor)/i.test(haystack)) {
    return 'Focus on dimensions/fit-for-space, material/build, practical usage scenarios, maintenance, and installation/setup notes if applicable.';
  }
  return 'Focus on practical buyer-facing benefits, key specifications, usage guidance, and what buyers receive.';
}

function dedupeHttpsUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const raw of urls) {
    const next = String(raw || '').trim();
    if (!/^https?:\/\//i.test(next)) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

async function loadImageBlocks(imageUrls) {
  const blocks = [];
  for (const imageUrl of imageUrls) {
    try {
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(7000) });
      if (!response.ok) continue;
      const rawContentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const SUPPORTED_TYPES = { 'image/jpeg': true, 'image/jpg': true, 'image/png': true, 'image/gif': true, 'image/webp': true };
      if (!SUPPORTED_TYPES[rawContentType]) continue;
      const mediaType = rawContentType === 'image/jpg' ? 'image/jpeg' : rawContentType;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) continue;
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: bytes.toString('base64'),
        },
      });
    } catch {
      // Best-effort image enrichment; skip failed images.
    }
  }
  return blocks;
}

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

async function callClaude({ prompt, imageBlocks }) {
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
      max_tokens: 1400,
      system:
        'You are JulineMart AI Product Assistant. Create polished, factual product copy for a Nigerian e-commerce catalog. Return ONLY valid JSON with keys: suggested_name, short_description_html, full_description_html, seo_title, seo_description. Do not include markdown fences or extra commentary.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...imageBlocks],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 220)}`);
  }

  const payload = await response.json();
  return String(payload?.content?.[0]?.text || '').trim();
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const body = parseJsonBody(event.body);
  if (!body) return jsonResponse(400, { success: false, error: 'Invalid JSON body' });

  const title = String(body.name || '').trim();
  const shortHtml = String(body.short_description || '');
  const fullHtml = String(body.description || '');
  const categoryNames = Array.isArray(body.category_names) ? body.category_names.map((v) => String(v || '').trim()).filter(Boolean) : [];
  const providedImageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];

  const shortText = toPlainText(shortHtml);
  const fullText = toPlainText(fullHtml);

  if (!title && !shortText && !fullText) {
    return jsonResponse(400, {
      success: false,
      error: 'Provide at least product name, short description, or full description',
    });
  }

  try {
    const descriptionImageUrls = extractDescriptionImageUrls(fullHtml);
    const mergedImageUrls = dedupeHttpsUrls([...providedImageUrls, ...descriptionImageUrls]).slice(0, 4);
    const imageBlocks = await loadImageBlocks(mergedImageUrls);
    const categoryGuide = getCategoryTemplateGuidance(categoryNames);

    const prompt = [
      'Generate improved product copy for JulineMart upload form.',
      '',
      'Hard rules:',
      '- Refine only text. Do not generate or include any <img> tags.',
      '- Do not invent unverifiable claims (e.g. official/original/waterproof/medical-grade) unless clearly supported by input.',
      '- Keep language buyer-friendly and clear.',
      '- Keep HTML minimal: <p>, <ul>, <li>, <strong>, <br> only.',
      '- short_description_html should be concise (1 short paragraph or small list).',
      '- full_description_html should be detailed with sections and practical buyer info.',
      '',
      `Category guidance: ${categoryGuide}`,
      '',
      `Product title: ${title || '(none provided)'}`,
      `Categories: ${categoryNames.join(', ') || '(none selected)'}`,
      '',
      `Existing short description text:\n${shortText || '(none)'}`,
      '',
      `Existing full description text:\n${fullText || '(none)'}`,
      '',
      imageBlocks.length > 0
        ? `Image context: ${imageBlocks.length} image(s) attached. Use them to infer visible attributes/specs/style; do not output image tags.`
        : 'Image context: no usable images attached.',
      '',
      'Return JSON with keys:',
      '{"suggested_name":"","short_description_html":"","full_description_html":"","seo_title":"","seo_description":""}',
    ].join('\n');

    const rawText = await callClaude({ prompt, imageBlocks });
    const parsed = parseAiJson(rawText);
    if (!parsed) {
      throw new Error('AI returned an invalid response format. Please try again.');
    }

    const data = {
      suggested_name: String(parsed.suggested_name || title || '').trim().slice(0, 220),
      short_description_html: sanitizeHtml(parsed.short_description_html || ''),
      full_description_html: sanitizeHtml(parsed.full_description_html || ''),
      seo_title: String(parsed.seo_title || '').trim().slice(0, 160),
      seo_description: String(parsed.seo_description || '').trim().slice(0, 320),
      used_image_count: imageBlocks.length,
    };

    if (!data.short_description_html && !data.full_description_html) {
      throw new Error('AI did not return usable description content. Please try again.');
    }

    return jsonResponse(200, { success: true, data });
  } catch (err) {
    console.error('admin-ai-product-draft error:', err);
    return jsonResponse(500, { success: false, error: err?.message || 'AI generation failed' });
  }
}
