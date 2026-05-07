import { supabaseServer as supabase } from '../../lib/supabaseServer.js';

const META_API_BASE = 'https://graph.facebook.com/v19.0';
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '';
const ACCESS_TOKEN   = process.env.META_ADS_ACCESS_TOKEN || '';

// ─── Meta API helpers ─────────────────────────────────────────────────────────

async function metaGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${META_API_BASE}/${path}`);
  url.searchParams.set('access_token', ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  const json = await res.json() as any;

  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Meta API error on ${path}`);
  }
  return json;
}

// ─── Campaign sync ────────────────────────────────────────────────────────────

export async function syncCampaigns() {
  const fields = 'id,name,status,objective,daily_budget,lifetime_budget,spend_cap,start_time,stop_time';
  const data = await metaGet(`${AD_ACCOUNT_ID}/campaigns`, { fields, limit: '100' });

  const campaigns: any[] = data.data || [];

  // Fetch insights for all active campaigns in one batch
  const insightMap: Record<string, any> = {};
  if (campaigns.length > 0) {
    try {
      const ids = campaigns.map((c: any) => c.id).join(',');
      const insights = await metaGet(`${AD_ACCOUNT_ID}/insights`, {
        fields: 'campaign_id,impressions,reach,clicks,spend,ctr,cpc,cpm',
        level: 'campaign',
        date_preset: 'last_30d',
        limit: '100',
      });
      for (const row of insights.data || []) {
        insightMap[row.campaign_id] = row;
      }
    } catch {
      // Insights optional — continue without them
    }
  }

  const rows = campaigns.map((c: any) => {
    const ins = insightMap[c.id] || {};
    return {
      meta_campaign_id: c.id,
      name:             c.name,
      status:           c.status,
      objective:        c.objective || null,
      daily_budget:     c.daily_budget ? Number(c.daily_budget) / 100 : null,
      lifetime_budget:  c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
      spend_cap:        c.spend_cap ? Number(c.spend_cap) / 100 : null,
      start_time:       c.start_time || null,
      stop_time:        c.stop_time || null,
      impressions:      Number(ins.impressions || 0),
      reach:            Number(ins.reach || 0),
      clicks:           Number(ins.clicks || 0),
      spend:            Number(ins.spend || 0),
      ctr:              Number(ins.ctr || 0),
      cpc:              Number(ins.cpc || 0),
      cpm:              Number(ins.cpm || 0),
      ad_account_id:    AD_ACCOUNT_ID,
      synced_at:        new Date().toISOString(),
    };
  });

  const { error: delErr } = await supabase
    .from('meta_campaigns_cache')
    .delete()
    .eq('ad_account_id', AD_ACCOUNT_ID);
  if (delErr) throw delErr;

  if (rows.length > 0) {
    const { error } = await supabase.from('meta_campaigns_cache').insert(rows);
    if (error) throw error;
  }

  return rows.length;
}

// ─── Get cached campaigns ─────────────────────────────────────────────────────

export async function getCampaigns() {
  let q = supabase.from('meta_campaigns_cache').select('*');
  if (AD_ACCOUNT_ID) q = q.eq('ad_account_id', AD_ACCOUNT_ID);
  const { data, error } = await q.order('synced_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ─── Ad drafts ────────────────────────────────────────────────────────────────

export async function getDrafts(status?: string) {
  let q = supabase
    .from('meta_ad_drafts')
    .select('*, users!meta_ad_drafts_created_by_fkey(full_name, email)')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createDraft(payload: {
  title: string;
  headline?: string;
  body_text: string;
  call_to_action?: string;
  image_url?: string;
  destination_url?: string;
  source_products?: any[];
  source_context?: any;
  target_audience?: any;
  suggested_budget?: number;
  ai_generated?: boolean;
  created_by: string;
}) {
  const { data, error } = await supabase
    .from('meta_ad_drafts')
    .insert({
      ...payload,
      status: 'draft',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function approveDraft(id: string, approvedBy: string) {
  const { data, error } = await supabase
    .from('meta_ad_drafts')
    .update({ status: 'approved', approved_by: approvedBy, approved_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function rejectDraft(id: string, rejectedBy: string, note: string) {
  const { data, error } = await supabase
    .from('meta_ad_drafts')
    .update({ status: 'rejected', approved_by: rejectedBy, rejection_note: note })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDraft(id: string) {
  const { data: row, error: fetchErr } = await supabase
    .from('meta_ad_drafts')
    .select('id, title')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw new Error('Draft not found');
  const { error } = await supabase.from('meta_ad_drafts').delete().eq('id', id);
  if (error) throw error;
  return row;
}

// ─── AI content generation ────────────────────────────────────────────────────

export async function generateAdContent(context: {
  products?: Array<{ name: string; price: number; category: string }>;
  promo_code?: string;
  top_region?: string;
  objective?: string;
  tone?: string;
  count?: number;
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const { products = [], promo_code, top_region, objective = 'sales', tone = 'engaging', count = 3 } = context;

  const productList = products.length
    ? products.map((p) => `- ${p.name} (₦${p.price.toLocaleString()}, ${p.category})`).join('\n')
    : 'JulineMart products';

  const prompt = `You are a creative Nigerian e-commerce ad copywriter for JulineMart, an online marketplace.

Generate ${count} Facebook/Instagram ad variations for the following:

Products:
${productList}
${top_region ? `\nTop buying region: ${top_region}` : ''}
${promo_code ? `\nPromo code: ${promo_code}` : ''}
Objective: ${objective}
Tone: ${tone}

For each variation, return JSON with:
- headline (max 40 chars)
- body_text (max 125 chars, compelling, includes product/price/CTA)
- call_to_action (one of: SHOP_NOW, LEARN_MORE, ORDER_NOW, GET_OFFER)

Return a JSON array only, no extra text.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const json = await res.json() as any;
  const text: string = json.content?.[0]?.text || '[]';

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('AI returned unexpected format');
  return JSON.parse(jsonMatch[0]) as Array<{ headline: string; body_text: string; call_to_action: string }>;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export async function getRecommendations() {
  const { data, error } = await supabase
    .from('meta_ai_recommendations')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ─── Log helper ───────────────────────────────────────────────────────────────

export async function logAction(
  userId: string | undefined,
  action: string,
  resource?: string,
  resourceId?: string,
  details?: any,
  status: 'success' | 'failed' = 'success',
  errorMsg?: string,
) {
  await supabase.from('meta_action_logs').insert({
    user_id:     userId || null,
    action,
    resource:    resource || null,
    resource_id: resourceId || null,
    details:     details || null,
    status,
    error_msg:   errorMsg || null,
  });
}
