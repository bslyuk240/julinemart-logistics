// Fez Delivery API Service
// Location: /netlify/functions/services/fezDeliveryService.js

const FEZ_API_BASE = 'https://api.fezdelivery.co';
const FEZ_USER_ID = process.env.FEZ_USER_ID || 'G-Azan-8WgA';
const FEZ_API_KEY = process.env.FEZ_API_KEY;

if (!FEZ_API_KEY) {
  console.warn('⚠️ FEZ_API_KEY not set in environment variables');
}

/**
 * Get shipping quote from Fez Delivery
 * @param {Object} params - Shipping parameters
 * @param {string} params.originCity - Origin city (e.g., "Lagos", "Warri")
 * @param {string} params.originState - Origin state
 * @param {string} params.destinationCity - Destination city
 * @param {string} params.destinationState - Destination state
 * @param {number} params.weight - Package weight in kg
 * @param {number} params.declaredValue - Package value in Naira
 * @returns {Promise<Object>} Quote response
 */
export async function getShippingQuote({
  originCity,
  originState,
  destinationCity,
  destinationState,
  weight,
  declaredValue
}) {
  if (!FEZ_API_KEY) {
    console.error('❌ Fez API key not configured');
    return {
      success: false,
      error: 'Fez API not configured',
      fallbackToEstimate: true
    };
  }

  try {
    const payload = {
      user_id: FEZ_USER_ID,
      origin: {
        city: originCity,
        state: originState
      },
      destination: {
        city: destinationCity,
        state: destinationState
      },
      package: {
        weight: weight,
        declared_value: declaredValue
      }
    };

    console.log('📞 Calling Fez Quote API:', {
      origin: `${originCity}, ${originState}`,
      destination: `${destinationCity}, ${destinationState}`,
      weight: `${weight}kg`,
      value: `₦${declaredValue}`
    });

    const response = await fetch(`${FEZ_API_BASE}/api/v1/shipment/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FEZ_API_KEY}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Fez Quote API error:', response.status, data);
      return {
        success: false,
        error: data.message || 'Failed to get quote from Fez',
        statusCode: response.status,
        fallbackToEstimate: true
      };
    }

    // Fez API response format (adjust based on actual API response)
    const quote = {
      success: true,
      amount: parseFloat(data.shipping_cost || data.amount || 0),
      baseRate: parseFloat(data.base_rate || 0),
      vatAmount: parseFloat(data.vat || 0),
      totalAmount: parseFloat(data.total || data.shipping_cost || 0),
      currency: 'NGN',
      estimatedDeliveryDays: data.delivery_days || 3,
      serviceType: data.service_type || 'standard',
      quotedAt: new Date().toISOString()
    };

    console.log('✅ Fez quote received:', {
      amount: `₦${quote.totalAmount.toLocaleString()}`,
      deliveryDays: quote.estimatedDeliveryDays
    });

    return quote;

  } catch (error) {
    console.error('❌ Error calling Fez Quote API:', error);
    return {
      success: false,
      error: error.message,
      fallbackToEstimate: true
    };
  }
}

/**
 * Create shipment with Fez Delivery
 * @param {Object} shipmentData - Shipment details
 * @returns {Promise<Object>} Shipment creation response
 */
export async function createShipment({
  subOrderId,
  customerName,
  customerPhone,
  customerEmail,
  deliveryAddress,
  deliveryCity,
  deliveryState,
  originHub,
  items,
  declaredValue,
  weight,
  shippingCost
}) {
  if (!FEZ_API_KEY) {
    return {
      success: false,
      error: 'Fez API not configured'
    };
  }

  try {
    const payload = {
      user_id: FEZ_USER_ID,
      reference: subOrderId,
      sender: {
        name: originHub.name,
        phone: originHub.phone || '08012345678',
        address: originHub.address,
        city: originHub.city,
        state: originHub.state
      },
      receiver: {
        name: customerName,
        phone: customerPhone,
        email: customerEmail,
        address: deliveryAddress,
        city: deliveryCity,
        state: deliveryState
      },
      package: {
        items: items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          weight: item.weight,
          value: item.price
        })),
        total_weight: weight,
        declared_value: declaredValue,
        description: items.map(i => `${i.quantity}x ${i.name}`).join(', ')
      },
      shipping: {
        service_type: 'standard',
        amount: shippingCost
      }
    };

    console.log('📦 Creating Fez shipment for sub-order:', subOrderId);

    const response = await fetch(`${FEZ_API_BASE}/api/v1/shipment/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FEZ_API_KEY}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Fez Shipment creation error:', response.status, data);
      return {
        success: false,
        error: data.message || 'Failed to create shipment with Fez'
      };
    }

    const shipment = {
      success: true,
      shipmentId: data.shipment_id || data.id,
      trackingNumber: data.tracking_number || data.waybill,
      waybill: data.waybill,
      trackingUrl: data.tracking_url,
      labelUrl: data.label_url,
      estimatedDelivery: data.estimated_delivery,
      status: data.status || 'pending'
    };

    console.log('✅ Fez shipment created:', {
      tracking: shipment.trackingNumber,
      waybill: shipment.waybill
    });

    return shipment;

  } catch (error) {
    console.error('❌ Error creating Fez shipment:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get tracking information from Fez
 * @param {string} trackingNumber - Tracking/waybill number
 * @returns {Promise<Object>} Tracking information
 */
export async function getTracking(trackingNumber) {
  if (!FEZ_API_KEY) {
    return {
      success: false,
      error: 'Fez API not configured'
    };
  }

  try {
    const response = await fetch(
      `${FEZ_API_BASE}/api/v1/shipment/track/${trackingNumber}`,
      {
        headers: {
          'Authorization': `Bearer ${FEZ_API_KEY}`,
          'Accept': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.message || 'Failed to get tracking info'
      };
    }

    return {
      success: true,
      status: data.status,
      currentLocation: data.current_location,
      estimatedDelivery: data.estimated_delivery,
      events: data.tracking_history || [],
      lastUpdate: data.last_update
    };

  } catch (error) {
    console.error('❌ Error getting Fez tracking:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Fallback: Calculate shipping from local rates table
 * Used when Fez API is unavailable
 */
export async function calculateFallbackShipping(supabase, hubId, zoneId, weight) {
  try {
    const { data: rate } = await supabase
      .from('shipping_rates')
      .select('*')
      .eq('hub_id', hubId)
      .eq('zone_id', zoneId)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!rate) {
      console.warn('⚠️ No fallback rate found for hub:', hubId, 'zone:', zoneId);
      return 3500; // Default fallback
    }

    const baseRate = Number(rate.flat_rate || 0);
    const ratePerKg = Number(rate.per_kg_rate || 0);
    const vatPercentage = Number(rate.vat_percentage || 7.5);
    
    const shippingCost = baseRate + (weight * ratePerKg);
    const vatAmount = shippingCost * (vatPercentage / 100);
    const totalShippingFee = shippingCost + vatAmount;

    console.log('📊 Using fallback rate:', {
      hubId,
      zoneId,
      baseRate,
      weight,
      total: totalShippingFee.toFixed(2)
    });

    return Math.round(totalShippingFee * 100) / 100;

  } catch (error) {
    console.error('❌ Error calculating fallback shipping:', error);
    return 3500; // Absolute fallback
  }
}