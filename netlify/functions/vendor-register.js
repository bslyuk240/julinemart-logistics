/**
 * vendor-register.js  — PUBLIC endpoint
 * Receives a vendor KYC application and stores it pending admin review.
 * POST /api/vendor-register
 *
 * Body:
 *   personal: { full_name, email, phone, nin_bvn }
 *   business: {
 *     store_name, business_type, rc_number, business_address,
 *     state, city, lga,
 *     approved_location_id,   // UUID from approved_vendor_locations
 *     fez_collection_method   // 'fez_pickup' | 'hub_dropoff'
 *   }
 *   bank:     { bank_name, account_number, account_name }
 *   documents: { id_url, cac_url }   (pre-uploaded to Supabase Storage)
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const adminClient = createClient(supabaseUrl, serviceKey);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { personal, business, bank, documents } = body;

  // Basic validation
  const required = ['full_name','email','phone'];
  for (const f of required) {
    if (!personal?.[f]) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: `Missing field: personal.${f}` }) };
    }
  }
  if (!business?.store_name) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing field: business.store_name' }) };
  }
  if (!business?.approved_location_id) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing field: business.approved_location_id — vendor must select an approved location' }) };
  }
  if (!business?.fez_collection_method || !['fez_pickup', 'hub_dropoff'].includes(business.fez_collection_method)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing or invalid field: business.fez_collection_method (fez_pickup | hub_dropoff)' }) };
  }

  // Verify the location is still active (prevents race condition if admin pauses mid-registration)
  const { data: approvedLocation, error: locationError } = await adminClient
    .from('approved_vendor_locations')
    .select('id, state, city, lga, status')
    .eq('id', business.approved_location_id)
    .eq('status', 'active')
    .maybeSingle();

  if (locationError || !approvedLocation) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'The selected location is no longer accepting vendor registrations. Please check back later or join the waitlist.' }),
    };
  }

  // Check for duplicate email
  const { data: existing } = await adminClient
    .from('vendor_applications')
    .select('id, status')
    .eq('email', personal.email)
    .maybeSingle();

  if (existing) {
    const msg = existing.status === 'approved'
      ? 'An account with this email already exists. Please log in.'
      : 'An application with this email is already under review.';
    return { statusCode: 409, headers: cors, body: JSON.stringify({ error: msg }) };
  }

  // Also check vendors table
  const { data: existingVendor } = await adminClient
    .from('vendors')
    .select('id')
    .eq('email', personal.email)
    .maybeSingle();

  if (existingVendor) {
    return { statusCode: 409, headers: cors, body: JSON.stringify({ error: 'A vendor account with this email already exists.' }) };
  }

  // Insert application
  const { data: application, error } = await adminClient
    .from('vendor_applications')
    .insert({
      full_name:        personal.full_name,
      email:            personal.email,
      phone:            personal.phone,
      nin_bvn:          personal.nin_bvn || null,
      store_name:       business.store_name,
      business_type:    business.business_type || null,
      rc_number:        business.rc_number || null,
      business_address: business.business_address || null,
      state:                   business.state || null,
      city:                    business.city || null,
      lga:                     business.lga || null,
      approved_location_id:    business.approved_location_id,
      fez_collection_method:   business.fez_collection_method,
      bank_name:               bank?.bank_name || null,
      bank_account_number: bank?.account_number || null,
      bank_account_name:   bank?.account_name || null,
      id_document_url:  documents?.id_url || null,
      cac_document_url: documents?.cac_url || null,
      status:           'pending',
    })
    .select()
    .single();

  if (error) {
    console.error('vendor-register insert error:', error);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Failed to submit application' }) };
  }

  // TODO: send email to admin notifying of new application
  // TODO: send acknowledgement email to applicant

  return {
    statusCode: 201,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      application_id: application.id,
      message: 'Application submitted successfully. We will review and get back to you within 2-3 business days.',
    }),
  };
};
