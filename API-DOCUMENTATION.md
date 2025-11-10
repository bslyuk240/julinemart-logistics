# JulineMart Logistics Orchestrator API

## Base URL
http://localhost:3001 (Development)

## Endpoints

### 1. Calculate Shipping Cost
**POST** /api/calc-shipping

Request:
{
  "deliveryState": "Lagos",
  "deliveryCity": "Ikeja",
  "items": [
    {
      "productId": "PROD-001",
      "quantity": 2,
      "weight": 1.5
    }
  ],
  "totalOrderValue": 25000
}

Response:
{
  "success": true,
  "data": {
    "totalShippingFee": 3500,
    "zoneName": "South West",
    "estimatedDeliveryDays": 2
  }
}

### 2. Get Zone by State
**GET** /api/zones/:state

Example: /api/zones/Lagos

Response:
{
  "success": true,
  "data": {
    "name": "South West",
    "code": "SW",
    "states": ["Lagos", "Ogun", "Oyo", "Osun", "Ondo", "Ekiti"],
    "estimated_delivery_days": 2
  }
}

### 3. Get All Orders
**GET** /api/orders?limit=50&offset=0

Response:
{
  "success": true,
  "data": [],
  "pagination": {
    "total": 0,
    "limit": 50,
    "offset": 0
  }
}

### 4. Get Order by ID
**GET** /api/orders/:id

### 5. Track Order
**GET** /api/tracking/:orderId

### 6. WooCommerce Webhook
**POST** /api/webhooks/woocommerce

## Nigerian Zones & Shipping Rates

| Zone | States | Flat Rate | Delivery Days |
|------|--------|-----------|---------------|
| South South | Delta, Edo, Bayelsa, Rivers, Cross River, Akwa Ibom | ₦2,800 | 2 days |
| South West | Lagos, Ogun, Oyo, Osun, Ondo, Ekiti | ₦3,500 | 2 days |
| South East | Abia, Anambra, Ebonyi, Enugu, Imo | ₦3,800 | 3 days |
| North Central | Abuja, FCT, Niger, Kogi, Benue, Plateau, Nassarawa, Kwara | ₦4,000 | 4 days |
| North West | Kaduna, Kano, Katsina, Kebbi, Sokoto, Zamfara, Jigawa | ₦4,500 | 5 days |
| North East | Adamawa, Bauchi, Borno, Gombe, Taraba, Yobe | ₦4,500 | 5 days |

## Hubs
- Warri Hub (Delta State) - Primary: Fez Delivery
- Lagos Hub (Lagos State) - Primary: Fez Delivery
- Abuja Hub (FCT) - Primary: GIGL

## Couriers
- Fez Delivery (Primary)
- GIGL
- Kwik Delivery
- GIG Logistics
