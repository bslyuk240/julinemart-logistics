import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// GET /api/influencers - List all influencers
export async function getInfluencersHandler(req: Request, res: Response) {
  try {
    const { status = 'active' } = req.query;
    
    const { data, error } = await supabase
      .from('influencers')
      .select('*')
      .eq('status', status)
      .order('total_sales', { ascending: false });
    
    if (error) throw error;
    
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Error fetching influencers:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch influencers' 
    });
  }
}

// GET /api/influencers/:id - Get single influencer
export async function getInfluencerByIdHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('influencers')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, data });
    
  } catch (error) {
    res.status(404).json({ 
      success: false, 
      error: 'Influencer not found' 
    });
  }
}

// POST /api/influencers - Create new influencer
export async function createInfluencerHandler(req: Request, res: Response) {
  try {
    const {
      name,
      email,
      phone,
      platform,
      handle,
      coupon_code,
      shipping_discount_type = 'percentage',
      shipping_discount_value = 50,
      minimum_order_value = 0,
      commission_rate = 5,
      tier = 'TIER1'
    } = req.body;
    
    // Validate required fields
    if (!name || !coupon_code) {
      return res.status(400).json({
        success: false,
        error: 'Name and coupon code are required'
      });
    }
    
    // Check if coupon code already exists
    const { data: existing } = await supabase
      .from('influencers')
      .select('id')
      .eq('coupon_code', coupon_code.toUpperCase())
      .single();
    
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Coupon code already exists'
      });
    }
    
    // Create influencer
    const { data, error } = await supabase
      .from('influencers')
      .insert({
        name,
        email,
        phone,
        platform,
        handle,
        coupon_code: coupon_code.toUpperCase(),
        shipping_discount_type,
        shipping_discount_value,
        minimum_order_value,
        commission_rate,
        tier,
        status: 'active'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Error creating influencer:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create influencer' 
    });
  }
}

// PUT /api/influencers/:id - Update influencer
export async function updateInfluencerHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('influencers')
      .update({
        ...req.body,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, data });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update influencer' 
    });
  }
}

// DELETE /api/influencers/:id - Soft delete influencer
export async function deleteInfluencerHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('influencers')
      .update({ 
        status: 'terminated', 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, data });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete influencer' 
    });
  }
}

// GET /api/influencers/:id/sales - Get influencer's sales
export async function getInfluencerSalesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { period = 'this_month' } = req.query;
    
    let query = supabase
      .from('influencer_sales')
      .select('*')
      .eq('influencer_id', id)
      .order('sale_date', { ascending: false });
    
    // Apply date filters
    const now = new Date();
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    
    switch (period) {
      case 'this_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last_month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'last_3_months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        break;
      // 'all_time' - no filter
    }
    
    if (startDate) {
      query = query.gte('sale_date', startDate.toISOString());
    }
    if (endDate) {
      query = query.lte('sale_date', endDate.toISOString());
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    res.json({ success: true, data });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch sales' 
    });
  }
}

// POST /api/influencers/validate-coupon - Validate coupon and calculate discount
export async function validateInfluencerCouponHandler(req: Request, res: Response) {
  try {
    const { coupon_code, cart_total, shipping_cost } = req.body;
    
    if (!coupon_code) {
      return res.status(400).json({
        success: false,
        error: 'Coupon code is required'
      });
    }
    
    // Find active influencer
    const { data: influencer, error } = await supabase
      .from('influencers')
      .select('*')
      .eq('coupon_code', coupon_code.toUpperCase())
      .eq('status', 'active')
      .single();
    
    if (error || !influencer) {
      return res.status(404).json({
        success: false,
        error: 'Invalid coupon code'
      });
    }
    
    // Check minimum order value
    if (influencer.minimum_order_value > 0 && cart_total < influencer.minimum_order_value) {
      return res.status(400).json({
        success: false,
        error: `Minimum order value of ₦${influencer.minimum_order_value.toLocaleString()} required`
      });
    }
    
    // Calculate shipping discount
    let shipping_discount = 0;
    let final_shipping_cost = shipping_cost;
    
    switch (influencer.shipping_discount_type) {
      case 'percentage':
        shipping_discount = shipping_cost * (influencer.shipping_discount_value / 100);
        final_shipping_cost = shipping_cost - shipping_discount;
        break;
        
      case 'fixed':
        shipping_discount = Math.min(influencer.shipping_discount_value, shipping_cost);
        final_shipping_cost = shipping_cost - shipping_discount;
        break;
        
      case 'free':
        shipping_discount = shipping_cost;
        final_shipping_cost = 0;
        break;
    }
    
    // Calculate influencer commission
    const commission_base = influencer.commission_based_on === 'product_total' 
      ? cart_total 
      : cart_total + final_shipping_cost;
    const influencer_commission = commission_base * (influencer.commission_rate / 100);
    
    res.json({
      success: true,
      data: {
        influencer_id: influencer.id,
        influencer_name: influencer.name,
        coupon_code: influencer.coupon_code,
        
        // Shipping breakdown
        original_shipping: shipping_cost,
        shipping_discount,
        final_shipping_cost,
        
        // Totals
        cart_total,
        order_total: cart_total + final_shipping_cost,
        
        // Commission (internal)
        commission_rate: influencer.commission_rate,
        commission_amount: influencer_commission,
        
        // Message
        message: shipping_discount > 0
          ? `You saved ₦${shipping_discount.toLocaleString()} on shipping with ${influencer.name}'s code!`
          : 'Coupon applied successfully'
      }
    });
    
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to validate coupon' 
    });
  }
}

// POST /api/influencers/record-sale - Record a sale
export async function recordInfluencerSaleHandler(req: Request, res: Response) {
  try {
    const data = req.body;
    
    // Validate required fields
    if (!data.influencer_id || !data.wc_order_id || !data.product_total) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    // Check if already recorded
    const { data: existing } = await supabase
      .from('influencer_sales')
      .select('id')
      .eq('wc_order_id', data.wc_order_id)
      .single();
    
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Sale already recorded'
      });
    }
    
    // Record sale
    const { data: sale, error } = await supabase
      .from('influencer_sales')
      .insert({
        influencer_id: data.influencer_id,
        wc_order_id: data.wc_order_id,
        order_number: data.order_number,
        customer_email: data.customer_email,
        
        product_total: data.product_total,
        
        shipping_original_cost: data.shipping_original_cost,
        shipping_discount_amount: data.shipping_discount_amount,
        shipping_customer_paid: data.shipping_customer_paid,
        shipping_actual_cost: data.shipping_actual_cost,
        
        admin_commission: data.product_total * 0.05,
        vendor_amount: data.product_total * 0.95,
        influencer_commission_rate: data.commission_rate,
        influencer_commission_amount: data.commission_amount,
        
        sale_date: data.sale_date || new Date().toISOString(),
        order_status: 'completed',
        commission_status: 'pending'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, data: sale });
    
  } catch (error) {
    console.error('Error recording sale:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to record sale' 
    });
  }
}

// NEW: Process influencer order from WooCommerce webhook
export async function processInfluencerOrderFromWebhook(orderData: any) {
  try {
    console.log('🔍 Checking order for influencer coupons:', orderData.id);
    
    // Check if order has coupon codes
    const couponLines = orderData.coupon_lines || [];
    
    if (couponLines.length === 0) {
      console.log('  ℹ️  No coupons used in this order');
      return null;
    }
    
    // Check each coupon to see if it's an influencer code
    for (const couponLine of couponLines) {
      const couponCode = couponLine.code?.toUpperCase();
      
      if (!couponCode) continue;
      
      console.log(`  🔎 Checking coupon: ${couponCode}`);
      
      // Find influencer by coupon code
      const { data: influencer, error: influencerError } = await supabase
        .from('influencers')
        .select('*')
        .eq('coupon_code', couponCode)
        .eq('status', 'active')
        .single();
      
      if (influencerError || !influencer) {
        console.log(`  ℹ️  ${couponCode} is not an influencer coupon`);
        continue;
      }
      
      console.log(`  ✅ Influencer coupon detected: ${couponCode} (${influencer.name})`);
      
      // Check if already recorded
      const { data: existing } = await supabase
        .from('influencer_sales')
        .select('id')
        .eq('wc_order_id', orderData.id.toString())
        .single();
      
      if (existing) {
        console.log('  ⚠️  Sale already recorded, skipping');
        continue;
      }
      
      // Calculate values
      const orderTotal = parseFloat(orderData.total || 0);
      const shippingTotal = parseFloat(orderData.shipping_total || 0);
      const productTotal = orderTotal - shippingTotal;
      
      // Calculate shipping discount (from coupon)
      const couponDiscount = parseFloat(couponLine.discount || 0);
      const shippingOriginalCost = shippingTotal + couponDiscount;
      const shippingDiscountAmount = couponDiscount;
      const shippingCustomerPaid = shippingTotal;
      
      // Estimate actual shipping cost
      // You should replace this with actual calculation from your shipping rates
      const shippingActualCost = shippingTotal > 0 ? shippingTotal : 1500;
      
      // Calculate commission
      const commissionRate = influencer.commission_rate || 5;
      const commissionBase = influencer.commission_based_on === 'order_total' 
        ? orderTotal
        : productTotal;
      const commissionAmount = commissionBase * (commissionRate / 100);
      
      console.log(`  💰 Recording sale:
    Product Total: ₦${productTotal}
    Shipping Original: ₦${shippingOriginalCost}
    Shipping Discount: ₦${shippingDiscountAmount}
    Shipping Paid: ₦${shippingCustomerPaid}
    Commission: ₦${commissionAmount} (${commissionRate}% of ₦${commissionBase})`);
      
      // Record the sale
      const { data: sale, error: saleError } = await supabase
        .from('influencer_sales')
        .insert({
          influencer_id: influencer.id,
          wc_order_id: orderData.id.toString(),
          order_number: orderData.number || orderData.id.toString(),
          customer_email: orderData.billing?.email || '',
          
          product_total: productTotal,
          
          shipping_original_cost: shippingOriginalCost,
          shipping_discount_amount: shippingDiscountAmount,
          shipping_customer_paid: shippingCustomerPaid,
          shipping_actual_cost: shippingActualCost,
          
          admin_commission: productTotal * 0.05,
          vendor_amount: productTotal * 0.95,
          influencer_commission_rate: commissionRate,
          influencer_commission_amount: commissionAmount,
          
          sale_date: orderData.date_created || new Date().toISOString(),
          order_status: 'completed',
          commission_status: 'pending'
        })
        .select()
        .single();
      
      if (saleError) {
        console.error('  ❌ Failed to record sale:', saleError.message);
        throw saleError;
      }
      
      console.log(`  ✅ Sale recorded successfully: ${sale.id}`);
      
      return {
        success: true,
        influencer: influencer.name,
        sale_id: sale.id,
        commission: commissionAmount
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Error processing influencer order:', error);
    throw error;
  }
}