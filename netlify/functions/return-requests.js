// Retired. Return requests are created through returns-create, which requires
// the customer's login, checks they own the order, and enforces the return
// window.
//
// This legacy endpoint accepted anyone's POST with no login and inserted a
// return_requests row for any order id (spam into the staff returns queue, no
// ownership check, no window). Nothing in the storefront or dashboard calls it,
// so it now answers 410 instead of creating anything.

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  return {
    statusCode: 410,
    headers,
    body: JSON.stringify({
      success: false,
      error: 'This endpoint has been retired. Request a return from your order page.',
    }),
  };
}
