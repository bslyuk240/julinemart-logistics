/**
 * GET /api/rewards-wallet
 *
 * Signed-in customer's JulinePoints wallet. Identity is the verified Supabase
 * auth user id from the Bearer JWT — never an email or a client-supplied id.
 *
 * Returns { enabled:false } when the programme is off or no config is active,
 * without creating a wallet. Staff and vendor accounts have no wallet.
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { authenticateCustomer } from './services/customerAuth.js';
import { checkRateLimit } from './services/rate-limit.js';
import { getActiveConfig, publicProgramme } from './services/rewards-config.js';

const HISTORY_LIMIT = 50;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'rewards-wallet',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  const { userId, error: authError } = await authenticateCustomer(event);
  if (authError) return jsonResponse(401, { success: false, error: 'Please sign in to view your rewards.' });

  try {
    const config = await getActiveConfig(adminClient);
    if (!config || config.policy?.programme?.enabled !== true) {
      return jsonResponse(200, { success: true, enabled: false });
    }

    // Staff and vendor logins are not storefront customers.
    const [{ data: staff }, { data: vendor }] = await Promise.all([
      adminClient.from('users').select('id').eq('id', userId).maybeSingle(),
      adminClient.from('vendors').select('id').eq('user_id', userId).limit(1).maybeSingle(),
    ]);
    if (staff || vendor) return jsonResponse(200, { success: true, enabled: false });

    const { data: wallet, error: walletErr } = await adminClient.rpc('rewards_ensure_wallet', {
      p_user_id: userId,
    });
    if (walletErr) throw walletErr;
    const account = Array.isArray(wallet) ? wallet[0] : wallet;

    const { data: history, error: histErr } = await adminClient
      .from('rewards_ledger')
      .select('id, entry_type, points, source, reference_type, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    if (histErr) throw histErr;

    const programme = publicProgramme(config.policy);
    const balance = account?.balance_points ?? 0;

    return jsonResponse(200, {
      success: true,
      enabled: true,
      programme,
      wallet: {
        available_points: balance,
        available_ngn: Math.round(balance * programme.points_to_ngn * 100) / 100,
        lifetime_earned_points: account?.lifetime_earned_points ?? 0,
      },
      history: history || [],
    });
  } catch (err) {
    console.error('rewards-wallet error:', err?.message || err);
    return jsonResponse(500, { success: false, error: 'Could not load your rewards. Please try again.' });
  }
}
