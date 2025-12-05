const FEZ_BASE = (process.env.FEZ_API_BASE_URL || process.env.FEZ_API_URL || '').replace(/\/$/, '');

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return '+2340000000000';
  const digits = phone.replace(/\D+/g, '');
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+234${digits}`;
}

export async function createFezReturnPickup({ returnCode, customer, hub }) {
  const fezBase = FEZ_BASE;
  const fezToken = process.env.FEZ_API_KEY;
  const fezUser = process.env.FEZ_USER_ID;
  const fezPassword = process.env.FEZ_PASSWORD;

  const missing = [];
  if (!fezBase) missing.push('FEZ_API_BASE_URL');
  if (!fezToken) missing.push('FEZ_API_KEY');
  if (!fezUser) missing.push('FEZ_USER_ID');
  if (!fezPassword) missing.push('FEZ_PASSWORD');
  if (missing.length) {
    throw new Error(`Fez API not configured: ${missing.join(', ')}`);
  }

  // STEP 2 - Build POSTMAN-COMPATIBLE PAYLOAD (the payload that worked for you)
  const payload = [
    {
      recipientAddress: hub.address,
      recipientState: hub.state,
      recipientName: hub.name,
      recipientPhone: normalizePhone(hub.phone),

      pickUpAddress: customer.address,
      pickUpState: customer.state,
      senderName: customer.name,
      senderPhone: normalizePhone(customer.phone),

      uniqueID: `RETURN-${returnCode}`,
      BatchID: `RETURN-${returnCode}`,
      itemDescription: 'Return package',
      weight: 1,
      valueOfItem: '1000',
      additionalDetails: 'JulineMart Return Shipment',

      requestPickup: true,
    },
  ];

  const headers = {
    'Content-Type': 'application/json',
    'fez-token': fezToken,
    'fez-username': fezUser,
    'fez-password': fezPassword,
  };

  console.error('Fez Headers:', headers);
  console.log('FEZ RETURN PAYLOAD:', payload);

  // STEP 3 - Send return creation request using correct headers
  const res = await fetch(`${fezBase}/order`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log('FEZ RETURN RAW RESPONSE:', text);

  let data = {};
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error('Fez return JSON parse error:', err);
    data = {};
  }

  if (data.status !== 'Success') {
    throw new Error(data.description || data.message || text || 'Fez return create failed');
  }

  // Extract tracking number
  const trackingId = Object.keys(data.orderNos)[0];
  const orderId = Object.values(data.orderNos)[0];

  return {
    tracking: orderId,
    shipmentId: trackingId,
  };
}
