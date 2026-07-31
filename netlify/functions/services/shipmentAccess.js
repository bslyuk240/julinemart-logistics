/**
 * Shipment access control — staff read/write and vendor-scoped waybill access.
 */
import { requireAdmin } from './global-sourcing-utils.js';
import { authenticateVendor, getAdminClient } from './vendorAuth.js';

/** Roles that can list/read shipments and print waybills (viewer is read-only). */
export const STAFF_READ_ROLES = ['admin', 'agent', 'manager', 'viewer', 'staff', 'shop_manager'];

/** Roles that can create/dispatch shipments and assign riders. */
export const STAFF_WRITE_ROLES = ['admin', 'agent', 'manager', 'staff'];

function unauthorized(message = 'Staff authentication required.') {
  return {
    ok: false,
    statusCode: 401,
    body: JSON.stringify({ success: false, error: message }),
  };
}

function forbidden(message) {
  return {
    ok: false,
    statusCode: 403,
    body: JSON.stringify({ success: false, error: message }),
  };
}

/**
 * Staff read access — rejects vendors and unauthenticated callers.
 * @returns {{ ok: true, profile? } | { ok: false, statusCode: number, body: string }}
 */
export async function assertStaffCanReadShipments(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return unauthorized('Staff authentication required.');
  }

  const vendorAuth = await authenticateVendor(event);
  if (!vendorAuth.error) {
    return forbidden('This resource is staff-only.');
  }

  const staffAuth = await requireAdmin(event, STAFF_READ_ROLES);
  if (staffAuth.errorResponse) {
    return {
      ok: false,
      statusCode: staffAuth.errorResponse.statusCode,
      body: staffAuth.errorResponse.body,
    };
  }

  return { ok: true, profile: staffAuth.profile };
}

/**
 * Shipment creation / dispatch is staff-only. Vendors must not call Fez APIs directly.
 * @returns {{ ok: true } | { ok: false, statusCode: number, body: string }}
 */
export async function assertStaffCanCreateShipment(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';

  if (authHeader.startsWith('Bearer ')) {
    const vendorAuth = await authenticateVendor(event);
    if (!vendorAuth.error) {
      return forbidden(
        'Vendors cannot create courier shipments. Mark the order ready in your portal; JulineMart staff will create the shipment.',
      );
    }

    const staffAuth = await requireAdmin(event, STAFF_WRITE_ROLES);
    if (staffAuth.errorResponse) {
      return {
        ok: false,
        statusCode: staffAuth.errorResponse.statusCode,
        body: staffAuth.errorResponse.body,
      };
    }

    return { ok: true };
  }

  return unauthorized('Staff authentication required to create courier shipments.');
}

/**
 * Waybill access: staff for all types; vendors may only fetch their own sub-order waybills.
 * @returns {{ ok: true } | { ok: false, statusCode: number, body: string }}
 */
export async function assertWaybillAccess(event, { subOrderId, returnShipmentId, shipmentId }) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return unauthorized('Authentication required.');
  }

  if (returnShipmentId || shipmentId) {
    return assertStaffCanReadShipments(event);
  }

  if (!subOrderId) {
    return {
      ok: false,
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'subOrderId, returnShipmentId, or shipmentId required' }),
    };
  }

  const staffAuth = await requireAdmin(event, STAFF_READ_ROLES);
  if (!staffAuth.errorResponse) {
    return { ok: true };
  }

  const vendorAuth = await authenticateVendor(event);
  if (vendorAuth.error) {
    return unauthorized('Authentication required.');
  }

  const adminClient = getAdminClient();
  const { data: subOrder, error } = await adminClient
    .from('sub_orders')
    .select('vendor_id')
    .eq('id', subOrderId)
    .single();

  if (error || !subOrder) {
    return {
      ok: false,
      statusCode: 404,
      body: JSON.stringify({ success: false, error: 'Sub-order not found' }),
    };
  }

  if (subOrder.vendor_id && subOrder.vendor_id !== vendorAuth.vendor.id) {
    return forbidden('Forbidden');
  }

  return { ok: true };
}
