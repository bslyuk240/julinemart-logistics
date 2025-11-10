import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, supabaseKey);

/**
 * Auto-assign best courier to a sub-order based on hub preferences
 */
export async function assignCourierToSubOrder(subOrderId: string) {
  try {
    // 1. Get sub-order details
    const { data: subOrder } = await supabase
      .from('sub_orders')
      .select('hub_id, main_order_id')
      .eq('id', subOrderId)
      .single();

    if (!subOrder) {
      throw new Error('Sub-order not found');
    }

    if (!subOrder.hub_id) {
      throw new Error('Sub-order missing hub_id');
    }

    const hubId = subOrder.hub_id;

    // 2. Get the best courier for this hub
    const { data: hubCourier } = await supabase
      .from('hub_couriers')
      .select(
        `
        courier_id,
        couriers (
          id,
          name,
          code,
          is_active
        )
      `
      )
      .eq('hub_id', hubId)
      .order('is_primary', { ascending: false })
      .order('priority', { ascending: false })
      .limit(1)
      .single();

    if (!hubCourier) {
      throw new Error('No courier available for this hub');
    }

    // 3. Assign courier to sub-order
    const { data: updatedSubOrder, error } = await supabase
      .from('sub_orders')
      .update({
        courier_id: hubCourier.courier_id,
        status: 'assigned',
      })
      .eq('id', subOrderId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // 4. Create tracking event
    await supabase.from('tracking_events').insert({
      sub_order_id: subOrderId,
      status: 'assigned',
      description: `Order assigned to ${hubCourier.couriers?.name}`,
      actor_type: 'system',
      source: 'auto_assignment',
    });

    return updatedSubOrder;
  } catch (error) {
    console.error('Error assigning courier:', error);
    throw error;
  }
}

/**
 * Get available couriers for a hub
 */
export async function getAvailableCouriers(hubId: string) {
  const { data, error } = await supabase
    .from('hub_couriers')
    .select(
      `
      *,
      couriers (
        id,
        name,
        code,
        type,
        is_active,
        base_rate
      )
    `
    )
    .eq('hub_id', hubId)
    .order('priority', { ascending: false });

  if (error) throw error;
  return data;
}
