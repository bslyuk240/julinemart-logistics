import { createHmac } from 'node:crypto';
import { resolveSender } from '../../resolveSender.js';
import {
  isValidNgPhone,
  normalizeCityState,
  normalizeNgPhone,
  toCourierPersonName,
} from '../../deliveryDetails.js';
import { normalizeQuote, parseEtaDays } from '../quoteModel.js';
import { mapProviderStatus } from '../statusMap.js';
import {
  getMappedAddressCode,
  locationKeyForDestination,
  locationKeyForOrigin,
  saveMappedAddressCode,
} from '../locationMappings.js';
import { sendApiCourierStatusCustomerEmail } from '../../../../../shared/riderAssignedEmail.js';
import { sendVendorShipmentReadyEmail } from '../../../../../shared/vendorFulfillment.js';
import { sendTransactionalEmail } from '../../emailNotifications.js';
import { sendWebhookEvent } from '../../webhookDelivery.js';
import { decryptSecret } from '../../secretsCrypto.js';

const API_BASE = 'https://api.shipbubble.com/v1';

function decryptStored(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    return decryptSecret(value) || '';
  } catch {
    return '';
  }
}

export function activeEnvironment(providerRow) {
  const env = String(providerRow?.environment || process.env.SHIPBUBBLE_ENVIRONMENT || 'sandbox').toLowerCase();
  return env === 'production' || env === 'live' ? 'production' : 'sandbox';
}

export function resolveShipbubbleSecrets(providerRow) {
  const config = providerRow?.config || {};
  const sandboxKey =
    decryptStored(config.sandbox_api_key_encrypted) ||
    process.env.SHIPBUBBLE_SANDBOX_API_KEY ||
    '';
  const liveKey =
    decryptStored(config.live_api_key_encrypted) ||
    process.env.SHIPBUBBLE_API_KEY ||
    process.env.SHIPBUBBLE_LIVE_API_KEY ||
    '';
  const webhookSecret =
    decryptStored(config.webhook_secret_encrypted) ||
    process.env.SHIPBUBBLE_WEBHOOK_SECRET ||
    '';
  const env = activeEnvironment(providerRow);
  const apiKey = env === 'production' ? liveKey : sandboxKey;
  return {
    environment: env,
    apiKey,
    sandboxKey,
    liveKey,
    webhookSecret: webhookSecret || apiKey,
    categoryId: config.category_id || process.env.SHIPBUBBLE_CATEGORY_ID || null,
    senderEmail: config.sender_email || process.env.JLO_SHIPPING_SENDER_EMAIL || null,
    senderPhone: config.sender_phone || process.env.JLO_SHIPPING_SENDER_PHONE || null,
  };
}

function apiKeyFor(providerRow) {
  return resolveShipbubbleSecrets(providerRow).apiKey;
}

function senderEmail(subOrder, providerRow) {
  return (
    resolveShipbubbleSecrets(providerRow).senderEmail ||
    subOrder.vendors?.email ||
    process.env.JLO_OPS_EMAIL ||
    'shipping@julinemart.com'
  );
}

function normalizePhone(raw) {
  return normalizeNgPhone(raw) || '';
}

function pickupDate() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
  if (now.getHours() >= 15) now.setDate(now.getDate() + 1);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function shipbubbleFetch(apiKey, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === 'failed') {
    const message = data.message || data.error || `Shipbubble ${path} failed (${response.status})`;
    const err = new Error(message);
    err.details = data;
    err.statusCode = response.status;
    throw err;
  }
  return data;
}

async function resolveCategoryId(apiKey, providerRow) {
  const configured = providerRow?.config?.category_id || process.env.SHIPBUBBLE_CATEGORY_ID;
  if (configured) return Number(configured);
  const data = await shipbubbleFetch(apiKey, '/shipping/labels/categories');
  const rows = data?.data || data?.categories || [];
  const other = rows.find((row) => /other/i.test(row.category || row.name || ''));
  return Number(other?.category_id || other?.id || rows[0]?.category_id || rows[0]?.id);
}

async function validateAddress(supabase, apiKey, { locationKey, name, email, phone, address, city, state }) {
  const existing = await getMappedAddressCode(supabase, locationKey, 'shipbubble');
  if (existing?.provider_address_code) {
    return Number(existing.provider_address_code);
  }
  const fullAddress = [address, city, state, 'Nigeria'].filter(Boolean).join(', ');
  const data = await shipbubbleFetch(apiKey, '/shipping/address/validate', {
    method: 'POST',
    body: {
      name,
      email,
      phone: normalizePhone(phone),
      address: fullAddress,
    },
  });
  const code = data?.data?.address_code;
  if (!code) throw new Error('Shipbubble did not return an address code.');
  await saveMappedAddressCode(supabase, {
    locationKey,
    provider: 'shipbubble',
    addressCode: code,
    metadata: { formatted_address: data?.data?.formatted_address || fullAddress },
  });
  return Number(code);
}

export const shipbubbleProvider = {
  code: 'shipbubble',
  name: 'Shipbubble',

  async getRates({ supabase, subOrder, shipment, providerRow }) {
    const secrets = resolveShipbubbleSecrets(providerRow);
    const apiKey = secrets.apiKey;
    if (!apiKey) {
      return { ok: false, error: 'Shipbubble API key is not configured. Add it in Settings → Courier APIs.' };
    }

    const sender = resolveSender(subOrder);
    const order = subOrder.orders || {};
    if (!sender.address || !order.delivery_address) {
      return { ok: false, error: 'Origin or destination address is incomplete.' };
    }

    const recipientName = toCourierPersonName(order.customer_name);
    if (!recipientName) {
      return {
        ok: false,
        error: 'Recipient needs first and last name (e.g. John Doe). Update the customer name on the order and retry.',
      };
    }
    if (!isValidNgPhone(order.customer_phone)) {
      return {
        ok: false,
        error: 'Recipient phone is missing or not a valid Nigerian number. Update the order and retry.',
      };
    }
    const senderPhone = sender.phone || secrets.senderPhone;
    if (!isValidNgPhone(senderPhone)) {
      return {
        ok: false,
        error: 'Pickup phone is missing. Set a sender phone on the hub/vendor or in Settings → Courier APIs.',
      };
    }

    const destination = normalizeCityState(order.delivery_city, order.delivery_state);
    if (!destination.state) {
      return { ok: false, error: 'Destination state is missing or not a valid Nigerian state.' };
    }
    const quoteCity = destination.cityLooksLikeState ? '' : destination.city;

    try {
      const [senderCode, receiverCode, categoryId] = await Promise.all([
        validateAddress(supabase, apiKey, {
          locationKey: locationKeyForOrigin(subOrder, sender),
          name: 'JulineMart Logistics',
          email: senderEmail(subOrder, providerRow),
          phone: senderPhone,
          address: sender.address,
          city: sender.city,
          state: sender.state,
        }),
        validateAddress(supabase, apiKey, {
          locationKey: locationKeyForDestination(order),
          name: recipientName,
          email: order.customer_email || senderEmail(subOrder, providerRow),
          phone: order.customer_phone,
          address: order.delivery_address,
          city: quoteCity,
          state: destination.state,
        }),
        resolveCategoryId(apiKey, providerRow),
      ]);

      if (!categoryId) {
        return { ok: false, error: 'Shipbubble package category is not configured.' };
      }

      const data = await shipbubbleFetch(apiKey, '/shipping/fetch_rates', {
        method: 'POST',
        body: {
          sender_address_code: senderCode,
          reciever_address_code: receiverCode,
          pickup_date: pickupDate(),
          category_id: categoryId,
          package_items: shipment.items.map((item) => ({
            name: item.name,
            description: item.description || item.name,
            unit_weight: String(item.unit_weight),
            unit_amount: String(Math.round(item.unit_amount || 0)),
            quantity: String(item.quantity),
          })),
          package_dimension: {
            length: shipment.length,
            width: shipment.width,
            height: shipment.height,
          },
          service_type: 'pickup',
        },
      });

      const requestToken = data?.data?.request_token;
      const couriers = data?.data?.couriers || [];
      if (!requestToken || couriers.length === 0) {
        return { ok: false, error: 'Shipbubble returned no available services.' };
      }

      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      return {
        ok: true,
        quotes: couriers.map((courier) => {
          const eta = parseEtaDays(courier.delivery_eta || courier.eta);
          return normalizeQuote({
            provider: 'shipbubble',
            providerQuoteId: `${requestToken}:${courier.courier_id}:${courier.service_code}`,
            courierName: courier.courier_name || courier.name || 'Courier',
            serviceName: courier.service_type_name || courier.service_type || 'Standard Delivery',
            amount: courier.total ?? courier.shipping_fee ?? courier.amount,
            currency: courier.currency || 'NGN',
            etaMinDays: eta.min,
            etaMaxDays: eta.max,
            pickupAvailable: String(courier.service_type || '').toLowerCase() === 'pickup',
            expiresAt,
            rawReference: {
              request_token: requestToken,
              courier_id: courier.courier_id,
              service_code: courier.service_code,
              courier,
            },
          });
        }),
      };
    } catch (error) {
      return { ok: false, error: error.message || 'Shipbubble rates could not be retrieved.' };
    }
  },

  async createShipment({ supabase, subOrder, quote }) {
    const providerRow = quote.providerRow;
    const apiKey = apiKeyFor(providerRow);
    if (!apiKey) {
      return { ok: false, statusCode: 500, error: 'Shipbubble API key is not configured. Add it in Settings → Courier APIs.' };
    }

    const meta = quote.provider_metadata || {};
    const requestToken = meta.request_token;
    const serviceCode = meta.service_code;
    const courierId = meta.courier_id;
    if (!requestToken || !serviceCode || !courierId) {
      return { ok: false, statusCode: 409, error: 'This quote is missing Shipbubble booking references. Refresh quotes and try again.' };
    }

    let created;
    try {
      created = await shipbubbleFetch(apiKey, '/shipping/labels', {
        method: 'POST',
        body: {
          request_token: requestToken,
          service_code: serviceCode,
          courier_id: courierId,
        },
      });
    } catch (error) {
      const expired = /token|expired|invalid request/i.test(error.message || '');
      return {
        ok: false,
        statusCode: expired ? 409 : 502,
        error: expired
          ? 'This quote has expired. Refresh quotes and select again.'
          : error.message,
      };
    }

    const payload = created?.data || {};
    const externalId = payload.order_id || payload.orderId;
    const trackingCode = payload.courier?.tracking_code || payload.tracking_code || externalId;
    const trackingUrl = payload.tracking_url || null;
    const waybillUrl = payload.waybill_document || payload.waybill_url || null;
    const jloTracking = subOrder.jlo_tracking_number || subOrder.tracking_number || `JLO-${String(subOrder.id).slice(-8).toUpperCase()}`;
    const charged = Number(quote.customer_shipping_charge || subOrder.allocated_shipping_fee || 0);
    const carrierCost = Number(payload.payment?.shipping_fee ?? quote.cost ?? 0);

    let waybillNumber = subOrder.waybill_number || null;
    if (!waybillNumber) {
      const { data: nextNumber } = await supabase.rpc('next_waybill_number');
      if (nextNumber) waybillNumber = nextNumber;
    }

    const { error: updateError } = await supabase
      .from('sub_orders')
      .update({
        tracking_number: jloTracking,
        jlo_tracking_number: jloTracking,
        courier_shipment_id: externalId,
        courier_waybill: trackingCode,
        courier_tracking_url: trackingUrl,
        status: 'assigned',
        fulfilment_provider: 'shipbubble',
        fulfilment_courier_name: quote.courier_name,
        fulfilment_service_name: quote.service_name,
        carrier_cost: carrierCost,
        shipping_margin: charged - carrierCost,
        selected_quote_id: quote.id,
        provider_metadata: {
          shipbubble: {
            order_id: externalId,
            tracking_code: trackingCode,
            tracking_url: trackingUrl,
            waybill_url: waybillUrl,
            courier: payload.courier || null,
          },
        },
        ...(waybillNumber ? { waybill_number: waybillNumber } : {}),
      })
      .eq('id', subOrder.id);

    if (updateError) {
      return { ok: false, statusCode: 500, error: 'Shipment was created but failed to save tracking details.' };
    }

    if (subOrder.orders?.id && subOrder.orders?.overall_status === 'pending') {
      await supabase.from('orders').update({ overall_status: 'processing' }).eq('id', subOrder.orders.id);
      sendWebhookEvent('order.updated', {
        order_id: subOrder.orders.id,
        order_number: subOrder.orders.order_number,
        previous_status: 'pending',
        status: 'processing',
      }).catch((e) => console.warn('[shipbubble] webhook dispatch failed:', e.message));
    }

    if (subOrder.orders?.customer_email) {
      try {
        await sendApiCourierStatusCustomerEmail(supabase, {
          jloStatus: 'assigned',
          orderId: subOrder.orders.id,
          orderNumber: subOrder.orders.order_number ?? subOrder.orders.id,
          customer_name: subOrder.orders.customer_name,
          customer_email: subOrder.orders.customer_email,
          tracking_number: jloTracking,
          courier_tracking_url: null,
          courier_display_name: 'JLO Shipping',
          delivery_city: subOrder.orders.delivery_city,
          delivery_state: subOrder.orders.delivery_state,
          raw_status_hint: 'Shipment created',
        });
      } catch (mailErr) {
        console.error('shipbubble customer email:', mailErr?.message || mailErr);
      }
    }

    if (subOrder.vendors) {
      await sendVendorShipmentReadyEmail(supabase, sendTransactionalEmail, {
        vendor: subOrder.vendors,
        orderId: subOrder.orders?.id,
        orderNumber: subOrder.orders?.order_number ?? subOrder.orders?.id,
        subOrderId: subOrder.id,
        trackingNumber: jloTracking,
        trackingUrl: null,
      });
    }

    return {
      ok: true,
      statusCode: 200,
      data: {
        provider: 'shipbubble',
        courier_name: quote.courier_name,
        tracking_number: jloTracking,
        courier_shipment_id: externalId,
        courier_tracking_url: trackingUrl,
        waybill_url: waybillUrl,
        carrier_cost: carrierCost,
        shipping_margin: charged - carrierCost,
        message: 'Shipment created successfully.',
      },
    };
  },

  mapStatus(raw) {
    return mapProviderStatus('shipbubble', raw);
  },

  verifyWebhook(event, providerRow) {
    const signature = event.headers?.['x-ship-signature'] || event.headers?.['X-Ship-Signature'];
    const secrets = resolveShipbubbleSecrets(providerRow);
    const keys = [...new Set([secrets.webhookSecret, secrets.apiKey, secrets.sandboxKey, secrets.liveKey].filter(Boolean))];
    if (keys.length === 0) return true;
    if (!signature || !event.body) return false;
    return keys.some((key) => createHmac('sha512', key).update(event.body).digest('hex') === signature);
  },
};
