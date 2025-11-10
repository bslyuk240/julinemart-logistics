import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Get all orders
export async function getOrdersHandler(req: Request, res: Response) {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const { data: orders, error, count } = await supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: orders || [],
      pagination: {
        total: count,
        limit: Number(limit),
        offset: Number(offset)
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    return res.status(500).json({
      error: 'Failed to fetch orders',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get order by ID with sub-orders
export async function getOrderByIdHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        sub_orders(
          *,
          hubs(id, name, city),
          couriers(id, name, code),
          tracking_events(*)
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Get order error:', error);
    return res.status(500).json({
      error: 'Failed to fetch order',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Create order with automatic hub splitting
export async function createOrderHandler(req: Request, res: Response) {
  try {
    const orderData = req.body;

    // Step 1: Create main order (only columns that exist in schema)
    const orderInsert = {
      woocommerce_order_id: orderData.woocommerce_order_id,
      customer_name: orderData.customer_name,
      customer_email: orderData.customer_email,
      customer_phone: orderData.customer_phone,
      delivery_address: orderData.delivery_address,
      delivery_city: orderData.delivery_city,
      delivery_state: orderData.delivery_state,
      delivery_zone: orderData.delivery_zone,
      subtotal: orderData.subtotal,
      total_amount: orderData.total_amount,
      shipping_fee_paid: orderData.shipping_fee_paid,
      payment_status: orderData.payment_status || 'pending',
      overall_status: orderData.overall_status || 'pending'
    } as any;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([orderInsert])
      .select()
      .single();

    if (orderError) throw orderError;

    // Step 2: Create sub-orders based on shipping breakdown
    if (orderData.shipping_breakdown && Array.isArray(orderData.shipping_breakdown)) {
      const subOrdersData = orderData.shipping_breakdown.map((breakdown: any) => ({
        main_order_id: order.id,
        hub_id: breakdown.hubId,
        courier_id: breakdown.courierId,
        status: 'pending',
        tracking_number: `${(breakdown.courierName || 'CR').substring(0, 3).toUpperCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        // Schema requires items JSONB and subtotal
        items: breakdown.items || [],
        subtotal: 0,
        // Store shipping cost in real_shipping_cost (schema column)
        real_shipping_cost: breakdown.totalShippingFee || 0,
        allocated_shipping_fee: breakdown.totalShippingFee || 0,
      }));

      const { data: subOrders, error: subOrdersError } = await supabase
        .from('sub_orders')
        .insert(subOrdersData)
        .select();

      if (subOrdersError) {
        console.error('Sub-orders creation error:', subOrdersError);
      }

      // Step 3: Create initial tracking events
      if (subOrders) {
        const trackingEvents = subOrders.map(subOrder => ({
          sub_order_id: subOrder.id,
          status: 'pending',
          description: 'Order received and awaiting processing',
          location_name: 'Processing Center',
          event_time: new Date().toISOString()
        }));

        await supabase
          .from('tracking_events')
          .insert(trackingEvents);
      }
    }

    return res.status(201).json({
      success: true,
      data: order,
      message: 'Order created successfully with automatic hub splitting'
    });
  } catch (error) {
    console.error('Create order error:', error);
    return res.status(500).json({
      error: 'Failed to create order',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Update order status
export async function updateOrderStatusHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data: order, error } = await supabase
      .from('orders')
      .update({ overall_status: status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({
      error: 'Failed to update order status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
