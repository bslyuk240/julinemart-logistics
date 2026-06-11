/**
 * Shipment creation is staff-only. Vendors must not call Fez APIs directly.
 */
import { requireAdmin } from './global-sourcing-utils.js';
import { authenticateVendor } from './vendorAuth.js';

const STAFF_ROLES = ['admin', 'manager', 'staff'];

/**
 * @returns {{ ok: true } | { ok: false, statusCode: number, body: string }}
 */
export async function assertStaffCanCreateShipment(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';

  if (authHeader.startsWith('Bearer ')) {
    const vendorAuth = await authenticateVendor(event);
    if (!vendorAuth.error) {
      return {
        ok: false,
        statusCode: 403,
        body: JSON.stringify({
          success: false,
          error: 'Vendors cannot create courier shipments. Mark the order ready in your portal; JulineMart staff will create the shipment.',
        }),
      };
    }

    const staffAuth = await requireAdmin(event, STAFF_ROLES);
    if (staffAuth.errorResponse) {
      return {
        ok: false,
        statusCode: staffAuth.errorResponse.statusCode,
        body: staffAuth.errorResponse.body,
      };
    }

    return { ok: true };
  }

  return {
    ok: false,
    statusCode: 401,
    body: JSON.stringify({
      success: false,
      error: 'Staff authentication required to create courier shipments.',
    }),
  };
}
