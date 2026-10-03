/**
 * Book a return pickup with Shipbubble: the courier collects from the
 * customer's address and delivers to the hub.
 *
 * Shipbubble is quote-and-book. For store orders staff pick a quote; for a
 * return, approval books the cheapest available courier itself and records
 * what it cost, so the whole return is one click. If anything fails nothing
 * has been saved yet, and staff can pick another lane.
 */
import { createHash } from 'node:crypto';
import { getEnabledProviders } from './shipping/registry.js';
import {
  pickupDate,
  resolveCategoryId,
  resolveShipbubbleSecrets,
  shipbubbleFetch,
  validateAddress,
} from './shipping/providers/shipbubbleProvider.js';
import { isValidNgPhone, toCourierPersonName } from './deliveryDetails.js';

// A return is one package we don't measure. These are sensible defaults for
// "a boxed item"; Shipbubble prices by weight and size.
export const RETURN_PACKAGE_DEFAULTS = { weight: 1, length: 30, width: 25, height: 15 };
const FALLBACK_DECLARED_VALUE = 1000;

const addressKey = (prefix, ...parts) =>
  `${prefix}:${createHash('sha256')
    .update(parts.map((p) => String(p || '').trim().toLowerCase()).join('|'))
    .digest('hex')
    .slice(0, 24)}`;

/** Lagos date (YYYY-MM-DD) Shipbubble can collect on: the preferred day if it's later than the earliest. */
function chooseCollectionDate(preferred) {
  const earliest = pickupDate();
  return preferred && /^\d{4}-\d{2}-\d{2}$/.test(preferred) && preferred > earliest ? preferred : earliest;
}

function courierTotal(courier) {
  const n = Number(courier?.total ?? courier?.shipping_fee ?? courier?.amount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @returns {{ provider_shipment_id, tracking_code, tracking_url, waybill_url,
 *             courier_name, service_name, cost, environment, collection_date }}
 * @throws Error with a message staff can act on
 */
export async function bookShipbubbleReturnPickup(client, {
  pickupFrom,
  hub,
  declaredValue,
  preferredDate,
  itemSummary,
}) {
  const [adapter] = await getEnabledProviders(client, { onlyCode: 'shipbubble' });
  if (!adapter) throw new Error('Shipbubble is not enabled. Turn it on under Settings → Courier APIs.');

  const secrets = resolveShipbubbleSecrets(adapter.row);
  if (!secrets.apiKey) {
    throw new Error('Shipbubble API key is not configured. Add it in Settings → Courier APIs.');
  }

  const senderName = toCourierPersonName(pickupFrom.name);
  if (!senderName) throw new Error('The pickup contact needs a first and last name.');
  if (!isValidNgPhone(pickupFrom.phone)) throw new Error('The pickup contact phone is not a valid Nigerian number.');
  if (!pickupFrom.address || !pickupFrom.state) throw new Error('The pickup address is incomplete.');

  const hubPhone = isValidNgPhone(hub.phone) ? hub.phone : secrets.senderPhone;
  if (!isValidNgPhone(hubPhone)) {
    throw new Error('The hub has no valid phone. Set one on the hub, or a sender phone in Settings → Courier APIs.');
  }
  if (!hub.address || !hub.state) throw new Error('The hub address is incomplete.');

  const contactEmail = secrets.senderEmail || process.env.JLO_OPS_EMAIL || 'shipping@julinemart.com';

  let senderCode;
  let receiverCode;
  let categoryId;
  try {
    [senderCode, receiverCode, categoryId] = await Promise.all([
      // The customer is the sender: the courier collects from here.
      validateAddress(client, secrets.apiKey, {
        locationKey: addressKey('return_pickup', pickupFrom.address, pickupFrom.city, pickupFrom.state),
        name: senderName,
        email: contactEmail,
        phone: pickupFrom.phone,
        address: pickupFrom.address,
        city: pickupFrom.city,
        state: pickupFrom.state,
      }),
      // The hub is the receiver.
      validateAddress(client, secrets.apiKey, {
        locationKey: `hub:${hub.id}`,
        name: hub.name || 'JulineMart Hub',
        email: contactEmail,
        phone: hubPhone,
        address: hub.address,
        city: hub.city,
        state: hub.state,
      }),
      resolveCategoryId(secrets.apiKey, adapter.row),
    ]);
  } catch (err) {
    throw new Error(`Shipbubble could not verify the addresses: ${err.message}`);
  }
  if (!categoryId) throw new Error('Shipbubble package category is not configured.');

  const collectionDate = chooseCollectionDate(preferredDate);
  const value = Math.max(0, Math.round(Number(declaredValue) || FALLBACK_DECLARED_VALUE));
  const itemName = String(itemSummary || 'Returned item').slice(0, 60);

  let rates;
  try {
    rates = await shipbubbleFetch(secrets.apiKey, '/shipping/fetch_rates', {
      method: 'POST',
      body: {
        sender_address_code: senderCode,
        reciever_address_code: receiverCode,
        pickup_date: collectionDate,
        category_id: categoryId,
        package_items: [{
          name: itemName,
          description: itemName,
          unit_weight: String(RETURN_PACKAGE_DEFAULTS.weight),
          unit_amount: String(value),
          quantity: '1',
        }],
        package_dimension: {
          length: RETURN_PACKAGE_DEFAULTS.length,
          width: RETURN_PACKAGE_DEFAULTS.width,
          height: RETURN_PACKAGE_DEFAULTS.height,
        },
        // The courier collects from the sender (the customer).
        service_type: 'pickup',
      },
    });
  } catch (err) {
    throw new Error(`Shipbubble could not price this pickup: ${err.message}`);
  }

  const requestToken = rates?.data?.request_token;
  const priced = (rates?.data?.couriers || [])
    .map((courier) => ({ courier, total: courierTotal(courier) }))
    .filter((entry) => entry.total !== null && entry.courier.courier_id && entry.courier.service_code)
    .sort((a, b) => a.total - b.total);
  if (!requestToken || priced.length === 0) {
    throw new Error('Shipbubble has no courier available for this pickup. Use Fez or a rider instead.');
  }

  const best = priced[0];
  let booked;
  try {
    booked = await shipbubbleFetch(secrets.apiKey, '/shipping/labels', {
      method: 'POST',
      body: {
        request_token: requestToken,
        service_code: best.courier.service_code,
        courier_id: best.courier.courier_id,
      },
    });
  } catch (err) {
    const expired = /token|expired|invalid request/i.test(err.message || '');
    throw new Error(
      expired
        ? 'The Shipbubble quote expired before it could be booked. Try again.'
        : `Shipbubble could not book the pickup: ${err.message}`
    );
  }

  const payload = booked?.data || {};
  const providerShipmentId = payload.order_id || payload.orderId;
  if (!providerShipmentId) throw new Error('Shipbubble booked the pickup but returned no shipment id.');

  return {
    provider_shipment_id: String(providerShipmentId),
    tracking_code: payload.courier?.tracking_code || payload.tracking_code || String(providerShipmentId),
    tracking_url: payload.tracking_url || null,
    waybill_url: payload.waybill_document || payload.waybill_url || null,
    courier_name: payload.courier?.name || best.courier.courier_name || best.courier.name || 'Courier',
    service_name: best.courier.service_type_name || best.courier.service_type || 'Pickup',
    cost: Number(payload.payment?.shipping_fee ?? best.total),
    environment: secrets.environment,
    collection_date: collectionDate,
  };
}
