/**
 * Who may use the staff-side returns and refunds endpoints.
 *
 * These match who the dashboard already shows the Returns / Refunds screens to
 * (permissions.ts), so enforcing them on the server doesn't take away anything
 * staff could already do from the UI.
 *
 *  - VIEW:   read the returns / refund queues (includes read-only viewers).
 *  - ACTION: anything that changes a return or moves money: approve or reject,
 *            record an inspection, trigger a Paystack refund, create a courier
 *            return shipment.
 */
export const RETURNS_VIEW_ROLES = ['admin', 'agent', 'manager', 'viewer'];
export const RETURNS_ACTION_ROLES = ['admin', 'agent', 'manager'];
