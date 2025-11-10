import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { courierAPI } from '../services/courierAPI.js';
import type { AuthRequest } from '../middleware/auth.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Create shipment on courier platform
export async function createCourierShipmentHandler(req: AuthRequest, res: Response) {
  try {
    const { subOrderId } = req.body;

    // Get sub-order details
    const { data: subOrder, error: subOrderError } = await supabase
      .from('sub_orders')
      .select(`
        *,
        parent_order:orders(*),
        hub:hubs(*),
        courier:couriers(*)
      `)
      .eq('id', subOrderId)
      .single();

    if (subOrderError || !subOrder) {
      return res.status(404).json({
        success: false,
        error: 'Sub-order not found',
      });
    }

    const order = subOrder.parent_order;
    const hub = subOrder.hub;

    // Prepare shipment data
    const shipmentData = {
      pickup_address: hub.address,
      pickup_city: hub.city,
      pickup_state: hub.state,
      pickup_contact_name: hub.contact_person || hub.name,
      pickup_contact_phone: hub.contact_phone || '',
      delivery_address: order.delivery_address,
      delivery_city: order.delivery_city,
      delivery_state: order.delivery_state,
      delivery_contact_name: order.customer_name,
      delivery_contact_phone: order.customer_phone,
      package_weight: 2.0, // You can calculate this from items
      package_description: `Order #${order.woocommerce_order_id}`,
      declared_value: order.total_amount,
      order_reference: order.woocommerce_order_id,
    };

    // Create shipment via courier API
    const result = await courierAPI.createShipment(subOrder.courier_id, shipmentData);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    // Update sub-order with courier details
    await supabase
      .from('sub_orders')
      .update({
        tracking_number: result.tracking_number,
        courier_shipment_id: result.shipment_id,
        courier_tracking_url: result.tracking_number 
          ? `https://track.fezdispatch.com/${result.tracking_number}` 
          : null,
        label_url: result.label_url,
        waybill_url: result.waybill_url,
        estimated_delivery_date: result.estimated_delivery_date,
        status: 'in_transit',
      })
      .eq('id', subOrderId);

    return res.status(200).json({
      success: true,
      data: {
        tracking_number: result.tracking_number,
        shipment_id: result.shipment_id,
        label_url: result.label_url,
        waybill_url: result.waybill_url,
      },
      message: 'Shipment created successfully on courier platform',
    });
  } catch (error) {
    console.error('Create shipment error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create shipment',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get live tracking from courier
export async function getCourierTrackingHandler(req: AuthRequest, res: Response) {
  try {
    const { subOrderId } = req.params;

    const { data: subOrder, error } = await supabase
      .from('sub_orders')
      .select('*, courier:couriers(*)')
      .eq('id', subOrderId)
      .single();

    if (error || !subOrder) {
      return res.status(404).json({
        success: false,
        error: 'Sub-order not found',
      });
    }

    if (!subOrder.tracking_number) {
      return res.status(400).json({
        success: false,
        error: 'No tracking number available',
      });
    }

    // Get live tracking from courier API
    const tracking = await courierAPI.getTracking(
      subOrder.courier_id,
      subOrder.tracking_number
    );

    if (!tracking.success) {
      return res.status(400).json({
        success: false,
        error: tracking.error,
      });
    }

    // Update last tracking sync time
    await supabase
      .from('sub_orders')
      .update({ last_tracking_update: new Date().toISOString() })
      .eq('id', subOrderId);

    return res.status(200).json({
      success: true,
      data: tracking,
    });
  } catch (error) {
    console.error('Get tracking error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch tracking information',
    });
  }
}

// Generate shipping label
export async function generateLabelHandler(req: AuthRequest, res: Response) {
  try {
    const { subOrderId } = req.params;

    const { data: subOrder, error } = await supabase
      .from('sub_orders')
      .select('*')
      .eq('id', subOrderId)
      .single();

    if (error || !subOrder) {
      return res.status(404).json({
        success: false,
        error: 'Sub-order not found',
      });
    }

    if (!subOrder.courier_shipment_id) {
      return res.status(400).json({
        success: false,
        error: 'Shipment not created on courier platform yet',
      });
    }

    const result = await courierAPI.generateLabel(
      subOrder.courier_id,
      subOrder.courier_shipment_id
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    // Update sub-order with label URL
    await supabase
      .from('sub_orders')
      .update({ label_url: result.label_url })
      .eq('id', subOrderId);

    return res.status(200).json({
      success: true,
      data: {
        label_url: result.label_url,
      },
    });
  } catch (error) {
    console.error('Generate label error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate label',
    });
  }
}

// Update courier API credentials (admin only)
export async function updateCourierCredentialsHandler(req: AuthRequest, res: Response) {
  try {
    const { courierId } = req.params;
    const { api_key, api_secret, api_enabled } = req.body;

    const updateData: any = {};
    
    if (api_key !== undefined) updateData.api_key_encrypted = api_key;
    if (api_secret !== undefined) updateData.api_secret_encrypted = api_secret;
    if (api_enabled !== undefined) updateData.api_enabled = api_enabled;

    const { error } = await supabase
      .from('couriers')
      .update(updateData)
      .eq('id', courierId);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: 'Courier API credentials updated successfully',
    });
  } catch (error) {
    console.error('Update credentials error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update credentials',
    });
  }
}

// Get API logs for debugging
export async function getCourierAPILogsHandler(req: AuthRequest, res: Response) {
  try {
    const { courierId } = req.query;
    const { limit = 50 } = req.query;

    let query = supabase
      .from('courier_api_logs')
      .select('*, courier:couriers(name, code)')
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (courierId) {
      query = query.eq('courier_id', courierId);
    }

    const { data: logs, error } = await query;

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: logs || [],
    });
  } catch (error) {
    console.error('Get API logs error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch API logs',
    });
  }
}
