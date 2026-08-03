/**
 * Resolves whether a customer/guest may receive an email in a given category.
 * Checks email_suppressions first (always wins, guest or not), then falls
 * back to customer_notification_prefs if a `customers` row exists for the
 * email. Defaults to allow (opt-out model) when no explicit preference row
 * exists — the suppression list is the safety valve either way.
 */
const VALID_CATEGORIES = ['order_updates', 'promotions', 'newsletter', 'sms', 'push'];

export async function isConsentedForEmail(adminClient, { email, category }) {
  if (!email || !VALID_CATEGORIES.includes(category)) return false;
  const normalizedEmail = String(email).trim().toLowerCase();

  const { data: suppressed } = await adminClient
    .from('email_suppressions')
    .select('id')
    .eq('email', normalizedEmail)
    .in('category', [category, 'all'])
    .limit(1);
  if (suppressed?.length) return false;

  const { data: customer } = await adminClient
    .from('customers')
    .select('id')
    .ilike('email', normalizedEmail)
    .maybeSingle();
  if (!customer) return true; // true guest — suppression list is the only lever

  const { data: prefs } = await adminClient
    .from('customer_notification_prefs')
    .select(category)
    .eq('customer_id', customer.id)
    .maybeSingle();
  if (!prefs) return true; // no row = default allow

  return prefs[category] !== false;
}
