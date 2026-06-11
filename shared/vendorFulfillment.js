/**
 * Vendor fulfilment routing: JLO hub vs Fez-only locations.
 * Staff always creates Fez shipments; vendors prepare and hand off.
 */

export function resolveVendorFulfillment(vendor) {
  if (vendor?.fulfillment_context) return vendor.fulfillment_context;

  const loc = vendor?.approved_vendor_locations;
  const jloHub = loc?.hubs || vendor?.hub || null;
  const isJloHubVendor = Boolean(jloHub?.name || vendor?.hub_id);
  const collectionMethod = vendor?.fez_collection_method || 'hub_dropoff';
  const hubName = jloHub?.name || loc?.fez_hub_name || null;
  const hubAddress = jloHub
    ? `${jloHub.address || ''}${jloHub.city ? `, ${jloHub.city}` : ''}`.replace(/^,\s*/, '')
    : loc?.fez_hub_address || null;

  return {
    isJloHubVendor,
    collectionMethod,
    hubName,
    hubAddress,
    hubType: isJloHubVendor ? 'jlo' : loc?.fez_hub_name ? 'fez' : null,
    sentToHubAction: isJloHubVendor && collectionMethod === 'hub_dropoff',
    showFezCollectionSettings: !isJloHubVendor,
  };
}

export function isRealShipmentTracking(value) {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  const bad = ['error', 'cannot', 'failed', 'jlo-', 'cr-'];
  return !bad.some((b) => lower.includes(b));
}

/**
 * HTML block for the initial "new order" vendor email.
 */
export function buildVendorNewOrderInstructionHtml(vendor, { deliveryCity = '', deliveryState = '' } = {}) {
  const ctx = resolveVendorFulfillment(vendor);
  const area = [deliveryCity, deliveryState].filter(Boolean).join(', ');

  if (ctx.isJloHubVendor && ctx.collectionMethod === 'hub_dropoff') {
    const hubDetail = ctx.hubName
      ? `<strong>${ctx.hubName}</strong>${ctx.hubAddress ? ` — ${ctx.hubAddress}` : ''}`
      : 'your assigned JulineMart hub';
    return `<p style="margin:8px 0 0;font-size:13px;color:#555"><strong>Next steps:</strong> Pack the items, open your vendor portal, and click <strong>Mark sent to hub</strong>. Drop the parcel at ${hubDetail}. JulineMart staff will dispatch to the customer after hub consolidation.</p>`;
  }

  if (ctx.collectionMethod === 'fez_pickup') {
    return `<p style="margin:8px 0 0;font-size:13px;color:#555"><strong>Next steps:</strong> Pack the items and click <strong>Mark ready</strong> in your vendor portal. JulineMart will create your Fez shipment and email you the tracking number and label. Then have the labelled parcel ready at your shop for Fez pickup.</p>`;
  }

  const fezHubDetail = ctx.hubName
    ? ` (<strong>${ctx.hubName}</strong>${ctx.hubAddress ? ` — ${ctx.hubAddress}` : ''})`
    : '';
  return `<p style="margin:8px 0 0;font-size:13px;color:#555"><strong>Next steps:</strong> Pack the items and click <strong>Mark ready</strong> in your vendor portal. JulineMart will create your shipment and email you the tracking number and label to print, then drop the parcel at the Fez collection hub${fezHubDetail}.</p>${area ? `<p style="margin:8px 0 0;font-size:13px;color:#555">Customer delivery area: ${area}</p>` : ''}`;
}

/**
 * Notify non-JLO vendors after staff creates a Fez shipment (tracking + label).
 */
export async function sendVendorShipmentReadyEmail(supabase, sendTransactionalEmail, params) {
  const {
    vendor,
    orderId,
    orderNumber,
    subOrderId,
    trackingNumber,
    trackingUrl,
  } = params;

  if (!vendor?.email || !sendTransactionalEmail) return;

  const ctx = resolveVendorFulfillment(vendor);
  if (ctx.isJloHubVendor) return;

  const jloApi = (process.env.JLO_PUBLIC_URL || process.env.URL || 'https://jlo.julinemart.com').replace(/\/+$/, '');
  const labelUrl = `${jloApi}/.netlify/functions/generate-label?subOrderId=${subOrderId}&print=true`;
  const portalUrl = (process.env.VENDOR_PORTAL_URL || 'https://vendors.julinemart.com').replace(/\/+$/, '');

  const templateName =
    ctx.collectionMethod === 'fez_pickup'
      ? 'Vendor Shipment Ready Fez Pickup'
      : 'Vendor Shipment Ready Fez Hub';

  await sendTransactionalEmail({
    templateName,
    to: vendor.email,
    orderId,
    data: {
      vendor_name: vendor.store_name || 'Vendor',
      order_number: String(orderNumber),
      tracking_number: trackingNumber || '',
      tracking_url: trackingUrl || '',
      label_url: labelUrl,
      portal_orders_url: `${portalUrl}/orders`,
      hub_name: ctx.hubName || 'your nearest Fez collection hub',
      hub_address: ctx.hubAddress || '',
    },
  }).catch((err) => {
    console.warn('[sendVendorShipmentReadyEmail]', err?.message || err);
  });
}
