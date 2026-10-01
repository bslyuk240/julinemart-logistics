/**
 * Courier-ready delivery details. FEZ quotes by destination state;
 * Shipbubble address-validate requires a two-word personal name and a town
 * (not "Ondo State" pasted into city). Keep in sync with
 * julinemart-pwa/src/lib/checkout/delivery-details.ts
 */

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

const STATE_ALIASES = {
  fct: 'FCT',
  abuja: 'FCT',
  'federal capital territory': 'FCT',
  'akwaibom': 'Akwa Ibom',
  'akwa-ibom': 'Akwa Ibom',
  'crossriver': 'Cross River',
  'cross-river': 'Cross River',
};

const CITY_MAY_MATCH_STATE = new Set([
  'lagos', 'fct', 'kano', 'kaduna', 'katsina', 'sokoto', 'bauchi', 'gombe',
]);

function fold(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[._,]/g, ' ')
    .replace(/\s+/g, ' ');
}

function stripStateSuffix(value) {
  return fold(value).replace(/\s+state$/, '').trim();
}

export function normalizeNigerianState(raw) {
  const folded = stripStateSuffix(raw);
  if (!folded) return '';
  const compact = folded.replace(/[\s-]/g, '');
  const alias = STATE_ALIASES[folded] || STATE_ALIASES[compact];
  if (alias) return alias;
  return NIGERIAN_STATES.find((state) => fold(state) === folded) || '';
}

export function cityLooksLikeState(city, state) {
  const rawCity = String(city || '').trim();
  if (/\bstate$/i.test(rawCity)) return true;
  const cityFolded = stripStateSuffix(city);
  if (!cityFolded) return false;
  const destState = normalizeNigerianState(state);
  const cityAsState = normalizeNigerianState(city);
  if (!cityAsState || !destState) return false;
  if (fold(cityAsState) !== fold(destState)) return false;
  return !CITY_MAY_MATCH_STATE.has(fold(cityAsState));
}

export function normalizeCityState(city, state) {
  const cleanedCity = String(city || '').replace(/\s+state$/i, '').trim();
  const destState = normalizeNigerianState(state) || normalizeNigerianState(city);
  return {
    city: cleanedCity,
    state: destState,
    cityLooksLikeState: cityLooksLikeState(cleanedCity, destState || state),
  };
}

export function sanitizePersonName(raw) {
  return String(raw || '')
    .replace(/[^A-Za-zÀ-ÿ' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isFullPersonName(raw) {
  const tokens = sanitizePersonName(raw).split(' ').filter((part) => part.replace(/['-]/g, '').length >= 2);
  return tokens.length >= 2;
}

export function toCourierPersonName(raw) {
  if (!isFullPersonName(raw)) return '';
  return sanitizePersonName(raw)
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function isValidEmail(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || '').trim());
}

export function localNgPhoneDigits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('234')) return digits.slice(3);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function isValidNgPhone(raw) {
  return /^[789]\d{9}$/.test(localNgPhoneDigits(raw));
}

export function normalizeNgPhone(raw) {
  const local = localNgPhoneDigits(raw);
  if (!/^[789]\d{9}$/.test(local)) return '';
  return `+234${local}`;
}

export function validateFullName(raw, label = 'Full name') {
  const cleaned = sanitizePersonName(raw);
  if (!cleaned) return `${label} is required`;
  if (!isFullPersonName(cleaned)) {
    return `${label} must be first and last name (e.g. John Doe)`;
  }
  return null;
}

export function validateDeliveryDetails({
  name,
  email,
  phone,
  address,
  city,
  state,
  requireAddress = true,
  requireEmail = true,
  nameLabel = 'Full name',
} = {}) {
  const errors = [];
  const nameError = validateFullName(name, nameLabel);
  if (nameError) errors.push({ field: 'name', message: nameError });

  if (requireEmail) {
    if (!String(email || '').trim()) errors.push({ field: 'email', message: 'Email is required' });
    else if (!isValidEmail(email)) errors.push({ field: 'email', message: 'Enter a valid email address' });
  } else if (String(email || '').trim() && !isValidEmail(email)) {
    errors.push({ field: 'email', message: 'Enter a valid email address' });
  }

  if (!String(phone || '').trim()) errors.push({ field: 'phone', message: 'Phone number is required' });
  else if (!isValidNgPhone(phone)) {
    errors.push({ field: 'phone', message: 'Enter a valid Nigerian phone number (e.g. 08012345678)' });
  }

  const loc = normalizeCityState(city, state);

  if (requireAddress) {
    if (!String(address || '').trim() || String(address || '').trim().length < 5) {
      errors.push({ field: 'address', message: 'Enter a street address (not just the city)' });
    }
    if (!loc.city) errors.push({ field: 'city', message: 'City / town is required' });
    else if (loc.cityLooksLikeState) {
      errors.push({
        field: 'city',
        message: `Enter the town, not the state (e.g. Akure — not ${loc.state || 'Ondo'} State)`,
      });
    }
    if (!loc.state) {
      errors.push({ field: 'state', message: 'Select a valid Nigerian state' });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      name: sanitizePersonName(name),
      email: String(email || '').trim().toLowerCase(),
      phone: String(phone || '').trim(),
      address: String(address || '').trim(),
      city: loc.city,
      state: loc.state,
    },
  };
}

export function firstDeliveryError(result) {
  return result?.errors?.[0]?.message || null;
}
