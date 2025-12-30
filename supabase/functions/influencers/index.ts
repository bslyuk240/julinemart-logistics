import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const url = new URL(req.url)
    const path = url.pathname.replace('/influencers', '')
    const method = req.method

    // GET /influencers - List all influencers
    if (method === 'GET' && !path) {
      const status = url.searchParams.get('status') || 'active'
      
      const { data, error } = await supabaseClient
        .from('influencers')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false })

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // POST /influencers - Create new influencer
    if (method === 'POST' && !path) {
      const body = await req.json()

      // Validate required fields
      if (!body.name || !body.coupon_code) {
        return new Response(
          JSON.stringify({ success: false, error: 'Name and coupon code are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check if coupon code already exists
      const { data: existing } = await supabaseClient
        .from('influencers')
        .select('id')
        .eq('coupon_code', body.coupon_code.toUpperCase())
        .single()

      if (existing) {
        return new Response(
          JSON.stringify({ success: false, error: 'Coupon code already exists' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Create influencer
      const { data, error } = await supabaseClient
        .from('influencers')
        .insert([{
          name: body.name,
          email: body.email || null,
          phone: body.phone || null,
          coupon_code: body.coupon_code.toUpperCase(),
          shipping_discount_type: body.shipping_discount_type || 'percentage',
          shipping_discount_value: body.shipping_discount_value || 0,
          commission_rate: body.commission_rate || 5,
          commission_based_on: body.commission_based_on || 'product_total',
          platform: body.platform || null,
          handle: body.handle || null,
          minimum_order_value: body.minimum_order_value || 0,
          tier: body.tier || 'TIER1',
          status: 'active',
        }])
        .select()
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 }
      )
    }

    // GET /influencers/:id - Get single influencer
    if (method === 'GET' && path.match(/^\/[^/]+$/)) {
      const id = path.substring(1)

      const { data, error } = await supabaseClient
        .from('influencers')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // PUT /influencers/:id - Update influencer
    if (method === 'PUT' && path.match(/^\/[^/]+$/)) {
      const id = path.substring(1)
      const body = await req.json()

      // Check if coupon code is being changed and already exists
      if (body.coupon_code) {
        const { data: existing } = await supabaseClient
          .from('influencers')
          .select('id')
          .eq('coupon_code', body.coupon_code.toUpperCase())
          .neq('id', id)
          .single()

        if (existing) {
          return new Response(
            JSON.stringify({ success: false, error: 'Coupon code already exists' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      const updateData: any = {}
      if (body.name !== undefined) updateData.name = body.name
      if (body.email !== undefined) updateData.email = body.email
      if (body.phone !== undefined) updateData.phone = body.phone
      if (body.coupon_code !== undefined) updateData.coupon_code = body.coupon_code.toUpperCase()
      if (body.shipping_discount_type !== undefined) updateData.shipping_discount_type = body.shipping_discount_type
      if (body.shipping_discount_value !== undefined) updateData.shipping_discount_value = body.shipping_discount_value
      if (body.commission_rate !== undefined) updateData.commission_rate = body.commission_rate
      if (body.commission_based_on !== undefined) updateData.commission_based_on = body.commission_based_on
      if (body.platform !== undefined) updateData.platform = body.platform
      if (body.handle !== undefined) updateData.handle = body.handle
      if (body.minimum_order_value !== undefined) updateData.minimum_order_value = body.minimum_order_value
      if (body.tier !== undefined) updateData.tier = body.tier
      if (body.status !== undefined) updateData.status = body.status

      const { data, error } = await supabaseClient
        .from('influencers')
        .update(updateData)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // DELETE /influencers/:id - Soft delete influencer
    if (method === 'DELETE' && path.match(/^\/[^/]+$/)) {
      const id = path.substring(1)

      const { data, error } = await supabaseClient
        .from('influencers')
        .update({ status: 'terminated' })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // GET /influencers/:id/sales - Get influencer sales
    if (method === 'GET' && path.match(/^\/[^/]+\/sales$/)) {
      const id = path.split('/')[1]
      const startDate = url.searchParams.get('start_date')
      const endDate = url.searchParams.get('end_date')

      let query = supabaseClient
        .from('influencer_sales')
        .select('*')
        .eq('influencer_id', id)
        .order('sale_date', { ascending: false })

      if (startDate) {
        query = query.gte('sale_date', startDate)
      }
      if (endDate) {
        query = query.lte('sale_date', endDate)
      }

      const { data, error } = await query

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // POST /influencers/validate-coupon - Validate coupon code
    if (method === 'POST' && path === '/validate-coupon') {
      const body = await req.json()
      const { coupon_code, cart_total, shipping_cost } = body

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

      if (error || !influencer) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid coupon code' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check minimum order value
      if (cart_total < influencer.minimum_order_value) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Minimum order of NGN ${influencer.minimum_order_value.toLocaleString()} required` 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Calculate shipping discount
      let shippingDiscount = 0
      if (influencer.shipping_discount_type === 'percentage') {
        shippingDiscount = (shipping_cost * influencer.shipping_discount_value) / 100
      } else if (influencer.shipping_discount_type === 'fixed') {
        shippingDiscount = influencer.shipping_discount_value
      }

      // Cap discount at shipping cost
      shippingDiscount = Math.min(shippingDiscount, shipping_cost)

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            influencer_id: influencer.id,
            influencer_name: influencer.name,
            shipping_discount: Math.round(shippingDiscount),
            message: `You saved NGN ${Math.round(shippingDiscount).toLocaleString()} on shipping!`,
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
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

