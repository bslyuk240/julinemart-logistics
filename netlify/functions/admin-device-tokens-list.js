/**
 * GET /.netlify/functions/admin-device-tokens-list
 * Admin-only registry of users with saved push notification tokens.
 * PII-safe: masked email/phone, token hints only (never full FCM tokens).
 */
import { headers, jsonResponse, requireAdmin } from './services/global-sourcing-utils.js';

const ALLOWED_TYPES = new Set(['all', 'customer', 'vendor', 'staff', 'admin', 'unknown']);
const ALLOWED_PLATFORMS = new Set(['all', 'web', 'android', 'ios']);

const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0) return '***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
};

const maskPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
};

const tokenHint = (token) => {
  if (!token || typeof token !== 'string') return null;
  if (token.length <= 6) return '***';
  return `…${token.slice(-6)}`;
};

const shortId = (id) => (id ? String(id).slice(0, 8) : '');

const customerDisplayName = (row) => {
  const first = String(row?.first_name || '').trim();
  const last = String(row?.last_name || '').trim();
  if (first && last) return `${first} ${last.charAt(0)}.`;
  if (first) return first;
  if (last) return `${last.charAt(0)}.`;
  return 'Customer';
};

const normalizeUserType = (raw) => {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'customer' || value === 'vendor' || value === 'staff' || value === 'admin') return value;
  return null;
};

const resolveStaffType = (role) => (String(role || '').toLowerCase() === 'admin' ? 'admin' : 'staff');

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function fetchByIds(adminClient, table, column, ids, select) {
  const map = new Map();
  if (!ids.length) return map;

  for (const batch of chunk(ids, 200)) {
    const { data, error } = await adminClient.from(table).select(select).in(column, batch);
    if (error) throw new Error(`${table} lookup failed: ${error.message}`);
    for (const row of data || []) {
      map.set(String(row[column === 'user_id' ? 'user_id' : 'id']), row);
    }
  }

  return map;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  const { adminClient } = auth;
  const params = event.queryStringParameters || {};

  const userTypeFilter = ALLOWED_TYPES.has(String(params.user_type || 'all').toLowerCase())
    ? String(params.user_type || 'all').toLowerCase()
    : 'all';
  const platformFilter = ALLOWED_PLATFORMS.has(String(params.platform || 'all').toLowerCase())
    ? String(params.platform || 'all').toLowerCase()
    : 'all';
  const search = String(params.search || '')
    .trim()
    .toLowerCase();
  const page = Math.max(Number(params.page || 1), 1);
  const perPage = Math.min(Math.max(Number(params.per_page || 30), 1), 100);

  let tokenRows;
  try {
    const primary = await adminClient
      .from('device_tokens')
      .select('id, customer_id, platform, last_used_at, created_at, updated_at, user_type, fcm_token')
      .order('last_used_at', { ascending: false, nullsFirst: false });

    if (primary.error && /user_type/.test(primary.error.message || '')) {
      const fallback = await adminClient
        .from('device_tokens')
        .select('id, customer_id, platform, last_used_at, created_at, updated_at, fcm_token')
        .order('last_used_at', { ascending: false, nullsFirst: false });
      if (fallback.error) throw new Error(fallback.error.message);
      tokenRows = (fallback.data || []).map((row) => ({ ...row, user_type: null }));
    } else if (primary.error) {
      throw new Error(primary.error.message);
    } else {
      tokenRows = primary.data || [];
    }
  } catch (err) {
    console.error('admin-device-tokens-list fetch error:', err.message);
    return jsonResponse(500, { success: false, error: 'Failed to load device tokens' });
  }

  const userIds = [...new Set(tokenRows.map((row) => String(row.customer_id)).filter(Boolean))];

  let usersById = new Map();
  let vendorsById = new Map();
  let vendorsByUserId = new Map();
  let customersById = new Map();

  try {
    [usersById, vendorsById, customersById] = await Promise.all([
      fetchByIds(adminClient, 'users', 'id', userIds, 'id, email, full_name, role, is_active'),
      fetchByIds(adminClient, 'vendors', 'id', userIds, 'id, email, store_name, user_id, is_active'),
      fetchByIds(adminClient, 'customers', 'id', userIds, 'id, email, first_name, last_name, phone'),
    ]);

    const vendorUserIds = [...vendorsById.values()]
      .map((v) => v.user_id)
      .filter(Boolean)
      .map(String);
    const missingUserIds = vendorUserIds.filter((id) => !usersById.has(id));
    if (missingUserIds.length) {
      const extraUsers = await fetchByIds(
        adminClient,
        'users',
        'id',
        missingUserIds,
        'id, email, full_name, role, is_active'
      );
      extraUsers.forEach((value, key) => usersById.set(key, value));
    }

    for (const vendor of vendorsById.values()) {
      if (vendor.user_id) vendorsByUserId.set(String(vendor.user_id), vendor);
    }

    const vendorMatchesByUser = await fetchByIds(
      adminClient,
      'vendors',
      'user_id',
      userIds,
      'id, email, store_name, user_id, is_active'
    );
    vendorMatchesByUser.forEach((vendor) => {
      if (vendor.user_id) vendorsByUserId.set(String(vendor.user_id), vendor);
    });
  } catch (err) {
    console.error('admin-device-tokens-list lookup error:', err.message);
    return jsonResponse(500, { success: false, error: 'Failed to resolve user profiles' });
  }

  const resolveProfile = (customerId, hintedType) => {
    const id = String(customerId);
    const hinted = normalizeUserType(hintedType);

    if (hinted === 'vendor') {
      const vendor = vendorsById.get(id) || vendorsByUserId.get(id);
      if (vendor) {
        return {
          user_type: 'vendor',
          display_name: vendor.store_name || 'Vendor',
          email_masked: maskEmail(vendor.email),
          phone_masked: null,
          role: null,
          is_active: vendor.is_active !== false,
        };
      }
    }

    if (hinted === 'customer') {
      const customer = customersById.get(id);
      if (customer) {
        return {
          user_type: 'customer',
          display_name: customerDisplayName(customer),
          email_masked: maskEmail(customer.email),
          phone_masked: maskPhone(customer.phone),
          role: null,
          is_active: true,
        };
      }
    }

    if (hinted === 'staff' || hinted === 'admin') {
      const user = usersById.get(id);
      if (user) {
        return {
          user_type: resolveStaffType(user.role),
          display_name: user.full_name || (resolveStaffType(user.role) === 'admin' ? 'Admin' : 'Staff'),
          email_masked: maskEmail(user.email),
          phone_masked: null,
          role: user.role,
          is_active: user.is_active !== false,
        };
      }
    }

    const user = usersById.get(id);
    if (user) {
      return {
        user_type: resolveStaffType(user.role),
        display_name: user.full_name || (resolveStaffType(user.role) === 'admin' ? 'Admin' : 'Staff'),
        email_masked: maskEmail(user.email),
        phone_masked: null,
        role: user.role,
        is_active: user.is_active !== false,
      };
    }

    const vendor = vendorsById.get(id) || vendorsByUserId.get(id);
    if (vendor) {
      return {
        user_type: 'vendor',
        display_name: vendor.store_name || 'Vendor',
        email_masked: maskEmail(vendor.email),
        phone_masked: null,
        role: null,
        is_active: vendor.is_active !== false,
      };
    }

    const customer = customersById.get(id);
    if (customer) {
      return {
        user_type: 'customer',
        display_name: customerDisplayName(customer),
        email_masked: maskEmail(customer.email),
        phone_masked: maskPhone(customer.phone),
        role: null,
        is_active: true,
      };
    }

    return {
      user_type: 'unknown',
      display_name: 'Unknown user',
      email_masked: null,
      phone_masked: null,
      role: null,
      is_active: null,
    };
  };

  const grouped = new Map();

  for (const row of tokenRows) {
    const userId = String(row.customer_id);
    const platform = String(row.platform || 'unknown').toLowerCase();

    if (platformFilter !== 'all' && platform !== platformFilter) continue;

    if (!grouped.has(userId)) {
      const profile = resolveProfile(userId, row.user_type);
      grouped.set(userId, {
        user_id: userId,
        user_id_short: shortId(userId),
        user_type: profile.user_type,
        display_name: profile.display_name,
        email_masked: profile.email_masked,
        phone_masked: profile.phone_masked,
        role: profile.role,
        is_active: profile.is_active,
        token_count: 0,
        platforms: new Set(),
        last_active_at: null,
        devices: [],
      });
    }

    const entry = grouped.get(userId);
    entry.token_count += 1;
    entry.platforms.add(platform);
    const lastUsed = row.last_used_at || row.updated_at || row.created_at;
    if (lastUsed && (!entry.last_active_at || lastUsed > entry.last_active_at)) {
      entry.last_active_at = lastUsed;
    }

    entry.devices.push({
      id: row.id,
      platform,
      token_hint: tokenHint(row.fcm_token),
      last_used_at: row.last_used_at,
      registered_at: row.created_at,
    });
  }

  let subscribers = [...grouped.values()].map((entry) => ({
    ...entry,
    platforms: [...entry.platforms].sort(),
  }));

  if (userTypeFilter !== 'all') {
    subscribers = subscribers.filter((entry) => entry.user_type === userTypeFilter);
  }

  if (search) {
    subscribers = subscribers.filter((entry) => {
      const haystack = [
        entry.display_name,
        entry.email_masked,
        entry.user_id,
        entry.user_id_short,
        entry.user_type,
        ...(entry.platforms || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }

  subscribers.sort((a, b) => {
    const aTime = a.last_active_at || '';
    const bTime = b.last_active_at || '';
    return bTime.localeCompare(aTime);
  });

  const summary = {
    total_users: subscribers.length,
    total_tokens: subscribers.reduce((sum, row) => sum + row.token_count, 0),
    by_type: { customer: 0, vendor: 0, staff: 0, admin: 0, unknown: 0 },
    by_platform: { web: 0, android: 0, ios: 0, unknown: 0 },
  };

  for (const entry of subscribers) {
    summary.by_type[entry.user_type] = (summary.by_type[entry.user_type] || 0) + 1;
    for (const device of entry.devices) {
      const key = summary.by_platform[device.platform] !== undefined ? device.platform : 'unknown';
      summary.by_platform[key] = (summary.by_platform[key] || 0) + 1;
    }
  }

  const total = subscribers.length;
  const from = (page - 1) * perPage;
  const pageRows = subscribers.slice(from, from + perPage);

  return jsonResponse(200, {
    success: true,
    summary,
    data: pageRows,
    meta: {
      page,
      per_page: perPage,
      total,
      total_pages: Math.max(Math.ceil(total / perPage), 1),
    },
  });
}
