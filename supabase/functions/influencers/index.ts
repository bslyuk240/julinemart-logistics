import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const url = new URL(req.url)
    const path = url.pathname.replace('/influencers', '')
    const method = req.method

    // POST /influencers/validate-coupon - Validate coupon code
    if (method === 'POST' && path === '/validate-coupon') {
      const body = await req.json()
      const { coupon_code, cart_total, shipping_cost } = body

      console.log('🔍 Validating coupon:', { coupon_code, cart_total, shipping_cost })

      if (!coupon_code) {
        return new Response(
          JSON.stringify({ success: false, error: 'Coupon code is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Find influencer with this coupon code
      const { data: influencer, error } = await supabaseClient
        .from('influencers')
        .select('*')
        .eq('coupon_code', coupon_code.toUpperCase())
        .eq('status', 'active')
        .single()

      console.log('📊 Database result:', { influencer, error })

      if (error || !influencer) {
        console.error('❌ Coupon not found:', error)
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid coupon code' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check minimum order value - convert string to number
      const minOrderValue = parseFloat(influencer.minimum_order_value || '0')
      if (cart_total < minOrderValue) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Minimum order of ₦${minOrderValue.toLocaleString()} required` 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Calculate shipping discount - handle string values
      let shippingDiscount = 0
      const discountType = influencer.shipping_discount_type || 'percentage'
      const discountValue = parseFloat(influencer.shipping_discount_value || '0')

      console.log('💰 Calculating discount:', { discountType, discountValue, shipping_cost })

      if (discountType === 'percentage') {
        shippingDiscount = (shipping_cost * discountValue) / 100
      } else if (discountType === 'fixed') {
        shippingDiscount = discountValue
      } else if (discountType === 'free') {
        shippingDiscount = shipping_cost
      }

      // Cap discount at shipping cost
      shippingDiscount = Math.min(shippingDiscount, shipping_cost)
      shippingDiscount = Math.round(shippingDiscount)

      console.log('✅ Discount calculated:', shippingDiscount)

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            influencer_id: influencer.id,
            influencer_name: influencer.name,
            shipping_discount: shippingDiscount,
            message: `You saved ₦${shippingDiscount.toLocaleString()} on shipping!`,
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Route not found
    return new Response(
      JSON.stringify({ success: false, error: 'Route not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Function error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})