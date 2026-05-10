/**
 * vendor-waitlist.js — PUBLIC endpoint
 * Captures vendor waitlist signups for cities not yet approved.
 * Sends a confirmation email to the applicant.
 *
 * POST /.netlify/functions/vendor-waitlist
 *
 * Body:
 *   {
 *     full_name, email, phone,
 *     state, city, lga,
 *     vendor_category,      // optional: fashion, electronics, food, etc.
 *     est_monthly_orders    // optional: self-reported monthly order volume
 *   }
 */
import { createClient } from '@supabase/supabase-js';
import { sendTransactionalEmail } from './services/emailNotifications.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const adminClient = createClient(supabaseUrl, serviceKey);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    full_name,
    email,
    phone,
    state,
    city,
    lga,
    vendor_category,
    est_monthly_orders,
  } = body;

  if (!full_name || !email || !state || !city) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'Missing required fields: full_name, email, state, city' }),
    };
  }

  // Prevent duplicate waitlist entries for same email + city
  const { data: existing } = await adminClient
    .from('vendor_location_waitlist')
    .select('id')
    .eq('email', email)
    .eq('state', state)
    .eq('city', city)
    .maybeSingle();

  if (existing) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'You are already on the waitlist for this location. We will notify you when it becomes active.',
      }),
    };
  }

  const { error } = await adminClient
    .from('vendor_location_waitlist')
    .insert({
      full_name,
      email,
      phone:               phone || null,
      state,
      city,
      lga:                 lga || null,
      vendor_category:     vendor_category || null,
      est_monthly_orders:  est_monthly_orders ? parseInt(est_monthly_orders, 10) : null,
    });

  if (error) {
    console.error('vendor-waitlist insert error:', error);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Failed to join waitlist' }),
    };
  }

  // Send confirmation email — non-blocking
  await sendTransactionalEmail({
    templateName: 'Vendor Waitlist Confirmation',
    to: email,
    data: {
      vendor_name:   full_name,
      city,
      state,
      lga:           lga || city,
      support_email: process.env.SUPPORT_EMAIL || 'support@julinemart.com',
    },
  }).catch((err) => console.error('waitlist confirmation email failed:', err));

  return {
    statusCode: 201,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      message: `You have been added to the waitlist for ${city}, ${state}. We will notify you as soon as JulineMart is ready to onboard vendors from your location.`,
    }),
  };
};
