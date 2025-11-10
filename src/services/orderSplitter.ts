import { createClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types/supabase';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, supabaseKey);

export interface OrderItem {
  productId: string;
  productName: string;
  productSku?: string;
  quantity: number;
  unitPrice: number;
  vendorId: string;
  hubId: string;
}

export interface MainOrder {
  woocommerceOrderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryState: string;
  deliveryZone: string;
  subtotal: number;
  totalAmount: number;
  shippingFeePaid: number;
  items: OrderItem[];
}

export interface SubOrder {
  hubId: string;
  vendorId: string;
  items: OrderItem[];
  subtotal: number;
}

/**
 * Split a main order into sub-orders based on hubs/vendors
 */
export async function splitOrder(mainOrder: MainOrder): Promise<SubOrder[]> {
  const subOrdersMap = new Map<string, SubOrder>();

  for (const item of mainOrder.items) {
    // Create unique key for hub + vendor combination
    const key = `${item.hubId}-${item.vendorId}`;

    if (!subOrdersMap.has(key)) {
      subOrdersMap.set(key, {
        hubId: item.hubId,
        vendorId: item.vendorId,
        items: [],
        subtotal: 0,
      });
    }

    const subOrder = subOrdersMap.get(key)!;
    subOrder.items.push(item);
    subOrder.subtotal += item.unitPrice * item.quantity;
  }

  return Array.from(subOrdersMap.values());
}

/**
 * Create main order and sub-orders in database
 */
export async function createOrderWithSubOrders(mainOrder: MainOrder) {
  try {
    // 1. Get zone ID
    const { data: zone } = await supabase
      .from('zones')
      .select('id')
      .contains('states', [mainOrder.deliveryState])
      .single();

    if (!zone) {
      throw new Error(`Zone not found for state: ${mainOrder.deliveryState}`);
    }

    // 2. Create main order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        woocommerce_order_id: mainOrder.woocommerceOrderId,
        customer_name: mainOrder.customerName,
        customer_email: mainOrder.customerEmail,
        customer_phone: mainOrder.customerPhone,
        delivery_address: mainOrder.deliveryAddress,
        delivery_city: mainOrder.deliveryCity,
        delivery_state: mainOrder.deliveryState,
        delivery_zone: zone.id,
        subtotal: mainOrder.subtotal,
        total_amount: mainOrder.totalAmount,
        shipping_fee_paid: mainOrder.shippingFeePaid,
        payment_status: 'paid',
        overall_status: 'processing',
      })
      .select()
      .single();

    if (orderError || !order) {
      throw new Error('Failed to create main order');
    }

    // 3. Split order into sub-orders
    const subOrders = await splitOrder(mainOrder);

    // 4. Calculate shipping allocation per sub-order
    const totalSubOrders = subOrders.length;
    const shippingPerSubOrder =
      mainOrder.shippingFeePaid / totalSubOrders;

    // 5. Create sub-orders
    const subOrderPromises = subOrders.map(async (subOrder) => {
      const { data: subOrderData, error: subOrderError } = await supabase
        .from('sub_orders')
        .insert({
          main_order_id: order.id,
          hub_id: subOrder.hubId,
          vendor_id: subOrder.vendorId,
          // Store items as JSON to satisfy generated Supabase types
          items: (subOrder.items as unknown) as Json,
          subtotal: subOrder.subtotal,
          allocated_shipping_fee: shippingPerSubOrder,
          status: 'pending',
        })
        .select()
        .single();

      if (subOrderError) {
        throw new Error('Failed to create sub-order');
      }

      // 6. Create order items
      const orderItemsPromises = subOrder.items.map((item) =>
        supabase.from('order_items').insert({
          order_id: order.id,
          sub_order_id: subOrderData.id,
          product_id: item.productId,
          product_name: item.productName,
          product_sku: item.productSku,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          subtotal: item.unitPrice * item.quantity,
          vendor_id: item.vendorId,
          hub_id: item.hubId,
        })
      );

      await Promise.all(orderItemsPromises);

      return subOrderData;
    });

    const createdSubOrders = await Promise.all(subOrderPromises);

    return {
      order,
      subOrders: createdSubOrders,
    };
  } catch (error) {
    console.error('Error creating order:', error);
    throw error;
  }
}
