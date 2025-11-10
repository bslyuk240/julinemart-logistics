#  Courier API Integration Guide

## Overview
This system provides live integration with Fez Delivery (and extensible for other couriers) for:
-  Automatic shipment creation on courier platform
-  Live tracking updates from courier API
- ✅ Shipping label/waybill generation
- ✅ Real-time status synchronization

## Setup Instructions

### 1. Database Migration
Run in Supabase SQL Editor:
```sql
-- File: supabase/migrations/courier_api_integration.sql
-- This adds API columns, logging tables, and Fez configuration
```

### 2. Get Fez Delivery API Credentials
1. Visit https://fezdispatch.com
2. Log in to your business account
3. Navigate to Settings  API Settings
4. Generate or copy your API key
5. Save the API key securely

### 3. Configure in Dashboard
1. Go to: http://localhost:3000/dashboard/courier-settings
2. Find "Fez Delivery" section
3. Enter your API key
4. Click "Save Credentials"
5. Toggle "Enable API" to ON

### 4. Test Integration
1. Go to Orders page
2. Open any order with Fez as courier
3. Click "Create Shipment on Fez Delivery"
4. System will:
   - Create shipment on Fez platform
   - Get real tracking number
   - Save shipment ID
   - Enable live tracking

## How It Works

### Order Flow with API Integration
```
1. Customer places order
   
2. Order split by hubs (automatic)
   
3. Sub-orders assigned to couriers
   
4. Staff clicks "Create Shipment" button
   
5.  API Call  Fez creates shipment
   
6.  Fez returns tracking number + label URL
   
7. Tracking number saved to database
   
8. Staff can:
   - Download shipping label
   - Track on courier website
   - Update tracking status
```

### Live Tracking
- Click "Update Tracking" button
- System fetches latest status from Fez API
- Updates automatically in your database
- Customer sees real-time status

## API Endpoints

### Create Shipment
```
POST /api/courier/create-shipment
Body: { subOrderId: "uuid" }
```

### Get Live Tracking
```
GET /api/courier/tracking/:subOrderId
```

### Download Label
```
GET /api/courier/label/:subOrderId
```

### Update Credentials (Admin)
```
PUT /api/couriers/:courierId/credentials
Body: { api_key: "key", api_enabled: true }
```

### View API Logs
```
GET /api/courier/logs?limit=50
```

## Features by Courier

| Feature | Fez Delivery | GIGL | Kwik | Custom |
|---------|--------------|------|------|--------|
| Create Shipment |  |  |  |  |
| Live Tracking |  |  |  |  |
| Label Generation |  |  |  |  |
| Rate Calculation |  |  |  |  |
| Webhook Updates |  |  |  |  |

 Implemented |  Ready to add |  Can be added

## Adding New Couriers

### Step 1: Add Courier in Database
```sql
INSERT INTO couriers (name, code, api_base_url, api_enabled, supports_live_tracking, supports_label_generation)
VALUES ('GIGL', 'GIGL', 'https://api.gigl.com/v1', false, true, true);
```

### Step 2: Implement API Methods
Edit: `src/api/services/courierAPI.ts`

Add case in `createShipment()`:
```typescript
case 'GIGL':
  return await this.createGIGLShipment(config, shipmentData);
```

Implement methods:
```typescript
private async createGIGLShipment(config, data) {
  // Your GIGL API implementation
}

private async getGIGLTracking(config, trackingNumber) {
  // Your GIGL tracking implementation
}
```

### Step 3: Add to Courier Settings UI
The page will automatically show the new courier!

## Security Notes

1. **API Keys are Encrypted**
   - Stored encrypted in database
   - Never exposed in frontend
   - Only accessible via secure API

2. **All API Calls are Logged**
   - View logs at: `/api/courier/logs`
   - Shows request/response for debugging
   - Helps identify integration issues

3. **Role-Based Access**
   - Only admins can configure credentials
   - Only admins/managers can create shipments
   - Viewers can only see tracking

## Troubleshooting

### "API credentials not configured"
 Go to Courier Settings and add API key

### "Failed to create shipment"
 Check API logs at `/api/courier/logs`
 Verify Fez credentials are correct

### "Tracking not updating"
 Click "Update Tracking" button manually
 Check if courier API is responding

### Can't see Courier Settings page
 Make sure you're logged in as Admin
 Check user role in Users page

## Testing Without Real Credentials

The system works in two modes:

1. **API Disabled** (default)
   - Manual tracking numbers
   - No real courier API calls
   - Staff enters tracking manually

2. **API Enabled** (with credentials)
   - Automatic shipment creation
   - Live tracking updates
   - Real shipping labels

You can test the entire system without API credentials by keeping it disabled!

## Support

For issues or questions:
1. Check API logs: `http://localhost:3001/api/courier/logs`
2. View courier config: `http://localhost:3000/dashboard/courier-settings`
3. Test API: Run `./test-courier-api.ps1`
