import { authenticateFez } from '../../fezAuth.js';
import { resolveSender } from '../../resolveSender.js';
import { mapFezStatus, fetchFezTracking, normalizeFezHistoryEntry } from '../../fezTracking.js';
import { normalizeNigerianState } from '../../deliveryDetails.js';
import { normalizeQuote } from '../quoteModel.js';
import { executeFezCreateShipment, FEZ_SUB_ORDER_SELECT } from '../fezCreateCore.js';

async function fetchFezDeliveryCost(supabase, { destinationState, pickupState, weight }) {
  const { authToken, secretKey, baseUrl } = await authenticateFez(supabase);
  const response = await fetch(`${baseUrl}/order/cost`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'secret-key': secretKey,
    },
    body: JSON.stringify({
      state: destinationState,
      ...(pickupState ? { pickUpState: pickupState } : {}),
      ...(Number(weight) > 0 ? { weight: Number(weight) } : {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || String(data.status || '').toLowerCase() !== 'success') {
    throw new Error(data.description || data.message || 'Failed to get quote from Fez');
  }
  const total = Number(data.totalCost ?? data.Cost?.cost ?? data.cost?.cost ?? data.cost);
  return { total, raw: data };
}

export const fezProvider = {
  code: 'fez',
  name: 'FEZ',

  async getRates({ supabase, subOrder, shipment }) {
    const sender = resolveSender(subOrder);
    const order = subOrder.orders || {};
    const destinationState = normalizeNigerianState(order.delivery_state) || normalizeNigerianState(order.delivery_city);
    if (!destinationState) {
      return {
        ok: false,
        error: 'Destination state is missing or not a valid Nigerian state. Update the order address and retry.',
      };
    }

    try {
      const quote = await fetchFezDeliveryCost(supabase, {
        destinationState,
        pickupState: normalizeNigerianState(sender.state || subOrder.hubs?.state),
        weight: shipment.weight,
      });
      if (!Number.isFinite(quote.total) || quote.total <= 0) {
        return { ok: false, error: 'FEZ returned no delivery cost for this destination.' };
      }

      return {
        ok: true,
        quotes: [
          normalizeQuote({
            provider: 'fez',
            providerQuoteId: `${destinationState}:${shipment.weight || 1}`,
            courierName: 'FEZ Standard',
            serviceName: 'Standard Delivery',
            amount: quote.total,
            currency: 'NGN',
            pickupAvailable: true,
            rawReference: { source: 'fez_order_cost', quote: quote.raw },
          }),
        ],
      };
    } catch (error) {
      return { ok: false, error: error.message || 'FEZ rates could not be retrieved.' };
    }
  },

  async createShipment({ supabase, subOrderId, quote, force = false }) {
    const result = await executeFezCreateShipment(supabase, { subOrderId, force });
    if (!result.ok) return result;

    const charged = Number(quote?.customer_shipping_charge || 0);
    const carrierCost = Number(quote?.cost || quote?.amount || 0);
    const extras = {
      fulfilment_provider: 'fez',
      fulfilment_courier_name: quote?.courier_name || 'FEZ Standard',
      fulfilment_service_name: quote?.service_name || 'Standard Delivery',
      carrier_cost: carrierCost || null,
      shipping_margin: charged && carrierCost ? charged - carrierCost : null,
      selected_quote_id: quote?.id || null,
      provider_metadata: {
        ...(quote?.provider_metadata || {}),
        fez: {
          tracking_number: result.data?.tracking_number,
          courier_shipment_id: result.data?.courier_shipment_id,
        },
      },
    };

    const { error } = await supabase.from('sub_orders').update(extras).eq('id', subOrderId);
    if (error) console.warn('[fezProvider] fulfilment fields update failed:', error.message);

    return {
      ...result,
      data: {
        ...result.data,
        provider: 'fez',
        courier_name: extras.fulfilment_courier_name,
        carrier_cost: extras.carrier_cost,
        shipping_margin: extras.shipping_margin,
      },
    };
  },

  async getTracking({ supabase, trackingNumber }) {
    const data = await fetchFezTracking(supabase, trackingNumber);
    return {
      ok: true,
      status: mapFezStatus(data.order?.orderStatus || data.order?.status),
      provider_status: data.order?.orderStatus || data.order?.status || null,
      history: (data.history || []).map(normalizeFezHistoryEntry),
    };
  },

  mapStatus(raw) {
    return mapFezStatus(raw);
  },

  async loadSubOrder(supabase, subOrderId) {
    const { data, error } = await supabase
      .from('sub_orders')
      .select(FEZ_SUB_ORDER_SELECT)
      .eq('id', subOrderId)
      .single();
    if (error) throw error;
    return data;
  },
};
