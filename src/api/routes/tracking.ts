import { Request, Response } from 'express';
import { supabaseServer as supabase } from '../../lib/supabaseServer';

export async function getTrackingHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;

    // Get order with tracking info
    const { data: order, error } = await supabase
      .from('orders')
      .select(
        `
        *,
        sub_orders (
          *,
          hubs (name, city, state),
          couriers (name, code),
          tracking_events (
            *
          )
        )
      `
      )
      .eq('woocommerce_order_id', id)
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error('Tracking error:', error);
    return res.status(404).json({
      error: 'Order not found',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function updateTrackingHandler(req: Request, res: Response) {
  try {
    const { subOrderId } = req.params;
    const { status, description, location } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Create tracking event
    const { data: event, error: eventError } = await supabase
      .from('tracking_events')
      .insert({
        sub_order_id: subOrderId,
        status,
        description,
        location_name: location,
        actor_type: 'system',
        source: 'api',
      })
      .select()
      .single();

    if (eventError) throw eventError;

    // Update sub-order status
    const { error: updateError } = await supabase
      .from('sub_orders')
      .update({ status })
      .eq('id', subOrderId);

    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      data: event,
    });
  } catch (error) {
    console.error('Update tracking error:', error);
    return res.status(500).json({
      error: 'Failed to update tracking',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
