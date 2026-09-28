import { getShippingQuote } from '../../fezDeliveryService.js';
import { resolveSender } from '../../resolveSender.js';
import { mapFezStatus, fetchFezTracking, normalizeFezHistoryEntry } from '../../fezTracking.js';
import { normalizeQuote, parseEtaDays } from '../quoteModel.js';
import { executeFezCreateShipment, FEZ_SUB_ORDER_SELECT } from '../fezCreateCore.js';

export const fezProvider = {
  code: 'fez',
  name: 'FEZ',

  async getRates({ supabase, subOrder, shipment }) {
    const sender = resolveSender(subOrder);
    const order = subOrder.orders || {};
    const quote = await getShippingQuote({
      originCity: sender.city || subOrder.hubs?.city || '',
      originState: sender.state || subOrder.hubs?.state || '',
      destinationCity: order.delivery_city || '',
      destinationState: order.delivery_state || '',
      weight: shipment.weight,
      declaredValue: shipment.declared_value,
    });

    if (!quote?.success) {
      return { ok: false, error: quote?.error || 'FEZ rates could not be retrieved.' };
    }

    const eta = parseEtaDays(quote.estimatedDeliveryDays);
    return {
      ok: true,
      quotes: [
        normalizeQuote({
          provider: 'fez',
          providerQuoteId: quote.quotedAt || null,
          courierName: 'FEZ Standard',
          serviceName: quote.serviceType || 'Standard Delivery',
          amount: quote.totalAmount || quote.amount,
          currency: quote.currency || 'NGN',
          etaMinDays: eta.min,
          etaMaxDays: eta.max,
          pickupAvailable: true,
          rawReference: { source: 'fez', quote },
        }),
      ],
    };
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
