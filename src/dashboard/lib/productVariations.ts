export interface VarAttr {
  name: string;
  optionsRaw: string;
  is_variation: boolean;
}

export interface VarRow {
  id?: string;
  attributes: { name: string; value: string }[];
  sku: string;
  regular_price: string;
  sale_price: string;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
  manage_stock: boolean;
  stock_quantity: string;
  image_url: string;
}

export function attrSignature(attrs: { name: string; value: string }[]): string {
  return attrs
    .map((a) => {
      const name = String(a.name ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      const value = String(a.value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      return `${name}::${value}`;
    })
    .filter((pair) => pair !== '::')
    .sort()
    .join('||');
}

export function hasMeaningfulAttributes(attrs: { name: string; value: string }[] | undefined): boolean {
  if (!Array.isArray(attrs) || attrs.length === 0) return false;
  return attrs.some((a) => String(a.name ?? '').trim() && String(a.value ?? '').trim());
}

export function generateCombinations(varAttrs: VarAttr[]): { name: string; value: string }[][] {
  const active = varAttrs
    .filter((a) => a.is_variation && a.name.trim() && a.optionsRaw.trim())
    .map((a) => ({
      name: a.name.trim(),
      values: a.optionsRaw.split(',').map((o) => o.trim()).filter(Boolean),
    }));

  if (active.length === 0) return [];

  return active.reduce<{ name: string; value: string }[][]>(
    (combos, attr) => combos.flatMap((combo) => attr.values.map((v) => [...combo, { name: attr.name, value: v }])),
    [[]],
  );
}

function hydrateVariationAttributesFromMatrix(rows: VarRow[], varAttrs: VarAttr[]): VarRow[] {
  const combos = generateCombinations(varAttrs);
  if (combos.length === 0) return rows;
  return rows.map((row, i) => {
    if (hasMeaningfulAttributes(row.attributes)) return row;
    const fill = combos[i];
    if (!fill?.length) return row;
    return { ...row, attributes: fill.map((a) => ({ name: a.name, value: a.value })) };
  });
}

function sortVariationsLikeMatrix(rows: VarRow[], varAttrs: VarAttr[]): VarRow[] {
  const combos = generateCombinations(varAttrs);
  if (combos.length === 0) return rows;
  const indexBySig = new Map(combos.map((c, i) => [attrSignature(c), i] as const));
  return rows.slice().sort((a, b) => {
    const ia = indexBySig.get(attrSignature(a.attributes));
    const ib = indexBySig.get(attrSignature(b.attributes));
    if (ia === undefined && ib === undefined) return 0;
    if (ia === undefined) return 1;
    if (ib === undefined) return -1;
    return ia - ib;
  });
}

export function realignVariationRowsOnLoad(rows: VarRow[], varAttrs: VarAttr[]): VarRow[] {
  return sortVariationsLikeMatrix(hydrateVariationAttributesFromMatrix(rows, varAttrs), varAttrs);
}

export function applyRealignFromOptionOrder(rows: VarRow[], varAttrs: VarAttr[]): VarRow[] {
  const combos = generateCombinations(varAttrs);
  if (combos.length === 0) return rows;
  if (rows.length !== combos.length) {
    return sortVariationsLikeMatrix(hydrateVariationAttributesFromMatrix(rows, varAttrs), varAttrs);
  }
  return rows.map((row, i) => ({
    ...row,
    attributes: combos[i].map((a) => ({ name: a.name, value: a.value })),
  }));
}

export function buildGeneratedVariations(varAttrs: VarAttr[], existing: VarRow[]): VarRow[] {
  const combos = generateCombinations(varAttrs);
  return combos.map((attrs, comboIdx) => {
    const sig = attrSignature(attrs);
    const bySig = existing.find((v) => hasMeaningfulAttributes(v.attributes) && attrSignature(v.attributes) === sig);
    if (bySig) return { ...bySig, attributes: attrs };
    const byIndex = existing[comboIdx];
    if (byIndex && !hasMeaningfulAttributes(byIndex.attributes)) {
      return { ...byIndex, attributes: attrs };
    }
    return {
      attributes: attrs,
      sku: '',
      regular_price: '',
      sale_price: '',
      stock_status: 'instock' as const,
      manage_stock: false,
      stock_quantity: '',
      image_url: '',
    };
  });
}

export const defaultVarAttrs = (): VarAttr[] => [{ name: '', optionsRaw: '', is_variation: true }];
