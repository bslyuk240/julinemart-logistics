/**
 * GET /.netlify/functions/vendor-firebase-config
 * Returns Firebase client config for the vendor portal service worker.
 * Public — the values here are not secrets (they're embedded in any web app).
 */
export const handler = async () => {
  const config = {
    apiKey:            process.env.FIREBASE_API_KEY            || '',
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN        || '',
    projectId:         process.env.FIREBASE_PROJECT_ID         || '',
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET     || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId:             process.env.FIREBASE_APP_ID             || '',
  };
  const vapidKey = process.env.FIREBASE_WEB_VAPID_KEY || '';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ config, vapidKey }),
  };
};
