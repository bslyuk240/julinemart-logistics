/**
 * Gift G6 — validate customisation against Phase 4 product_customisation_schemas.
 */
import {
  computeCustomisationAdjustment,
  validateCustomisation,
} from './custom-order-utils.js';

function buildSummaryLines(schema, fieldValues) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  return fields
    .map((field) => {
      const raw = fieldValues?.[field.id];
      if (raw == null || String(raw).trim() === '') return null;
      let display = String(raw);
      if (field.type === 'dropdown' && Array.isArray(field.options)) {
        display = field.options.find((o) => o.value === String(raw))?.label || display;
      }
      return `${field.label}: ${display}`;
    })
    .filter(Boolean);
}

export async function loadProductCustomisationSchema(adminClient, productId) {
  const { data, error } = await adminClient
    .from('product_customisation_schemas')
    .select('id, product_id, vendor_id, fields, production_days_min, production_days_max, requires_approval')
    .eq('product_id', productId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.fields?.length) return null;
  return data;
}

export async function validateGiftCustomisationSpec(adminClient, productId, rawSpec) {
  const schema = await loadProductCustomisationSchema(adminClient, productId);
  if (!schema) {
    if (rawSpec) return { error: 'This product does not support customisation' };
    return { spec: null };
  }

  if (!rawSpec?.schema_id) {
    return { error: 'Customisation is required for this product' };
  }
  if (rawSpec.schema_id !== schema.id) {
    return { error: 'Customisation schema mismatch — refresh and try again' };
  }

  const fieldValues = rawSpec.field_values || {};
  const validationError = validateCustomisation(schema, fieldValues);
  if (validationError) return { error: validationError };

  const serverAdjustment = computeCustomisationAdjustment(schema, fieldValues);
  const clientAdjustment = Number(rawSpec.price_adjustment || 0);
  if (Math.abs(serverAdjustment - clientAdjustment) > 0.02) {
    return { error: 'Customisation price mismatch — refresh and try again' };
  }

  const summary_lines = buildSummaryLines(schema, fieldValues);

  return {
    spec: {
      schema_id: schema.id,
      field_values: fieldValues,
      price_adjustment: serverAdjustment,
      summary_lines,
      production_days_min: schema.production_days_min ?? null,
      production_days_max: schema.production_days_max ?? null,
    },
  };
}

export async function loadCustomisationFlags(adminClient, productIds) {
  if (!productIds.length) return new Map();
  const { data, error } = await adminClient
    .from('product_customisation_schemas')
    .select('id, product_id')
    .in('product_id', productIds);

  if (error) throw error;
  return new Map((data || []).map((row) => [row.product_id, row.id]));
}
