const ALLOWED_ORIGINS = [
  'https://julinemart.com',
  'https://jlo.julinemart.com',
  'https://vendors.julinemart.com',
  'https://vendors-julinemart.netlify.app',
];

export function corsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  };
}

export function preflightResponse(requestOrigin) {
  return {
    statusCode: 200,
    headers: corsHeaders(requestOrigin),
    body: '',
  };
}
