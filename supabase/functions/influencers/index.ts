import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
    // Supabase request path is e.g. /functions/v1/influencers/validate-c — not /influencers/...
    const pathname = url.pathname
    const infIdx = pathname.indexOf('/influencers')
    let path = infIdx >= 0 ? pathname.slice(infIdx + '/influencers'.length) : pathname
    if (path === '/' || !path) path = ''
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

    // POST /influencers/:id/pay - Process commission payment for an influencer
    if (method === 'POST' && path.match(/^\/[^/]+\/pay$/)) {
      const id = path.split('/')[1]
      const body = await req.json()
      const { payment_method = 'bank_transfer', payment_reference, notes } = body

      // Get influencer and their pending sales
      const { data: influencer, error: infErr } = await supabaseClient
        .from('influencers')
        .select('id, name, total_commission_earned, total_commission_paid')
        .eq('id', id)
        .single()

      if (infErr || !influencer) {
        return new Response(
          JSON.stringify({ success: false, error: 'Influencer not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { data: pendingSales, error: salesErr } = await supabaseClient
        .from('influencer_sales')
        .select('id, influencer_commission_amount, sale_date')
        .eq('influencer_id', id)
        .eq('commission_status', 'pending')

      if (salesErr) throw salesErr

      if (!pendingSales || pendingSales.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'No pending commission to pay' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const totalCommission = pendingSales.reduce(
        (sum: number, s: any) => sum + parseFloat(s.influencer_commission_amount || 0), 0
      )

      const sortedDates = pendingSales
        .map((s: any) => s.sale_date)
        .filter(Boolean)
        .sort()
      const periodStart = sortedDates[0]?.split('T')[0] ?? new Date().toISOString().split('T')[0]
      const periodEnd = sortedDates[sortedDates.length - 1]?.split('T')[0] ?? periodStart

      const now = new Date().toISOString()
      const ref = payment_reference?.trim() ||
        `PAY-${id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`

      // Create payment batch
      const { data: batch, error: batchErr } = await supabaseClient
        .from('influencer_payment_batches')
        .insert({
          period_start: periodStart,
          period_end: periodEnd,
          total_influencers: 1,
          total_orders: pendingSales.length,
          total_commission: totalCommission,
          payment_method,
          payment_status: 'completed',
          payment_reference: ref,
          notes: notes || null,
          processed_at: now,
        })
        .select()
        .single()

      if (batchErr) throw batchErr

      // Mark all pending sales as paid
      const saleIds = pendingSales.map((s: any) => s.id)
      const { error: updateSalesErr } = await supabaseClient
        .from('influencer_sales')
        .update({
          commission_status: 'paid',
          payment_date: now,
          payment_reference: ref,
          payment_batch_id: batch.id,
          updated_at: now,
        })
        .in('id', saleIds)

      if (updateSalesErr) throw updateSalesErr

      // Update influencer total_commission_paid
      const newPaid = parseFloat(influencer.total_commission_paid || 0) + totalCommission
      const { error: updateInfErr } = await supabaseClient
        .from('influencers')
        .update({ total_commission_paid: newPaid })
        .eq('id', id)

      if (updateInfErr) throw updateInfErr

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            batch_id: batch.id,
            payment_reference: ref,
            total_commission: totalCommission,
            sales_paid: saleIds.length,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

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

      console.log('📊 Database result:', { found: !!influencer, error })

      if (error || !influencer) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid coupon code' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check minimum order value - HANDLE STRING VALUES
      const minOrderValue = parseFloat(influencer.minimum_order_value || '0')
      if (cart_total < minOrderValue) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Minimum order of NGN ${minOrderValue.toLocaleString()} required` 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Calculate shipping discount - HANDLE STRING VALUES
      let shippingDiscount = 0
      const discountType = influencer.shipping_discount_type || 'percentage'
      const discountValue = parseFloat(influencer.shipping_discount_value || '0')

      console.log('💰 Calculating:', { discountType, discountValue, shipping_cost })

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

      console.log('✅ Final discount:', shippingDiscount)

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            influencer_id: influencer.id,
            influencer_name: influencer.name,
            shipping_discount: shippingDiscount,
            message: `You saved NGN ${shippingDiscount.toLocaleString()} on shipping!`,
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
