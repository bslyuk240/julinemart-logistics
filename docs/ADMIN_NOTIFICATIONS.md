# Admin Notifications Module (JLO)

This module adds an admin UI in JLO and uses a server-side Netlify proxy to call the existing PWA push engine.

## Environment Variables

Set these in JLO server env (Netlify/local shell), never in client-only vars:

- `PWA_BASE_URL`
- `NOTIFICATIONS_ADMIN_SECRET`

Examples:

```bash
# Local
PWA_BASE_URL=http://localhost:3000

# Preview
# PWA_BASE_URL=https://dev-lab--julinemart-pwa.netlify.app

# Production
# PWA_BASE_URL=https://julinemart.com

NOTIFICATIONS_ADMIN_SECRET=your_notifications_admin_secret
```

## Local Run

Use Netlify dev so `/api/*` redirects to Netlify Functions:

```bash
npm run netlify:dev
```

Open the admin app from the Netlify dev URL (usually `http://localhost:8888`), then:

- History: `/admin/notifications`
- Composer: `/admin/notifications/new`

## Proxy Endpoint

- JLO endpoint: `POST /api/admin/notifications/send`
- Netlify function file: `netlify/functions/admin/notifications/send.js`

Behavior:

- `audience=single`: admin/agent allowed
- any bulk/segment audience: admin only
- bulk/segment requests automatically attach `x-notifications-admin-secret` server-side

## Example Payloads

Single customer:

```json
{
  "audience": "single",
  "customerId": "58",
  "title": "Order update",
  "message": "Your order is out for delivery",
  "type": "order_update",
  "data": { "deepLink": "/orders/123" }
}
```

All customers:

```json
{
  "audience": "all_customers",
  "title": "Weekend Promo",
  "message": "Flash sale is live now",
  "type": "promotion",
  "data": { "deepLink": "/flash-sales" }
}
```

Android segment:

```json
{
  "audience": "segment",
  "segment": { "platform": "android" },
  "title": "Android feature update",
  "message": "Try the new app experience",
  "type": "general",
  "data": { "deepLink": "/product/slug" }
}
```
