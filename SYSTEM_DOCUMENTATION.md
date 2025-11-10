# JulineMart Logistics Orchestrator - System Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Features](#features)
4. [API Documentation](#api-documentation)
5. [Webhook Integration](#webhook-integration)
6. [Database Schema](#database-schema)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## System Overview

JulineMart Logistics Orchestrator (JLO) is a comprehensive multi-hub logistics management platform designed for Nigerian e-commerce operations. The system handles:

- **Multi-Hub Order Management**: Automatically splits orders across Warri, Lagos, and Abuja fulfillment centers
- **Intelligent Shipping**: Weight-based calculation with VAT across 6 Nigerian shipping zones
- **Courier Integration**: Live API integration with Fez Delivery, GIGL, and Kwik
- **Real-Time Tracking**: Automatic status updates and customer notifications
- **Role-Based Access**: Admin, Manager, and Viewer roles with granular permissions
- **Audit Logging**: Complete activity trail for compliance and debugging

### Technology Stack
- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (via Supabase)
- **Authentication**: Supabase Auth with JWT
- **Deployment**: Ready for Docker/Cloud deployment

---

## Architecture

### System Flow
```
WooCommerce Store → Webhook → JLO API → Database
                                 ↓
                         Order Splitting Logic
                                 ↓
                    ┌────────────┼────────────┐
                    ↓            ↓            ↓
                Warri Hub    Lagos Hub    Abuja Hub
                    ↓            ↓            ↓
              Courier API   Courier API   Courier API
                (Fez)        (GIGL)        (Kwik)
                    ↓            ↓            ↓
                  Live Tracking Updates
                    ↓            ↓            ↓
                Customer Notifications
```

### Key Components

#### 1. Order Processing Engine
- Receives orders from WooCommerce webhook
- Validates order data and customer information
- Splits items by fulfillment hub based on vendor/product mapping
- Creates parent order and sub-orders in database

#### 2. Shipping Calculator
- Determines shipping zone from delivery state
- Looks up rates: Hub → Zone → Courier
- Calculates: Base Rate + (Extra Weight × Per KG) + VAT
- Returns total cost and breakdown per hub

#### 3. Courier Integration Module
- Unified interface for multiple courier APIs
- Creates shipments on courier platforms
- Fetches live tracking information
- Generates and downloads shipping labels
- Logs all API requests/responses

#### 4. Authentication & Authorization
- JWT-based session management
- Role-based access control (RBAC)
- Row-level security in database
- Activity logging for audit trails

---

## Features

### 1. Order Management
✅ Create orders manually or via WooCommerce webhook
✅ Automatic multi-hub splitting
✅ Order status tracking
✅ Customer information management
✅ Order history and search

### 2. Shipping Management
✅ Dynamic rate calculation
✅ 6 shipping zones (SS, SW, SE, NC, NW, NE)
✅ Weight-based pricing with VAT
✅ Hub-specific rate configurations
✅ Courier assignment logic

### 3. Courier Integration
✅ Fez Delivery API (ready)
✅ GIGL API (framework ready)
✅ Kwik API (framework ready)
✅ Automatic shipment creation
✅ Live tracking updates
✅ Label/waybill generation
✅ API request logging

### 4. User Management
✅ Role-based access (Admin, Manager, Viewer)
✅ User creation and management
✅ Permission control
✅ Activity logging
✅ Session management

### 5. Analytics & Reporting
✅ Dashboard statistics
✅ Order metrics
✅ Hub performance
✅ Courier performance
✅ Revenue tracking
✅ Export functionality

---

## API Documentation

### Base URL
```
Production: https://yourdomain.com/api
Development: http://localhost:3001/api
```

### Authentication
Most endpoints require authentication via JWT token:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

### Orders API

#### GET /api/orders
List all orders with pagination
```javascript
// Request
GET /api/orders?limit=50&offset=0

// Response
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 250,
    "limit": 50,
    "offset": 0
  }
}
```

#### POST /api/orders
Create a new order
```javascript
// Request
POST /api/orders
Content-Type: application/json

{
  "woocommerce_order_id": "12345",
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "customer_phone": "+234 800 000 0000",
  "delivery_address": "123 Main St",
  "delivery_city": "Lagos",
  "delivery_state": "Lagos",
  "delivery_country": "Nigeria",
  "subtotal": 45000,
  "shipping_fee_paid": 3500,
  "total_amount": 48500,
  "items": [
    {
      "productId": "PROD-001",
      "hubId": "hub-uuid",
      "quantity": 2,
      "weight": 1.5,
      "price": 22500
    }
  ]
}

// Response
{
  "success": true,
  "data": {
    "id": "order-uuid",
    "woocommerce_order_id": "12345",
    "overall_status": "pending",
    "sub_orders": [...]
  }
}
```

### Shipping API

#### POST /api/calc-shipping
Calculate shipping cost
```javascript
// Request
POST /api/calc-shipping
Content-Type: application/json

{
  "deliveryState": "Lagos",
  "deliveryCity": "Ikeja",
  "items": [
    {
      "hubId": "hub-uuid",
      "quantity": 2,
      "weight": 1.5
    }
  ],
  "totalOrderValue": 50000
}

// Response
{
  "success": true,
  "data": {
    "zoneName": "South West",
    "totalShippingFee": 3763,
    "subOrders": [
      {
        "hubId": "hub-uuid",
        "hubName": "Lagos Hub",
        "courierId": "courier-uuid",
        "courierName": "Fez Delivery",
        "totalWeight": 3.0,
        "baseRate": 3500,
        "additionalWeightCharge": 0,
        "subtotal": 3500,
        "vat": 263,
        "totalShippingFee": 3763,
        "deliveryTimelineDays": 2
      }
    ]
  }
}
```

### Courier Integration API

#### POST /api/courier/create-shipment
Create shipment on courier platform
```javascript
// Request
POST /api/courier/create-shipment
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "subOrderId": "sub-order-uuid"
}

// Response
{
  "success": true,
  "data": {
    "tracking_number": "FEZ123456789",
    "shipment_id": "SHIP-ABC123",
    "label_url": "https://fez.com/labels/123.pdf",
    "waybill_url": "https://fez.com/waybills/123.pdf"
  }
}
```

#### GET /api/courier/tracking/:subOrderId
Get live tracking information
```javascript
// Request
GET /api/courier/tracking/sub-order-uuid
Authorization: Bearer YOUR_JWT_TOKEN

// Response
{
  "success": true,
  "data": {
    "status": "in_transit",
    "location": "Lagos Sorting Center",
    "events": [
      {
        "status": "picked_up",
        "location": "Lagos Hub",
        "timestamp": "2025-01-08T10:00:00Z",
        "description": "Package picked up"
      },
      {
        "status": "in_transit",
        "location": "Lagos Sorting Center",
        "timestamp": "2025-01-08T14:00:00Z",
        "description": "In transit to destination"
      }
    ]
  }
}
```

---

## Webhook Integration

### WooCommerce Webhook Setup

#### Configuration
1. Go to WooCommerce → Settings → Advanced → Webhooks
2. Click "Add webhook"
3. Configure:
   - **Name**: JulineMart Logistics Orchestrator
   - **Status**: Active
   - **Topic**: Order created
   - **Delivery URL**: `https://yourdomain.com/api/webhooks/woocommerce`
   - **Secret**: (optional but recommended)
   - **API Version**: WP REST API v3

#### Payload Format
JLO expects the following payload structure:
```json
{
  "id": 12345,
  "number": "12345",
  "status": "processing",
  "customer": {
    "email": "customer@example.com",
    "first_name": "John",
    "last_name": "Doe"
  },
  "billing": {
    "phone": "+234 800 000 0000",
    "address_1": "123 Main Street",
    "city": "Lagos",
    "state": "Lagos"
  },
  "line_items": [
    {
      "product_id": 101,
      "name": "Product Name",
      "quantity": 2,
      "total": "5000.00",
      "meta_data": [
        {
          "key": "_vendor_id",
          "value": "VENDOR-1"
        },
        {
          "key": "_hub_id",
          "value": "hub-uuid"
        }
      ]
    }
  ],
  "total": "7500.00",
  "shipping_total": "2500.00"
}
```

---

## Database Schema

### Core Tables

#### orders
Main orders table
```sql
- id (uuid, PK)
- woocommerce_order_id (text, unique)
- customer_name (text)
- customer_email (text)
- customer_phone (text)
- delivery_address (text)
- delivery_state (text)
- delivery_zone (text)
- total_amount (numeric)
- shipping_fee_paid (numeric)
- overall_status (text)
- created_at (timestamp)
```

#### sub_orders
Split orders by hub
```sql
- id (uuid, PK)
- parent_order_id (uuid, FK → orders)
- hub_id (uuid, FK → hubs)
- courier_id (uuid, FK → couriers)
- tracking_number (text)
- courier_shipment_id (text)
- status (text)
- shipping_cost (numeric)
- estimated_delivery_date (timestamp)
```

#### shipping_rates
Rate configurations
```sql
- id (uuid, PK)
- origin_hub_id (uuid, FK → hubs)
- destination_zone_id (uuid, FK → zones)
- courier_id (uuid, FK → couriers)
- base_rate (numeric)
- additional_weight_rate (numeric)
- vat_percentage (numeric)
- min_weight (numeric)
- max_weight (numeric)
- is_active (boolean)
```

---

## Deployment

### Environment Variables
```bash
# Supabase
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Server
PORT=3001
NODE_ENV=production

# Optional
CORS_ORIGIN=https://yourdomain.com
```

### Docker Deployment
```dockerfile
# Coming soon
```

### Cloud Deployment
Recommended platforms:
- **Frontend**: Vercel, Netlify
- **Backend**: Railway, Render, DigitalOcean App Platform
- **Database**: Supabase (managed PostgreSQL)

---

## Troubleshooting

### Common Issues

#### 1. Webhook not receiving orders
- Check WooCommerce webhook logs
- Verify delivery URL is accessible
- Check API server logs: `npm run api:dev`
- Test with webhook tester: webhook.site

#### 2. Shipping calculation fails
- Verify hub is assigned to items
- Check shipping rates exist for hub-zone combination
- Ensure zones table has state mappings
- Review API logs: `/api/courier/logs`

#### 3. Courier API integration not working
- Verify API credentials in Courier Settings
- Check courier is enabled (api_enabled = true)
- Review API logs for error messages
- Test with courier's API documentation

#### 4. Authentication issues
- Check JWT token is valid
- Verify user has correct role
- Check RLS policies in Supabase
- Review activity logs for auth failures

### Debug Mode
Enable detailed logging:
```bash
NODE_ENV=development npm run api:dev
```

### Support
- Check Activity Logs: `/dashboard/activity`
- Review API Logs: `/api/courier/logs`
- Database logs: Supabase Dashboard
- GitHub Issues: [Your repo URL]

---

## Version History

### v2.0.0 (Current)
- ✅ Multi-hub logistics with auto-split
- ✅ Courier API integration framework
- ✅ Live tracking
- ✅ User management & RBAC
- ✅ Activity logging
- ✅ Complete documentation

### v1.0.0
- Initial release
- Basic order management
- Static shipping rates
- Manual tracking

---

**Last Updated**: January 2025
**Maintained By**: JulineMart Development Team
