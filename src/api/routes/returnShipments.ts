import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function generateReturnCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let code = 'RTN-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create a return request (public endpoint for PWA)
export async function createReturnRequest(req: Request, res: Response) {
  try {
    const { woo_order_id, order_id, reason, status } = req.body || {};

    if (!woo_order_id && !order_id) {
      return res.status(400).json({ success: false, error: 'woo_order_id or order_id is required' });
    }

    // Resolve JLO order id
    let jloOrderId = order_id;

    if (!jloOrderId && woo_order_id) {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, woocommerce_order_id')
        .eq('woocommerce_order_id', woo_order_id)
        .single();

      if (orderError || !order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }
      jloOrderId = order.id;
    }

    const payload = {
      order_id: jloOrderId,
      reason: reason || null,
      status: status || 'pending',
    };

    const { data, error } = await supabase
      .from('return_requests')
      .insert(payload)
      .select('id')
      .single();

    if (error || !data) {
      throw error;
    }

    return res.status(201).json({
      success: true,
      return_request_id: data.id,
    });
  } catch (error) {
    console.error('createReturnRequest error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create return request',
    });
  }
}

export async function createReturnShipment(req: Request, res: Response) {
  try {
    const { return_request_id, method, customer, hub } = req.body || {};

    if (!return_request_id || !method) {
      return res.status(400).json({ success: false, error: 'return_request_id and method are required' });
    }

    if (!['pickup', 'dropoff'].includes(method)) {
      return res.status(400).json({ success: false, error: 'method must be pickup or dropoff' });
    }

    const returnCode = generateReturnCode();
    let fezTracking: string | null = null;

    if (method === 'pickup') {
      const fezBase = (process.env.FEZ_API_BASE_URL || process.env.FEZ_API_URL || '').replace(/\/$/, '');
      const fezKey = process.env.FEZ_API_KEY || process.env.FEZ_PASSWORD || '';
      const fezUserId = process.env.FEZ_USER_ID || '';

      if (!fezBase || !fezKey) {
        return res.status(500).json({ success: false, error: 'Fez API not configured on server' });
      }

      const payload = {
        user_id: fezUserId || undefined,
        reference: return_request_id,
        sender: {
          name: hub?.name,
          phone: hub?.phone,
          address: hub?.address,
          city: hub?.city,
          state: hub?.state,
        },
        receiver: {
          name: customer?.name,
          phone: customer?.phone,
          address: customer?.address,
          city: customer?.city,
          state: customer?.state,
        },
        package: {
          items: [],
          total_weight: 1,
          declared_value: 0,
          description: `Return package ${returnCode}`,
        },
        shipping: {
          service_type: 'standard',
          amount: 0,
        },
      };

      const response = await fetch(`${fezBase}/shipment/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${fezKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          data?.message ||
          data?.error ||
          data?.description ||
          'Failed to create Fez return shipment';
        return res.status(502).json({ success: false, error: message });
      }

      fezTracking =
        data?.tracking_number ||
        data?.trackingNumber ||
        data?.waybill ||
        data?.orderNo ||
        data?.order_no ||
        data?.orderNumber ||
        data?.data?.tracking_number ||
        null;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('return_shipments')
      .insert({
        return_request_id,
        return_code: returnCode,
        method,
        status: 'pending',
        fez_tracking: fezTracking,
      })
      .select('*')
      .single();

    if (insertError) {
      console.error('Insert return_shipment error:', insertError);
      return res.status(500).json({ success: false, error: 'Failed to save return shipment' });
    }

    return res.status(200).json({
      success: true,
      return_code: returnCode,
      fez_tracking: fezTracking,
      method,
      data: inserted,
    });
  } catch (error) {
    console.error('createReturnShipment error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create return shipment',
    });
  }
}

// Get return_request_id by WooCommerce order number
export async function getReturnRequestIdByWooOrder(req: Request, res: Response) {
  try {
    const { orderNumber } = req.params;
    if (!orderNumber) {
      return res.status(400).json({ success: false, error: 'Missing WooCommerce order number' });
    }

    // Find the JLO order by WooCommerce order number
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, woocommerce_order_id')
      .eq('woocommerce_order_id', orderNumber)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Get the latest return_request for that order
    const { data: request, error: requestError } = await supabase
      .from('return_requests')
      .select('id, order_id, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (requestError || !request) {
      return res.status(404).json({ success: false, error: 'Return request not found for this order' });
    }

    return res.status(200).json({
      success: true,
      return_request_id: request.id,
    });
  } catch (error) {
    console.error('getReturnRequestIdByWooOrder error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch return request',
    });
  }
}

export async function getReturnShipmentsByOrder(req: Request, res: Response) {
  try {
    const { orderId } = req.params;

    const { data: requests, error: requestError } = await supabase
      .from('return_requests')
      .select('id')
      .eq('order_id', orderId);

    if (requestError) {
      // If table is missing, avoid breaking order detail view
      if ((requestError as any)?.message?.toLowerCase?.().includes('return_requests')) {
        console.warn('return_requests table missing, returning empty list');
        return res.status(200).json({ success: true, data: [] });
      }
      throw requestError;
    }

    const requestIds = (requests || []).map((r: { id: string }) => r.id);
    if (!requestIds.length) {
      return res.status(200).json({ success: true, data: [] });
    }

    const { data: shipments, error: shipmentError } = await supabase
      .from('return_shipments')
      .select('*')
      .in('return_request_id', requestIds)
      .order('created_at', { ascending: false });

    if (shipmentError) {
      if ((shipmentError as any)?.message?.toLowerCase?.().includes('return_shipments')) {
        console.warn('return_shipments table missing, returning empty list');
        return res.status(200).json({ success: true, data: [] });
      }
      throw shipmentError;
    }

    return res.status(200).json({ success: true, data: shipments || [] });
  } catch (error) {
    console.error('getReturnShipmentsByOrder error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch return shipments',
    });
  }
}

export async function updateReturnShipmentStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body as { status?: string };

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required' });
    }

    const { data, error } = await supabase
      .from('return_shipments')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('updateReturnShipmentStatus error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update return shipment',
    });
  }
}
