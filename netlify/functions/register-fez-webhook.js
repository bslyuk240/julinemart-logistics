// Register Fez Webhook - One-time Setup Script
// Run this once to register your webhook with Fez

const WEBHOOK_URL = 'https://jlo.julinemart.com/.netlify/functions/fez-webhook';
const FEZ_BASE_URL = 'https://apisandbox.fezdelivery.co/v1'; // Change to production later

// STEP 1: Authenticate to get secret key
async function authenticateAndRegisterWebhook(userId, password) {
  try {
    console.log('Step 1: Authenticating with Fez...');
    
    // Authenticate
    const authResponse = await fetch(`${FEZ_BASE_URL}/user/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        password: password,
      }),
    });

    const authData = await authResponse.json();

    if (authData.status !== 'Success') {
      throw new Error('Authentication failed: ' + authData.description);
    }

    console.log('✅ Authentication successful!');
    console.log('Organization:', authData.orgDetails['Org Full Name']);

    const secretKey = authData.orgDetails['secret-key'];
    console.log('Secret Key:', secretKey);

    // STEP 2: Register webhook
    console.log('\nStep 2: Registering webhook...');
    console.log('Webhook URL:', WEBHOOK_URL);

    const webhookResponse = await fetch(`${FEZ_BASE_URL}/webhooks/store`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'secret-key': secretKey,
      },
      body: JSON.stringify({
        webhook: WEBHOOK_URL,
      }),
    });

    const webhookData = await webhookResponse.json();

    console.log('\n=== WEBHOOK REGISTRATION RESULT ===');
    console.log(JSON.stringify(webhookData, null, 2));

    if (webhookData.status === 'Success' || webhookResponse.ok) {
      console.log('\n✅ SUCCESS! Webhook registered successfully!');
      console.log('Your webhook is now active at:', WEBHOOK_URL);
    } else {
      console.log('\n⚠️  Registration response:', webhookData);
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Full error:', error);
  }
}

// USAGE:
// Replace these with your actual Fez credentials
const YOUR_USER_ID = 'YOUR_FEZ_USER_ID_HERE';  // e.g., "G-4568-3493"
const YOUR_PASSWORD = 'YOUR_FEZ_PASSWORD_HERE';

// Run the function
authenticateAndRegisterWebhook(YOUR_USER_ID, YOUR_PASSWORD);

// ========================================
// HOW TO RUN THIS SCRIPT:
// ========================================
// 1. Save this file as: register-fez-webhook.js
// 2. Replace YOUR_USER_ID and YOUR_PASSWORD with your actual credentials
// 3. Run in terminal:
//    node register-fez-webhook.js
// 4. You should see: "SUCCESS! Webhook registered successfully!"