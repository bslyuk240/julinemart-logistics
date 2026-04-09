const ALLOWED_ORIGINS = [
  'https://julinemart.com',
  'https://www.julinemart.com',
  'https://julinemart-pwa.netlify.app',
  'https://dev-lab--julinemart-pwa.netlify.app',
  'https://vendors.julinemart.com',
  'https://vendors-julinemart.netlify.app',
  'https://jlo.julinemart.com',
];

function getCorsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-customer-id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

export default async (request, context) => {
  const origin = request.headers.get('Origin') || '';
  const corsHeaders = getCorsHeaders(origin);

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
       status: 204,
      headers: corsHeaders
    });
  }

  // Inject CORS headers into all API responses
  const response = await context.next();
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));

  return new Response(response.body, {
    status: response.status,
    headers
  });
};
