import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

interface CourierConfig {
  id: string;
  name: string;
  code: string;
  api_enabled: boolean;
  api_base_url: string;
  api_key_encrypted: string;
  api_secret_encrypted: string;
  api_config: any;
  supports_live_tracking: boolean;
  supports_label_generation: boolean;
}

interface ShipmentData {
  pickup_address: string;
  pickup_city: string;
  pickup_state: string;
  pickup_contact_name: string;
  pickup_contact_phone: string;
  delivery_address: string;
  delivery_city: string;
  delivery_state: string;
  delivery_contact_name: string;
  delivery_contact_phone: string;
  package_weight: number;
  package_description: string;
  declared_value: number;
  order_reference: string;
}

interface ShipmentResponse {
  success: boolean;
  tracking_number?: string;
  shipment_id?: string;
  label_url?: string;
  waybill_url?: string;
  estimated_delivery_date?: string;
  error?: string;
}

interface TrackingResponse {
  success: boolean;
  status?: string;
  location?: string;
  events?: Array<{
    status: string;
    location: string;
    timestamp: string;
    description: string;
  }>;
  error?: string;
}

class CourierAPIService {
  private async getCourierConfig(courierId: string): Promise<CourierConfig | null> {
    const { data, error } = await supabase
      .from('couriers')
      .select('*')
      .eq('id', courierId)
      .single();

    if (error || !data) {
      console.error('Error fetching courier config:', error);
      return null;
    }

    return data;
  }

  private async logAPICall(
    courierId: string,
    requestType: string,
    requestPayload: any,
    responsePayload: any,
    statusCode: number,
    success: boolean,
    errorMessage?: string
  ) {
    await supabase.from('courier_api_logs').insert({
      courier_id: courierId,
      request_type: requestType,
      request_payload: requestPayload,
      response_payload: responsePayload,
      status_code: statusCode,
      success,
      error_message: errorMessage || null,
    });
  }

  // Create shipment on courier platform
  async createShipment(
    courierId: string,
    shipmentData: ShipmentData
  ): Promise<ShipmentResponse> {
    const config = await this.getCourierConfig(courierId);

    if (!config) {
      return { success: false, error: 'Courier configuration not found' };
    }

    if (!config.api_enabled) {
      return { success: false, error: 'API integration not enabled for this courier' };
    }

    // Route to correct courier implementation
    switch (config.code) {
      case 'FEZ':
        return await this.createFezShipment(config, shipmentData);
      // Add more couriers here
      default:
        return { success: false, error: 'Courier API not implemented' };
    }
  }

  // Fez Delivery implementation
  private async createFezShipment(
    config: CourierConfig,
    shipmentData: ShipmentData
  ): Promise<ShipmentResponse> {
    try {
      // Check if API credentials are configured
      if (!config.api_key_encrypted) {
        return {
          success: false,
          error: 'Fez Delivery API credentials not configured. Please add them in Courier Settings.',
        };
      }

      // Prepare Fez API request
      const fezPayload = {
        pickup: {
          address: shipmentData.pickup_address,
          city: shipmentData.pickup_city,
          state: shipmentData.pickup_state,
          contact_name: shipmentData.pickup_contact_name,
          contact_phone: shipmentData.pickup_contact_phone,
        },
        delivery: {
          address: shipmentData.delivery_address,
          city: shipmentData.delivery_city,
          state: shipmentData.delivery_state,
          contact_name: shipmentData.delivery_contact_name,
          contact_phone: shipmentData.delivery_contact_phone,
        },
        package: {
          weight: shipmentData.package_weight,
          description: shipmentData.package_description,
          value: shipmentData.declared_value,
        },
        reference: shipmentData.order_reference,
      };

      // Make API call to Fez
      const response = await fetch(`${config.api_base_url}/shipments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.api_key_encrypted}`, // Will be actual API key
        },
        body: JSON.stringify(fezPayload),
      });

      const responseData = await response.json();

      // Log API call
      await this.logAPICall(
        config.id,
        'CREATE_SHIPMENT',
        fezPayload,
        responseData,
        response.status,
        response.ok
      );

      if (!response.ok) {
        return {
          success: false,
          error: responseData.message || 'Failed to create shipment on Fez platform',
        };
      }

      // Map Fez response to our format
      return {
        success: true,
        tracking_number: responseData.tracking_number || responseData.waybill_number,
        shipment_id: responseData.shipment_id || responseData.id,
        label_url: responseData.label_url,
        waybill_url: responseData.waybill_url,
        estimated_delivery_date: responseData.estimated_delivery,
      };
    } catch (error) {
      await this.logAPICall(
        config.id,
        'CREATE_SHIPMENT',
        shipmentData,
        null,
        500,
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create shipment',
      };
    }
  }

  // Get live tracking information
  async getTracking(courierId: string, trackingNumber: string): Promise<TrackingResponse> {
    const config = await this.getCourierConfig(courierId);

    if (!config) {
      return { success: false, error: 'Courier configuration not found' };
    }

    if (!config.api_enabled || !config.supports_live_tracking) {
      return { success: false, error: 'Live tracking not available for this courier' };
    }

    // Route to correct courier implementation
    switch (config.code) {
      case 'FEZ':
        return await this.getFezTracking(config, trackingNumber);
      default:
        return { success: false, error: 'Tracking API not implemented' };
    }
  }

  // Fez tracking implementation
  private async getFezTracking(
    config: CourierConfig,
    trackingNumber: string
  ): Promise<TrackingResponse> {
    try {
      if (!config.api_key_encrypted) {
        return {
          success: false,
          error: 'Fez Delivery API credentials not configured',
        };
      }

      const response = await fetch(
        `${config.api_base_url}/tracking/${trackingNumber}`,
        {
          headers: {
            'Authorization': `Bearer ${config.api_key_encrypted}`,
          },
        }
      );

      const responseData = await response.json();

      await this.logAPICall(
        config.id,
        'GET_TRACKING',
        { tracking_number: trackingNumber },
        responseData,
        response.status,
        response.ok
      );

      if (!response.ok) {
        return {
          success: false,
          error: responseData.message || 'Failed to fetch tracking information',
        };
      }

      return {
        success: true,
        status: responseData.status,
        location: responseData.current_location,
        events: responseData.tracking_events || [],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch tracking',
      };
    }
  }

  // Generate shipping label
  async generateLabel(courierId: string, shipmentId: string): Promise<{ success: boolean; label_url?: string; error?: string }> {
    const config = await this.getCourierConfig(courierId);

    if (!config || !config.supports_label_generation) {
      return { success: false, error: 'Label generation not supported' };
    }

    switch (config.code) {
      case 'FEZ':
        return await this.getFezLabel(config, shipmentId);
      default:
        return { success: false, error: 'Label generation not implemented' };
    }
  }

  private async getFezLabel(
    config: CourierConfig,
    shipmentId: string
  ): Promise<{ success: boolean; label_url?: string; error?: string }> {
    try {
      const response = await fetch(
        `${config.api_base_url}/shipments/${shipmentId}/label`,
        {
          headers: {
            'Authorization': `Bearer ${config.api_key_encrypted}`,
          },
        }
      );

      const responseData = await response.json();

      await this.logAPICall(
        config.id,
        'GENERATE_LABEL',
        { shipment_id: shipmentId },
        responseData,
        response.status,
        response.ok
      );

      if (!response.ok) {
        return { success: false, error: 'Failed to generate label' };
      }

      return {
        success: true,
        label_url: responseData.label_url || responseData.download_url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate label',
      };
    }
  }
}

export const courierAPI = new CourierAPIService();
