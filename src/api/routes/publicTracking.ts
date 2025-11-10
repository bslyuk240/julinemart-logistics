import { Response, Request } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Public order tracking - no authentication required
export async function trackOrderPublicHandler(req: Request, res: Response) {
  try {
    const { orderNumber, email } = req.query;

    if (!orderNumber || !email) {
      return res.status(400).json({
        success: false,
        error: 'Order number and email are required',
      });
    }

    // Find order by order number and customer email (security check)
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        id,
        woocommerce_order_id,
        customer_name,
        customer_email,
        customer_phone,
        delivery_address,
        delivery_city,
        delivery_state,
        total_amount,
        shipping_fee_paid,
        overall_status,
        created_at,
        sub_orders (
          id,
          tracking_number,
          status,
          shipping_cost,
          estimated_delivery_date,
          courier_tracking_url,
          created_at,
          hubs (
            name,
            city,
            state
          ),
          couriers (
            name,
            code
          ),
          tracking_events (
            status,
            location,
            description,
            timestamp,
            created_at
          )
        )
      `)
      .eq('woocommerce_order_id', orderNumber)
      .eq('customer_email', String(email).toLowerCase())
      .single();

    if (error || !order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found. Please check your order number and email address.',
      });
    }

    // Sort tracking events by timestamp (newest first)
    if (order.sub_orders) {
      order.sub_orders = order.sub_orders.map((subOrder: any) => ({
        ...subOrder,
        tracking_events: (subOrder.tracking_events || []).sort(
          (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        ),
      }));
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error('Track order error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve order information',
    });
  }
}

// Get shipping estimate (public)
export async function getShippingEstimatePublicHandler(req: Request, res: Response) {
  try {
    const { state, city, items } = req.body;

    if (!state || !items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: 'State and items are required',
      });
    }

    // Calculate shipping (reuse existing logic)
    // This would call your existing shipping calculation
    const response = await fetch('/api/calc-shipping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryState: state,
        deliveryCity: city,
        items: items,
        totalOrderValue: items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0),
      }),
    });

    const data = await response.json();

    return res.status(200).json(data);
  } catch (error) {
    console.error('Shipping estimate error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to calculate shipping estimate',
    });
  }
}
