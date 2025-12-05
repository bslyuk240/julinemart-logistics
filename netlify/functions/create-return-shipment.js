// Netlify proxy to Supabase Edge Function: create-return-shipment
// Keeps service-role auth on the server and exposes a simple /api/create-return-shipment endpoint

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

function getFunctionUrl() {
  if (!supabaseUrl) {
    throw new Error('SUPABASE URL missing');
  }
  const base = supabaseUrl.replace(/\/$/, '');
  return `${base}/functions/v1/create-return-shipment`;
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ success: false, error: `${event.httpMethod} not supported` }),
      };
    }

    if (!supabaseServiceKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Supabase service key not configured' }),
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const functionUrl = getFunctionUrl();

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    return {
      statusCode: response.status,
      headers,
      body: text || JSON.stringify({ success: response.ok }),
    };
  } catch (error) {
    console.error('create-return-shipment netlify proxy error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Failed to create return shipment' }),
    };
  }
}
