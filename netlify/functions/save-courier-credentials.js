// Save Courier Credentials & Test Connection
// Saves encrypted API credentials and tests connection to Fez

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { requireAdmin } from './services/global-sourcing-utils.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const encryptionKey = process.env.ENCRYPTION_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// Only real Fez hosts may be hit by test_connection's server-side fetch —
// api_base_url otherwise comes straight from the request body, which would
// let anyone make this server fetch an arbitrary URL (SSRF) and see the
// response/error back.
const ALLOWED_COURIER_HOSTS = new Set(['apisandbox.fezdelivery.co', 'api.fezdelivery.co']);

function isAllowedCourierUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_COURIER_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// AES-256-GCM — authenticated encryption (the CBC-without-integrity mode
// this replaced could be tampered with undetected). Stored as
// "gcm:<iv hex>:<authTag hex>:<ciphertext hex>"; see fezAuth.js for the
// matching decrypt side.
function encrypt(text) {
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY is not configured — refusing to store courier credentials unencrypted');
  }
  const key = Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

// Test Fez API connection
async function testFezConnection(userId, password, baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/user/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        password: password,
      }),
    });

    const data = await response.json();

    if (data.status === 'Success') {
      return {
        success: true,
        message: 'Connection successful!',
        orgName: data.orgDetails['Org Full Name'],
        userName: data.userDetails['Full Name'],
        secretKey: data.orgDetails['secret-key'],
      };
    } else {
      return {
        success: false,
        message: data.description || 'Authentication failed',
      };
    }
  } catch (error) {
    console.error('Connection test error:', error);
    return {
      success: false,
      message: 'Failed to connect to Fez API: ' + error.message,
    };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'PUT' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    // Get courier ID from path
    const pathParts = event.path.split('/').filter(Boolean);
    const fnIndex = pathParts.findIndex((segment) => segment === 'save-courier-credentials');
    const courierId = fnIndex >= 0 ? pathParts[fnIndex + 1] : undefined;

    if (!courierId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Courier ID required' }),
      };
    }

    const payload = JSON.parse(event.body || '{}');

    // Handle test connection request
    if (payload.action === 'test_connection') {
      const { api_user_id, api_password, api_base_url } = payload;

      if (!api_user_id || !api_password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User ID and password required for testing',
          }),
        };
      }

      const baseUrl = api_base_url || 'https://apisandbox.fezdelivery.co/v1';
      if (!isAllowedCourierUrl(baseUrl)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'api_base_url must be a recognized Fez API host' }),
        };
      }
      const testResult = await testFezConnection(api_user_id, api_password, baseUrl);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(testResult),
      };
    }

    // Handle save credentials
    const updateData = {};

    if (payload.api_user_id) {
      updateData.api_user_id = payload.api_user_id;
    }

    if (payload.api_password) {
      updateData.api_password = encrypt(payload.api_password);
    }

    if (payload.api_key) {
      updateData.api_credentials_encrypted = encrypt(payload.api_key);
    }

    if (payload.api_secret) {
      updateData.api_secret_encrypted = encrypt(payload.api_secret);
    }

    if (payload.api_base_url) {
      updateData.api_base_url = payload.api_base_url;
    }

    if (typeof payload.api_enabled === 'boolean') {
      updateData.api_enabled = payload.api_enabled;
    }

    if (Object.keys(updateData).length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No valid fields to update',
        }),
      };
    }

    // Update courier credentials
    const { data, error } = await supabase
      .from('couriers')
      .update(updateData)
      .eq('id', courierId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Log activity
    await supabase.from('activity_logs').insert({
      user_id: 'admin',
      action: 'courier_credentials_updated',
      description: `Updated credentials for courier: ${data.name}`,
      metadata: { courierId, fields: Object.keys(updateData) },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Credentials saved successfully',
        data: {
          id: data.id,
          name: data.name,
          api_enabled: data.api_enabled,
        },
      }),
    };
  } catch (error) {
    console.error('Error saving credentials:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to save credentials',
        message: error.message,
      }),
    };
  }
};
