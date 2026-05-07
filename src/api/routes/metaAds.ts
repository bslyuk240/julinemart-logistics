import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import {
  syncCampaigns,
  getCampaigns,
  getDrafts,
  createDraft,
  approveDraft,
  rejectDraft,
  deleteDraft,
  generateAdContent,
  getRecommendations,
  logAction,
} from '../services/metaAdsService.js';
import { supabaseServer as supabase } from '../../lib/supabaseServer.js';

// ── GET /api/meta/campaigns ───────────────────────────────────────────────────
export async function getCampaignsHandler(req: AuthRequest, res: Response) {
  try {
    const campaigns = await getCampaigns();
    return res.json({ success: true, data: campaigns });
  } catch (error) {
    console.error('getCampaigns error:', error);
    return res.status(500).json({ error: 'Failed to load campaigns', message: (error as Error).message });
  }
}

// ── POST /api/meta/campaigns/sync ─────────────────────────────────────────────
export async function syncCampaignsHandler(req: AuthRequest, res: Response) {
  try {
    const count = await syncCampaigns();
    await logAction(req.user?.id, 'sync_campaigns', 'campaign', undefined, { count });
    return res.json({ success: true, synced: count });
  } catch (error) {
    console.error('syncCampaigns error:', error);
    await logAction(req.user?.id, 'sync_campaigns', 'campaign', undefined, {}, 'failed', (error as Error).message);
    return res.status(500).json({ error: 'Failed to sync campaigns', message: (error as Error).message });
  }
}

// ── GET /api/meta/drafts ──────────────────────────────────────────────────────
export async function getDraftsHandler(req: AuthRequest, res: Response) {
  try {
    const { status } = req.query as { status?: string };
    const drafts = await getDrafts(status);
    return res.json({ success: true, data: drafts });
  } catch (error) {
    console.error('getDrafts error:', error);
    return res.status(500).json({ error: 'Failed to load drafts', message: (error as Error).message });
  }
}

// ── POST /api/meta/drafts ─────────────────────────────────────────────────────
export async function createDraftHandler(req: AuthRequest, res: Response) {
  try {
    const { title, headline, body_text, call_to_action, image_url, destination_url,
            source_products, source_context, target_audience, suggested_budget, ai_generated } = req.body;

    if (!title || !body_text) {
      return res.status(400).json({ error: 'title and body_text are required' });
    }

    const draft = await createDraft({
      title, headline, body_text,
      call_to_action: call_to_action || 'SHOP_NOW',
      image_url, destination_url,
      source_products, source_context,
      target_audience, suggested_budget,
      ai_generated: ai_generated || false,
      created_by: req.user!.id,
    });

    await logAction(req.user?.id, 'create_draft', 'draft', draft.id, { title });
    return res.status(201).json({ success: true, data: draft });
  } catch (error) {
    console.error('createDraft error:', error);
    return res.status(500).json({ error: 'Failed to create draft', message: (error as Error).message });
  }
}

// ── PUT /api/meta/drafts/:id/approve ─────────────────────────────────────────
export async function approveDraftHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const draft = await approveDraft(id, req.user!.id);
    await logAction(req.user?.id, 'approve_draft', 'draft', id, { title: draft.title });
    return res.json({ success: true, data: draft });
  } catch (error) {
    console.error('approveDraft error:', error);
    return res.status(500).json({ error: 'Failed to approve draft', message: (error as Error).message });
  }
}

// ── PUT /api/meta/drafts/:id/reject ──────────────────────────────────────────
export async function rejectDraftHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const draft = await rejectDraft(id, req.user!.id, note || '');
    await logAction(req.user?.id, 'reject_draft', 'draft', id, { note });
    return res.json({ success: true, data: draft });
  } catch (error) {
    console.error('rejectDraft error:', error);
    return res.status(500).json({ error: 'Failed to reject draft', message: (error as Error).message });
  }
}

// ── DELETE /api/meta/drafts/:id ──────────────────────────────────────────────
export async function deleteDraftHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const row = await deleteDraft(id);
    await logAction(req.user?.id, 'delete_draft', 'draft', id, { title: row.title });
    return res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('deleteDraft error:', error);
    const msg = (error as Error).message;
    if (msg === 'Draft not found') {
      return res.status(404).json({ success: false, error: 'Draft not found', message: msg });
    }
    return res.status(500).json({ error: 'Failed to delete draft', message: msg });
  }
}

// ── POST /api/meta/ai/generate ────────────────────────────────────────────────
export async function generateContentHandler(req: AuthRequest, res: Response) {
  try {
    const { products, promo_code, top_region, objective, tone, count } = req.body;
    const variations = await generateAdContent({ products, promo_code, top_region, objective, tone, count });
    await logAction(req.user?.id, 'generate_content', undefined, undefined, { count: variations.length });
    return res.json({ success: true, data: variations });
  } catch (error) {
    console.error('generateContent error:', error);
    await logAction(req.user?.id, 'generate_content', undefined, undefined, {}, 'failed', (error as Error).message);
    return res.status(500).json({ error: 'Failed to generate content', message: (error as Error).message });
  }
}

// ── GET /api/meta/recommendations ─────────────────────────────────────────────
export async function getRecommendationsHandler(_req: AuthRequest, res: Response) {
  try {
    const recs = await getRecommendations();
    return res.json({ success: true, data: recs });
  } catch (error) {
    console.error('getRecommendations error:', error);
    return res.status(500).json({ error: 'Failed to load recommendations', message: (error as Error).message });
  }
}

// ── GET /api/meta/context ─────────────────────────────────────────────────────
// Returns JulineMart data to power AI content generation
export async function getAdsContextHandler(_req: AuthRequest, res: Response) {
  try {
    const [productsRes, topRegionRes, promosRes] = await Promise.all([
      // Top 20 products by order frequency (from order_items via WooCommerce product name)
      supabase
        .from('order_items')
        .select('product_name, unit_price')
        .limit(200),

      // Top delivery region
      supabase
        .from('orders')
        .select('delivery_state')
        .not('delivery_state', 'is', null)
        .limit(500),

      // Active promo codes / vouchers
      supabase
        .from('campaign_vouchers')
        .select('code, discount_value, discount_type')
        .eq('is_active', true)
        .limit(5),
    ]);

    // Count product frequency
    const productCount: Record<string, { name: string; price: number; count: number }> = {};
    for (const item of productsRes.data || []) {
      const key = item.product_name || 'Unknown';
      if (!productCount[key]) productCount[key] = { name: key, price: Number(item.unit_price || 0), count: 0 };
      productCount[key].count++;
    }
    const topProducts = Object.values(productCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(({ name, price }) => ({ name, price, category: 'general' }));

    // Count top region
    const regionCount: Record<string, number> = {};
    for (const o of topRegionRes.data || []) {
      const s = o.delivery_state || 'Unknown';
      regionCount[s] = (regionCount[s] || 0) + 1;
    }
    const topRegion = Object.entries(regionCount).sort((a, b) => b[1] - a[1])[0]?.[0];

    return res.json({
      success: true,
      data: {
        top_products: topProducts,
        top_region:   topRegion || null,
        active_promos: (promosRes.data || []).map((v: any) => ({ code: v.code, value: v.discount_value, type: v.discount_type })),
      },
    });
  } catch (error) {
    console.error('getAdsContext error:', error);
    return res.status(500).json({ error: 'Failed to load ads context', message: (error as Error).message });
  }
}
