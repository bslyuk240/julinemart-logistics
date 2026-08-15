/**
 * Gift builder session API (Mode B).
 *
 * GET  /api/gift-builder?session_token=<token>
 * POST /api/gift-builder  { action, session_token, ... }
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';
import {
  computeCustomerGiftTotal,
  loadGiftCommercialSettings,
} from './services/gift-commercial.js';
import {
  customerFacingLeadDays,
  maxLeadTimeForGiftLines,
} from './services/gift-delivery-schedule.js';
import { randomUUID } from 'crypto';
import {
  loadProductCustomisationSchema,
  validateGiftCustomisationSpec,
} from './services/gift-customisation.js';

const SESSION_SELECT = `
  id, session_token, gift_fulfilment_centre_id, gift_packaging_type_id,
  recipient_type, occasion, budget_max, status, expires_at, created_at, updated_at
`;

async function resolveGfc(code, gfcId) {
  let q = adminClient.from('gift_fulfilment_centres').select('id, name, code, city').eq('active', true);
  if (gfcId) q = q.eq('id', gfcId);
  else if (code) q = q.eq('code', String(code).trim().toLowerCase());
  else q = q.eq('is_default', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function loadPackagingOptions() {
  const { data, error } = await adminClient
    .from('gift_packaging_types')
    .select('id, code, name, description, price, max_items, sort_order')
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data || [];
}

async function computeSessionTotals(session, rawItems, packaging) {
  const componentCostTotal = (rawItems || []).reduce(
    (s, i) => s + Number(i.component_cost || 0) * Number(i.quantity || 0),
    0
  );
  const packagingFee = Number(packaging?.price || 0);
  const settings = await loadGiftCommercialSettings(adminClient, session.gift_fulfilment_centre_id);
  const pricing = computeCustomerGiftTotal({
    componentCostTotal,
    packagingFee,
    settings,
  });
  const itemCount = (rawItems || []).reduce((s, i) => s + Number(i.quantity || 0), 0);

  return {
    items_subtotal: Math.max(pricing.customerSubtotal - packagingFee, 0),
    packaging_fee: packagingFee,
    grand_total: pricing.customerSubtotal,
    item_count: itemCount,
  };
}

async function loadSession(sessionToken) {
  const { data: session, error } = await adminClient
    .from('gift_builder_sessions')
    .select(SESSION_SELECT)
    .eq('session_token', sessionToken)
    .maybeSingle();

  if (error) throw error;
  if (!session) return null;

  if (session.status === 'draft' && new Date(session.expires_at) < new Date()) {
    await adminClient
      .from('gift_builder_sessions')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', session.id);
    session.status = 'expired';
  }

  const { data: items } = await adminClient
    .from('gift_builder_items')
    .select(`
      id, product_id, variation_id, quantity, component_cost, line_source, pool_sourced_item_id,
      customisation_spec,
      products ( id, name, slug, gift_category,
        product_images ( src, position, is_thumbnail )
      ),
      gift_pool_sourced_items ( id, name, gift_category, image_url )
    `)
    .eq('gift_builder_session_id', session.id)
    .order('created_at');

  let packaging = null;
  if (session.gift_packaging_type_id) {
    const { data: pkg } = await adminClient
      .from('gift_packaging_types')
      .select('id, code, name, price, max_items')
      .eq('id', session.gift_packaging_type_id)
      .maybeSingle();
    packaging = pkg;
  }

  const totals = await computeSessionTotals(session, items || [], packaging);
  const settings = await loadGiftCommercialSettings(adminClient, session.gift_fulfilment_centre_id);
  const byoLead = Math.max(0, Number(settings.byo_lead_time_days ?? 1));
  const itemMaxLead = await maxLeadTimeForGiftLines(
    adminClient,
    items || [],
    session.gift_fulfilment_centre_id
  );

  return {
    session,
    byo_lead_time_days: byoLead,
    lead_time_days: customerFacingLeadDays(Math.max(itemMaxLead, byoLead)),
    items: (items || []).map((row) => {
      const isSourced = row.line_source === 'jlo_sourced';
      const images = (row.products?.product_images || []).sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0)
      );
      const thumb = images.find((i) => i.is_thumbnail) || images[0];
      return {
        id: row.id,
        product_id: row.product_id,
        pool_sourced_item_id: row.pool_sourced_item_id,
        line_source: row.line_source || 'vendor_catalog',
        variation_id: row.variation_id,
        quantity: row.quantity,
        name: isSourced ? row.gift_pool_sourced_items?.name : row.products?.name,
        gift_category: isSourced
          ? row.gift_pool_sourced_items?.gift_category
          : row.products?.gift_category,
        image: isSourced ? row.gift_pool_sourced_items?.image_url || null : thumb?.src || null,
        customisation_spec: row.customisation_spec || null,
        customisation_summary: row.customisation_spec?.summary_lines || null,
      };
    }),
    packaging,
    totals,
  };
}

async function validatePoolItem(gfcId, productId, variationId, quantity) {
  const baseSelect = `
      id, available_qty, gift_program_cost, active, variation_id,
      products!inner ( id, name, regular_price, sale_price, gift_eligible, gift_box_compatible, status )
    `;

  let pool = null;
  if (variationId) {
    const { data } = await adminClient
      .from('gift_pool_inventory')
      .select(baseSelect)
      .eq('gift_fulfilment_centre_id', gfcId)
      .eq('product_id', productId)
      .eq('variation_id', variationId)
      .eq('active', true)
      .maybeSingle();
    pool = data;
  }
  if (!pool) {
    const { data } = await adminClient
      .from('gift_pool_inventory')
      .select(baseSelect)
      .eq('gift_fulfilment_centre_id', gfcId)
      .eq('product_id', productId)
      .is('variation_id', null)
      .eq('active', true)
      .maybeSingle();
    pool = data;
  }

  if (!pool?.products?.gift_eligible || pool.products.gift_box_compatible === false) {
    return { error: 'Product is not available for gift boxes' };
  }
  if (pool.products.status !== 'published') {
    return { error: 'Product is not available' };
  }
  if (!pool || pool.available_qty < quantity) {
    return { error: 'Insufficient pool stock for this item' };
  }

  const unitPrice = Number(pool.products.sale_price || pool.products.regular_price || 0);
  const componentCost =
    pool.gift_program_cost != null ? Number(pool.gift_program_cost) : null;

  return { pool, componentCost, catalogUnitPrice: unitPrice };
}

async function validateSourcedPoolItem(gfcId, sourcedId, quantity) {
  const { data: sourced, error } = await adminClient
    .from('gift_pool_sourced_items')
    .select('id, name, available_qty, gift_program_cost, active')
    .eq('id', sourcedId)
    .eq('gift_fulfilment_centre_id', gfcId)
    .eq('active', true)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!sourced) return { error: 'Sourced item is not available for gift boxes' };
  if (sourced.available_qty < quantity) {
    return { error: 'Insufficient pool stock for this item' };
  }

  return {
    sourced,
    componentCost: Number(sourced.gift_program_cost || 0),
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'gift-builder',
    max: 90,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  try {
    if (event.httpMethod === 'GET') {
      const sessionToken = event.queryStringParameters?.session_token;
      if (!sessionToken) return jsonResponse(400, { success: false, error: 'session_token required' });

      const payload = await loadSession(sessionToken);
      if (!payload) return jsonResponse(404, { success: false, error: 'Session not found' });

      const packaging_options = await loadPackagingOptions();
      return jsonResponse(200, {
        success: true,
        data: { ...payload, packaging_options },
      });
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed' });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const action = body.action || 'create';

    if (action === 'create') {
      const gfc = await resolveGfc(body.gfc_code, body.gfc_id);
      if (!gfc) return jsonResponse(404, { success: false, error: 'Hub not found' });

      const token = randomUUID();
      const { data, error } = await adminClient
        .from('gift_builder_sessions')
        .insert({
          session_token: token,
          gift_fulfilment_centre_id: gfc.id,
        })
        .select(SESSION_SELECT)
        .single();

      if (error) return jsonResponse(500, { success: false, error: error.message });

      const packaging_options = await loadPackagingOptions();
      return jsonResponse(201, {
        success: true,
        data: {
          session: data,
          session_token: token,
          items: [],
          packaging: null,
          totals: { items_subtotal: 0, packaging_fee: 0, grand_total: 0, item_count: 0 },
          packaging_options,
          gfc,
        },
      });
    }

    const sessionToken = body.session_token;
    if (!sessionToken) return jsonResponse(400, { success: false, error: 'session_token required' });

    const { data: session, error: sessErr } = await adminClient
      .from('gift_builder_sessions')
      .select('id, status, gift_fulfilment_centre_id, gift_packaging_type_id')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (sessErr) return jsonResponse(500, { success: false, error: sessErr.message });
    if (!session) return jsonResponse(404, { success: false, error: 'Session not found' });
    if (session.status !== 'draft') {
      return jsonResponse(400, { success: false, error: 'Session is no longer editable' });
    }

    if (action === 'set_context') {
      const patch = { updated_at: new Date().toISOString() };
      if (body.recipient_type !== undefined) patch.recipient_type = body.recipient_type || null;
      if (body.occasion !== undefined) patch.occasion = body.occasion || null;
      if (body.budget_max !== undefined) {
        patch.budget_max = body.budget_max != null ? Number(body.budget_max) : null;
      }
      await adminClient.from('gift_builder_sessions').update(patch).eq('id', session.id);
      const payload = await loadSession(sessionToken);
      const packaging_options = await loadPackagingOptions();
      return jsonResponse(200, { success: true, data: { ...payload, packaging_options } });
    }

    if (action === 'set_packaging') {
      const code = String(body.packaging_code || '').trim().toLowerCase();
      const { data: pkg } = await adminClient
        .from('gift_packaging_types')
        .select('id, code, name, price, max_items')
        .eq('code', code)
        .eq('active', true)
        .maybeSingle();

      if (!pkg) return jsonResponse(400, { success: false, error: 'Invalid packaging type' });

      const current = await loadSession(sessionToken);
      if (current.totals.item_count > pkg.max_items) {
        return jsonResponse(400, {
          success: false,
          error: `This tier fits up to ${pkg.max_items} items — remove some first`,
        });
      }

      await adminClient
        .from('gift_builder_sessions')
        .update({
          gift_packaging_type_id: pkg.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      const payload = await loadSession(sessionToken);
      const packaging_options = await loadPackagingOptions();
      return jsonResponse(200, { success: true, data: { ...payload, packaging_options } });
    }

    if (action === 'add_item') {
      const productId = body.product_id;
      const sourcedId = body.pool_sourced_item_id;
      const quantity = Math.max(1, Number(body.quantity || 1));

      if (!productId && !sourcedId) {
        return jsonResponse(400, { success: false, error: 'product_id or pool_sourced_item_id required' });
      }

      let existingItem = null;
      let validatedFinal;
      let maxItems = 12;

      if (session.gift_packaging_type_id) {
        const { data: pkg } = await adminClient
          .from('gift_packaging_types')
          .select('max_items')
          .eq('id', session.gift_packaging_type_id)
          .maybeSingle();
        maxItems = pkg?.max_items || maxItems;
      }

      if (sourcedId) {
        const { data: existing } = await adminClient
          .from('gift_builder_items')
          .select('id, quantity')
          .eq('gift_builder_session_id', session.id)
          .eq('line_source', 'jlo_sourced')
          .eq('pool_sourced_item_id', sourcedId)
          .maybeSingle();
        existingItem = existing;

        const finalQty = existingItem ? existingItem.quantity + quantity : quantity;
        validatedFinal = await validateSourcedPoolItem(
          session.gift_fulfilment_centre_id,
          sourcedId,
          finalQty
        );
        if (validatedFinal.error) {
          return jsonResponse(400, { success: false, error: validatedFinal.error });
        }

        const current = await loadSession(sessionToken);
        const newCount = current.totals.item_count - (existingItem?.quantity || 0) + finalQty;
        if (newCount > maxItems) {
          return jsonResponse(400, {
            success: false,
            error: `Box tier allows up to ${maxItems} items`,
          });
        }

        if (existingItem) {
          const { error: updErr } = await adminClient
            .from('gift_builder_items')
            .update({
              quantity: finalQty,
              unit_price: 0,
              component_cost: validatedFinal.componentCost,
            })
            .eq('id', existingItem.id);
          if (updErr) return jsonResponse(500, { success: false, error: updErr.message });
        } else {
          const { error: insErr } = await adminClient.from('gift_builder_items').insert({
            gift_builder_session_id: session.id,
            line_source: 'jlo_sourced',
            pool_sourced_item_id: sourcedId,
            product_id: null,
            variation_id: null,
            quantity: finalQty,
            unit_price: 0,
            component_cost: validatedFinal.componentCost,
          });
          if (insErr) return jsonResponse(500, { success: false, error: insErr.message });
        }

        const payload = await loadSession(sessionToken);
        const packaging_options = await loadPackagingOptions();
        return jsonResponse(200, { success: true, data: { ...payload, packaging_options } });
      }

      if (!productId) return jsonResponse(400, { success: false, error: 'product_id required' });

      const productSchema = await loadProductCustomisationSchema(adminClient, productId);
      const isCustomisable = Boolean(productSchema?.fields?.length);

      let customisationSpec = null;
      if (isCustomisable) {
        const validated = await validateGiftCustomisationSpec(
          adminClient,
          productId,
          body.customisation_spec
        );
        if (validated.error) {
          return jsonResponse(400, { success: false, error: validated.error });
        }
        customisationSpec = validated.spec;
      } else if (body.customisation_spec) {
        return jsonResponse(400, { success: false, error: 'This product does not support customisation' });
      }

      existingItem = null;
      if (!isCustomisable) {
        let existingQuery = adminClient
          .from('gift_builder_items')
          .select('id, quantity')
          .eq('gift_builder_session_id', session.id)
          .eq('product_id', productId);
        if (body.variation_id) existingQuery = existingQuery.eq('variation_id', body.variation_id);
        else existingQuery = existingQuery.is('variation_id', null);
        const { data } = await existingQuery.maybeSingle();
        existingItem = data;
      }

      const finalQty = existingItem ? existingItem.quantity + quantity : quantity;

      validatedFinal = await validatePoolItem(
        session.gift_fulfilment_centre_id,
        productId,
        body.variation_id || null,
        finalQty
      );
      if (validatedFinal.error) return jsonResponse(400, { success: false, error: validatedFinal.error });

      const current = await loadSession(sessionToken);
      const newCount = current.totals.item_count - (existingItem?.quantity || 0) + finalQty;
      if (newCount > maxItems) {
        return jsonResponse(400, {
          success: false,
          error: `Box tier allows up to ${maxItems} items`,
        });
      }

      if (current.session.budget_max != null) {
        const { data: costRows } = await adminClient
          .from('gift_builder_items')
          .select('id, quantity, component_cost')
          .eq('gift_builder_session_id', session.id);
        const withoutCost = (costRows || [])
          .filter((i) => i.id !== existingItem?.id)
          .reduce((s, i) => s + Number(i.component_cost || 0) * i.quantity, 0);
        const lineCost =
          validatedFinal.componentCost != null
            ? Number(validatedFinal.componentCost) + Number(customisationSpec?.price_adjustment || 0)
            : validatedFinal.catalogUnitPrice;
        const projectedCost = withoutCost + lineCost * finalQty;
        const packagingFee = Number(current.packaging?.price || 0);
        const settings = await loadGiftCommercialSettings(
          adminClient,
          session.gift_fulfilment_centre_id
        );
        const projected = computeCustomerGiftTotal({
          componentCostTotal: projectedCost,
          packagingFee,
          settings,
        }).customerSubtotal;
        if (projected > Number(current.session.budget_max)) {
          return jsonResponse(400, { success: false, error: 'Would exceed your budget' });
        }
      }

      const unitComponentCost =
        Number(validatedFinal.componentCost || 0) + Number(customisationSpec?.price_adjustment || 0);

      if (existingItem) {
        const { error: updErr } = await adminClient
          .from('gift_builder_items')
          .update({
            quantity: finalQty,
            unit_price: 0,
            component_cost: unitComponentCost,
          })
          .eq('id', existingItem.id);
        if (updErr) return jsonResponse(500, { success: false, error: updErr.message });
      } else {
        const { error: insErr } = await adminClient.from('gift_builder_items').insert({
          gift_builder_session_id: session.id,
          gift_pool_inventory_id: validatedFinal.pool.id,
          product_id: productId,
          variation_id: body.variation_id || null,
          quantity: finalQty,
          unit_price: 0,
          component_cost: unitComponentCost,
          customisation_spec: customisationSpec,
        });
        if (insErr) return jsonResponse(500, { success: false, error: insErr.message });
      }

      const payload = await loadSession(sessionToken);
      const packaging_options = await loadPackagingOptions();
      return jsonResponse(200, { success: true, data: { ...payload, packaging_options } });
    }

    if (action === 'update_item') {
      const itemId = body.item_id;
      const quantity = Number(body.quantity);
      if (!itemId || !Number.isInteger(quantity) || quantity < 1) {
        return jsonResponse(400, { success: false, error: 'item_id and quantity required' });
      }

      const { data: existing } = await adminClient
        .from('gift_builder_items')
        .select('id, product_id, variation_id, gift_builder_session_id')
        .eq('id', itemId)
        .eq('gift_builder_session_id', session.id)
        .maybeSingle();

      if (!existing) return jsonResponse(404, { success: false, error: 'Item not found' });

      const validated = await validatePoolItem(
        session.gift_fulfilment_centre_id,
        existing.product_id,
        existing.variation_id,
        quantity
      );
      if (validated.error) return jsonResponse(400, { success: false, error: validated.error });

      await adminClient.from('gift_builder_items').update({ quantity }).eq('id', itemId);

      const payload = await loadSession(sessionToken);
      const packaging_options = await loadPackagingOptions();
      return jsonResponse(200, { success: true, data: { ...payload, packaging_options } });
    }

    if (action === 'remove_item') {
      const itemId = body.item_id;
      if (!itemId) return jsonResponse(400, { success: false, error: 'item_id required' });

      await adminClient
        .from('gift_builder_items')
        .delete()
        .eq('id', itemId)
        .eq('gift_builder_session_id', session.id);

      const payload = await loadSession(sessionToken);
      const packaging_options = await loadPackagingOptions();
      return jsonResponse(200, { success: true, data: { ...payload, packaging_options } });
    }

    return jsonResponse(400, { success: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse(500, { success: false, error: err?.message || String(err) });
  }
}
