# 🎨 Customer Order Tracking Portal

## Overview

The Customer Order Tracking Portal is a **public-facing** web application that allows customers to track their orders in real-time without logging in.

---

## Features

### 1. Order Tracking
- **Public access** - No login required
- **Real-time updates** - Live shipment tracking
- **Multi-shipment support** - Orders split across hubs
- **Timeline view** - Visual tracking history
- **Courier links** - Direct links to courier tracking

### 2. Shipping Estimate Calculator
- **Instant quotes** - Real-time shipping calculations
- **Zone-based pricing** - Accurate rates by location
- **Weight-based** - Calculate by package weight
- **Transparent breakdown** - See base rate + VAT

### 3. Security
- **Email verification** - Orders only accessible with correct email
- **No sensitive data exposed** - Payment info hidden
- **Read-only access** - Customers can't modify orders

---

## How It Works

### Customer Workflow
```
1. Customer places order on WooCommerce
   ↓
2. Receives confirmation email with order number
   ↓
3. Visits tracking portal: track.julinemart.com
   ↓
4. Enters: Order Number + Email
   ↓
5. Views real-time tracking + timeline
   ↓
6. Gets delivery updates
```

### Portal Pages

#### 1. Landing Page (/)
- Hero section with tracking form
- Feature highlights
- Delivery timeline explanation
- Links to estimate calculator

#### 2. Tracking Page (/track)
- Order summary
- Customer & delivery info
- Shipment cards (one per hub)
- Tracking timeline with events
- Courier tracking links
- Help section

#### 3. Shipping Estimate (/estimate)
- Calculator form
- Real-time rate calculation
- Zone and courier breakdown
- Delivery time estimates

---

## Running the Customer Portal

### Development

**Option 1: Run separately**
```bash
# Terminal 1: API Server
npm run api:dev

# Terminal 2: Customer Portal
npm run portal:dev
```

**Option 2: Run all together**
```bash
npm run dev:all
# Runs dashboard (3000) + API (3001) + portal (3002)
```

### Access URLs

- **Customer Portal**: http://localhost:3002
- **Admin Dashboard**: http://localhost:3000
- **API Server**: http://localhost:3001

---

## API Endpoints

### Public Tracking (No Auth)

#### GET /api/track-order
Track an order by order number and email
```javascript
GET /api/track-order?orderNumber=12345&email=customer@example.com

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "woocommerce_order_id": "12345",
    "customer_name": "John Doe",
    "overall_status": "in_transit",
    "sub_orders": [
      {
        "tracking_number": "FEZ123456",
        "status": "in_transit",
        "hubs": { "name": "Lagos Hub" },
        "couriers": { "name": "Fez Delivery" },
        "tracking_events": [...]
      }
    ]
  }
}
```

#### POST /api/shipping-estimate
Calculate shipping cost estimate
```javascript
POST /api/shipping-estimate
Body: {
  "state": "Lagos",
  "city": "Ikeja",
  "items": [
    {
      "hubId": "default",
      "quantity": 1,
      "weight": 2.5,
      "price": 50000
    }
  ]
}

Response:
{
  "success": true,
  "data": {
    "zoneName": "South West",
    "totalShippingFee": 3763,
    "subOrders": [...]
  }
}
```

---

## Deployment

### Option 1: Vercel (Recommended)

**Deploy Customer Portal:**
```bash
npm run portal:build
cd dist/customer-portal
vercel --prod
```

**Custom Domain:**
- Set up: `track.julinemart.com`
- Point to Vercel deployment

### Option 2: Netlify
```bash
npm run portal:build
netlify deploy --prod --dir=dist/customer-portal
```

### Option 3: Same Domain (Subdirectory)

Deploy both dashboard and portal on same domain:
- `https://julinemart.com/` - Main site
- `https://julinemart.com/track` - Customer portal
- `https://julinemart.com/dashboard` - Admin dashboard

---

## Configuration

### Environment Variables

Customer portal uses the same `.env` as dashboard:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### Branding Customization

Edit these files to customize:
- `src/customer-portal/pages/Landing.tsx` - Colors, logo, text
- `tailwind.config.js` - Theme colors
- `customer-portal.html` - Title, meta tags

---

## Email Integration

### Order Confirmation Email

Include tracking link in WooCommerce emails:
```html
<p>Track your order:</p>
<a href="https://track.julinemart.com/?order={{order_number}}&email={{customer_email}}">
  Click here to track
</a>
```

### Tracking Link Format
```
https://track.julinemart.com/?order=12345&email=customer@example.com
```

The portal will:
1. Validate order number + email
2. Fetch order details
3. Display tracking information

---

## Security Features

### Email Verification
- Orders only accessible with correct email
- Prevents unauthorized tracking
- Case-insensitive email matching

### No Sensitive Data
- No payment information exposed
- No internal order IDs visible
- Only public tracking data shown

### Rate Limiting (Recommended)
Add rate limiting to prevent abuse:
```javascript
// In API index.ts
import rateLimit from 'express-rate-limit';

const trackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP
  message: 'Too many tracking requests'
});

app.get('/api/track-order', trackingLimiter, trackOrderPublicHandler);
```

---

## Customer Support

### Help Section
Each tracking page includes:
- Email support link
- Phone support link
- FAQ link (optional)

### Common Issues

**"Order not found"**
- Check order number is correct
- Verify email matches order email
- Wait 5-10 minutes after order placed

**"No tracking updates"**
- Order may still be processing
- Tracking updates appear once shipped
- Check estimated ship date

---

## Tracking Events

### Event Types

| Status | Description |
|--------|-------------|
| pending | Order received, awaiting processing |
| processing | Being packed at warehouse |
| in_transit | Out for delivery with courier |
| delivered | Successfully delivered |
| cancelled | Order cancelled |

### Timeline Display

Events shown in reverse chronological order:
1. Most recent event (highlighted)
2. Previous events
3. Order creation

---

## Testing

### Test Tracking

1. Create test order in dashboard
2. Note order number and email
3. Visit customer portal
4. Enter credentials
5. Verify tracking displays correctly

### Test Estimate Calculator

1. Go to `/estimate`
2. Select state (e.g., Lagos)
3. Enter weight (e.g., 2.5 kg)
4. Click calculate
5. Verify rates display

---

## Analytics (Optional)

Track customer portal usage:
```javascript
// Add to Landing.tsx
useEffect(() => {
  // Google Analytics
  window.gtag('config', 'GA_MEASUREMENT_ID', {
    page_path: window.location.pathname,
  });
}, []);
```

Metrics to track:
- Tracking page views
- Successful order lookups
- Failed order lookups
- Estimate calculator usage
- Average time on page

---

## Customization Examples

### Add Company Logo
```tsx
// In Landing.tsx
<h1 className="text-2xl font-bold text-primary-600">
  <img src="/logo.png" alt="JulineMart" className="h-8" />
</h1>
```

### Add Live Chat
```tsx
// In Track.tsx, add before help section
<div className="bg-white rounded-lg p-4">
  <button onClick={() => openLiveChat()}>
    Chat with Support
  </button>
</div>
```

### Add SMS Notifications

Allow customers to subscribe to SMS updates:
```tsx
<form onSubmit={subscribeSMS}>
  <input type="tel" placeholder="Phone number" />
  <button>Get SMS Updates</button>
</form>
```

---

## Maintenance

### Update Tracking Statuses

Add new statuses in `Track.tsx`:
```typescript
const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    // Add your custom statuses
    out_for_delivery: 'bg-orange-100 text-orange-800',
    // ...
  };
  return colors[status] || 'bg-gray-100 text-gray-800';
};
```

### Update Shipping Zones

Edit state-to-zone mapping in API if zones change.

---

## Performance

### Optimization Tips

1. **Lazy Loading**
```tsx
   const Track = lazy(() => import('./pages/Track'));
```

2. **Caching**
   - Cache shipping rate calculations
   - Use service worker for offline support

3. **CDN**
   - Deploy static assets to CDN
   - Use image optimization

---

## Support

**Customer Portal Issues:**
- Check browser console for errors
- Verify API server is running
- Check CORS configuration
- Review Supabase connection

**Contact:**
- Email: support@julinemart.com
- Phone: +234 800 000 0000

---

**Last Updated**: January 2025
