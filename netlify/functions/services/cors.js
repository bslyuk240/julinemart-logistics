const ALLOWED_ORIGIN = 'https://julinemart.com';

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  };
}

export function preflightResponse() {
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: '',
  };
}
