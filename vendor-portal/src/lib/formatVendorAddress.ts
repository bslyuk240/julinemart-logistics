export type FormatVendorAddressOptions = {
  /**
   * When true (e.g. Settings with separate City/State rows), Woo-style JSON omits
   * city/state from the Address block to avoid repeating the same lines.
   */
  omitCityStateWhenStructured?: boolean;
};

/**
 * Migrated Woo vendors often store `address` as a JSON string
 * (street_1, street_2, city, state, zip, country). Portal-native vendors use plain text.
 */
export function formatVendorAddressForDisplay(
  raw: string | null | undefined,
  options?: FormatVendorAddressOptions
): string {
  if (raw == null || raw.trim() === '') return '';

  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return raw;

  try {
    const o = JSON.parse(trimmed) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return raw;

    const street1 = pickStr(o, 'street_1', 'street1', 'address_1');
    const street2 = pickStr(o, 'street_2', 'street2', 'address_2');
    const city = pickStr(o, 'city');
    const state = pickStr(o, 'state');
    const zip = pickStr(o, 'zip', 'postcode', 'postal_code');
    const country = pickStr(o, 'country');

    if (!street1 && !street2 && !city && !state && !zip && !country) return raw;

    const lines: string[] = [];
    if (street1) lines.push(street1);
    if (street2) lines.push(street2);

    if (options?.omitCityStateWhenStructured && (street1 || street2)) {
      if (zip) lines.push(zip);
      if (country) lines.push(country);
      if (lines.length) return lines.join('\n');
    }

    const stateZip = [state, zip].filter(Boolean).join(' ').trim();
    const locality = [city, stateZip].filter(Boolean).join(', ');
    if (locality) lines.push(locality);
    if (country) lines.push(country);

    return lines.length ? lines.join('\n') : raw;
  } catch {
    return raw;
  }
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}
