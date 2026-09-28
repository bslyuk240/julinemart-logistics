function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function resolvePackageInfo(supabase, subOrder) {
  const items = parseItems(subOrder.items);
  const override = subOrder.package_override && typeof subOrder.package_override === 'object'
    ? subOrder.package_override
    : {};

  const productIds = [...new Set(items.map((i) => i.productId || i.product_id).filter(Boolean))];
  const skus = [...new Set(items.map((i) => i.sku).filter(Boolean))];

  let products = [];
  if (productIds.length > 0) {
    const { data } = await supabase
      .from('products')
      .select('id, sku, name, weight, length, width, height, price')
      .in('id', productIds);
    products = data || [];
  }
  if (products.length === 0 && skus.length > 0) {
    const { data } = await supabase
      .from('products')
      .select('id, sku, name, weight, length, width, height, price')
      .in('sku', skus);
    products = data || [];
  }

  const byId = new Map(products.map((p) => [String(p.id), p]));
  const bySku = new Map(products.map((p) => [String(p.sku || '').toLowerCase(), p]));

  const missing = new Set();
  const hydrated = items.map((item) => {
    const product = byId.get(String(item.productId || item.product_id || ''))
      || bySku.get(String(item.sku || '').toLowerCase());
    const quantity = Number(item.quantity || 1) || 1;
    const weight = num(item.weight) || num(product?.weight);
    const length = num(item.length) || num(product?.length);
    const width = num(item.width) || num(product?.width);
    const height = num(item.height) || num(product?.height);
    const unitAmount = num(item.price) || num(item.unit_price) || num(product?.price) || 0;
    if (!weight) missing.add('Weight');
    if (!length) missing.add('Package length');
    if (!width) missing.add('Package width');
    if (!height) missing.add('Package height');
    return {
      name: item.name || product?.name || 'Item',
      description: item.name || product?.name || 'Item',
      sku: item.sku || product?.sku || null,
      quantity,
      unit_weight: weight,
      unit_amount: unitAmount,
      length,
      width,
      height,
    };
  });

  const overrideWeight = num(override.weight);
  const overrideLength = num(override.length);
  const overrideWidth = num(override.width);
  const overrideHeight = num(override.height);

  if (overrideWeight) missing.delete('Weight');
  if (overrideLength) missing.delete('Package length');
  if (overrideWidth) missing.delete('Package width');
  if (overrideHeight) missing.delete('Package height');

  const weight = overrideWeight || hydrated.reduce((sum, item) => sum + (item.unit_weight || 0) * item.quantity, 0);
  const length = overrideLength || Math.max(0, ...hydrated.map((i) => i.length || 0));
  const width = overrideWidth || Math.max(0, ...hydrated.map((i) => i.width || 0));
  const height = overrideHeight || hydrated.reduce((sum, item) => sum + (item.height || 0) * item.quantity, 0);
  const declaredValue = hydrated.reduce((sum, item) => sum + (item.unit_amount || 0) * item.quantity, 0);
  const quantity = hydrated.reduce((sum, item) => sum + item.quantity, 0);

  const missingList = [...missing];
  return {
    ready: missingList.length === 0 && weight > 0 && length > 0 && width > 0 && height > 0,
    missing: missingList,
    weight,
    length,
    width,
    height,
    quantity: quantity || 1,
    declared_value: declaredValue,
    items: hydrated,
    override,
  };
}
