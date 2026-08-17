/**
 * Server-side custom order validation — mirrors PWA src/lib/custom-order.ts
 */

export function computeCustomisationAdjustment(schema, fieldValues) {
  let total = 0;
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  for (const field of fields) {
    const raw = fieldValues?.[field.id];
    if (raw == null || raw === '') continue;
    if (field.type === 'dropdown' && Array.isArray(field.options)) {
      const opt = field.options.find((o) => o.value === String(raw));
      if (opt?.price_delta) total += Number(opt.price_delta);
    } else if (field.price_delta) {
      total += Number(field.price_delta);
    }
  }
  return Math.round(total * 100) / 100;
}

export function validateCustomisation(schema, fieldValues) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  for (const field of fields) {
    const raw = fieldValues?.[field.id];
    const empty = raw == null || String(raw).trim() === '';
    if (field.required && empty) {
      return `${field.label} is required`;
    }
    if (field.type === 'number' && !empty) {
      const n = Number(raw);
      if (!Number.isFinite(n)) return `${field.label} must be a number`;
      if (field.min != null && n < field.min) return `${field.label} must be at least ${field.min}`;
      if (field.max != null && n > field.max) return `${field.label} must be at most ${field.max}`;
    }
    if (field.type === 'dropdown' && !empty) {
      const options = Array.isArray(field.options) ? field.options : [];
      if (!options.some((o) => o.value === String(raw))) {
        return `${field.label} has an invalid selection`;
      }
    }
  }
  return null;
}

export function sanitizeFieldDefinitions(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f) => f && typeof f === 'object' && f.id && f.type && f.label)
    .map((f) => ({
      id: String(f.id).slice(0, 64),
      type: f.type,
      label: String(f.label).slice(0, 120),
      required: Boolean(f.required),
      placeholder: f.placeholder ? String(f.placeholder).slice(0, 200) : undefined,
      price_delta: f.price_delta != null ? Number(f.price_delta) : undefined,
      min: f.min != null ? Number(f.min) : undefined,
      max: f.max != null ? Number(f.max) : undefined,
      options: Array.isArray(f.options)
        ? f.options
            .filter((o) => o && o.label && o.value)
            .map((o) => ({
              label: String(o.label).slice(0, 80),
              value: String(o.value).slice(0, 80),
              price_delta: o.price_delta != null ? Number(o.price_delta) : undefined,
            }))
        : undefined,
    }));
}
